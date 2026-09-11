-- Migration 091: a work queue for website changes
--
-- The Website section could already collect change requests and publish the
-- site, but the step in between — actually making the change — still meant
-- someone opening Claude Code on a laptop and being told what to do.
--
-- This is that step, as a queue. Someone describes the change in the app; a
-- worker running Claude Code on a machine the business controls picks the job
-- up, makes the change on the staging branch, and writes back what it did.
-- Nothing here calls a paid API: the work runs on an existing Claude Code
-- subscription, which is the whole reason it is a queue and not a live chat.

CREATE TABLE IF NOT EXISTS website_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What to change, in the requester's own words. This is handed to Claude
  -- Code as the prompt, so it is stored exactly as typed.
  instruction   TEXT NOT NULL,
  -- Set when the job came from a logged change request, so finishing the work
  -- can close the request off.
  request_id    UUID REFERENCES website_requests(id) ON DELETE SET NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  -- Claude's own summary of what it did, written for the person who asked.
  result        TEXT,
  -- The commits that landed on staging, so the app can show what changed
  -- without anyone reading a git log.
  commits       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Enough of the run to work out what went wrong when something does.
  log           TEXT,
  claimed_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Claiming the next job is the worker's only hot query: oldest queued first.
CREATE INDEX IF NOT EXISTS website_jobs_queue_idx
  ON website_jobs (created_at) WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS website_jobs_recent_idx
  ON website_jobs (created_at DESC);
