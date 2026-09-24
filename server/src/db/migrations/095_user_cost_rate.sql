-- Migration 095: what a team member costs per hour
--
-- Billing rates (settings key 'billing_rates') say what an hour is CHARGED at.
-- Nothing said what an hour COSTS, so a job's gross profit could not be worked
-- out. This is the missing half: the hourly cost of the person doing the work,
-- applied to every hour they log on a job — billable or not, since unbillable
-- time still costs the business money.
--
-- Left empty, that person simply contributes no cost, and the Time tab says so
-- rather than quietly reporting profit that is too high.
ALTER TABLE users ADD COLUMN IF NOT EXISTS cost_rate NUMERIC(10,2);

COMMENT ON COLUMN users.cost_rate IS
  'Hourly cost of this person in NZD excl. GST. Admin-visible only — it is never returned to non-admin callers.';
