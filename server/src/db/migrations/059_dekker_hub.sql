-- Dekker Hub — the internal company area: shared documents, company events,
-- and staff feedback on the app itself.

-- Document folders. Seeded with the starting set but kept in a table rather
-- than hard-coded so more can be added later without a code change.
CREATE TABLE IF NOT EXISTS hub_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO hub_folders (name, sort_order)
SELECT v.name, v.sort_order
FROM (VALUES
  ('Company Policies',  1),
  ('Sales Forms',       2),
  ('Operations Forms',  3),
  ('Health and Safety', 4),
  ('User Manuals',      5),
  ('PDF Price Lists',   6)
) AS v(name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM hub_folders f WHERE f.name = v.name);

-- Documents live as base64 like job_attachments, so there's no separate file
-- store to keep in sync with the database.
CREATE TABLE IF NOT EXISTS hub_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id UUID NOT NULL REFERENCES hub_folders(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes INT,
  data_base64 TEXT NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hub_documents_folder ON hub_documents(folder_id);

-- Company events — team meetings, training days, supplier visits. Admin
-- managed, visible to all staff.
CREATE TABLE IF NOT EXISTS hub_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  start_time TIME,
  location VARCHAR(255),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hub_events_date ON hub_events(event_date);

-- Staff feedback about the app. Anyone can raise it; admins resolve it.
CREATE TABLE IF NOT EXISTS hub_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'unresolved' CHECK (status IN ('unresolved', 'resolved')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_feedback_status ON hub_feedback(status, created_at DESC);
