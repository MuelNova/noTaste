import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Env } from './env';

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export function accessConfigured(env: Env) {
  return !!(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD && env.OWNER_EMAIL);
}
export async function verifyAccessToken(token: string, env: Env, testKey?: JWTVerifyGetKey) {
  if (!accessConfigured(env)) throw new Error('Cloudflare Access 尚未配置');
  const issuer = env.CF_ACCESS_TEAM_DOMAIN!.replace(/\/$/, '');
  const url = new URL(issuer);
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(url.hostname) ||
    url.origin !== issuer
  ) {
    throw new Error('Cloudflare Access 域名配置无效');
  }
  if (!testKey && !keySets.has(issuer)) {
    keySets.set(
      issuer,
      createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer), { timeoutDuration: 5000 }),
    );
  }
  const { payload } = await jwtVerify(token, testKey ?? keySets.get(issuer)!, {
    issuer,
    audience: env.CF_ACCESS_AUD,
    algorithms: ['RS256'],
    requiredClaims: ['exp', 'sub', 'email'],
  });
  if (
    typeof payload.email !== 'string' ||
    payload.email.trim().toLowerCase() !== env.OWNER_EMAIL!.trim().toLowerCase()
  ) {
    throw new Error('此邮箱不是站点主人');
  }
  return {
    email: payload.email.toLowerCase(),
    expires: Math.min(payload.exp! * 1000, Date.now() + 86400000),
  };
}
