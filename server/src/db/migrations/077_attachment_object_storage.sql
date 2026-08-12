-- Attachments move out of the database and into object storage.
--
-- Storing files inline as base64 made a large drawing a very large single
-- statement, which is what took Postgres down when a 17MB ArcSite export was
-- pulled. Files belong in a bucket; the database keeps the record of them.

-- Where the file lives in the bucket. NULL means this row predates the change
-- and its bytes are still in data_base64, so both are readable side by side and
-- nothing has to be migrated up front.
ALTER TABLE job_attachments ADD COLUMN IF NOT EXISTS storage_key TEXT;

-- Set for new rows so size is known without fetching the file back.
ALTER TABLE job_attachments ADD COLUMN IF NOT EXISTS size_bytes BIGINT;

-- New rows keep their bytes in the bucket, so this can no longer be required.
ALTER TABLE job_attachments ALTER COLUMN data_base64 DROP NOT NULL;

-- A row must have its bytes in one place or the other.
ALTER TABLE job_attachments DROP CONSTRAINT IF EXISTS job_attachments_have_bytes;
ALTER TABLE job_attachments ADD CONSTRAINT job_attachments_have_bytes
  CHECK (storage_key IS NOT NULL OR data_base64 IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_job_attachments_storage_key
  ON job_attachments(storage_key) WHERE storage_key IS NOT NULL;
