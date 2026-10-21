-- Suppliers, as somebody actually has to deal with them.
--
-- A supplier was only ever an email address and an account number, learned on
-- the fly the first time an order went out. That is not enough: several of
-- them want the order sent to more than one address (a branch desk and a head
-- office account), and the person ordering wants to know who they are ringing.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255);

-- Everyone else who must receive an order to this supplier, beyond the main
-- address. Kept separate from `email` so the address the order is addressed to
-- stays the one the team already knows, and so remembering an address from the
-- order screen cannot quietly drop the rest.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS order_emails TEXT[] NOT NULL DEFAULT '{}';
