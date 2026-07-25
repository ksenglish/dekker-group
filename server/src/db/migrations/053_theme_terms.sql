-- Terms move from a single global setting to per-theme, alongside a new
-- Payment Terms field. Payment Terms sits where Terms & Conditions used to
-- (between the line items and the job drawing); Terms & Conditions itself
-- moves to the very end of the quote, after the product brochures.

ALTER TABLE document_themes ADD COLUMN IF NOT EXISTS payment_terms TEXT;
ALTER TABLE document_themes ADD COLUMN IF NOT EXISTS terms_and_conditions TEXT;

-- Carry over the old global quote terms into the default theme, so nothing
-- goes blank for whoever's already relying on it.
DO $$
DECLARE
  v_quote_terms TEXT;
BEGIN
  SELECT value->>'quoteTerms' INTO v_quote_terms FROM settings WHERE key = 'quote_theme';
  IF v_quote_terms IS NOT NULL AND v_quote_terms <> '' THEN
    UPDATE document_themes SET terms_and_conditions = v_quote_terms WHERE is_default = true AND terms_and_conditions IS NULL;
  END IF;
END $$;
