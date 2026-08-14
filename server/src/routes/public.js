// ── Public, unauthenticated endpoints for the marketing site ──────────────────
// Mounted with open CORS (see index.js) because dekkerair.co.nz is a different
// origin. Everything here is world-readable, so add to it carefully.
const router = require('express').Router();
const pool = require('../db/pool');
const { RINNAI_HEATPUMP_TABLE } = require('../utils/heatpumpSizing');

const SETTINGS_KEY = 'public_heatpump_pricing';
const GST_MULTIPLIER = 1.15;

// Pricing is OFF until someone turns it on and sets an install cost — deploying
// this route must not publish the price list by itself. To enable:
//
//   INSERT INTO settings (key, value) VALUES
//     ('public_heatpump_pricing', '{"enabled":true,"installCents":XXXXX}')
//   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
//
// installCents is the installation charge added to each unit's supply price,
// in cents, EXCLUDING GST — GST is applied to the combined figure below.
const DEFAULTS = { enabled: false, installCents: 0 };

async function getConfig() {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [SETTINGS_KEY]);
  return { ...DEFAULTS, ...(rows[0]?.value || {}) };
}

const norm = s => (s || '').trim().toLowerCase();

// GET /api/public/heat-pumps
//
// Deliberately narrow: only the Rinnai highwall models the sizing calculator
// can recommend, and only their installed retail price inc GST. cost_price,
// supplier and every other product field stay private.
router.get('/heat-pumps', async (req, res) => {
  try {
    const config = await getConfig();

    let priceList = [];
    if (config.enabled) {
      const { rows } = await pool.query(
        'SELECT name, description, unit_price FROM products WHERE is_active = true'
      );
      priceList = rows;
    }

    const models = RINNAI_HEATPUMP_TABLE.map(band => {
      // The price list may carry either the model code or the full description
      // as the product name, so match on both — same rule the Sales Presenter
      // uses.
      const match = priceList.find(p => {
        const fields = [norm(p.name), norm(p.description)];
        return fields.includes(norm(band.model)) || fields.includes(norm(band.description));
      });

      return {
        model: band.model,
        description: band.description,
        kwMin: band.kwMin,
        kwMax: band.kwMax,
        // Cents, inc GST, installation included. null means "ask us" — either
        // pricing is off or that model isn't on the price list.
        installedPriceIncGstCents: match
          ? Math.round((match.unit_price + config.installCents) * GST_MULTIPLIER)
          : null,
      };
    });

    res.set('Cache-Control', 'public, max-age=300');
    res.json({ pricingEnabled: !!config.enabled, currency: 'NZD', models });
  } catch (err) {
    console.error('GET /api/public/heat-pumps failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
