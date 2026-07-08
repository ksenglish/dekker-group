-- ArcSite integration v1: push a job to ArcSite as a Project, pull the saved
-- drawing back as a job attachment (reuses the existing job_attachments table).

-- Jobs <-> ArcSite Project (push direction)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS arcsite_project_id VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_arcsite_project_id
  ON jobs(arcsite_project_id) WHERE arcsite_project_id IS NOT NULL;

-- Job attachments <-> ArcSite Drawing (pull direction) — lets a re-pull
-- upsert instead of duplicating the same drawing on every click.
ALTER TABLE job_attachments ADD COLUMN IF NOT EXISTS arcsite_drawing_id VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_attachments_arcsite_drawing
  ON job_attachments(job_id, arcsite_drawing_id) WHERE arcsite_drawing_id IS NOT NULL;
