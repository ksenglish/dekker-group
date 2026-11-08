-- Terms and conditions a quote can bend without bending the theme's.
--
-- The wording belongs to the Document Theme, and that is right: it is the
-- business's standard terms, written once and agreed to by every customer.
-- But one job in twenty needs a line changed — a staged payment, a site
-- condition, something the customer's own contract asks for — and the only
-- ways to do that were to edit the theme, which rewrites the terms on every
-- other quote using it, or to make a near-duplicate theme for one quote.
--
-- So a quote can carry its own copy. NULL is the normal state and means "use
-- whatever the theme says", so a quote left alone still follows a later edit
-- to the theme. Text means somebody deliberately wrote it for this quote, and
-- nothing in the theme touches it afterwards.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS terms_and_conditions TEXT;

COMMENT ON COLUMN quotes.terms_and_conditions IS
  'This quote''s own terms. NULL means follow the document theme. See migration 122.';
