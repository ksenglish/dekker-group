-- Customers can now decline online as well as accept, and the acceptance
-- record keeps its own copy of the terms agreed to.

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS declined_name VARCHAR(255);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS decline_reason TEXT;

-- Terms live on the document theme and can be edited at any time, so the
-- wording in force when the customer accepted is snapshotted here. Without
-- it, a later edit would silently rewrite what they appear to have agreed to.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS accepted_terms TEXT;
