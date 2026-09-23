import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
const local = parseEnv(readFileSync('.dev.vars', 'utf8'));
const path = '.env.production.local';
const saved = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
const account = saved.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const origin = saved.APP_URL || process.env.APP_URL;
async function request(method, suffix, body) {
  const r = await fetch('https://api.cloudflare.com/client/v4/accounts/' + account + suffix, {
    method,
    headers: {
      Authorization: 'Bearer ' + local.CLOUDFLARE_API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const d = await r.json();
  if (!r.ok || !d.success)
    throw new Error(
      'Cloudflare request failed: HTTP ' +
        r.status +
        ', codes ' +
        (d.errors ?? []).map((e) => e.code).join(','),
    );
  return d.result;
}
try {
  if (!local.CLOUDFLARE_API_TOKEN) throw new Error('Missing CLOUDFLARE_API_TOKEN in .dev.vars');
  if (!account || !origin)
    throw new Error('Set CLOUDFLARE_ACCOUNT_ID and APP_URL for the first setup.');
  const name = saved.D1_DATABASE_NAME || 'taste-db';
  const list = await request('GET', '/d1/database?name=' + encodeURIComponent(name));
  let database = list.find((d) => d.name === name);
  if (!database) {
    database = await request('POST', '/d1/database', { name });
    console.log('Created production D1 database: ' + name);
  } else console.log('Using existing production D1 database: ' + name);
  if (saved.D1_DATABASE_ID && saved.D1_DATABASE_ID !== database.uuid)
    throw new Error('Database ID differs from saved production settings; refusing to replace it.');
  const queues = await request('GET', '/queues?name=no-taste-reports');
  if (!queues.some((queue) => queue.queue_name === 'no-taste-reports')) {
    await request('POST', '/queues', { queue_name: 'no-taste-reports' });
    console.log('Created report queue: no-taste-reports');
  } else console.log('Using existing report queue: no-taste-reports');
  const values = {
    ...saved,
    CLOUDFLARE_ACCOUNT_ID: account,
    D1_DATABASE_NAME: name,
    D1_DATABASE_ID: database.uuid,
    APP_URL: origin,
    PUBLIC_REPORTS: saved.PUBLIC_REPORTS || local.PUBLIC_REPORTS || 'false',
    TOKEN_ENCRYPTION_KEY: saved.TOKEN_ENCRYPTION_KEY || randomBytes(32).toString('base64'),
  };
  writeFileSync(
    path,
    Object.entries(values)
      .map(([k, v]) => k + '=' + JSON.stringify(v))
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  console.log('Production settings saved locally; encryption key is not printed.');
} catch (error) {
  console.error(
    error.message?.startsWith('Cloudflare request failed') ||
      error.message?.startsWith('Missing') ||
      error.message?.startsWith('Set ') ||
      error.message?.startsWith('Database ID')
      ? error.message
      : 'Cloudflare setup could not complete. Check connectivity and API token permissions.',
  );
  process.exitCode = 1;
}
