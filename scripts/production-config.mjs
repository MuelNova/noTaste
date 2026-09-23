import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parse } from 'jsonc-parser';

export function productionConfig(input) {
  const required = [
    'CLOUDFLARE_ACCOUNT_ID',
    'D1_DATABASE_ID',
    'APP_URL',
    'CF_ACCESS_TEAM_DOMAIN',
    'CF_ACCESS_AUD',
    'OWNER_EMAIL',
    'KIMI_BASE_URL',
    'KIMI_MODEL',
  ];
  const missing = required.filter((k) => !input[k]?.trim());
  if (missing.length) throw new Error('Missing deployment settings: ' + missing.join(', '));
  if (!/^[a-f0-9]{32}$/i.test(input.CLOUDFLARE_ACCOUNT_ID))
    throw new Error('Invalid CLOUDFLARE_ACCOUNT_ID');
  if (
    !/^[a-f0-9-]{36}$/i.test(input.D1_DATABASE_ID) ||
    input.D1_DATABASE_ID === '00000000-0000-0000-0000-000000000000'
  )
    throw new Error('Invalid production D1_DATABASE_ID');
  const origin = new URL(input.APP_URL);
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== input.APP_URL ||
    origin.hostname === 'localhost' ||
    origin.username ||
    origin.password
  )
    throw new Error('APP_URL must be a production HTTPS origin without trailing slash');
  const team = new URL(input.CF_ACCESS_TEAM_DOMAIN);
  if (
    team.protocol !== 'https:' ||
    team.origin !== input.CF_ACCESS_TEAM_DOMAIN ||
    !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team.hostname)
  )
    throw new Error('Invalid CF_ACCESS_TEAM_DOMAIN');
  if (new URL(input.KIMI_BASE_URL).protocol !== 'https:')
    throw new Error('KIMI_BASE_URL must use HTTPS');
  if (!['true', 'false'].includes(input.PUBLIC_REPORTS ?? 'false'))
    throw new Error('PUBLIC_REPORTS must be true or false');
  const errors = [];
  const config = parse(
    readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
    errors,
    { allowTrailingComma: true },
  );
  if (errors.length) throw new Error('Invalid wrangler.jsonc');
  return {
    ...config,
    account_id: input.CLOUDFLARE_ACCOUNT_ID,
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: origin.hostname, custom_domain: true }],
    d1_databases: [
      {
        binding: 'DB',
        database_name: input.D1_DATABASE_NAME || 'taste-db',
        database_id: input.D1_DATABASE_ID,
        migrations_dir: 'migrations',
      },
    ],
    vars: {
      APP_URL: origin.origin,
      TIMEZONE: input.TIMEZONE || 'Australia/Perth',
      PUBLIC_REPORTS: input.PUBLIC_REPORTS ?? 'false',
      KIMI_BASE_URL: input.KIMI_BASE_URL,
      KIMI_MODEL: input.KIMI_MODEL,
      CF_ACCESS_TEAM_DOMAIN: team.origin,
      CF_ACCESS_AUD: input.CF_ACCESS_AUD,
      OWNER_EMAIL: input.OWNER_EMAIL.trim().toLowerCase(),
    },
  };
}
export function productionSecrets(input) {
  const names = [
    'SPOTIFY_CLIENT_ID',
    'SPOTIFY_CLIENT_SECRET',
    'KIMI_API_KEY',
    'TOKEN_ENCRYPTION_KEY',
  ];
  const missing = names.filter((k) => !input[k]);
  if (missing.length) throw new Error('Missing deployment secrets: ' + missing.join(', '));
  if (Buffer.from(input.TOKEN_ENCRYPTION_KEY, 'base64').length !== 32)
    throw new Error('TOKEN_ENCRYPTION_KEY must contain 32 bytes');
  if (!!input.TELEGRAM_BOT_TOKEN !== !!input.TELEGRAM_CHAT_ID)
    throw new Error('Telegram requires both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID');
  const result = Object.fromEntries(names.map((k) => [k, input[k]]));
  for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'ADMIN_PASSWORD'])
    if (input[key]) result[key] = input[key];
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = productionConfig(process.env);
    const secrets = productionSecrets(process.env);
    writeFileSync('.wrangler.production.generated.json', JSON.stringify(config, null, 2) + '\n', {
      mode: 0o600,
    });
    writeFileSync('.secrets.production.generated.json', JSON.stringify(secrets), { mode: 0o600 });
    console.log('Production config and secrets prepared. Secret values are not logged.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
