-- Allow admin-defined custom job statuses (in addition to the protected
-- automation statuses: new, quoted, scheduled, invoiced, complete, cancelled).
-- Drop the fixed CHECK constraint on jobs.status — validation of the
-- protected-vs-custom distinction now happens at the app layer in
-- jobController.js, against the live list in settings ('job_statuses').
--
-- The constraint name isn't hardcoded here since Postgres auto-generates it
-- and relying on a guessed name (e.g. via IF EXISTS with the wrong name)
-- would silently leave the real constraint in place. Find it by its actual
-- definition instead.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'jobs'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%IN%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE jobs DROP CONSTRAINT %I', con_name);
  END IF;
END $$;
