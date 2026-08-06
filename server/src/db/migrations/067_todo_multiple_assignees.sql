-- A to-do can be shared by several people, so assignees move out to their own
-- table. The old single assigned_to column is backfilled and then dropped so
-- there's only one source of truth.
CREATE TABLE IF NOT EXISTS todo_assignees (
  todo_id  UUID NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (todo_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_todo_assignees_user ON todo_assignees(user_id);

INSERT INTO todo_assignees (todo_id, user_id)
SELECT id, assigned_to FROM todos WHERE assigned_to IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE todos DROP COLUMN IF EXISTS assigned_to;
