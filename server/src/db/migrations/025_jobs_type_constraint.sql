-- Remove hardcoded type CHECK so custom job types from settings can be used
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;
