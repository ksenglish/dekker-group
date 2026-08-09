-- Tracks whether someone has looked at a to-do assigned to them, so a task
-- handed over by a colleague can announce itself until it's been seen.
ALTER TABLE todo_assignees ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_todo_assignees_unseen
  ON todo_assignees(user_id) WHERE seen_at IS NULL;

-- Everything assigned before this existed is treated as already seen. Otherwise
-- the whole team logs in to a badge counting tasks they have known about for
-- weeks, and the number means nothing.
UPDATE todo_assignees SET seen_at = NOW() WHERE seen_at IS NULL;
