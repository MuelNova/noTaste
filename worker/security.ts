import { type Env, isLocal } from './env';
const encoder = new TextEncoder();
function bytes(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
function base64(value: ArrayBuffer | Uint8Array) {
  return btoa(String.fromCharCode(...new Uint8Array(value)));
}
async function key(env: Env) {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error('请先运行本地配置初始化');
  return crypto.subtle.importKey('raw', bytes(env.TOKEN_ENCRYPTION_KEY), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}
export async function encrypt(value: unknown, env: Env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await key(env),
    encoder.encode(JSON.stringify(value)),
  );
  return base64(iv) + '.' + base64(cipher);
}
export async function decrypt<T>(value: string, env: Env): Promise<T> {
  const [iv, data] = value.split('.');
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv) }, await key(env), bytes(data)),
    ),
  );
}
export function cookies(request: Request) {
  return Object.fromEntries(
    (request.headers.get('Cookie') ?? '')
      .split(';')
      .filter((x) => x.includes('='))
      .map((x) => {
        const index = x.indexOf('=');
        return [x.slice(0, index).trim(), x.slice(index + 1)];
      }),
  );
}
export function cookie(name: string, value: string, request: Request, maxAge = 3600) {
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export type OwnerSession = {
  role: 'owner';
  method: 'password' | 'cloudflare';
  email?: string;
  expires: number;
};
export async function verifiedSession(request: Request, env: Env): Promise<OwnerSession | null> {
  try {
    const session = await decrypt<OwnerSession>(cookies(request).taste_session, env);
    if (
      session.role !== 'owner' ||
      !Number.isFinite(session.expires) ||
      session.expires <= Date.now()
    )
      return null;
    if (session.method === 'password' && env.ADMIN_PASSWORD) return session;
    if (
      session.method === 'cloudflare' &&
      env.CF_ACCESS_AUD &&
      env.CF_ACCESS_TEAM_DOMAIN &&
      env.OWNER_EMAIL &&
      session.email === env.OWNER_EMAIL.trim().toLowerCase()
    )
      return session;
    return null;
  } catch {
    return null;
  }
}
export async function isOwner(request: Request, env: Env) {
  return !!(await verifiedSession(request, env)) || (isLocal(request, env) && !env.ADMIN_PASSWORD);
}
export function sameOrigin(request: Request, env: Env) {
  const origin = request.headers.get('Origin');
  return !!origin && origin === new URL(env.APP_URL).origin;
}
export async function equal(a: string, b: string) {
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(s)));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
