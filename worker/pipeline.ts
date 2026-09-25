import {
  calculateMetrics,
  localDate,
  periodBounds,
  previousBounds,
  addDays,
  dedupe,
} from '../shared/metrics';
import type { Classification, PeriodType, Play, Report, Track } from '../shared/schema';
import type { Env } from './env';
import { recent, findTrack } from './spotify';
import { classify, writeEditorial } from './llm';
import { songSource } from './sources';
import { splitPlays, emptyBSide } from '../shared/sides';
import { claimJob, startQueuedJob, type ReportTask } from './jobs';
export async function getPlays(env: Env, start: string, end: string) {
  const rows = await env.DB.prepare(
    'SELECT p.played_at, p.context, t.data FROM plays p JOIN tracks t ON t.id=p.track_id WHERE p.local_date>=? AND p.local_date<? ORDER BY p.played_at',
  )
    .bind(start, end)
    .all<{ played_at: string; context: string | null; data: string }>();
  return rows.results.map((r) => ({
    played_at: r.played_at,
    context: r.context,
    track: JSON.parse(r.data),
  })) as Play[];
}
async function allLabels(env: Env) {
  const rows = await env.DB.prepare(
    'SELECT classification FROM tracks WHERE classification IS NOT NULL',
  ).all<{ classification: string }>();
  return rows.results.map((r) => JSON.parse(r.classification)) as Classification[];
}
export async function stage(env: Env, id: string, value: string) {
  await env.DB.prepare('UPDATE jobs SET stage=?, updated_at=? WHERE id=?')
    .bind(value, new Date().toISOString(), id)
    .run();
}
export async function generate(env: Env, type: PeriodType, date: string) {
  const { start, end } = periodBounds(type, date),
    id = type + ':' + start,
    timezone = env.TIMEZONE || 'Australia/Perth';
  try {
    const warnings: string[] = [];
    await stage(env, id, '采集播放记录');
    if (type === 'day') {
      const captured = await recent(env, addDays(start, -1) + 'T00:00:00Z');
      if (captured.capped) warnings.push('已达到本次采集页数上限');
      const capturedPlays = dedupe(captured.plays);
      const capturedTracks = [...new Map(capturedPlays.map((p) => [p.track.id, p.track])).values()];
      if (capturedPlays.length)
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO tracks(id,data) SELECT json_extract(value,'$.id'),value FROM json_each(?) WHERE true ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          ).bind(JSON.stringify(capturedTracks)),
          env.DB.prepare(
            "INSERT OR IGNORE INTO plays SELECT json_extract(value,'$.track.id'),json_extract(value,'$.played_at'),json_extract(value,'$.local_date'),json_extract(value,'$.context') FROM json_each(?)",
          ).bind(
            JSON.stringify(
              capturedPlays.map((p) => ({
                ...p,
                local_date: localDate(new Date(p.played_at), timezone),
              })),
            ),
          ),
        ]);
    }
    const periodPlays = await getPlays(env, start, addDays(end, 1));
    const { a: plays, b: skipped } = splitPlays(periodPlays, start, end, timezone);
    const tracks = [...new Map(plays.map((p) => [p.track.id, p.track])).values()];
    const skippedTracks = [...new Map(skipped.map((p) => [p.track.id, p.track])).values()];
    const allTracks = [...new Map([...tracks, ...skippedTracks].map((t) => [t.id, t])).values()];
    let labels = await allLabels(env);
    await stage(env, id, '整理音乐标签');
    const known = new Set(labels.map((l) => l.track_id)),
      unclassified = allTracks.filter((t) => !known.has(t.id)).slice(0, 60);
    if (unclassified.length && env.KIMI_API_KEY) {
      try {
        const fresh = await classify(env, unclassified);
        if (fresh.length)
          await env.DB.prepare(
            "INSERT INTO tracks(id,data,classification,taxonomy_version) SELECT t.id,t.data,j.value,'1' FROM json_each(?) j JOIN tracks t ON t.id=json_extract(j.value,'$.track_id') WHERE true ON CONFLICT(id) DO UPDATE SET classification=excluded.classification,taxonomy_version=excluded.taxonomy_version",
          )
            .bind(JSON.stringify(fresh))
            .run();
        labels = labels.concat(fresh);
      } catch {
        warnings.push('部分音乐标签暂缺');
      }
    }
    const prev = previousBounds(type, start),
      previousPlays = splitPlays(
        await getPlays(env, prev.start, addDays(prev.end, 1)),
        prev.start,
        prev.end,
        timezone,
      ).a;
    const historyRows = await env.DB.prepare(
      "SELECT DISTINCT json_extract(a.value,'$.id') AS id FROM tracks t, json_each(t.data,'$.artists') a WHERE EXISTS (SELECT 1 FROM plays p WHERE p.track_id=t.id AND p.local_date<?)",
    )
      .bind(start)
      .all<{ id: string }>();
    const priorArtists = new Set<string>(historyRows.results.map((r) => r.id));
    const metrics = calculateMetrics(plays, labels, timezone, priorArtists),
      previous = previousPlays.length ? calculateMetrics(previousPlays, labels, timezone) : null;
    const bSide = {
      ...emptyBSide(timezone),
      metrics: calculateMetrics(skipped, labels, timezone),
      tracks: skippedTracks,
    };
    if (skipped.length) {
      bSide.taste_comment = {
        title: '今天略过的声音',
        standfirst: '跳过记录已保存，短评暂未生成。',
        paragraphs: [],
        track_ids: [],
      };
      bSide.taste_profile.headline = '这一期的另一面';
    }
    const empty: Report = {
      id,
      type,
      date: start,
      end_date: end,
      timezone,
      demo: false,
      generated_at: new Date().toISOString(),
      status: 'complete',
      warnings,
      metrics,
      b_side: bSide,
      collected_plays: plays.length + skipped.length,
      skip_rule: 'gap-10s-v1',
      previous,
      tracks,
      taste_comment: {
        title: plays.length
          ? '这一期，先听音乐。'
          : skipped.length
            ? '这一面，今天留白。'
            : '这一天，暂无收集到的播放',
        standfirst: plays.length
          ? '播放记录已保存，乐评暂未生成。'
          : skipped.length
            ? '本期采集的记录都在 B 面。'
            : '采集结果为空，不代表这一天没有听歌。',
        paragraphs: [],
        track_ids: [],
      },
      taste_profile: { headline: '等待更多音乐线索', tags: [] },
      discoveries: [],
      fun_facts: [],
      recommendations: [],
      taste_evolution: null,
      model: env.KIMI_MODEL,
      prompt_version: '3',
    };
    let report = empty;
    if (plays.length || skipped.length) {
      await stage(env, id, '寻找歌曲背后的故事');
      const sources = (
        await Promise.all(metrics.top_tracks.slice(0, 2).map((t) => songSource(env, t.track)))
      ).filter((x) => x !== null);
      await stage(env, id, '撰写乐评');
      try {
        const last = await env.DB.prepare('SELECT data FROM reports WHERE type=? AND date=?')
          .bind(type, prev.start)
          .first<{ data: string }>();
        const feedback = await env.DB.prepare(
          'SELECT f.value,t.data FROM feedback f JOIN tracks t ON t.id=f.track_id ORDER BY f.updated_at DESC LIMIT 30',
        ).all();
        const e = await writeEditorial(env, {
          type,
          tracks: tracks.slice(0, 150),
          skipped: { tracks: skippedTracks.slice(0, 100), metrics: bSide.metrics },
          metrics,
          previous,
          classifications: labels
            .filter((l) => allTracks.some((t) => t.id === l.track_id))
            .slice(0, 150),
          sources,
          previous_comment: last ? (JSON.parse(last.data) as Report).taste_comment : null,
          feedback: feedback.results,
        });
        const ids = new Set(allTracks.map((t) => t.id));
        const aIds = new Set(tracks.map((t) => t.id));
        const bIds = new Set(skippedTracks.map((t) => t.id));
        const facts = e.fun_facts.flatMap((f) => {
          const s = sources.find((s) => s.id === f.source_id && s.track_id === f.track_id);
          if (
            !s ||
            !f.source_quote.trim() ||
            f.source_quote.split(/\s+/).length > 25 ||
            !s.excerpt.includes(f.source_quote)
          )
            return [];
          const { excerpt, ...source } = s;
          return [{ ...f, source }];
        });
        await stage(env, id, '核对推荐歌曲');
        const recommendations: Report['recommendations'] = [];
        for (const r of e.recommendations) {
          if (!aIds.has(r.connection_track_id)) continue;
          try {
            const track = await findTrack(env, r.name, r.artist);
            if (
              track &&
              !ids.has(track.id) &&
              !recommendations.some((x) => x.track.id === track.id)
            ) {
              recommendations.push({ ...r, track });
              await env.DB.prepare(
                'INSERT INTO tracks(id,data) VALUES (?,?) ON CONFLICT(id) DO NOTHING',
              )
                .bind(track.id, JSON.stringify(track))
                .run();
            }
          } catch {
            warnings.push('部分推荐暂未通过歌曲核对');
          }
        }
        report = {
          ...empty,
          ...e,
          b_side:
            skipped.length && e.b_side
              ? {
                  ...bSide,
                  ...e.b_side,
                  taste_comment: {
                    ...e.b_side.taste_comment,
                    track_ids: e.b_side.taste_comment.track_ids.filter((id) => bIds.has(id)),
                  },
                  discoveries: e.b_side.discoveries.map((d) => ({
                    ...d,
                    track_ids: d.track_ids.filter((id) => ids.has(id)),
                  })),
                }
              : bSide,
          taste_comment: plays.length
            ? {
                ...e.taste_comment,
                track_ids: e.taste_comment.track_ids.filter((id) => aIds.has(id)),
              }
            : empty.taste_comment,
          taste_profile: plays.length ? e.taste_profile : empty.taste_profile,
          discoveries: !plays.length
            ? []
            : e.discoveries.map((d) => ({
                ...d,
                track_ids: d.track_ids.filter((id) => aIds.has(id)),
              })),
          fun_facts: facts,
          recommendations,
          taste_evolution: plays.length && previous ? e.taste_evolution : null,
        };
        if (skipped.length && !e.b_side) {
          report.status = 'partial';
          warnings.push('B 面短评暂未生成');
        }
      } catch (e) {
        report.status = 'partial';
        warnings.push(e instanceof Error ? e.message : '乐评生成失败');
      }
    }
    const unfinished = end > localDate(new Date(), timezone);
    if (unfinished) warnings.push('本期尚未结束；这是截至生成时的记录，周期结束后会重新生成');
    report.warnings = [...new Set(warnings)];
    await env.DB.prepare(
      'INSERT INTO reports VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,created_at=excluded.created_at',
    )
      .bind(id, type, start, JSON.stringify(report), report.generated_at)
      .run();
    await env.DB.prepare('UPDATE jobs SET status=?,stage=?,updated_at=? WHERE id=?')
      .bind(
        report.status === 'partial' || unfinished ? 'partial' : 'complete',
        report.status === 'partial'
          ? '记录已保存，乐评可重试'
          : unfinished
            ? '已生成本期预览'
            : '已完成',
        new Date().toISOString(),
        id,
      )
      .run();
  } catch (e) {
    await env.DB.prepare(
      "UPDATE jobs SET status='failed',stage='未完成',error=?,updated_at=? WHERE id=?",
    )
      .bind(e instanceof Error ? e.message : '生成失败', new Date().toISOString(), id)
      .run();
  }
}
export async function daily(env: Env, now = new Date()) {
  const today = localDate(now, env.TIMEZONE || 'Australia/Perth'),
    yesterday = addDays(today, -1);
  for (const type of ['day', 'week', 'month'] as const) {
    if (type === 'week' && new Date(today + 'T12:00:00Z').getUTCDay() !== 1) continue;
    if (type === 'month' && !today.endsWith('-01')) continue;
    const { start } = periodBounds(type, yesterday);
    const task = { id: type + ':' + start, runId: crypto.randomUUID() };
    if (await claimJob(env, task.id, { runId: task.runId })) await processReportTask(env, task);
  }
}

export async function processReportTask(env: Env, task: ReportTask, run = generate) {
  if (!(await startQueuedJob(env, task))) return;
  const [type, date] = task.id.split(':');
  try {
    await run(env, type as PeriodType, date);
  } catch {
    await env.DB.prepare(
      "UPDATE jobs SET status='failed',stage='生成中断',error='后台生成失败，请稍后重试',updated_at=? WHERE id=? AND run_id=? AND status='running'",
    )
      .bind(new Date().toISOString(), task.id, task.runId)
      .run();
  }
}
