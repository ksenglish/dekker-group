-- Every line on an incoming invoice has to end up somewhere.
--
-- A document used to be dealt with whole: linked to a job, which turns all of
-- its lines into that job's costs, or filed into an operating-cost folder,
-- which turns them into nothing. That second case is where things go missing.
-- Benjamin buys a drill and a box of screws at Mitre 10 for no particular
-- job, the receipt is filed under Hardware, and the drill is on the price
-- list, in the costs report, and nowhere at all — not in his van, not in the
-- warehouse, not on the tool register.
--
-- So a line now gets a destination of its own:
--
--   location   into the warehouse or a van. Writes the same stock movement
--              that scanning it in would, so it lands on the Stock or Tools
--              tab and in Recent movements.
--   job        onto a job as a cost, which is what linking the whole document
--              already does to all of them.
--   not_stock  consumed, a fee, a coffee. A decision, recorded, so that the
--              line is accounted for rather than merely ignored.

CREATE TABLE IF NOT EXISTS scan_line_placements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id      UUID NOT NULL REFERENCES job_cost_scans(id) ON DELETE CASCADE,
  -- Which line. parsed_items is a JSON array with no ids of its own, so the
  -- position is the key — and editing the lines clears the placements,
  -- because after an edit the positions mean something else.
  line_index   INT NOT NULL,
  -- What the line said at the time, so a later edit is visible rather than
  -- silently re-pointing a placement at different words.
  description  TEXT NOT NULL,
  quantity     NUMERIC(12,2) NOT NULL DEFAULT 1,

  destination  VARCHAR(20) NOT NULL,
  location_id  UUID REFERENCES stock_locations(id) ON DELETE SET NULL,
  job_id       UUID REFERENCES jobs(id) ON DELETE SET NULL,
  -- What it turned into, kept so undoing a placement can undo its effect
  -- rather than leaving a movement nobody can trace.
  product_id   UUID REFERENCES products(id) ON DELETE SET NULL,
  job_cost_id  UUID REFERENCES job_costs(id) ON DELETE SET NULL,
  note         TEXT,
  placed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS scan_line_placements_line
  ON scan_line_placements (scan_id, line_index);

CREATE INDEX IF NOT EXISTS scan_line_placements_scan
  ON scan_line_placements (scan_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scan_line_placements_destination_check') THEN
    ALTER TABLE scan_line_placements ADD CONSTRAINT scan_line_placements_destination_check
      CHECK (destination IN ('location', 'job', 'not_stock'));
  END IF;
  -- A destination that names nowhere is not a destination.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scan_line_placements_target_check') THEN
    ALTER TABLE scan_line_placements ADD CONSTRAINT scan_line_placements_target_check
      CHECK (
        (destination = 'location'  AND location_id IS NOT NULL)
        OR (destination = 'job'    AND job_id IS NOT NULL)
        OR destination = 'not_stock'
      );
  END IF;
END $$;

-- Whether this document has to have every line placed before it can be filed.
--
-- True from here on. False for everything already waiting: there are dozens of
-- them, and making a backlog unclearable until somebody has placed a few
-- hundred lines by hand would stop the work rather than account for it. Those
-- can still be placed line by line — they are just not held up by it.
ALTER TABLE job_cost_scans
  ADD COLUMN IF NOT EXISTS placement_required BOOLEAN NOT NULL DEFAULT true;

UPDATE job_cost_scans SET placement_required = false WHERE created_at <= NOW();

COMMENT ON TABLE scan_line_placements IS
  'Where each line on a scanned invoice ended up: a stock location, a job, or '
  'written off. See migration 121.';
