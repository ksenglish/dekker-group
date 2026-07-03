-- Freeform notes on the Schedule calendar, separate from job appointments.
-- Created by clicking an empty slot in a team member's column/day.
CREATE TABLE IF NOT EXISTS calendar_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  note_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  recurrence VARCHAR(10) NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_notes_user_id ON calendar_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_notes_note_date ON calendar_notes(note_date);
