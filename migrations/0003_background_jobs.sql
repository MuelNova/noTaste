CREATE INDEX IF NOT EXISTS jobs_status_updated ON jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS jobs_status_started ON jobs(status, started_at, id);
ALTER TABLE jobs ADD COLUMN run_id TEXT NOT NULL DEFAULT '';
