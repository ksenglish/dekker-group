-- Distinguish timer-tracked vs manually-typed timesheet entries, and let
-- either kind be tagged with a billing rate (server/src/routes/settings.js
-- GET/PUT /settings/billing-rates — the existing admin-editable rate list).

ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('timer', 'manual'));
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS billing_rate_id VARCHAR(50);
