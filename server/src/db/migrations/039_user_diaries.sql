-- Which diaries (calendars) each team member appears under on the Schedule.
-- A user can belong to several (e.g. Kyle does both sales and operations work).
ALTER TABLE users ADD COLUMN IF NOT EXISTS diaries TEXT[] NOT NULL DEFAULT '{}';

-- Backfill from each user's role so the diary filter works immediately
UPDATE users SET diaries = CASE
  WHEN role = 'admin'                          THEN ARRAY['admin']
  WHEN role = 'sales'                          THEN ARRAY['sales']
  WHEN role IN ('operations', 'office')        THEN ARRAY['operations']
  WHEN role IN ('subcontractor', 'field_tech') THEN ARRAY['subcontractor']
  ELSE ARRAY[]::TEXT[]
END
WHERE diaries = '{}';

-- Per-occurrence deletions for recurring calendar notes (YYYY-MM-DD strings)
ALTER TABLE calendar_notes ADD COLUMN IF NOT EXISTS excluded_dates TEXT[] NOT NULL DEFAULT '{}';
