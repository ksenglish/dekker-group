// ── Public, unauthenticated endpoints for the marketing site ──────────────────
// Mounted with open CORS (see index.js) because dekkerair.co.nz is a different
// origin. Everything here is world-readable, so add to it carefully.
const router = require('express').Router();
const pool = require('../db/pool');
const { RINNAI_HEATPUMP_TABLE } = require('../utils/heatpumpSizing');
const { SMARTVENT_TABLE } = require('../utils/smartVentSizing');
const { getPublicPricing } = require('../utils/publicPricing');
const content = require('../services/websiteContent');
const media = require('../services/websiteMedia');

const GST_MULTIPLIER = 1.15;

const norm = s => (s || '').trim().toLowerCase();

// GET /api/public/heat-pumps
//
// Deliberately narrow: only the Rinnai highwall models the sizing calculator
// can recommend, and only their installed retail price inc GST. cost_price,
// supplier and every other product field stay private.
//
// Pricing stays off until it's switched on in Settings → Website Pricing, so
// deploying this route does not publish the price list by itself.
router.get('/heat-pumps', async (req, res) => {
  try {
    const config = await getPublicPricing();

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

// GET /api/public/ventilation-systems?family=positive|balanced
//
// The SmartVent sizing bands, plus an installed price per model where the
// price list has one. Same arrangement as the heat pumps: only the models the
// calculator can recommend, only their installed retail price, and nothing at
// all until pricing is switched on in Settings.
router.get('/ventilation-systems', async (req, res) => {
  try {
    const family = ['positive', 'balanced'].includes(req.query.family) ? req.query.family : null;
    const config = await getPublicPricing();

    let priceList = [];
    if (config.enabled) {
      const { rows } = await pool.query(
        'SELECT name, description, unit_price FROM products WHERE is_active = true'
      );
      priceList = rows;
    }

    const priceFor = (model) => {
      const match = priceList.find(p => {
        const fields = [norm(p.name), norm(p.description)];
        return fields.includes(norm(model));
      });
      return match
        ? Math.round((match.unit_price + config.installCents) * GST_MULTIPLIER)
        : null;
    };

    const rows = SMARTVENT_TABLE
      .filter(r => !family || r.family === family)
      .map(r => ({
        family: r.family,
        system: r.system,
        houseMin: r.houseMin,
        houseMax: r.houseMax,
        outlets: r.outlets,
        model: r.model,
        installedPriceIncGstCents: priceFor(r.model),
      }));

    res.set('Cache-Control', 'public, max-age=300');
    res.json({ pricingEnabled: !!config.enabled, currency: 'NZD', systems: rows });
  } catch (err) {
    console.error('GET /api/public/ventilation-systems failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Website content ──────────────────────────────────────────────────────────
// The live site gets the published copy. Supplying the preview token — which
// the Website section of the app hands out — returns the draft instead, so a
// change can be looked at in place before anyone else sees it.
router.get('/website/deals', async (req, res) => {
  try {
    const row = await content.getContent('deals');
    const preview = await content.isValidPreviewToken(req.query.preview);
    const deals = (preview ? row.draft : row.published) || [];

    // A draft must never be cached, or a preview would go stale mid-edit.
    res.set('Cache-Control', preview ? 'no-store' : 'public, max-age=120');
    res.json({
      preview,
      publishedAt: preview ? null : row.published_at,
      deals,
    });
  } catch (err) {
    console.error('GET /api/public/website/deals failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/website/media/:id', async (req, res) => {
  try {
    const file = await media.readBuffer(req.params.id);
    if (!file) return res.status(404).end();
    // Bytes never change for a given id — a new upload gets a new one.
    res.set('Content-Type', file.mime);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(file.buffer);
  } catch (err) {
    console.error('GET website media failed:', err.message);
    res.status(500).end();
  }
});

module.exports = router;
