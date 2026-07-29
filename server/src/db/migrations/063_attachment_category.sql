-- Photos are now uploaded from two places: the Pre-Install Forms tab and the
-- Post Install Forms tab. Without a category they'd share one pool, so
-- post-install photos would light up the Pre-Install indicator on the job
-- summary and each tab would show the other's photos.
ALTER TABLE job_attachments ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'pre_install';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'job_attachments'::regclass AND conname = 'job_attachments_category_check'
  ) THEN
    ALTER TABLE job_attachments
      ADD CONSTRAINT job_attachments_category_check
      CHECK (category IN ('pre_install', 'post_install'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_attachments_category ON job_attachments(job_id, category);
