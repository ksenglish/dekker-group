-- Tools going out to a job, and coming back.
--
-- Migration 114 made a product either a material or a tool, and taught the
-- valuation to count them apart. This is the other half: a tool that leaves
-- the van for a job has not been used up, it is on a job, and somebody has to
-- be able to see which tools are out and where before they go hunting for the
-- laser level.
--
-- No new table. A tool's whereabouts is already written down — every movement
-- carries the job it went to — so what is out on a job is what went there
-- minus what came back, read off the same audit trail that has to agree with
-- it anyway. A second place to record it is a second place to be wrong.
--
-- What this adds is the index that makes reading it that way cheap, because
-- the job tab asks the question on every open.

CREATE INDEX IF NOT EXISTS stock_movements_job_product
  ON stock_movements (job_id, product_id)
  WHERE job_id IS NOT NULL;

-- Returning a tool is the same movement as returning leftover material: off a
-- job and back into a location. 114 already allows the reason; this is only
-- here so the constraint is present on a database that somehow skipped it.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_reason_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason IN ('receive', 'transfer', 'used_on_job', 'adjust', 'returned_from_job'));

COMMENT ON INDEX stock_movements_job_product IS
  'What is out on a job: used_on_job less returned_from_job, per product. '
  'See migration 115.';
