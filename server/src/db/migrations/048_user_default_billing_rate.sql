-- A user's default billing rate for timesheet entries — matches an id from
-- the settings.billing_rates JSON list (server/src/routes/settings.js), not
-- a foreign key since that list isn't a real table.
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_billing_rate_id VARCHAR(50);
