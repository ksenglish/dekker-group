-- Products built from supplier invoices, carrying a note to ourselves where
-- their description should be.
--
-- Price List → From Invoices wrote the description as where the product came
-- from: "From Bunnings invoice 954200222021, Fri Oct 02 2026 00:00:00 GMT+0000
-- (Coordinated Universal Time)." — a raw JavaScript date and all.
--
-- The description is the line that goes on a quote. So that sentence was
-- landing in front of customers, and had to be retyped by hand every time one
-- of those products was used. Where it came from is already recorded anyway:
-- the supplier is on the row, and the invoice is on the job it was bought for.
--
-- The code no longer writes it. This is the ones already written.

-- Matched on both the shape of the sentence and the category it was filed
-- under, so a description somebody wrote themselves that happens to begin
-- "From " is left alone.
UPDATE products
   SET description = name,
       updated_at = NOW()
 WHERE category = 'Supplier Purchases'
   AND description ~ '^From .+ invoice'
   AND TRIM(COALESCE(name, '')) <> '';

-- The other half: the automatic intake wrote no description at all. Every
-- screen that shows one falls back to the name, so nothing was broken — but
-- the price list and the stock report both have a Description column that
-- simply read blank, and "match the product name" is what it should have said
-- in the first place.
UPDATE products
   SET description = name,
       updated_at = NOW()
 WHERE category = 'Supplier Purchases'
   AND COALESCE(TRIM(description), '') = ''
   AND TRIM(COALESCE(name, '')) <> '';
