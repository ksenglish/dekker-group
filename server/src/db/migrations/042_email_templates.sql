-- Saved, editable email templates (e.g. for the "Email to Customer" button on quotes)
CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(20) NOT NULL DEFAULT 'quote' CHECK (category IN ('quote', 'invoice', 'job')),
  name VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  body TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);

-- Seed one sensible default so the feature works immediately, matching the
-- wording that was previously hardcoded into the quote-send endpoint.
INSERT INTO email_templates (category, name, subject, body, is_default)
SELECT 'quote', 'Standard Quote Email',
  'Your quote from {{company_name}} — {{quote_total}}',
  E'Hi {{customer_first_name}},\n\nPlease find your quote from {{company_name}} attached.\n\nTotal: {{quote_total}} (incl. 15% GST)\n\nTo view and accept this quote online, click here: {{accept_link}}\n\nIf you have any questions, please don''t hesitate to get in touch.\n\nKind regards,\n{{sender_name}}\n{{company_name}}',
  true
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE category = 'quote');
