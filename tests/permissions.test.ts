import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { claimJob, generationState, allowedPeriod, COOLDOWN_MS } from '../worker/jobs';
import { verifyAccessToken } from '../worker/access';
import { verifiedSession, encrypt } from '../worker/security';
import { notifySpotifyFailure, clearSpotifyAlert } from '../worker/notifications';
import { spotify } from '../worker/spotify';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { checkModel } from '../worker/llm';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of ['0001_initial.sql', '0002_notifications.sql'])
    sqlite.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const DB = {
    prepare(sql: string) {
      const statement = (args: unknown[]) => ({
        bind(...values: unknown[]) {
          return statement(values);
        },
        async run() {
          const result = sqlite.prepare(sql).run(...(args as any[]));
          return { meta: { changes: Number(result.changes) } };
        },
        async first() {
          return sqlite.prepare(sql).get(...(args as any[])) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...(args as any[])) };
        },
      });
      return statement([]);
    },
  } as unknown as D1Database;
  const env = {
    DB,
    APP_URL: 'https://taste.example.com',
    TIMEZONE: 'Australia/Perth',
    PUBLIC_REPORTS: 'true',
    KIMI_API_KEY: 'test',
    TOKEN_ENCRYPTION_KEY: btoa('12345678901234567890123456789012'),
  } as Env;
  return { env, sqlite };
}
const now = new Date('2026-09-23T08:00:00Z');
const later = (ms: number) => new Date(now.getTime() + ms);

