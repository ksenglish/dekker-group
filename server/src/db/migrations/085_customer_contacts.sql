-- Alternative contact details for a customer.
--
-- When a lead is merged into an existing customer, anything that disagrees with
-- what's already on file is kept here rather than overwriting it or being
-- thrown away — a second name on the account, a partner's mobile, a different
-- site address. A table rather than secondary_* columns on customers, because a
-- customer can accumulate several of these over repeated merges.
CREATE TABLE IF NOT EXISTS customer_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name        VARCHAR(255),
  mobile      VARCHAR(50),
  phone       VARCHAR(50),
  email       VARCHAR(255),
  address     TEXT,
  -- Where this came from, so a stray second number can be traced back.
  note        TEXT,
  lead_id     UUID REFERENCES leads(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer
  ON customer_contacts(customer_id, created_at DESC);
