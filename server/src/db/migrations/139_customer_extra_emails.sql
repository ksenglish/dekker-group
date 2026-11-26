-- More than one person wants the quote.
--
-- A customer had one email address, so a household or a company with two
-- people in it had nowhere to put the second one. They went in wherever there
-- was room — Arrowsmith has an address sitting in the Company field — and
-- whoever sent the quote either retyped it from memory or left somebody off.
--
-- Kept beside `email` rather than replacing it, the same way a supplier's
-- order_emails sit beside theirs (migration 110). The main address stays the
-- one the team already knows and the one a quote is addressed to; these are
-- everybody else who should get a copy.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS extra_emails TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN customers.extra_emails IS
  'The other people at this customer who should receive a quote. The main '
  'address stays in email. See migration 139.';
