import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPlays, sideReport } from '../shared/sides';
import { demoReport, demoTracks } from '../shared/demo';
import type { Play } from '../shared/schema';
const play = (time: string, track = 0): Play => ({
  played_at: time,
  track: demoTracks[track],
  context: null,
});
const split = (plays: Play[]) => splitPlays(plays, '2026-09-23', '2026-09-24', 'Asia/Shanghai');

test('ten-second boundary, deduplication, unsorted records and final unknown event', () => {
  const first = play('2026-09-23T02:00:00.000Z');
  const next = play('2026-09-23T02:00:10.000Z', 1);
  const last = play('2026-09-23T02:00:20.001Z');
  const sides = split([last, next, first, first, play('invalid')]);
  assert.deepEqual(sides.b, [first]);
  assert.deepEqual(sides.a, [next, last]);
  assert.equal(sides.a[1].track.id, sides.b[0].track.id);
});

test('timestamp ties do not invent an event ordering', () => {
  const plays = [
    play('2026-09-23T02:00:00Z'),
    play('2026-09-23T02:00:00Z', 1),
    play('2026-09-23T02:00:05Z', 2),
  ];
  assert.deepEqual(split(plays), { a: plays, b: [] });
});

test('next-day lookahead classifies preceding event without counting successor', () => {
  const before = play('2026-09-23T15:59:55Z');
  const after = play('2026-09-24T00:00:03+08:00', 1);
  assert.deepEqual(split([after, before]), { a: [], b: [before] });
  assert.deepEqual(splitPlays([after, before], '2026-09-24', '2026-09-25', 'Asia/Shanghai'), {
    a: [after],
    b: [],
  });
});

test('month boundary and missing successor keep totals consistent', () => {
  const before = play('2026-09-30T15:59:55Z');
  const after = play('2026-09-30T16:00:05Z', 1);
  assert.deepEqual(splitPlays([after, before], '2026-09-01', '2026-10-01', 'Asia/Shanghai'), {
    a: [],
    b: [before],
  });
  assert.deepEqual(splitPlays([before], '2026-09-01', '2026-10-01', 'Asia/Shanghai'), {
    a: [before],
    b: [],
  });
});

test('B projection preserves original report and legacy reports have a clear empty side', () => {
  for (const type of ['day', 'week', 'month'] as const) {
    const report = demoReport(type);
    const original = JSON.stringify(report);
    const b = sideReport(report, 'b');
    assert.equal(sideReport(report, 'a'), report);
    assert.equal(b.metrics, report.b_side!.metrics);
    assert.equal(report.collected_plays, report.metrics.plays + b.metrics.plays);
    assert.equal(
      b.metrics.hours.reduce((a, n) => a + n, 0),
      b.metrics.plays,
    );
    assert.deepEqual(b.recommendations, []);
    assert.equal(JSON.stringify(report), original);
    const { b_side, ...legacy } = report;
    assert.equal(sideReport(legacy, 'b').metrics.plays, 0);
    assert.match(sideReport(legacy, 'b').taste_comment.title, /还没有 B 面/);
  }
});
