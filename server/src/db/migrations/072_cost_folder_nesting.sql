-- Let operating-cost folders nest, so a supplier folder can be broken down
-- further (by year, by site, by account — whatever suits).
--
-- RESTRICT rather than CASCADE: deleting a folder must not silently take a
-- subtree of filed invoices with it. The route refuses and says what's in the way.
ALTER TABLE cost_folders
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES cost_folders(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_cost_folders_parent ON cost_folders(parent_id);

-- Names only have to be unique among siblings now — "2026" under two different
-- suppliers is perfectly reasonable.
--
-- Two indexes rather than one on (parent_id, name): Postgres treats NULLs as
-- distinct in a unique index, so a single index would let duplicate top-level
-- names through.
DROP INDEX IF EXISTS idx_cost_folders_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_folders_name_root
  ON cost_folders(LOWER(name)) WHERE parent_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_folders_name_child
  ON cost_folders(parent_id, LOWER(name)) WHERE parent_id IS NOT NULL;
