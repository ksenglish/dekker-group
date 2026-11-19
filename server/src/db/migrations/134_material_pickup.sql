-- Somebody picking it up on the day.
--
-- Not everything on a job can be ordered. Top soil, metal, a load of bark —
-- somebody drives in and gets it, and until now the list had nowhere to say
-- so. Those lines sat on "To order" for the life of the job, which told the
-- crew nothing and told the office the wrong thing.
--
-- So a line can have somebody's name against it instead of an order. It is
-- not an order and does not pretend to be one: nothing is emailed, nothing
-- is sent, and the line reads as what it is — Pup to organise pick up.
ALTER TABLE job_materials ADD COLUMN IF NOT EXISTS pickup_user_id UUID
  REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS job_materials_pickup_idx ON job_materials (pickup_user_id)
  WHERE pickup_user_id IS NOT NULL;

COMMENT ON COLUMN job_materials.pickup_user_id IS
  'Who is organising to pick this one up, for the things that cannot be '
  'ordered. Set instead of putting the line on an order. See migration 134.';
