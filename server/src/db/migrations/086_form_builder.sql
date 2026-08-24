-- Admin-built onsite forms. The Electrical COC stays as its own bespoke
-- table/component — it's a statutory certificate with a prescribed layout and
-- its own PDF — so these are additional forms that sit alongside it.

CREATE TABLE IF NOT EXISTS form_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  -- Which tab on the job the form belongs under
  stage VARCHAR(20) NOT NULL DEFAULT 'post_install' CHECK (stage IN ('pre_install', 'post_install')),
  -- [{ id, type, label, required, options[], help }] — see FIELD_TYPES in
  -- client/src/pages/settings/formFields.js for the supported types.
  fields JSONB NOT NULL DEFAULT '[]',
  archived BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  -- RESTRICT, not CASCADE: a completed form is a record of work done and must
  -- not disappear because someone tidied up the template list. The API blocks
  -- deleting a template that has submissions and offers archiving instead.
  template_id UUID NOT NULL REFERENCES form_templates(id) ON DELETE RESTRICT,

  -- The fields as they were when this form was filled in. Templates get edited;
  -- without a snapshot an old submission would render against the new field list
  -- and quietly lose or mislabel answers.
  fields_snapshot JSONB NOT NULL DEFAULT '[]',
  answers JSONB NOT NULL DEFAULT '{}',

  status VARCHAR(20) NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed')),
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One submission per template per job, so re-attaching is idempotent
  UNIQUE (job_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_job_form_submissions_job ON job_form_submissions(job_id);
CREATE INDEX IF NOT EXISTS idx_form_templates_stage ON form_templates(stage) WHERE NOT archived;
