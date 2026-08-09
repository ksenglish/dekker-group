-- What each lead source costs us, so the Marketing report can put spend next to
-- the jobs and revenue it produced.
--
-- Recorded as individual entries rather than one running figure per source: a
-- monthly ad spend is a series of amounts, and keeping them separate means the
-- tally can be dated and corrected line by line.
CREATE TABLE IF NOT EXISTS marketing_costs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Matches customers.lead_source by name. Not a foreign key: lead sources are
  -- a settings list plus a set of built-in defaults, not a table.
  source       VARCHAR(100) NOT NULL,
  amount_cents INTEGER NOT NULL,
  incurred_on  DATE NOT NULL DEFAULT CURRENT_DATE,
  notes        TEXT,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_costs_source ON marketing_costs(source);
CREATE INDEX IF NOT EXISTS idx_marketing_costs_date ON marketing_costs(incurred_on);
