-- Op Forms: one operational completion form per job (site safety, work
-- completed to spec, customer walkthrough), filled in by the field team.

CREATE TABLE IF NOT EXISTS job_op_forms (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  site_safety_confirmed BOOLEAN NOT NULL DEFAULT false,
  work_completed_to_spec BOOLEAN NOT NULL DEFAULT false,
  customer_walkthrough_done BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  technician_name VARCHAR(200) NOT NULL,
  completed_by INTEGER REFERENCES users(id),
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
