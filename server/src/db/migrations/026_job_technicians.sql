-- Multiple team members per job
CREATE TABLE IF NOT EXISTS job_technicians (
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_job_technicians_job_id ON job_technicians(job_id);
CREATE INDEX IF NOT EXISTS idx_job_technicians_user_id ON job_technicians(user_id);

-- Seed from existing lead_tech_id so no data is lost
INSERT INTO job_technicians (job_id, user_id)
  SELECT id, lead_tech_id FROM jobs WHERE lead_tech_id IS NOT NULL
  ON CONFLICT DO NOTHING;
