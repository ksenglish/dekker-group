-- Migration 034: Allow job deletion by fixing FK constraints that had no ON DELETE action.
-- Quotes, invoices, timesheets and email_log all referenced jobs(id) without a rule,
-- causing Postgres to block any DELETE on jobs that had related rows.
-- SET NULL preserves historical records while allowing the job to be removed.

ALTER TABLE quotes     DROP CONSTRAINT IF EXISTS quotes_job_id_fkey;
ALTER TABLE quotes     ADD  CONSTRAINT quotes_job_id_fkey     FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;

ALTER TABLE invoices   DROP CONSTRAINT IF EXISTS invoices_job_id_fkey;
ALTER TABLE invoices   ADD  CONSTRAINT invoices_job_id_fkey   FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;

ALTER TABLE timesheets DROP CONSTRAINT IF EXISTS timesheets_job_id_fkey;
ALTER TABLE timesheets ADD  CONSTRAINT timesheets_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;

ALTER TABLE email_log  DROP CONSTRAINT IF EXISTS email_log_job_id_fkey;
ALTER TABLE email_log  ADD  CONSTRAINT email_log_job_id_fkey  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
