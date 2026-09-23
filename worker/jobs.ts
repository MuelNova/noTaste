import type { Env } from './env';
import type { PeriodType } from '../shared/schema';
import { localDate } from '../shared/metrics';
export type ReportTask = { id: string; runId: string };

export const COOLDOWN_MS = 3 * 60 * 60 * 1000;
const LEASE_MS = 20 * 60 * 1000;
export function allowedPeriod(
  type: PeriodType,
  date: string,
  verified: boolean,
  timezone: string,
  now = new Date(),
) {
  const today = localDate(now, timezone);
  return date <= today && (verified || (type === 'day' && date === today));
}

// One SQL statement both checks the shared budget and claims the job. Two tabs
// cannot both pass a separate read/check step before either writes its claim.
export async function claimJob(
  env: Env,
  id: string,
  options: { manual?: boolean; verified?: boolean; now?: Date; runId?: string } = {},
) {
  const now = options.now ?? new Date();
  const stale = new Date(now.getTime() - LEASE_MS).toISOString();
  const cutoff = new Date(now.getTime() - COOLDOWN_MS).toISOString();
  const manual = options.manual ? 1 : 0;
  const limited = options.manual && !options.verified ? 1 : 0;
  const result = await env.DB.prepare(
    `
    INSERT INTO jobs (id,status,stage,error,started_at,updated_at,run_id)
    SELECT ?, 'queued', '等待后台生成', NULL, ?, ?, ?
    WHERE (? = 0 OR NOT EXISTS (SELECT 1 FROM jobs WHERE started_at > ?))
      AND (? = 0 OR NOT EXISTS (SELECT 1 FROM jobs WHERE status IN ('queued','running') AND updated_at >= ?))
    ON CONFLICT(id) DO UPDATE SET status='queued',stage='等待后台生成',error=NULL,
      started_at=excluded.started_at,updated_at=excluded.updated_at,run_id=excluded.run_id
    WHERE (jobs.status NOT IN ('queued','running') AND (? = 1 OR jobs.status IN ('failed','partial')))
      OR (jobs.status IN ('queued','running') AND jobs.updated_at < ?)
  `,
  )
    .bind(
      id,
      now.toISOString(),
      now.toISOString(),
      options.runId ?? crypto.randomUUID(),
      limited,
      cutoff,
      manual,
      stale,
      manual,
      stale,
    )
    .run();
  return result.meta.changes > 0;
}

export async function enqueueReport(
  env: Env,
  id: string,
  options: { manual?: boolean; verified?: boolean; now?: Date } = {},
) {
  const task = { id, runId: crypto.randomUUID() };
  if (!(await claimJob(env, id, { ...options, runId: task.runId }))) return false;
  try {
    await env.REPORT_QUEUE.send(task);
  } catch {
    await env.DB.prepare(
      "UPDATE jobs SET status='failed',stage='提交失败',error='后台任务未能提交，请稍后重试',updated_at=? WHERE id=? AND run_id=? AND status='queued'",
    )
      .bind(new Date().toISOString(), id, task.runId)
      .run();
    throw new Error('后台任务未能提交，请稍后重试');
  }
  return true;
}

export async function startQueuedJob(env: Env, task: ReportTask) {
  const result = await env.DB.prepare(
    "UPDATE jobs SET status='running',stage='开始生成',updated_at=? WHERE id=? AND run_id=? AND status='queued'",
  )
    .bind(new Date().toISOString(), task.id, task.runId)
    .run();
  return result.meta.changes > 0;
}

export async function generationState(env: Env, verified: boolean, now = new Date()) {
  const row = await env.DB.prepare(
    `SELECT MAX(started_at) AS last_started,
    MAX(CASE WHEN status IN ('queued','running') AND updated_at>=? THEN stage END) AS running_stage FROM jobs`,
  )
    .bind(new Date(now.getTime() - LEASE_MS).toISOString())
    .first<{ last_started: string | null; running_stage: string | null }>();
  const next = row?.last_started ? Date.parse(row.last_started) + COOLDOWN_MS : 0;
  return {
    verified_owner: verified,
    next_allowed_at: !verified && next > now.getTime() ? new Date(next).toISOString() : null,
    running: !!row?.running_stage,
    stage: row?.running_stage ?? null,
    cooldown_seconds: !verified ? Math.max(0, Math.ceil((next - now.getTime()) / 1000)) : 0,
  };
}
