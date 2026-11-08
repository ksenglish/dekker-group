-- Payment terms a quote can set for itself, the same way it can its terms
-- and conditions (migration 122).
--
-- Payment terms are the ones most likely to move job to job: a deposit on a
-- big supply, progress payments on a long install, seven days instead of the
-- 20th for a customer who asked. The wording still belongs to the Document
-- Theme — NULL means follow it, so a quote left alone picks up a later edit
-- — and text means somebody wrote it for this job.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS payment_terms TEXT;

COMMENT ON COLUMN quotes.payment_terms IS
  'This quote''s own payment terms. NULL means follow the document theme. See migration 123.';
