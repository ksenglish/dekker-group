-- Marketing Library: the supplier material (brochures, lifestyle photography,
-- product shots) the marketing manager and the website worker build the site
-- from. Filled mostly by automation/marketing-sync.js, which uploads whatever
-- lands in a folder on the office PC, and by hand from Website → Marketing
-- Library.
--
-- Separate from website_media on purpose. That table holds images that are live
-- on the site: served publicly, and converted to WebP on the way in. This is the
-- private source library, kept as the files were supplied.

-- Folders are paths, e.g. 'Mitsubishi/AP Series/Lifestyle'. A file records the
-- path it sits in; this table exists so a folder made in the app stays put
-- before anything has been uploaded into it. Uploading into a path creates the
-- path and every parent above it.
CREATE TABLE IF NOT EXISTS marketing_folders (
  path TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- '' is the top of the library
  folder_path TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes BIGINT NOT NULL,
  width INTEGER,
  height INTEGER,
  -- SHA-256 of the file. Unique, so the same photo downloaded twice — or synced
  -- again from a different folder — is kept once.
  content_hash CHAR(64) NOT NULL,
  -- Bytes in object storage, falling back to the database when no bucket is
  -- configured — the arrangement fileStore uses everywhere else.
  storage_key TEXT,
  data_base64 TEXT,
  -- A small WebP made at upload, so a grid of photos doesn't pull every
  -- full-size original out of storage to draw its tiles.
  thumb_key TEXT,
  thumb_base64 TEXT,
  source VARCHAR(20) NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'sync')),
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_assets_hash ON marketing_assets(content_hash);
CREATE INDEX IF NOT EXISTS idx_marketing_assets_folder ON marketing_assets(folder_path);
