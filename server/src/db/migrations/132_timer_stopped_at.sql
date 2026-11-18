-- A timer that was stopped has to stay stopped.
--
-- Kyle pressed Stop and was still on the clock on the dashboard two hours
-- later, while the job page he stopped it on showed Start Timer. The two were
-- both telling the truth about what they could see.
--
-- The job page announces a running timer to the server every five minutes, so
-- that a timer the office cannot see — one started before this existed, or on
-- a phone with no signal at the time — turns up anyway. That announcement is
-- an ordinary start, and a start creates the row. So any other tab still open
-- on the job, holding the start time it read when it loaded, put the timer
-- back a few minutes after it was stopped, with its original start time. The
-- dashboard then correctly reported somebody who had been on the clock since
-- 17:10.
--
-- active_timers is deliberately not a history: the row is deleted when the
-- timer stops. So nothing on the server remembered that a stop had happened,
-- and it had no way to tell a genuine announcement from a stale one.
--
-- This is that memory. One timestamp per person — when they last went off the
-- clock — which is all that is needed to answer the only question being asked:
-- is this five-minute reminder about a timer that has since been stopped?
ALTER TABLE users ADD COLUMN IF NOT EXISTS timer_stopped_at TIMESTAMPTZ;

COMMENT ON COLUMN users.timer_stopped_at IS
  'When this person last went off the clock. A timer re-announcing itself with '
  'a start at or before this is a tab that missed the stop, and is ignored. '
  'Pressing Start is always obeyed. See migration 132.';
