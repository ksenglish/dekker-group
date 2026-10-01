-- Migration 100: remembering who a supplier document came from
--
-- A Bunnings credit note carries the Bunnings logo as an image and never spells
-- the name out as text, so the scan came back with no supplier at all. Someone
-- then types it in — and the next identical document asks them again.
--
-- So corrections are kept. Two kinds of key point at one canonical name:
--
--   gst_number  the GST number printed on the document. Unique to a business,
--               stable across every invoice it ever sends, and printed on all
--               of them by law — the strongest signal there is.
--   alias       what the scan actually read, when it read something. Catches
--               "BUNNINGS TRADE", "Bunnings Mt Maunganui" and "bunnings" all
--               landing on one name instead of three.
CREATE TABLE IF NOT EXISTS supplier_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_type VARCHAR(20) NOT NULL CHECK (key_type IN ('gst_number', 'alias')),
  key_value VARCHAR(255) NOT NULL,
  supplier VARCHAR(255) NOT NULL,
  times_seen INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One name per key. A key_value is matched case- and space-insensitively, so
-- it is stored already folded and the index can be plain.
CREATE UNIQUE INDEX IF NOT EXISTS supplier_identities_key
  ON supplier_identities (key_type, key_value);

-- The GST number is what a future document is recognised by, so it is kept
-- with the scan rather than only in the lookup table.
ALTER TABLE job_cost_scans ADD COLUMN IF NOT EXISTS supplier_gst_number VARCHAR(50);
