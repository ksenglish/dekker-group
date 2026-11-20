-- What a hand-typed line costs us.
--
-- A line linked to the Price List costs what that product costs, read live, so
-- the margin on screen is today's margin. A line typed in by hand — labour, an
-- allowance, "Plumbing", "Bathroom Renovation" — had nothing to read, so it was
-- left out of the cost and counted as though it were all margin. The quote then
-- said 100% on a job with four thousand dollars of subcontractors in it, and
-- said so in a box headed Margin, which is worse than saying nothing.
--
-- So an admin can type the cost against the line. Per unit and excluding GST,
-- exactly like products.cost_price, because that is the same number for the
-- same purpose and two shapes of it would disagree the first time somebody
-- changed a quantity.
--
-- NULL still means "we do not know", and still says so rather than showing a
-- zero: a zero is a cost, and not knowing is not.
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS unit_cost_cents INTEGER;

ALTER TABLE line_items DROP CONSTRAINT IF EXISTS line_items_unit_cost_not_negative;
ALTER TABLE line_items ADD CONSTRAINT line_items_unit_cost_not_negative
  CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0);

COMMENT ON COLUMN line_items.unit_cost_cents IS
  'What this line costs us per unit, excluding GST, typed by an admin. Only '
  'read where the line has no Price List cost behind it — the Price List wins, '
  'because it is live. NULL means unknown. See migration 136.';
