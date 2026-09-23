import type { Env } from './env';
import type { PeriodType } from '../shared/schema';
import { localDate } from '../shared/metrics';

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
  options: { manual?: boolean; verified?: boolean; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const stale = new Date(now.getTime() - LEASE_MS).toISOString();
  const cutoff = new Date(now.getTime() - COOLDOWN_MS).toISOString();
  const manual = options.manual ? 1 : 0;
  const limited = options.manual && !options.verified ? 1 : 0;
  const result = await env.DB.prepare(
    `
    INSERT INTO jobs (id,status,stage,error,started_at,updated_at)
    SELECT ?, 'running', '准备中', NULL, ?, ?
    WHERE (? = 0 OR NOT EXISTS (SELECT 1 FROM jobs WHERE started_at > ?))
      AND (? = 0 OR NOT EXISTS (SELECT 1 FROM jobs WHERE status='running' AND updated_at >= ?))
    ON CONFLICT(id) DO UPDATE SET status='running',stage='准备中',error=NULL,
      started_at=excluded.started_at,updated_at=excluded.updated_at
    WHERE (jobs.status != 'running' AND (? = 1 OR jobs.status IN ('failed','partial')))
      OR (jobs.status='running' AND jobs.updated_at < ?)
  `,
  )
    .bind(id, now.toISOString(), now.toISOString(), limited, cutoff, manual, stale, manual, stale)
    .run();
  return result.meta.changes > 0;
}

export async function generationState(env: Env, verified: boolean, now = new Date()) {
  const row = await env.DB.prepare(
    `SELECT MAX(started_at) AS last_started,
    MAX(CASE WHEN status='running' AND updated_at>=? THEN stage END) AS running_stage FROM jobs`,
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
