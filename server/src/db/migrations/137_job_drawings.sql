-- A drawing measured on site, kept so it can be opened again.
--
-- The drawing tool already existed inside the fence and deck calculators, but
-- what it drew lived only for as long as that calculator was open. Somebody
-- stood in a back yard, measured it, got a price, and the measurements went
-- with the tab — so the next person to want them measured it again.
--
-- A drawing is saved on the job as an ordinary attachment, which is what makes
-- it turn up on the Pre-Install Forms tab and in the quote attachment picker
-- beside the photographs, with no new plumbing for either. What is new is the
-- plan beside the picture: the corners, whether it closes, and the gates on it.
-- The picture is what a customer sees; the plan is what the tool reads back so
-- the walls can be moved and a calculator run over them.
ALTER TABLE job_attachments ADD COLUMN IF NOT EXISTS plan_json JSONB;

-- The drawings on a job, which is a different question from its photographs
-- and the one the Drawing Tool asks every time it opens.
CREATE INDEX IF NOT EXISTS job_attachments_drawings
  ON job_attachments (job_id, created_at DESC) WHERE plan_json IS NOT NULL;

COMMENT ON COLUMN job_attachments.plan_json IS
  'The drawing behind the picture: { points, closed, objects, calculator }. '
  'NULL for an ordinary photograph or PDF. See migration 137.';
