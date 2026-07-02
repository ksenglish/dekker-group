-- Tag each schedule entry as a Sales or Operations appointment so the
-- calendar can be filtered to show one or the other.
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS appointment_type VARCHAR(20)
  CHECK (appointment_type IN ('sales', 'operations'));
CREATE INDEX IF NOT EXISTS idx_schedules_appointment_type ON schedules(appointment_type);
