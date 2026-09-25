import { calculateMetrics, dedupe, localDate } from './metrics';
import type { Play, Report, ReportSide } from './schema';

export const SKIP_WINDOW_MS = 10_000;
export function splitPlays(raw: Play[], start: string, end: string, timezone: string) {
  const ordered = dedupe(raw)
    .filter((p) => Number.isFinite(Date.parse(p.played_at)))
    .sort((a, b) => Date.parse(a.played_at) - Date.parse(b.played_at));
  const a: Play[] = [],
    b: Play[] = [];
  const counts = new Map<number, number>();
  for (const p of ordered) {
    const time = Date.parse(p.played_at);
    counts.set(time, (counts.get(time) ?? 0) + 1);
  }
  ordered.forEach((play, i) => {
    const day = localDate(new Date(play.played_at), timezone);
    if (day < start || day >= end) return;
    const next = ordered[i + 1];
    const at = Date.parse(play.played_at),
      nextAt = next ? Date.parse(next.played_at) : NaN;
    const gap = nextAt - at;
    // Tied timestamps have no reliable order. Keep them on A, including the last tied item.
    const skipped =
      counts.get(at) === 1 && counts.get(nextAt) === 1 && gap > 0 && gap <= SKIP_WINDOW_MS;
    (skipped ? b : a).push(play);
  });
  return { a, b };
}

export function emptyBSide(timezone: string, legacy = false): ReportSide {
  return {
    metrics: calculateMetrics([], [], timezone),
    tracks: [],
    taste_comment: {
      title: legacy ? '这一期，还没有 B 面。' : '这一面，今天留白。',
      standfirst: legacy ? '重新生成后，可查看双面手记。' : '本期暂无跳过记录。',
      paragraphs: [],
      track_ids: [],
    },
    taste_profile: { headline: 'Not today.', tags: [] },
    discoveries: [],
  };
}

export function sideReport(report: Report, side: 'a' | 'b'): Report {
  if (side === 'a') return report;
  return {
    ...report,
    ...(report.b_side ?? emptyBSide(report.timezone, true)),
    previous: null,
    fun_facts: [],
    recommendations: [],
    taste_evolution: null,
  };
}
