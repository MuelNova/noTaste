CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  next_attempt_at TEXT NOT NULL,
  sent_at TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS jobs_started ON jobs(started_at);
