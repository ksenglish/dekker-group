-- Undoing an order, and room for the addresses it was sent to.
--
-- An order could be sent and nothing more. Somebody who picks Delivery when
-- they meant Click & Collect, or whose order was for the wrong job, had no way
-- to say so: the materials stayed "Ordered" for ever and the order sat in the
-- list looking as though it stood. Cancelling does not unsend the email — the
-- supplier still has it and still has to be told — but it puts our own record
-- straight and lets the materials be ordered again.

ALTER TABLE material_orders DROP CONSTRAINT IF EXISTS material_orders_status_check;
ALTER TABLE material_orders ADD CONSTRAINT material_orders_status_check
  CHECK (status IN ('draft', 'sent', 'failed', 'cancelled'));

ALTER TABLE material_orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE material_orders ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE material_orders ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

-- An order can go to several addresses now — a branch desk and a head office
-- account — and three of those do not fit in 255 characters.
ALTER TABLE material_orders ALTER COLUMN email_to TYPE TEXT;
