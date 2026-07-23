-- Fix the quotes.status CHECK constraint, which never actually included
-- 'cancelled' even though the frontend's status pipeline has offered it
-- since migration 029 — every attempt to cancel a quote has been failing
-- at the DB layer. Also add 'approved': an internal sales-review step
-- between draft and sent, so a quote's badge reads APPROVED (not DRAFT)
-- by the time it's emailed to the customer.
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_status_check
  CHECK (status IN ('draft', 'approved', 'sent', 'accepted', 'declined', 'cancelled'));

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
