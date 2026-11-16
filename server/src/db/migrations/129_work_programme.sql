-- The Job Form is the Work Programme, and a copy of it says which part of the
-- job is that person's.
--
-- Two changes in one migration because they are the same change: the document
-- was renamed, and at the same time a share stopped meaning "here is a slice
-- of the job" and started meaning "here is the job, and this part of it is
-- yours".

ALTER TABLE IF EXISTS job_form_shares RENAME TO work_programme_shares;

DO $$
BEGIN
  -- The old name meant "the bookings on this copy". It now means "the
  -- bookings that are this person's" — everything else on the job is either
  -- greyed out beside them or left off, depending on the share.
  --
  -- Reinterpreting the rows rather than clearing them: what somebody was
  -- shown is the best available answer to what was theirs, and a share that
  -- silently emptied itself would be worse than one that reads a little
  -- generously.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'work_programme_shares' AND column_name = 'schedule_ids') THEN
    ALTER TABLE work_programme_shares RENAME COLUMN schedule_ids TO own_schedule_ids;
  END IF;
END $$;

-- Which blocks of the scope of works are this person's.
--
-- Keyed on the text of each block rather than its position, so inserting a
-- line above somebody's does not quietly hand them the wrong one. A block
-- whose wording is edited stops matching and shows as not-theirs, which is
-- visible on the panel rather than silently wrong on a subbie's copy.
--
-- NULL means nothing has been marked, which reads as "the whole scope is
-- theirs" — the right answer for a one-trade job and for every share that
-- existed before this column did.
ALTER TABLE work_programme_shares ADD COLUMN IF NOT EXISTS own_scope_keys TEXT[];

-- What happens to the parts that are not theirs: shown greyed out beside
-- their own, or left off the copy entirely. Greyed by default — a subbie who
-- can see the rest of the job knows who else is coming, and the bold is what
-- tells them what they are on the hook for.
ALTER TABLE work_programme_shares ADD COLUMN IF NOT EXISTS rest_mode VARCHAR(10) NOT NULL DEFAULT 'grey';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'work_programme_shares'::regclass
       AND conname = 'work_programme_shares_rest_mode_check'
  ) THEN
    ALTER TABLE work_programme_shares
      ADD CONSTRAINT work_programme_shares_rest_mode_check
      CHECK (rest_mode IN ('grey', 'hide'));
  END IF;
END $$;

-- The indexes carry the old name after a table rename, which is only
-- confusing to the next person reading \d.
ALTER INDEX IF EXISTS idx_job_form_shares_job RENAME TO idx_work_programme_shares_job;
ALTER INDEX IF EXISTS idx_job_form_shares_token RENAME TO idx_work_programme_shares_token;

CREATE INDEX IF NOT EXISTS idx_work_programme_shares_job ON work_programme_shares(job_id);
CREATE INDEX IF NOT EXISTS idx_work_programme_shares_token
  ON work_programme_shares(token) WHERE revoked_at IS NULL;

-- What the sends were logged as.
UPDATE email_log SET type = 'work_programme' WHERE type = 'job_pack' OR type = 'job_form';
