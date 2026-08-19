-- What was actually said on a call, kept next to the result it was recorded
-- with. last_result only says "Left Voice Mail"; this says what the voicemail
-- was about, and who left it.
CREATE TABLE IF NOT EXISTS lead_call_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  note       TEXT NOT NULL,
  -- The call result logged alongside this note, when there was one. Null for a
  -- note added on its own without changing where the lead stands.
  result     VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_call_notes_lead ON lead_call_notes(lead_id, created_at DESC);

-- Who booked the job, as opposed to resulted_by which records whoever touched
-- the lead first. "Leads booked by user" needs the person who actually won it.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS converted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Historic rows can only be approximated from whoever actioned the lead. It's
-- the same person in the common case where one person works a lead end to end.
UPDATE leads SET converted_by = resulted_by
  WHERE converted_by IS NULL AND status = 'converted' AND resulted_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_converted_by ON leads(converted_by) WHERE status = 'converted';
CREATE INDEX IF NOT EXISTS idx_leads_created_at_source ON leads(created_at, source);
