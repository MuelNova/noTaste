import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionError, partitionPlays, sideReport, currentBSide } from '../shared/sides';
import { demoReport, demoTracks } from '../shared/demo';
import { editorialSchema, type Play } from '../shared/schema';
const fixture = () =>
  editorialSchema.parse({ ...demoReport(), recommendations: [], fun_facts: [] });
const counts = new Map(demoTracks.map((t) => [t.id, 1]));
test('partition rejects overlap, missing songs, unknown songs, tiny groups and reversed dominance', () => {
  assert.equal(partitionError(fixture(), counts), null);
  for (const mutate of [
    (e: ReturnType<typeof fixture>) => e.partition.b_track_ids.push(e.partition.a_track_ids[0]),
    (e: ReturnType<typeof fixture>) => e.partition.a_track_ids.pop(),
    (e: ReturnType<typeof fixture>) => e.partition.a_track_ids.splice(0, 1, 'unknown'),
    (e: ReturnType<typeof fixture>) => {
      e.partition.a_track_ids.push(...e.partition.b_track_ids.splice(1));
    },
    (e: ReturnType<typeof fixture>) => {
      e.b_side = null;
    },
    (e: ReturnType<typeof fixture>) => {
      e.taste_comment.track_ids = e.partition.b_track_ids;
    },
  ]) {
    const e = fixture();
    mutate(e);
    assert(partitionError(e, counts));
  }
  const heavyB = new Map(counts);
  heavyB.set('demo-2', 100);
  assert(partitionError(fixture(), heavyB));
});
test('every repeat follows its song regardless of timestamp gap', () => {
  const e = fixture();
  const plays: Play[] = [0, 2, 0, 2].map((id, i) => ({
    track: demoTracks[id],
    played_at: `2026-09-23T02:00:0${i}Z`,
    context: null,
  }));
  const groups = partitionPlays(plays, e.partition);
  assert.equal(groups.a.length, 2);
  assert.equal(groups.b.length, 2);
  assert(groups.a.every((p) => p.track.id === 'demo-0'));
  assert(groups.b.every((p) => p.track.id === 'demo-2'));
});
test('single coherent group is valid and needs no B editorial', () => {
  const e = fixture();
  e.partition.a_track_ids = demoTracks.map((t) => t.id);
  e.partition.b_track_ids = [];
  e.b_side = null;
  assert.equal(partitionError(e, counts), null);
});
test('demo statistics conserve plays and side projections route related content', () => {
  for (const type of ['day', 'week', 'month'] as const) {
    const r = demoReport(type),
      a = sideReport(r, 'a'),
      b = sideReport(r, 'b');
    assert.equal(r.collected_plays, a.metrics.plays + b.metrics.plays);
    assert.equal(r.period_metrics!.plays, r.collected_plays);
    assert.equal(
      new Set([...a.tracks, ...b.tracks].map((t) => t.id)).size,
      a.tracks.length + b.tracks.length,
    );
    for (const side of [a, b]) {
      assert.equal(
        side.metrics.hours.reduce((s, n) => s + n, 0),
        side.metrics.plays,
      );
      assert(
        side.recommendations.every((rec) =>
          side.tracks.some((t) => t.id === rec.connection_track_id),
        ),
      );
    }
    assert.equal(a.recommendations.length, 2);
    assert.equal(b.recommendations.length, 1);
    assert.equal(b.taste_evolution, null);
  }
});
test('legacy skip reports never become Another take by relabeling', () => {
  const r = demoReport();
  delete r.side_mode;
  r.skip_rule = 'gap-10s-v1';
  assert.equal(currentBSide(r), undefined);
  assert.equal(sideReport(r, 'b').metrics.plays, 0);
  assert.match(sideReport(r, 'b').taste_comment.title, /尚未成篇/);
});
