-- Migration 106: the app's own change queue
--
-- The Website section lets marketing ask for a change in their own words and
-- have Claude Code make it. This is the same arrangement for the app itself, so
-- the office can ask for a column, a wording fix or a new field without anyone
-- opening a terminal.
--
-- The one real difference is what "preview" means. A website change previews on
-- a Cloudflare branch build; the app is a single service with one database
-- behind it, so there is nothing to point a preview at. Instead a job carries
-- the evidence — what the checks said, what the screen looked like afterwards —
-- and publishing merges the branch that work sits on.
CREATE TABLE IF NOT EXISTS app_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What to change, in the requester's own words. Handed to Claude Code as the
  -- prompt, so it is stored exactly as typed.
  instruction   TEXT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled', 'published')),
  -- The branch the work was committed to. Publishing merges this into main.
  branch        VARCHAR(200),
  -- Claude's own summary, written for the person who asked rather than for a
  -- developer.
  result        TEXT,
  commits       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- What the checks said: lint, the test suites, the build. The whole of
  -- "preview" for a change that cannot be previewed on a URL, so it is
  -- structured rather than buried in the log.
  checks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Enough of the run to work out what went wrong when something does.
  log           TEXT,
  claimed_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  published_at  TIMESTAMPTZ,
  published_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Claiming the next job is the worker's only hot query: oldest queued first.
CREATE INDEX IF NOT EXISTS app_jobs_queue_idx
  ON app_jobs (created_at) WHERE status = 'queued';

-- What the change looked like on screen once it was made. Images rather than a
-- live URL: for an app, "does it do what I asked" is answered by a picture of
-- the screen plus the tests, and both of those survive the worker's machine
-- being turned off.
CREATE TABLE IF NOT EXISTS app_job_shots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID NOT NULL REFERENCES app_jobs(id) ON DELETE CASCADE,
  caption      VARCHAR(255),
  mime_type    VARCHAR(100) NOT NULL DEFAULT 'image/png',
  -- Stored in the bucket where one is configured, inline otherwise — the same
  -- fallback every other upload in the app uses.
  storage_key  TEXT,
  data_base64  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (storage_key IS NOT NULL OR data_base64 IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS app_job_shots_job_idx ON app_job_shots (job_id, sort_order);
