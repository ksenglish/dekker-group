const pool = require('../src/db/pool');
async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS timesheets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      hours NUMERIC(5,2) NOT NULL DEFAULT 0,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS timesheets_job_id_idx ON timesheets(job_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS timesheets_user_id_idx ON timesheets(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS timesheets_date_idx ON timesheets(date)`);
  console.log('Timesheets table ready');
  pool.end();
}
run().catch(e => { console.error(e.message); pool.end(); });
