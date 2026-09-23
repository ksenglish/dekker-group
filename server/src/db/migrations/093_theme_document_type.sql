-- Migration 093: what the document calls itself, and which email goes with it
--
-- Some trading entities send an Estimate rather than a Quote — their terms and
-- conditions say "estimate" throughout, while the PDF and the online copy were
-- still headed QUOTE. The wording belongs to the theme, so it sits here
-- alongside the terms it has to agree with, and every customer-facing surface
-- (PDF title, the page the customer accepts on, the email) reads it from here.
--
-- Only the wording changes. An Estimate is still a quote record in the app,
-- with the same numbering, workflow and reporting.
ALTER TABLE document_themes ADD COLUMN IF NOT EXISTS document_type VARCHAR(20) NOT NULL DEFAULT 'Quote';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_themes_document_type_check'
  ) THEN
    ALTER TABLE document_themes ADD CONSTRAINT document_themes_document_type_check
      CHECK (document_type IN ('Quote', 'Estimate'));
  END IF;
END $$;

-- The email template the "Email to Customer" button opens with for this theme.
-- Left empty, it falls back to the default template for the quote category, so
-- nothing changes for themes that don't set one. ON DELETE SET NULL because
-- deleting a template must not take the theme's other settings with it.
ALTER TABLE document_themes ADD COLUMN IF NOT EXISTS email_template_id UUID
  REFERENCES email_templates(id) ON DELETE SET NULL;
