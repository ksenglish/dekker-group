-- Migration 097: priced proposals on a job
--
-- Replaces the Job Sheet spreadsheet: a job that needs several scopes of work
-- priced separately (retaining wall / steps / fencing) gets one proposal per
-- scope, each built the same way the sheet builds them:
--
--   products from the price list, at cost and at RRP
--   + labour and the other job lines, each with what it COSTS us and what we
--     CHARGE for it — two different rates, which is what makes the margin real
--   + a markup on the materials, applied to either the cost or the RRP total
--   = a quoted price, which can be overridden with a rounded figure
--
-- Margin is then quoted price less (product cost + labour cost), exactly as the
-- sheet works it out.
--
-- Prices are integer cents excluding GST throughout, like line_items and
-- products. GST is added once, for display.

CREATE TABLE IF NOT EXISTS job_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  -- Which total the markup is applied to. The sheet offers both and the
  -- estimator picks whichever gives the better number.
  materials_basis VARCHAR(10) NOT NULL DEFAULT 'cost'
    CHECK (materials_basis IN ('cost', 'rrp')),
  -- Two separate percentages, because that is how the sheet actually works:
  -- RRP already carries the supplier's margin so it takes a smaller uplift,
  -- while cost needs a bigger one. Keeping one shared number would silently
  -- change whichever option you were not looking at.
  markup_cost_pct NUMERIC(6,2) NOT NULL DEFAULT 43,
  markup_rrp_pct NUMERIC(6,2) NOT NULL DEFAULT 15,
  -- The rounded figure actually quoted. NULL means "use the build-up" — the
  -- sheet always types one in, because $4,150 reads better than $4,365.07.
  quote_price INTEGER,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- cost_price and rrp are snapshots, not lookups. A proposal sent last month
-- must not silently reprice because someone imported a new price list.
CREATE TABLE IF NOT EXISTS job_proposal_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES job_proposals(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  product_name VARCHAR(255),
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  cost_price INTEGER NOT NULL DEFAULT 0,
  rrp INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS job_proposal_labour (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES job_proposals(id) ON DELETE CASCADE,
  label VARCHAR(255) NOT NULL,
  cost_rate INTEGER NOT NULL DEFAULT 0,
  charge_rate INTEGER NOT NULL DEFAULT 0,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_job_proposals_job ON job_proposals(job_id);
CREATE INDEX IF NOT EXISTS idx_proposal_products ON job_proposal_products(proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_labour ON job_proposal_labour(proposal_id);

-- The standard set of job lines, so a new proposal opens filled in rather than
-- blank — retyping eleven rows per scope is most of the work in the sheet.
-- Editable in Settings; the rates below are the ones on the Job Sheet.
INSERT INTO settings (key, value)
SELECT 'proposal_labour_defaults', '[
  {"label":"Builder Labour",     "cost_rate":4000, "charge_rate":6500},
  {"label":"Labourer",           "cost_rate":3000, "charge_rate":5000},
  {"label":"Operator",           "cost_rate":9000, "charge_rate":10000},
  {"label":"Sub Contractor 1",   "cost_rate":9000, "charge_rate":12870},
  {"label":"Sub Contractor 2",   "cost_rate":9000, "charge_rate":12870},
  {"label":"Travel - Builder Van","cost_rate":4000,"charge_rate":4000},
  {"label":"Delivery - Materials","cost_rate":5000,"charge_rate":9500},
  {"label":"Waste Removal",      "cost_rate":20000,"charge_rate":24000},
  {"label":"Health & Safety",    "cost_rate":5000, "charge_rate":10000},
  {"label":"Admin",              "cost_rate":10000,"charge_rate":10000},
  {"label":"Sales",              "cost_rate":0,    "charge_rate":0}
]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'proposal_labour_defaults');
