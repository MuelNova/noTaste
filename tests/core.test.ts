import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMetrics, dedupe, periodBounds, previousBounds } from '../shared/metrics';
import { demoReport, demoTracks } from '../shared/demo';
import { encrypt, decrypt, sameOrigin, isOwner } from '../worker/security';
import { isLocal, type Env } from '../worker/env';
import type { Play } from '../shared/schema';
const play = (at: string, id = 0): Play => ({
  track: demoTracks[id],
  played_at: at,
  context: null,
});
test('duplicates do not erase repeated listening at different times', () => {
  const a = play('2026-09-22T10:00:00Z'),
    b = play('2026-09-22T10:04:00Z');
  assert.equal(dedupe([a, a, b]).length, 2);
  const m = calculateMetrics([a, a, b], [], 'Australia/Perth');
  assert.equal(m.plays, 2);
  assert.equal(m.tracks, 1);
  assert.equal(m.repeat_ratio, 0.5);
  assert.equal(m.hours[18], 2);
  assert.equal(m.genres[0].name, '未知');
});
test('local midnight and DST hour aggregation', () => {
  const a = play('2026-09-22T16:05:00Z');
  const m = calculateMetrics([a], [], 'Australia/Perth');
  assert.equal(m.hours[0], 1);
  assert.equal(m.weekdays[2], 1);
  const dst = calculateMetrics(
    [play('2026-11-01T05:30:00Z'), play('2026-11-01T06:30:00Z')],
    [],
    'America/New_York',
  );
  assert.equal(dst.hours[1], 2);
  assert.equal(dst.observed_days, 1);
});
test('period boundaries across leap years and year boundaries', () => {
  assert.deepEqual(periodBounds('month', '2024-02-29'), { start: '2024-02-01', end: '2024-03-01' });
  assert.deepEqual(periodBounds('week', '2026-01-01'), { start: '2025-12-29', end: '2026-01-05' });
  assert.deepEqual(previousBounds('month', '2026-01-01'), {
    start: '2025-12-01',
    end: '2026-01-01',
  });
  assert.throws(() => periodBounds('day', '2026-02-30'));
  assert.throws(() => periodBounds('day', 'not-date'));
});
test('empty samples are not zero-percent taste profiles', () => {
  const m = calculateMetrics([], [], 'UTC');
  assert.equal(m.repeat_ratio, null);
  assert.equal(m.new_artists, null);
  assert.deepEqual(m.genres, []);
});
test('collaborating artists share a play rather than inflate totals', () => {
  const p = play('2026-09-22T10:00:00Z');
  p.track = {
    ...p.track,
    artists: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
  };
  const m = calculateMetrics([p], [], 'UTC');
  assert.equal(
    m.top_artists.reduce((s, a) => s + a.count, 0),
    1,
  );
  assert.equal(m.artists, 2);
});
test('demo reports have consistent section data for all periods', () => {
  for (const type of ['day', 'week', 'month'] as const) {
    const r = demoReport(type);
    assert.equal(
      r.metrics.hours.reduce((s, n) => s + n, 0),
      r.metrics.plays,
    );
    assert.equal(
      r.metrics.genres.reduce((s, n) => s + n.count, 0),
      r.metrics.plays,
    );
    assert.equal(r.tracks.length, r.metrics.tracks);
    assert.equal(r.demo, true);
  }
});
test('tokens are authenticated encrypted and reject a tampered value', async () => {
  const env = { TOKEN_ENCRYPTION_KEY: btoa('12345678901234567890123456789012') } as Env;
  const value = await encrypt({ refresh_token: 'sensitive' }, env);
  assert(!value.includes('sensitive'));
  assert.deepEqual(await decrypt(value, env), { refresh_token: 'sensitive' });
  await assert.rejects(() => decrypt(value.slice(0, -5) + 'aaaaa', env));
});
test('local development bypass cannot authorize a deployed request', async () => {
  const env = { APP_URL: 'http://127.0.0.1:8787' } as Env;
  assert(isLocal(new Request(env.APP_URL), env));
  assert(!(await isOwner(new Request('https://taste.example.com'), env)));
  assert(
    !sameOrigin(
      new Request(env.APP_URL, { method: 'POST', headers: { Origin: 'https://evil.example' } }),
      env,
    ),
  );
  assert(
    sameOrigin(new Request(env.APP_URL, { method: 'POST', headers: { Origin: env.APP_URL } }), env),
  );
});
