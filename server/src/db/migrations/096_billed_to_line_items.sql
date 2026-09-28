-- Migration 096: remember which costs and hours have been put on the bill
--
-- Costs and time can now be turned into billable line items. Without a record
-- of that, a second pass through the picker would quietly bill the same
-- supplier invoice or the same afternoon twice — the one mistake this feature
-- could plausibly cause.
--
-- Advisory, not a lock. It drives "already added" in the picker and unticks
-- those rows by default; adding again is still allowed, because a line item
-- deleted from the job leaves the flag behind and the office has to be able to
-- put it back.
ALTER TABLE job_costs ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ;
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ;

COMMENT ON COLUMN job_costs.billed_at IS
  'When this cost was last added to the job''s line items. Advisory — see migration 096.';
COMMENT ON COLUMN timesheets.billed_at IS
  'When these hours were last added to the job''s line items. Advisory — see migration 096.';
