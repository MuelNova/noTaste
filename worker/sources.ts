import type { Source, Track } from '../shared/schema';
import type { Env } from './env';
export async function songSource(env: Env, track: Track): Promise<Source | null> {
  const cached = await env.DB.prepare(
    'SELECT data FROM sources WHERE track_id=? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(track.id)
    .first<{ data: string }>();
  if (cached) return JSON.parse(cached.data);
  const u = new URL('https://en.wikipedia.org/w/api.php');
  u.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `"${track.name}" "${track.artists[0]?.name}" song`,
    gsrnamespace: '0',
    gsrlimit: '2',
    prop: 'extracts|info',
    explaintext: '1',
    exintro: '1',
    exchars: '5000',
    inprop: 'url',
  }).toString();
  try {
    const r = await fetch(u, {
      headers: { 'User-Agent': 'NoTasteToday/0.1 (personal music journal)' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as any;
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N}]/gu, '');
    const page = (Object.values(data.query?.pages ?? {}) as any[]).find(
      (p) =>
        normalize(p.title).includes(normalize(track.name)) &&
        normalize(p.extract ?? '').includes(normalize(track.artists[0]?.name ?? '')),
    );
    if (!page?.extract || !page.fullurl?.startsWith('https://en.wikipedia.org/wiki/')) return null;
    const source: Source = {
      id: 'wiki-' + page.pageid,
      track_id: track.id,
      title: page.title + ' · Wikipedia',
      url: page.fullurl,
      excerpt: page.extract.slice(0, 5000),
    };
    await env.DB.prepare('INSERT OR REPLACE INTO sources VALUES (?, ?, ?, ?)')
      .bind(source.id, track.id, JSON.stringify(source), new Date().toISOString())
      .run();
    return source;
  } catch {
    return null;
  }
}
