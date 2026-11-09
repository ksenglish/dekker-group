-- A supplier's GST number, typed once instead of waited for.
--
-- The scanner already recognises a business by the GST number printed on its
-- documents (migration 100). The catch is how it comes to know the number:
-- only by somebody correcting a document that had both a readable GST number
-- and a wrong name. A Bunnings receipt whose logo is an image and whose GST
-- number the scan missed teaches nothing at all, so correcting it changes
-- nothing about the next one — which is exactly what it looks like from the
-- outside: "I keep fixing these and it keeps not learning."
--
-- So the number can be entered by hand, against the supplier, in Settings.
-- One entry, and every document that carries that number is recognised from
-- then on without anybody correcting anything.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS gst_number VARCHAR(50);

-- Whatever the scanner has already worked out, brought over, so the Settings
-- page opens showing what it knows rather than empty. Matched on the name the
-- way everything else here matches it: case-insensitively.
UPDATE suppliers s
   SET gst_number = i.key_value
  FROM supplier_identities i
 WHERE i.key_type = 'gst_number'
   AND LOWER(TRIM(i.supplier)) = LOWER(TRIM(s.name))
   AND s.gst_number IS NULL;

COMMENT ON COLUMN suppliers.gst_number IS
  'Typed by hand so the scanner can recognise this supplier''s documents by '
  'the number printed on them. See migration 124.';
