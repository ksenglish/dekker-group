ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recurrence_interval VARCHAR(20); -- 'monthly', 'quarterly', 'biannual', 'annual'
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recurrence_next_date DATE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parent_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
