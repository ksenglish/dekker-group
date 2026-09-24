-- Migration 094: remember that the office has already been told a job is done
--
-- A job reaches Complete from several places — someone moving it on the board,
-- the last invoice being paid, an automatic advance — and more than one of them
-- can fire for the same job. This column is claimed atomically by whichever
-- path gets there first, so the office gets exactly one email and one to-do.
--
-- It is cleared again whenever the job leaves Complete, so a job reopened and
-- finished a second time is announced a second time.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS complete_notified_at TIMESTAMPTZ;

-- Jobs already sitting in Complete before this existed are marked as done with,
-- so turning the feature on doesn't email the office about historic work. Only
-- jobs completed from now on are announced.
UPDATE jobs SET complete_notified_at = COALESCE(updated_at, NOW())
WHERE status = 'complete' AND complete_notified_at IS NULL;
