import test from 'node:test';
import assert from 'node:assert/strict';
import { productionConfig, productionSecrets } from '../scripts/production-config.mjs';
const settings = {
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  D1_DATABASE_ID: '12345678-1234-1234-1234-123456789012',
  APP_URL: 'https://taste.example.com',
  CF_ACCESS_TEAM_DOMAIN: 'https://taste.cloudflareaccess.com',
  CF_ACCESS_AUD: 'test-aud',
  OWNER_EMAIL: 'Owner@example.com',
  KIMI_BASE_URL: 'https://api.moonshot.cn/v1',
  KIMI_MODEL: 'test-model',
  PUBLIC_REPORTS: 'true',
  SPOTIFY_CLIENT_ID: 'test-id',
  SPOTIFY_CLIENT_SECRET: 'test-secret',
  KIMI_API_KEY: 'test-api-key',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};
test('production separates secrets from config, disables alternate hosts and binds the selected D1', () => {
  const config = productionConfig(settings);
  const secrets = productionSecrets(settings);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.d1_databases[0].database_id, settings.D1_DATABASE_ID);
  assert.equal(config.routes[0].pattern, 'taste.example.com');
  assert.deepEqual(config.triggers.crons, ['30 17 * * *']);
  assert.equal(config.queues.producers[0].binding, 'REPORT_QUEUE');
  assert.equal(config.queues.consumers[0].max_retries, 0);
  assert.equal(config.queues.consumers[0].max_concurrency, 1);
  assert.equal(config.vars.OWNER_EMAIL, 'owner@example.com');
  assert(!JSON.stringify(config).includes(settings.KIMI_API_KEY));
  assert.equal(secrets.KIMI_API_KEY, settings.KIMI_API_KEY);
  assert(!('CLOUDFLARE_API_TOKEN' in secrets));
});
test('invalid production settings fail before deployment', () => {
  for (const override of [
    { APP_URL: 'http://127.0.0.1:8787' },
    { APP_URL: 'https://taste.example.com/' },
    { D1_DATABASE_ID: '00000000-0000-0000-0000-000000000000' },
    { CF_ACCESS_TEAM_DOMAIN: 'taste.cloudflareaccess.com' },
    { CF_ACCESS_AUD: '' },
    { PUBLIC_REPORTS: 'yes' },
  ])
    assert.throws(() => productionConfig({ ...settings, ...override }));
  assert.throws(() => productionSecrets({ ...settings, TOKEN_ENCRYPTION_KEY: 'invalid' }));
  assert.throws(() => productionSecrets({ ...settings, TELEGRAM_BOT_TOKEN: 'only-one' }));
  assert.throws(() => productionSecrets({ ...settings, KIMI_API_KEY: '' }));
});
