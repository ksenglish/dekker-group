-- Who actually opened a quote.
--
-- The rep is BCC'd on the quote email, and a BCC is the same message — so
-- their copy carried the identical tracking pixel and the identical View Quote
-- link as the customer's. Opening your own copy therefore logged "Quote email
-- opened by customer", which is what the team were seeing.
--
-- Each recipient now gets their own tracking id, carried on the pixel and the
-- link in their copy, so an open can be attributed to the address it came
-- from. Needs the two copies to be sent as separate messages rather than one
-- with a BCC — see sendEmail.

CREATE TABLE IF NOT EXISTS quote_email_recipients (
  -- The id IS the tracking token that appears in the URL
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  -- 'customer' is the addressee; 'sender' is the rep's own copy
  role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'sender')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quote_email_recipients_quote ON quote_email_recipients(quote_id);
