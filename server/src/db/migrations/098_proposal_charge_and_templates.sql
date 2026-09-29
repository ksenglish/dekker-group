-- Migration 098: proposals drop RRP, and gain templates
--
-- 1. RRP goes. A product row now carries what it COSTS and what it is CHARGED
--    at, and the markup is the single "Cost + %" that fills the charge column.
--    Two bases to choose between was one decision too many.
-- 2. Proposal templates: a standing set of labour lines (and optionally
--    products) an admin sets up once in Settings and picks when adding a
--    proposal to a job.

-- ── Charge replaces RRP ─────────────────────────────────────────────────────

ALTER TABLE job_proposal_products ADD COLUMN IF NOT EXISTS charge_price INTEGER NOT NULL DEFAULT 0;

-- Carry the existing rows across. The charge is what the row was going to be
-- sold at, which — under the old model — was its cost with the proposal's cost
-- markup on it. Anything already priced keeps the same number it had.
UPDATE job_proposal_products p
   SET charge_price = ROUND(p.cost_price * (1 + COALESCE(pr.markup_cost_pct, 0) / 100.0))
  FROM job_proposals pr
 WHERE pr.id = p.proposal_id AND p.charge_price = 0;

ALTER TABLE job_proposal_products DROP COLUMN IF EXISTS rrp;

-- One markup, so the column says what it is rather than which of two it was.
ALTER TABLE job_proposals ADD COLUMN IF NOT EXISTS markup_pct NUMERIC(6,2) NOT NULL DEFAULT 15;
UPDATE job_proposals SET markup_pct = markup_cost_pct
 WHERE markup_cost_pct IS NOT NULL;
ALTER TABLE job_proposals DROP COLUMN IF EXISTS markup_cost_pct;
ALTER TABLE job_proposals DROP COLUMN IF EXISTS markup_rrp_pct;
ALTER TABLE job_proposals DROP COLUMN IF EXISTS materials_basis;

-- Which quote a proposal was sent out on, so the job shows where it went and
-- the same scope isn't quoted twice by accident. Advisory: the quote can be
-- deleted and the proposal re-sent.
ALTER TABLE job_proposals ADD COLUMN IF NOT EXISTS quoted_on UUID REFERENCES quotes(id) ON DELETE SET NULL;

-- ── Templates ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS proposal_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  markup_pct NUMERIC(6,2) NOT NULL DEFAULT 15,
  is_default BOOLEAN NOT NULL DEFAULT false,
  archived BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proposal_template_labour (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES proposal_templates(id) ON DELETE CASCADE,
  label VARCHAR(255) NOT NULL,
  cost_rate INTEGER NOT NULL DEFAULT 0,
  charge_rate INTEGER NOT NULL DEFAULT 0,
  -- Units usually start at zero — the hours belong to the job, not the
  -- template — but a template for a standard callout can carry them.
  quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS proposal_template_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES proposal_templates(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  product_name VARCHAR(255),
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  cost_price INTEGER NOT NULL DEFAULT 0,
  charge_price INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_proposal_tpl_labour ON proposal_template_labour(template_id);
CREATE INDEX IF NOT EXISTS idx_proposal_tpl_products ON proposal_template_products(template_id);

-- The standard job lines become a real template, so there is something to pick
-- on day one. Seeded from the settings blob 097 wrote, which this replaces.
DO $$
DECLARE
  v_id UUID;
  v_lines JSONB;
  v_line JSONB;
  v_i INTEGER := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM proposal_templates) THEN RETURN; END IF;

  SELECT value INTO v_lines FROM settings WHERE key = 'proposal_labour_defaults';
  IF v_lines IS NULL THEN RETURN; END IF;

  INSERT INTO proposal_templates (name, description, markup_pct, is_default)
  VALUES ('Standard Job', 'The usual job lines — edit the rates here and every new proposal picks them up.', 15, true)
  RETURNING id INTO v_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    INSERT INTO proposal_template_labour (template_id, label, cost_rate, charge_rate, quantity, sort_order)
    VALUES (v_id, v_line->>'label', (v_line->>'cost_rate')::int, (v_line->>'charge_rate')::int, 0, v_i);
    v_i := v_i + 1;
  END LOOP;
END $$;

-- Only one default at a time, so "which template does a new proposal start
-- from" always has one answer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_templates_one_default
  ON proposal_templates(is_default) WHERE is_default = true;
