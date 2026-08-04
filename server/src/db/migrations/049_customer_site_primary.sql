-- Mark one site per customer as their default ("primary") site. That site's
-- address is kept in sync with the customer's own address by
-- customerController's create/update, so it always reflects the current
-- customer address while other sites stay freely editable.

ALTER TABLE customer_sites ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

-- Backfill: pick one existing site per customer as their primary. Prefer the
-- one the old create() auto-labelled 'Primary'; otherwise fall back to the
-- earliest created site. DISTINCT ON takes the first row per customer_id
-- under this ordering.
WITH picked AS (
  SELECT DISTINCT ON (customer_id) id
  FROM customer_sites
  ORDER BY customer_id,
           (label = 'Primary') DESC NULLS LAST,
           created_at ASC
)
UPDATE customer_sites s
SET is_primary = true
FROM picked p
WHERE s.id = p.id
  AND NOT EXISTS (
    SELECT 1 FROM customer_sites x
    WHERE x.customer_id = s.customer_id AND x.is_primary
  );

-- At most one primary per customer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_sites_one_primary
  ON customer_sites(customer_id) WHERE is_primary;
