-- Per-appointment notes, separate from job notes, editable from the Schedule page
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS notes TEXT;
