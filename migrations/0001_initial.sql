CREATE TABLE IF NOT EXISTS auth (id TEXT PRIMARY KEY, encrypted TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, data TEXT NOT NULL, classification TEXT, taxonomy_version TEXT);
CREATE TABLE IF NOT EXISTS plays (track_id TEXT NOT NULL, played_at TEXT NOT NULL, local_date TEXT NOT NULL, context TEXT, PRIMARY KEY(track_id, played_at));
CREATE INDEX IF NOT EXISTS plays_date ON plays(local_date, played_at);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, type TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(type, date));
CREATE INDEX IF NOT EXISTS reports_period ON reports(type, date DESC);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, stage TEXT NOT NULL, error TEXT, started_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, track_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS feedback (track_id TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(value IN ('like','dislike','known')), updated_at TEXT NOT NULL);