test('model diagnostics retain gateway failures without HTML or credentials', async () => {
  const original = globalThis.fetch;
  const env = { KIMI_API_KEY: 'private-key', KIMI_BASE_URL: 'https://model.example.com' } as Env;
  globalThis.fetch = (async () =>
    new Response(
      '<html><script>unsafe()</script><h1>Access denied</h1><p>error code: 1020 private-key</p></html>',
      { status: 403 },
    )) as typeof fetch;
  try {
    await assert.rejects(
      () => checkModel(env),
      (error: Error) => {
        assert.match(error.message, /Access denied/);
        assert.match(error.message, /1020/);
        assert(!/private-key|unsafe|<html>/.test(error.message));
        return true;
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('model diagnostics require a verified same-origin owner and redact provider errors', async () => {
  const { env, sqlite } = database();
  env.ADMIN_PASSWORD = 'a-long-test-password';
  env.KIMI_API_KEY = 'test-private-model-key';
  env.KIMI_BASE_URL = 'https://model.example.com/v1';
  env.KIMI_MODEL = 'test-model';
  const session = await encrypt(
    { role: 'owner', method: 'password', expires: Date.now() + 60000 },
    env,
  );
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url, options) => {
    calls++;
    const body = JSON.parse(options!.body as string);
    assert.equal(body.max_tokens, 4);
    return Response.json(
      { error: { message: 'IP blocked; credential ' + env.KIMI_API_KEY } },
      { status: 403 },
    );
  }) as typeof fetch;
  const request = (origin: string, authenticated = false) =>
    new Request(env.APP_URL + '/api/admin/model-check', {
      method: 'POST',
      headers: { Origin: origin, ...(authenticated ? { Cookie: 'taste_session=' + session } : {}) },
    });
  try {
    assert.equal((await worker.fetch(request(env.APP_URL), env)).status, 401);
    assert.equal((await worker.fetch(request('https://elsewhere.example', true), env)).status, 403);
    assert.equal(calls, 0);
    const response = await worker.fetch(request(env.APP_URL, true), env);
    const result = await response.text();
    assert.equal(calls, 1);
    assert.match(result, /403/);
    assert.match(result, /IP blocked/);
    assert(!result.includes(env.KIMI_API_KEY));
  } finally {
    globalThis.fetch = original;
    sqlite.close();
  }
});

test('shared cooldown is atomic, covers failures and survives midnight', async () => {
  const { env, sqlite } = database();
  const results = await Promise.all(
    Array.from({ length: 12 }, () => claimJob(env, 'day:2026-09-23', { manual: true, now })),
  );
  assert.equal(results.filter(Boolean).length, 1);
  sqlite.exec("UPDATE jobs SET status='failed'");
  assert.equal(
    await claimJob(env, 'day:2026-09-24', { manual: true, now: later(COOLDOWN_MS - 1) }),
    false,
  );
  assert.equal((await generationState(env, false, later(COOLDOWN_MS - 1000))).cooldown_seconds, 1);
  assert.equal(
    await claimJob(env, 'day:2026-09-23', { manual: true, now: later(COOLDOWN_MS) }),
    true,
  );
  sqlite.close();
});
test('owner can overwrite completed reports but cannot launch overlapping manual jobs', async () => {
  const { env, sqlite } = database();
  assert(await claimJob(env, 'day:2026-09-22', { now }));
  assert.equal(
    await claimJob(env, 'week:2026-09-21', { manual: true, verified: true, now }),
    false,
  );
  sqlite.exec("UPDATE jobs SET status='complete'");
  assert.equal(await claimJob(env, 'day:2026-09-22', { now }), false);
  assert(await claimJob(env, 'day:2026-09-22', { manual: true, verified: true, now }));
  assert.equal((await generationState(env, true, now)).cooldown_seconds, 0);
  sqlite.close();
});
test('scheduled jobs ignore manual cooldown and remain idempotent', async () => {
  const { env, sqlite } = database();
  assert(await claimJob(env, 'day:2026-09-23', { manual: true, now }));
  sqlite.exec("UPDATE jobs SET status='complete'");
  assert(await claimJob(env, 'day:2026-09-22', { now }));
  assert(await claimJob(env, 'week:2026-09-21', { now }));
  sqlite.exec("UPDATE jobs SET status='complete'");
  assert.equal(await claimJob(env, 'week:2026-09-21', { now }), false);
  sqlite.close();
});
test('ordinary mode restricts dates by site timezone and never accepts future periods', () => {
  const boundary = new Date('2026-09-23T16:00:00Z');
  assert(allowedPeriod('day', '2026-09-24', false, 'Australia/Perth', boundary));
  assert(!allowedPeriod('day', '2026-09-23', false, 'Australia/Perth', boundary));
  assert(!allowedPeriod('week', '2026-09-24', false, 'Australia/Perth', boundary));
  assert(allowedPeriod('month', '2025-01-01', true, 'Australia/Perth', boundary));
  assert(!allowedPeriod('day', '2026-09-25', true, 'Australia/Perth', boundary));
});
test('Cloudflare identity requires valid signature, audience, expiry and exact owner email', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const key = await exportJWK(publicKey);
  key.kid = 'test';
  const jwks = createLocalJWKSet({ keys: [key] });
  const env = {
    CF_ACCESS_TEAM_DOMAIN: 'https://taste.cloudflareaccess.com',
    CF_ACCESS_AUD: 'app-audience',
    OWNER_EMAIL: 'owner@example.com',
  } as Env;
  const signed = async (
    email = 'owner@example.com',
    aud = 'app-audience',
    exp = '1h',
    issuer = env.CF_ACCESS_TEAM_DOMAIN!,
  ) =>
    new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject('owner-id')
      .setIssuer(issuer)
      .setAudience(aud)
      .setExpirationTime(exp)
      .sign(privateKey);
  assert.equal((await verifyAccessToken(await signed(), env, jwks)).email, 'owner@example.com');
  for (const token of [
    await signed('other@example.com'),
    await signed(undefined, 'other-app'),
    await signed(undefined, undefined, '-1s'),
    await signed(undefined, undefined, undefined, 'https://evil.example'),
    (await signed()).slice(0, -10) + 'tampered00',
  ])
    await assert.rejects(() => verifyAccessToken(token, env, jwks));
});
test('local access and unsigned email headers cannot grant owner override', async () => {
  const { env, sqlite } = database();
  env.APP_URL = 'http://127.0.0.1:8787';
  assert.equal(
    await verifiedSession(
      new Request(env.APP_URL, {
        headers: { 'Cf-Access-Authenticated-User-Email': 'owner@example.com' },
      }),
      env,
    ),
    null,
  );
  const old = await encrypt({ expires: Date.now() + 60000 }, env);
  assert.equal(
    await verifiedSession(
      new Request(env.APP_URL, { headers: { Cookie: 'taste_session=' + old } }),
      env,
    ),
    null,
  );
  env.ADMIN_PASSWORD = 'a-long-test-password';
  const session = await encrypt(
    { role: 'owner', method: 'password', expires: Date.now() + 60000 },
    env,
  );
  assert(
    await verifiedSession(
      new Request(env.APP_URL, { headers: { Cookie: 'taste_session=' + session } }),
      env,
    ),
  );
  sqlite.close();
});
test('HTTP routes reject spoofed overrides, historical generation and unauthenticated Spotify connection', async () => {
  const { env, sqlite } = database();
  sqlite
    .prepare('INSERT INTO auth VALUES (?,?,?)')
    .run('spotify', 'fake', new Date().toISOString());
  await claimJob(env, 'day:today', { manual: true });
  sqlite.exec("UPDATE jobs SET status='partial'");
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: env.TIMEZONE }).format(new Date());
  const post = (date: string, type = 'day') =>
    new Request(env.APP_URL + '/api/generate', {
      method: 'POST',
      headers: {
        Origin: env.APP_URL,
        'Content-Type': 'application/json',
        'Cf-Access-Authenticated-User-Email': 'owner@example.com',
      },
      body: JSON.stringify({ date, type, force: true, verified_owner: true }),
    });
  assert.equal((await worker.fetch(post(today), env)).status, 429);
  assert.equal((await worker.fetch(post('2020-01-01'), env)).status, 403);
  assert.equal((await worker.fetch(post(today, 'week'), env)).status, 403);
  for (const path of ['/api/auth/spotify/start', '/api/auth/spotify/callback?code=fake'])
    assert.equal((await worker.fetch(new Request(env.APP_URL + path), env)).status, 401);
  env.CF_ACCESS_TEAM_DOMAIN = 'https://taste.cloudflareaccess.com';
  env.CF_ACCESS_AUD = 'test';
  env.OWNER_EMAIL = 'owner@example.com';
  assert.equal(
    (
      await worker.fetch(
        new Request(env.APP_URL + '/api/admin/login', {
          headers: { 'Cf-Access-Authenticated-User-Email': env.OWNER_EMAIL },
        }),
        env,
      )
    ).status,
    401,
  );
  assert.equal((await worker.fetch(new Request(env.APP_URL + '/api/demo'), env)).status, 404);
  sqlite.close();
});
test('Telegram alerts deduplicate concurrent failures and reset after recovery', async () => {
  const { env, sqlite } = database();
  env.TELEGRAM_BOT_TOKEN = 'test-token';
  env.TELEGRAM_CHAT_ID = 'test-chat';
  const original = globalThis.fetch;
  let sent = 0;
  let payload: any;
  globalThis.fetch = (async (_url, options) => {
    sent++;
    payload = JSON.parse(options!.body as string);
    return Response.json({ ok: true });
  }) as typeof fetch;
  try {
    await Promise.all(Array.from({ length: 10 }, () => notifySpotifyFailure(env, 'refresh')));
    assert.equal(sent, 1);
    assert(!payload.text.includes('test-token'));
    assert(payload.text.includes('/api/admin/login'));
    await clearSpotifyAlert(env);
    await notifySpotifyFailure(env, 'refresh');
    assert.equal(sent, 2);
    await clearSpotifyAlert(env);
    globalThis.fetch = (async () => {
      throw new Error('URL contains test-token');
    }) as typeof fetch;
    await notifySpotifyFailure(env, 'refresh');
    const row = sqlite.prepare('SELECT * FROM notifications').get() as any;
    assert(!row.last_error.includes('test-token'));
    assert(Date.parse(row.next_attempt_at) > Date.now());
  } finally {
    globalThis.fetch = original;
    sqlite.close();
  }
});
test('failed Spotify refresh triggers alert while preserving refresh token for retry', async () => {
  const { env, sqlite } = database();
  env.TELEGRAM_BOT_TOKEN = 'test-token';
  env.TELEGRAM_CHAT_ID = 'test-chat';
  const encrypted = await encrypt(
    { access_token: 'old', refresh_token: 'keep', expires_at: 0 },
    env,
  );
  sqlite.prepare('INSERT INTO auth VALUES (?,?,?)').run('spotify', encrypted, now.toISOString());
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url) => {
    calls.push(String(url));
    return String(url).includes('telegram.org')
      ? Response.json({ ok: true })
      : Response.json({ error: 'invalid_grant' }, { status: 400 });
  }) as typeof fetch;
  try {
    await assert.rejects(() => spotify(env, 'me/player/recently-played'), /续期失败/);
    assert.equal(calls.length, 2);
    assert(calls[1].includes('telegram.org'));
    assert.equal(
      (sqlite.prepare("SELECT encrypted FROM auth WHERE id='spotify'").get() as any).encrypted,
      encrypted,
    );
  } finally {
    globalThis.fetch = original;
    sqlite.close();
  }
});
