-- 001_initial_schema.sql created `timesheets` without updated_at, and
-- 005_timesheets.sql's CREATE TABLE IF NOT EXISTS (which lists updated_at)
-- was a silent no-op against the already-existing table — so the column
-- was never actually added, and every timesheetController.update() call
-- has been failing on "column updated_at does not exist" ever since.
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
