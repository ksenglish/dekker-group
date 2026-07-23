const pool = require('../db/pool');

const DEFAULT_THEME = {
  companyName: 'DEKKER GROUP',
  tagline: 'HVAC Installation & Field Services',
  website: 'dekkergroup.co.nz',
  email: 'kyle@dekkergroup.co.nz',
  phone: '',
  location: 'New Zealand',
  gstNumber: '',
  brandColour: '#1e40af',
  footerLine1: 'Thank you for your business.',
  footerLine2: 'Dekker Group · New Zealand · GST registered',
  logoBase64: '',
  transparentHeader: false,
  logoSize: 'medium',       // 'small' | 'medium' | 'large'
  logoPosition: 'left',     // 'left' | 'right'
  contactPosition: 'right', // 'left' | 'right'
  quoteExpiryDays: 30,      // default expiry in days (0 = no expiry)
};

async function getTheme() {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key='quote_theme'`);
  return rows[0] ? { ...DEFAULT_THEME, ...rows[0].value } : DEFAULT_THEME;
}

async function get(req, res) {
  try {
    res.json(await getTheme());
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function update(req, res) {
  try {
    const current = await getTheme();
    const updated = { ...current, ...req.body };
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('quote_theme', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
      [JSON.stringify(updated)]
    );
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

module.exports = { get, update, getTheme };
