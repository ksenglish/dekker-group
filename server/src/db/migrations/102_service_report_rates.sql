-- Migration 102: per-job labour and travel rates on the service report
--
-- The house billing rates are a starting point, the same way the materials
-- markup is: a job won on a negotiated rate has to be able to say so, and the
-- report has to match the invoice that follows it.
--
-- Labour: dollars per hour excl. GST for every hour on the job that is not
-- travel. Null = each hour stays at the billing rate it was logged against.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS service_report_labour_rate NUMERIC(10,2);

-- Travel: either an hourly rate on the travel hours recorded, or a fixed charge
-- for each travel entry recorded (a trip). Null mode = the house travel rate.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS service_report_travel_mode TEXT
  CHECK (service_report_travel_mode IN ('hourly', 'fixed'));
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS service_report_travel_rate NUMERIC(10,2);
