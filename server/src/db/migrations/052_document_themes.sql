-- Multi-theme document branding: quotes and invoices can each pick from a
-- library of themes (different logo, trading name, contact details) instead
-- of a single global company profile. Company name and GST number stay
-- structured fields (used elsewhere — email placeholders, etc.); everything
-- else in the top-right letterhead box is one free-text field so it can be
-- laid out and ordered however the trading entity wants, same as Tradify.

CREATE TABLE IF NOT EXISTS document_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  company_name VARCHAR(255) NOT NULL DEFAULT 'DEKKER GROUP',
  gst_number VARCHAR(50),
  contact_details TEXT,
  brand_colour VARCHAR(20) NOT NULL DEFAULT '#1e40af',
  logo_base64 TEXT,
  logo_size VARCHAR(20) NOT NULL DEFAULT 'medium',
  logo_position VARCHAR(20) NOT NULL DEFAULT 'left',
  contact_position VARCHAR(20) NOT NULL DEFAULT 'right',
  transparent_header BOOLEAN NOT NULL DEFAULT false,
  footer_line1 VARCHAR(255) NOT NULL DEFAULT 'Thank you for your business.',
  footer_line2 VARCHAR(255) NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT false,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one default theme at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_themes_one_default
  ON document_themes(is_default) WHERE is_default = true;

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS theme_id UUID REFERENCES document_themes(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS theme_id UUID REFERENCES document_themes(id);

-- Migrate the existing single global theme into the first (default) row,
-- and point every existing quote/invoice at it so nothing changes visually.
DO $$
DECLARE
  v_theme JSONB;
  v_theme_id UUID;
  v_contact TEXT;
BEGIN
  SELECT value INTO v_theme FROM settings WHERE key = 'quote_theme';
  IF v_theme IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document_themes) THEN
    v_contact := NULLIF(TRIM(BOTH E'\n' FROM CONCAT_WS(E'\n',
      NULLIF(v_theme->>'website', ''),
      NULLIF(v_theme->>'email', ''),
      NULLIF(v_theme->>'phone', ''),
      NULLIF(v_theme->>'location', '')
    )), '');

    INSERT INTO document_themes (
      name, company_name, gst_number, contact_details, brand_colour,
      logo_base64, logo_size, logo_position, contact_position, transparent_header,
      footer_line1, footer_line2, is_default
    ) VALUES (
      COALESCE(NULLIF(v_theme->>'companyName', ''), 'Dekker Group') || ' Theme',
      COALESCE(NULLIF(v_theme->>'companyName', ''), 'DEKKER GROUP'),
      NULLIF(v_theme->>'gstNumber', ''),
      v_contact,
      COALESCE(NULLIF(v_theme->>'brandColour', ''), '#1e40af'),
      NULLIF(v_theme->>'logoBase64', ''),
      COALESCE(NULLIF(v_theme->>'logoSize', ''), 'medium'),
      COALESCE(NULLIF(v_theme->>'logoPosition', ''), 'left'),
      COALESCE(NULLIF(v_theme->>'contactPosition', ''), 'right'),
      COALESCE((v_theme->>'transparentHeader')::boolean, false),
      COALESCE(NULLIF(v_theme->>'footerLine1', ''), 'Thank you for your business.'),
      COALESCE(v_theme->>'footerLine2', ''),
      true
    ) RETURNING id INTO v_theme_id;

    UPDATE quotes SET theme_id = v_theme_id WHERE theme_id IS NULL;
    UPDATE invoices SET theme_id = v_theme_id WHERE theme_id IS NULL;
  END IF;
END $$;
