-- Deleting a form is allowed for the person whose form it is, and for an admin.
-- `completed_by` already records that for a finished form, but a half-finished
-- one had nobody against it — so the person filling it in on site had no way to
-- remove a form they had started by mistake.
--
-- Set on the first save and never moved after that: it answers "whose form is
-- this", not "who touched it last".
ALTER TABLE job_form_submissions
  ADD COLUMN IF NOT EXISTS started_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Forms already finished before this column existed: the person who completed
-- one is plainly the person who started it.
UPDATE job_form_submissions
   SET started_by = completed_by
 WHERE started_by IS NULL
   AND completed_by IS NOT NULL;
