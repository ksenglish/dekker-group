-- Migration 084: installation priced separately from supply
--
-- Product prices are moving to supply-only, with installation (or construction,
-- for fencing) becoming its own price list item. A presenter product names the
-- install item that goes with it, so the calculator can work out both halves
-- and put them on the quote as separate lines.
--
-- How many of the install item to charge is derived from the calculator type
-- rather than stored: heat pumps are per unit, ventilation per outlet, fencing
-- per metre. See INSTALL_BASIS in client/src/pages/presenter/SalesPresenter.jsx.

ALTER TABLE presenter_products
  ADD COLUMN IF NOT EXISTS install_product_id UUID REFERENCES products(id) ON DELETE SET NULL;
