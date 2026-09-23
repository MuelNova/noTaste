import type { Play, Track } from '../shared/schema';
import { type Env, appUrl } from './env';
import { decrypt, encrypt } from './security';
import { notifySpotifyFailure, clearSpotifyAlert } from './notifications';
class SpotifyTokenError extends Error {
  constructor(readonly status: number) {
    super(`Spotify 授权失败 (${status})，请检查应用设置或重新连接`);
  }
}
type Token = { access_token: string; refresh_token: string; expires_at: number };
export async function exchange(env: Env, params: Record<string, string>) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(env.SPOTIFY_CLIENT_ID + ':' + env.SPOTIFY_CLIENT_SECRET),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new SpotifyTokenError(r.status);
  return (await r.json()) as { access_token: string; refresh_token?: string; expires_in: number };
}
export async function saveToken(env: Env, token: Token) {
  await env.DB.prepare(
    'INSERT INTO auth VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted, updated_at=excluded.updated_at',
  )
    .bind('spotify', await encrypt(token, env), new Date().toISOString())
    .run();
}
export async function connect(env: Env, code: string) {
  const t = await exchange(env, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: appUrl(env) + '/api/auth/spotify/callback',
  });
  if (!t.refresh_token) throw new Error('Spotify 没有返回长期授权，请重新连接');
  await saveToken(env, {
    ...t,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + t.expires_in * 1000,
  });
  await clearSpotifyAlert(env);
}
async function token(env: Env) {
  const row = await env.DB.prepare('SELECT encrypted FROM auth WHERE id=?')
    .bind('spotify')
    .first<{ encrypted: string }>();
  if (!row) throw new Error('请先连接 Spotify');
  let t: Token;
  try {
    t = await decrypt<Token>(row.encrypted, env);
  } catch {
    await notifySpotifyFailure(env, 'storage');
    throw new Error('Spotify 授权无法读取，请主人重新连接');
  }
  if (t.expires_at < Date.now() + 60000) {
    try {
      const fresh = await exchange(env, {
        grant_type: 'refresh_token',
        refresh_token: t.refresh_token,
      });
      t = {
        access_token: fresh.access_token,
        refresh_token: fresh.refresh_token ?? t.refresh_token,
        expires_at: Date.now() + fresh.expires_in * 1000,
      };
      await saveToken(env, t);
      await clearSpotifyAlert(env);
    } catch (e) {
      await notifySpotifyFailure(
        env,
        e instanceof SpotifyTokenError && e.status === 401 ? 'credentials' : 'refresh',
      );
      throw new Error('Spotify 授权续期失败，请主人检查连接；已尝试发送提醒（需配置 Telegram）');
    }
  }
  return t.access_token;
}
export async function spotify<T>(env: Env, path: string): Promise<T> {
  const url = new URL(path, 'https://api.spotify.com/v1/');
  if (url.origin !== 'https://api.spotify.com' || !url.pathname.startsWith('/v1/'))
    throw new Error('无效 Spotify 分页地址');
  const r = await fetch(url, {
    headers: { Authorization: 'Bearer ' + (await token(env)) },
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 429)
    throw new Error(
      `Spotify 配额暂不可用，请稍后重试（建议等待 ${r.headers.get('Retry-After') ?? '一段时间'} 秒）`,
    );
  if (!r.ok) throw new Error(`Spotify 请求失败 (${r.status})`);
  return r.json() as Promise<T>;
}
export function normalize(t: any): Track | null {
  if (!t?.id || !t?.name || !Array.isArray(t.artists) || t.is_local) return null;
  return {
    id: t.id,
    name: t.name,
    artists: t.artists.map((a: any) => ({ id: a.id ?? a.name, name: a.name })),
    album: t.album?.name ?? '',
    image: t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url ?? null,
    url: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}`,
    release_date: t.album?.release_date ?? '',
    duration_ms: t.duration_ms ?? 0,
  };
}
export async function recent(env: Env, since: string) {
  let path: string | null = 'me/player/recently-played?limit=50';
  const seen = new Set<string>(),
    plays: Play[] = [];
  let pages = 0;
  while (path && pages < 8 && !seen.has(path)) {
    seen.add(path);
    const data: { items: any[]; next: string | null } = await spotify(env, path);
    pages++;
    for (const item of data.items ?? []) {
      const track = normalize(item.track);
      if (track && Number.isFinite(Date.parse(item.played_at)))
        plays.push({
          track,
          played_at: new Date(item.played_at).toISOString(),
          context: item.context?.type ?? null,
        });
    }
    if (!data.items?.length || data.items.some((x) => x.played_at < since)) {
      path = null;
      break;
    }
    path = data.next ?? null;
  }
  return { plays, capped: !!path };
}
const clean = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]/gu, '');
export async function findTrack(env: Env, name: string, artist: string) {
  const q = `track:${name.replace(/["\\]/g, '')} artist:${artist.replace(/["\\]/g, '')}`;
  const result = await spotify<{ tracks: { items: any[] } }>(
    env,
    'search?type=track&limit=5&q=' + encodeURIComponent(q),
  );
  const match = result.tracks?.items.find(
    (t) =>
      clean(t.name) === clean(name) && t.artists?.some((a: any) => clean(a.name) === clean(artist)),
  );
  return normalize(match);
}
