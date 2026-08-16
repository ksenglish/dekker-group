-- Migration 079: editable website content for dekkerair.co.nz
--
-- Content the marketing site reads at runtime, so publishing a change does not
-- need a site rebuild. Each key holds two copies: `draft` is what the editor
-- and the preview URL see, `published` is what the live site serves. That makes
-- publishing a single atomic copy rather than a per-row flag, so the live site
-- can never show a half-finished set of deals.

CREATE TABLE IF NOT EXISTS website_content (
  key           VARCHAR(100) PRIMARY KEY,
  draft         JSONB NOT NULL DEFAULT '[]'::jsonb,
  published     JSONB,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at  TIMESTAMPTZ,
  published_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Images uploaded for the website. Bytes go to object storage when it is
-- configured and fall back to the database otherwise — the same arrangement
-- attachments and product media use (see services/fileStore.js).
CREATE TABLE IF NOT EXISTS website_media (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename     VARCHAR(255) NOT NULL,
  mime         VARCHAR(100) NOT NULL DEFAULT 'image/webp',
  width        INTEGER,
  height       INTEGER,
  bytes        INTEGER,
  storage_key  TEXT,
  data_base64  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS website_media_created_idx ON website_media (created_at DESC);

-- Website change requests — a queue of things to fix or add, logged as they are
-- noticed so they survive between sessions.
CREATE TABLE IF NOT EXISTS website_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        VARCHAR(255) NOT NULL,
  details      TEXT,
  page         VARCHAR(255),
  status       VARCHAR(20) NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'in_progress', 'done', 'dismissed')),
  media_id     UUID REFERENCES website_media(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS website_requests_status_idx ON website_requests (status, created_at DESC);
