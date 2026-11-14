-- One Job Form per person it is going to.
--
-- The form started as one document for the whole job, which is wrong the
-- moment two trades are on it: the sparky does not need the plumber's day in
-- the diary, and the roofer does not need photos of the switchboard. Each
-- share is its own copy — its own link, its own choice of pre-install files
-- and its own choice of bookings — so the office can send one person exactly
-- what that person needs and nothing else.
--
-- The link is live, the same way the service report's is. Editing a share
-- changes what its recipient sees next time they open it, rather than
-- producing a second link that competes with the first.

CREATE TABLE IF NOT EXISTS job_form_shares (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  -- What the recipient's URL carries. Unique across every job: a token is the
  -- whole of the access check, so two must never collide.
  token        UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

  recipient_name  VARCHAR(255),
  recipient_email VARCHAR(255),
  -- Said to this person only — the gate code, where to park. It prints on
  -- their copy and goes in their email, and nobody else's.
  message      TEXT,

  -- Which pre-install files and which bookings this copy carries.
  --
  -- NULL means everything, which is what a share made before somebody chose
  -- gets, and what "send them the lot" writes. An empty array is a real
  -- choice — none — and must not be confused with it, which is why this is
  -- nullable rather than defaulting to '{}'.
  --
  -- Deliberately not foreign keys: a photo deleted off the job simply stops
  -- appearing, and the share survives. The alternative is a cascade that
  -- quietly empties somebody's pack, or a restrict that stops the office
  -- tidying up the job.
  attachment_ids UUID[],
  schedule_ids   UUID[],

  -- Whether the works list off the accepted quote is on this copy.
  -- Descriptions and quantities only; there is no price anywhere in the form.
  include_works BOOLEAN NOT NULL DEFAULT false,

  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- When it was last emailed, so the office can see who has actually had it
  -- rather than who a link was made for.
  sent_at      TIMESTAMPTZ,
  -- Revoked rather than deleted: the record of who was sent what outlives the
  -- link, and a revoked token is never reissued.
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_job_form_shares_job ON job_form_shares(job_id);
-- The public page looks a share up by token on every load, and only a live
-- one answers.
CREATE INDEX IF NOT EXISTS idx_job_form_shares_token
  ON job_form_shares(token) WHERE revoked_at IS NULL;
