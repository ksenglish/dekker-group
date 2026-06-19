const pool = require('../src/db/pool');

const defaultTheme = {
  companyName: 'DEKKER GROUP',
  tagline: 'HVAC Installation & Field Services',
  website: 'dekkergroup.co.nz',
  email: 'kyle@dekkergroup.co.nz',
  phone: '',
  location: 'New Zealand',
  brandColour: '#1e40af',
  footerLine1: 'Thank you for your business.',
  footerLine2: 'Dekker Group · New Zealand · GST registered',
  logoBase64: '',
};

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(100) PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
    ['quote_theme', JSON.stringify(defaultTheme)]
  );
  console.log('Settings table ready');
  pool.end();
}

run().catch(e => { console.error(e.message); pool.end(); });
