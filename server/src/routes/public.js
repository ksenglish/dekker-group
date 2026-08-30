// ── Public, unauthenticated endpoints for the marketing site ──────────────────
// Mounted with open CORS (see index.js) because dekkerair.co.nz is a different
// origin. Everything here is world-readable, so add to it carefully.
const router = require('express').Router();
const pool = require('../db/pool');
const { RINNAI_HEATPUMP_TABLE } = require('../utils/heatpumpSizing');
const { SMARTVENT_TABLE } = require('../utils/smartVentSizing');
const { getPublicPricing } = require('../utils/publicPricing');
const discounts = require('../utils/calculatorDiscounts');
const content = require('../services/websiteContent');
const media = require('../services/websiteMedia');

const GST_MULTIPLIER = 1.15;

const norm = s => (s || '').trim().toLowerCase();

// Public prices are shown to the dollar — "From $2,595" reads better than
// "From $2,595.01", and the cents were only ever an artefact of adding GST to
// a trade price anyway. Rounded up, never down, so the site can't advertise
// less than the real figure. Applied to every price as it leaves here, so it
// doesn't depend on how the site chooses to format it.
const toWholeDollars = cents => (cents == null ? null : Math.ceil(cents / 100) * 100);

// The "Installation from" figure for these calculator types.
//
// An explicit figure set against a presenter product wins — that's the number
// someone has decided to quote publicly. Failing that it falls back to the
// install product's own rate, so the site still says something useful before
// anyone has filled the field in. Lowest of whatever is available, since it's
// quoted as a "from".
async function installRateIncGstCents(calculatorTypes) {
  const { rows } = await pool.query(
    `SELECT MIN(pp.install_from_cents) AS stated,
            MIN(ip.unit_price)         AS rate
       FROM presenter_products pp
       LEFT JOIN products ip ON ip.id = pp.install_product_id AND ip.is_active = true
      WHERE pp.calculator_type = ANY($1)`,
    [calculatorTypes]
  );
  const source = rows[0]?.stated ?? rows[0]?.rate;
  return source == null ? null : toWholeDollars(Math.round(source * GST_MULTIPLIER));
}

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
    const preview = await content.isValidPreviewToken(req.query.preview);
    const discount = config.enabled
      ? await discounts.getActiveDiscount('heatpump', { preview })
      : null;

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

      // Cents, inc GST, installation included. null means "ask us" — either
      // pricing is off or that model isn't on the price list.
      const listPrice = match
        ? Math.round((match.unit_price + config.installCents) * GST_MULTIPLIER)
        : null;

      return {
        model: band.model,
        description: band.description,
        kwMin: band.kwMin,
        kwMax: band.kwMax,
        // What the customer pays, discount already taken off, so an old build
        // of the site quotes the right number without knowing about discounts.
        // Rounded after the discount — taking a percentage off a whole-dollar
        // figure puts the cents straight back.
        installedPriceIncGstCents: toWholeDollars(discounts.applyDiscount(listPrice, discount)),
        // The pre-discount price, for showing what it was. Equal to the above
        // when nothing is discounted.
        listPriceIncGstCents: toWholeDollars(listPrice),
      };
    });

    res.set('Cache-Control', preview ? 'no-store' : 'public, max-age=300');
    res.json({
      pricingEnabled: !!config.enabled,
      currency: 'NZD',
      // Installation is a separate product now, charged once per unit.
      installFromIncGstCents: config.enabled ? await installRateIncGstCents(['heatpump']) : null,
      discount: discounts.describe(discount),
      models,
    });
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
    const preview = await content.isValidPreviewToken(req.query.preview);

    // Without a family the response spans both, and they can be discounted
    // differently — so the discount is resolved per row, not per request.
    const families = family ? [family] : ['positive', 'balanced'];
    const byFamily = {};
    for (const f of families) {
      byFamily[f] = config.enabled ? await discounts.getActiveDiscount(f, { preview }) : null;
    }

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
      .map(r => {
        const listPrice = priceFor(r.model);
        return {
          family: r.family,
          system: r.system,
          houseMin: r.houseMin,
          houseMax: r.houseMax,
          outlets: r.outlets,
          model: r.model,
          // Discounted, so an old build of the site still quotes the right
          // number; listPriceIncGstCents is what it was before. Rounded after
          // the discount, for the reason noted on the heat pumps above.
          installedPriceIncGstCents: toWholeDollars(discounts.applyDiscount(listPrice, byFamily[r.family])),
          listPriceIncGstCents: toWholeDollars(listPrice),
        };
      });

    const installTypes = family === 'balanced'
      ? ['smartvent_balanced_pressure']
      : ['smartvent_lite', 'smartvent_positive_pressure', 'bdvair_positive_pressure'];

    // A single headline figure, not a rate to multiply out — the site quotes
    // "installation from X" and the real number is settled on site.
    const installFrom = config.enabled ? await installRateIncGstCents(installTypes) : null;

    res.set('Cache-Control', preview ? 'no-store' : 'public, max-age=300');
    res.json({
      pricingEnabled: !!config.enabled,
      currency: 'NZD',
      installFromIncGstCents: installFrom,
      // The discount for the family asked for. A request spanning both carries
      // them per row instead, so there is no single one to name here.
      discount: family ? discounts.describe(byFamily[family]) : null,
      // Kept for the version of the site that's live until this change is
      // published; it reads the old name. Safe to drop after that.
      installPerOutletIncGstCents: installFrom,
      systems: rows,
    });
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
