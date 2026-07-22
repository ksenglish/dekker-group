-- Digital "Electrical Certificate of Compliance & Electrical Safety
-- Certificate" form, filled in onsite by whichever licensed electrical
-- worker completed the job. First of what will become a library of
-- digital Post Install Forms.

ALTER TABLE users ADD COLUMN IF NOT EXISTS licence_number VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile VARCHAR(50);

CREATE TABLE IF NOT EXISTS job_electrical_coc (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,

  reference_no VARCHAR(100),
  location_details TEXT,
  contact_details TEXT,
  electrical_worker_name VARCHAR(255),
  licence_number VARCHAR(100),
  phone_email VARCHAR(255),
  supervised_persons TEXT,

  -- Certificate of Compliance
  work_type VARCHAR(20) CHECK (work_type IN ('addition','alteration','new_work')),
  risk_level VARCHAR(20) CHECK (risk_level IN ('low_risk','general','high_risk')),
  high_risk_detail TEXT,
  compliance_part VARCHAR(10) CHECK (compliance_part IN ('part1','part2')),
  additional_standards_required BOOLEAN,
  additional_standards_detail TEXT,
  work_date_range VARCHAR(255),
  fittings_safe BOOLEAN,
  supply_system_type VARCHAR(255),
  earthing_correctly_rated BOOLEAN,
  parts_scope VARCHAR(10) CHECK (parts_scope IN ('all','parts')),
  parts_scope_detail TEXT,
  relies_on_manual BOOLEAN,
  manual_identify TEXT,
  manual_link TEXT,
  relies_on_certified_design BOOLEAN,
  design_identify TEXT,
  design_link TEXT,
  relies_on_sdoc BOOLEAN,
  sdoc_identify TEXT,
  sdoc_link TEXT,
  satisfactorily_tested BOOLEAN,
  description_of_work TEXT,
  test_polarity VARCHAR(50),
  test_insulation_resistance VARCHAR(50),
  test_earth_continuity VARCHAR(50),
  test_bonding VARCHAR(50),
  test_fault_loop_impedance VARCHAR(50),
  test_other VARCHAR(255),
  coc_certifier_signature VARCHAR(255),
  coc_signed_date DATE,

  -- Electrical Safety Certificate
  esc_certifier_name VARCHAR(255),
  esc_licence_number VARCHAR(100),
  esc_certifier_signature VARCHAR(255),
  esc_issue_date DATE,
  esc_connection_date DATE,

  completed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
