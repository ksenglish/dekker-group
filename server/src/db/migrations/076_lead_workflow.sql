-- Lead workflow: a call-back stage, clearer wording, and conversion meaning a
-- job rather than a customer record.

-- 'dismissed' reads like an admin action; 'not interested' is what actually
-- happened. Existing rows are migrated before the constraint is rebuilt.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
UPDATE leads SET status = 'not_interested' WHERE status = 'dismissed';
ALTER TABLE leads ADD CONSTRAINT leads_status_check
  CHECK (status IN ('new', 'contacted', 'call_back', 'converted', 'not_interested'));

-- When to ring back, set when a call result says to.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS call_back_on DATE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS call_back_at TIMESTAMPTZ;

-- The outcome of the last call, so the history is not just a status.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_result VARCHAR(40);

-- Converting a lead now opens a job. customer_id is still here, but it is set
-- as soon as the lead is contacted rather than on conversion — every lead we
-- have spoken to becomes a customer record, whatever it turns into.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;

-- Matches the rename. dismissed_at is left in place rather than dropped, so no
-- history is lost if anything still reads it.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS not_interested_at TIMESTAMPTZ;
UPDATE leads SET not_interested_at = dismissed_at
  WHERE not_interested_at IS NULL AND dismissed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_call_back_on ON leads(call_back_on) WHERE status = 'call_back';
