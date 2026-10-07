import { calculateMetrics } from './metrics';
import type { Editorial, Play, Report, ReportSide } from './schema';

// Validation happens before accepting model output: never silently drop or reassign a song.
export function partitionError(e: Editorial, counts: Map<string, number>): string | null {
  const { a_track_ids: a, b_track_ids: b } = e.partition;
  const ids = [...a, ...b];
  if (new Set(ids).size !== ids.length) return '分组中有重复歌曲';
  if (ids.length !== counts.size || ids.some((id) => !counts.has(id)))
    return '分组必须包含全部输入歌曲且不能添加歌曲';
  if (!a.length) return 'A 面不能为空';
  if (b.length && (a.length < 2 || b.length < 2)) return '两面各至少需要两首不同歌曲';
  if (!!b.length !== !!e.b_side) return 'B 面分组与短评必须同时存在或同时为空';
  if (b.length && (!e.partition.b_label.trim() || !e.partition.contrast.trim()))
    return '双面需要主题和具体对照';
  const sum = (group: string[]) => group.reduce((n, id) => n + (counts.get(id) ?? 0), 0);
  if (sum(a) < sum(b)) return '播放次数更多的一组应为 A 面';
  const aSet = new Set(a),
    bSet = new Set(b);
  if (
    e.taste_comment.track_ids.some((id) => !aSet.has(id)) ||
    e.discoveries.some((d) => d.track_ids.some((id) => !aSet.has(id)))
  )
    return 'A 面引用了其他组的歌曲';
  if (
    e.b_side &&
    (e.b_side.taste_comment.track_ids.some((id) => !bSet.has(id)) ||
      e.b_side.discoveries.some((d) => d.track_ids.some((id) => !bSet.has(id))))
  )
    return 'B 面引用了其他组的歌曲';
  return null;
}
export function partitionPlays(plays: Play[], partition: Editorial['partition']) {
  const aIds = new Set(partition.a_track_ids),
    bIds = new Set(partition.b_track_ids);
  return {
    a: plays.filter((p) => aIds.has(p.track.id)),
    b: plays.filter((p) => bIds.has(p.track.id)),
  };
}
export function emptyBSide(timezone: string, legacy = false): ReportSide {
  return {
    metrics: calculateMetrics([], [], timezone),
    tracks: [],
    taste_comment: {
      title: legacy ? '另一面，尚未成篇。' : '这一面，今天留白。',
      standfirst: legacy ? '重新生成后，听见另一种选曲。' : '本期选曲尚未形成鲜明的第二组。',
      paragraphs: [],
      track_ids: [],
    },
    taste_profile: { headline: 'Another take.', tags: [] },
    discoveries: [],
  };
}
export function currentBSide(report: Report) {
  return report.side_mode === 'taste-clusters-v1' ? report.b_side : undefined;
}
export function sideReport(report: Report, side: 'a' | 'b'): Report {
  const b = currentBSide(report);
  const result =
    side === 'a'
      ? report
      : {
          ...report,
          ...(b ?? emptyBSide(report.timezone, true)),
          previous: null,
          taste_evolution: null,
        };
  if (report.side_mode !== 'taste-clusters-v1')
    return side === 'a' ? report : { ...result, fun_facts: [], recommendations: [] };
  const ids = new Set(result.tracks.map((t) => t.id));
  return {
    ...result,
    fun_facts: report.fun_facts.filter((f) => ids.has(f.track_id)),
    recommendations: report.recommendations.filter((r) => ids.has(r.connection_track_id)),
  };
}
