-- Hub folders somebody can actually manage, and somewhere for PDF Check to
-- put a document that is not a cost.
--
-- The Hub shipped with six folders written into a migration. Everything since
-- has had to live in one of those six, or nowhere — there was no way to add a
-- seventh, rename one, or put a folder inside another, which is the first
-- thing anyone expects of a folder.
--
-- And PDF Check could only ever file into the operating-cost folders. A price
-- list, a manual, an insurance certificate — documents that arrive in the same
-- inbox and are not costs at all — had nowhere to go but a cost folder they
-- did not belong in.

-- ── Folders inside folders ───────────────────────────────────────────────────

ALTER TABLE hub_folders
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES hub_folders(id) ON DELETE RESTRICT;

ALTER TABLE hub_folders
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- A name is unique among its siblings, not across the whole Hub: "2026" under
-- Price Lists and "2026" under Health and Safety are two different folders and
-- both are the obvious name.
ALTER TABLE hub_folders DROP CONSTRAINT IF EXISTS hub_folders_name_key;

-- Two indexes rather than one, because a NULL parent is not equal to another
-- NULL parent as far as a unique index is concerned, and the top level is
-- exactly where duplicate names would be most confusing.
CREATE UNIQUE INDEX IF NOT EXISTS hub_folders_name_in_parent
  ON hub_folders (parent_id, LOWER(TRIM(name)))
  WHERE parent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS hub_folders_name_at_top
  ON hub_folders (LOWER(TRIM(name)))
  WHERE parent_id IS NULL;

CREATE INDEX IF NOT EXISTS hub_folders_parent ON hub_folders (parent_id);

-- ── Documents that live in the bucket ────────────────────────────────────────
--
-- A Hub document carried its own bytes as base64 in the row. That was fine
-- for six policies uploaded by hand; it is not fine once PDF Check can send
-- documents here, because those are the same scans the app already went to
-- some trouble to keep out of the database.
--
-- So a document is either a key in the bucket or inline bytes, the same way
-- an attachment has been since migration 077. Everything already here keeps
-- its bytes and goes on working.

ALTER TABLE hub_documents ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE hub_documents ALTER COLUMN data_base64 DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_documents_has_bytes') THEN
    ALTER TABLE hub_documents ADD CONSTRAINT hub_documents_has_bytes
      CHECK (storage_key IS NOT NULL OR data_base64 IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS hub_documents_storage_key
  ON hub_documents (storage_key) WHERE storage_key IS NOT NULL;

-- Where it came from, when it came from PDF Check. Kept so the Hub can say so,
-- and so deleting the scan does not take the filed document with it.
ALTER TABLE hub_documents
  ADD COLUMN IF NOT EXISTS source_scan_id UUID REFERENCES job_cost_scans(id) ON DELETE SET NULL;

-- ── PDF Check knows it went to the Hub ───────────────────────────────────────
--
-- Alongside folder_id, which files into an operating-cost folder. A document
-- goes to one or the other, and which one is the difference between a cost and
-- a document we are keeping.
ALTER TABLE job_cost_scans
  ADD COLUMN IF NOT EXISTS hub_folder_id UUID REFERENCES hub_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS job_cost_scans_hub_folder
  ON job_cost_scans (hub_folder_id) WHERE hub_folder_id IS NOT NULL;

COMMENT ON COLUMN hub_folders.parent_id IS
  'Folders nest. NULL is the top level. See migration 117.';
COMMENT ON COLUMN job_cost_scans.hub_folder_id IS
  'Filed into the Hub rather than into an operating-cost folder: a document '
  'we are keeping, not a cost. See migration 117.';
