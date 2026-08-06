-- Simple to-do list. due_date is optional: with one set the item becomes
-- "due" (and badges) once the date arrives; without one it's just a reminder.
CREATE TABLE IF NOT EXISTS todos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description  TEXT NOT NULL,
  notes        TEXT,
  due_date     DATE,
  assigned_to  UUID REFERENCES users(id) ON DELETE SET NULL,
  job_id       UUID REFERENCES jobs(id) ON DELETE SET NULL,
  done         BOOLEAN NOT NULL DEFAULT FALSE,
  done_at      TIMESTAMPTZ,
  done_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_todos_done ON todos(done);
CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date) WHERE done = FALSE;
CREATE INDEX IF NOT EXISTS idx_todos_assigned_to ON todos(assigned_to);
