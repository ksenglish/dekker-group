-- Ordering in to our own depot.
--
-- An order was one of two things: collected from the branch, or delivered to
-- site. There is a third we do all the time and had nowhere to put — ordering
-- from a supplier in Auckland to be sent to Dekker Road, to be taken out to
-- the job later. Put through as a delivery it told the supplier to drop a
-- pallet at a customer's house.
ALTER TABLE material_orders DROP CONSTRAINT IF EXISTS material_orders_method_check;
ALTER TABLE material_orders ADD CONSTRAINT material_orders_method_check
  CHECK (method IN ('collect', 'delivery', 'depot'));

-- Where our depot is, so an order to it arrives filled in rather than typed
-- out every time. Here rather than read off the letterhead, because the
-- address on a document is what we put on a quote and this is where a truck
-- goes — the day those differ, nobody should have to find that out from a
-- supplier.
INSERT INTO settings (key, value)
SELECT 'depot_address', '"15 Dekker Road, Omanawa, 3173"'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'depot_address');
