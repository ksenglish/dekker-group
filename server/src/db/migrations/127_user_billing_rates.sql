-- Which billing rates a person may log their time against.
--
-- Every rate was offered to everybody, so an Operations user could pick
-- Admin, a landscaper could pick Builder, and the job's charges came out
-- wrong in a way nobody notices until the invoice. The rates themselves are
-- right; the list each person sees is what was missing.
--
-- NULL means every rate, which is what everyone has until somebody says
-- otherwise — turning this on should not be the day the whole team cannot log
-- time. A list means exactly those, and nothing else is offered or accepted.
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_rate_ids JSONB;

COMMENT ON COLUMN users.billing_rate_ids IS
  'Billing rate ids this person may use. NULL means all of them. '
  'See migration 127.';
