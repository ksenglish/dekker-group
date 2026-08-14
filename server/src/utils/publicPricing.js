// Controls whether the public marketing site is allowed to show prices from
// the price list, and what installation charge gets added to each unit.
//
// Read by the public endpoint (routes/public.js) and read/written by the
// Website Pricing tab in Settings (routes/settings.js).
const pool = require('../db/pool');

const SETTINGS_KEY = 'public_heatpump_pricing';

// Off until someone deliberately turns it on — no deploy should start
// publishing prices by itself.
const DEFAULTS = { enabled: false, installCents: 0 };

async function getPublicPricing() {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [SETTINGS_KEY]);
  return { ...DEFAULTS, ...(rows[0]?.value || {}) };
}

async function savePublicPricing({ enabled, installCents }) {
  const value = {
    enabled: !!enabled,
    installCents: Math.max(0, Math.round(Number(installCents) || 0)),
  };
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [SETTINGS_KEY, JSON.stringify(value)]
  );
  return value;
}

module.exports = { SETTINGS_KEY, DEFAULTS, getPublicPricing, savePublicPricing };
