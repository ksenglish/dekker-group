// Editable content for the Dekker Air marketing site.
//
// Each key holds a `draft` and a `published` copy. The editor and the preview
// URL read the draft; the live site reads published. Publishing copies one over
// the other in a single statement, so the live site never shows a half-edited
// set of deals.
const crypto = require('crypto');
const pool = require('../db/pool');

const PREVIEW_TOKEN_KEY = 'website_preview_token';

// What a key starts life as, used the first time it is asked for. These mirror
// the deals that shipped hardcoded in the site's src/data/deals.js, so nothing
// changes the day this is switched on.
const DEFAULTS = {
  deals: [
    {
      id: 'high-wall-heat-pump',
      badge: 'Winter deal',
      title: 'Rinnai Pro Series 2 high wall heat pump',
      price: 'From $1,695',
      priceNote: 'installed',
      image: '/deals/high-wall-heat-pump.webp',
      imageAlt: 'Rinnai high wall heat pump — Dekker Air winter deal, from $1,695 installed',
      hook: "Don't wait for the cold snap — secure your installation now.",
      body: 'A Rinnai Pro Series 2 high wall heat pump supplied and installed, from $1,695.',
      terms: 'T&Cs apply.',
      service: 'heating',
      expires: '2026-08-31',
    },
    {
      id: 'ducted-heat-pump',
      badge: 'Winter deal',
      title: 'Rinnai Pro Series ducted heat pump',
      price: 'From $8,995',
      priceNote: 'installed',
      image: '/deals/ducted-heat-pump.webp',
      imageAlt: 'Whole home ducted heat pump — Dekker Air deal, from $8,995 installed',
      hook: 'Invisible comfort for your entire home — seamless, quiet and effortless.',
      body: 'A whole-home Rinnai Pro Series ducted heat pump supplied and installed, from $8,995. Get in touch today for your free quote.',
      terms: 'T&Cs apply.',
      service: 'heating',
      expires: '2026-08-31',
    },
    {
      id: 'smartvent-lite-plus',
      badge: 'Winter deal',
      title: 'SmartVent Lite+ home ventilation',
      price: 'From $2,595',
      priceNote: 'installed',
      image: '/deals/smartvent-lite-plus.webp',
      imageAlt: 'SmartVent Lite+ home ventilation system — Dekker Air deal, from $2,595 installed',
      hook: 'No more mould and crying windows — just fresh, dry air.',
      body: "A SmartVent Lite+ ventilation system supplied and installed, from $2,595. Protect your home and your family's health — get in touch today for your free quote.",
      terms: 'T&Cs apply.',
      service: 'ventilation',
      expires: '2026-08-31',
    },
    {
      id: 'heat-pump-service',
      badge: 'Service offer',
      title: 'High wall heat pump service',
      price: 'From $129',
      priceNote: null,
      image: '/deals/heat-pump-service.webp',
      imageAlt: 'Heat pump being serviced — Dekker Air servicing offer, from $129',
      hook: 'Protect your investment — keep your heat pump running clean and efficiently with annual servicing.',
      body: 'A full service on your high wall heat pump, from $129. Any brand, whoever installed it.',
      terms: 'T&Cs apply.',
      service: 'hvac-servicing',
      expires: '2026-08-31',
    },
  ],
};

// Reads a key, creating it from DEFAULTS on first use. A brand new key is
// seeded into both draft and published so the live site has something to serve
// immediately rather than going blank until someone presses Publish.
async function getContent(key) {
  const { rows } = await pool.query('SELECT * FROM website_content WHERE key = $1', [key]);
  if (rows[0]) return rows[0];

  const seed = JSON.stringify(DEFAULTS[key] ?? []);
  const { rows: created } = await pool.query(
    `INSERT INTO website_content (key, draft, published, published_at)
     VALUES ($1, $2, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key
     RETURNING *`,
    [key, seed]
  );
  return created[0];
}

async function saveDraft(key, value, userId) {
  await getContent(key); // ensure the row exists
  const { rows } = await pool.query(
    `UPDATE website_content
        SET draft = $2, updated_at = NOW(), updated_by = $3
      WHERE key = $1
      RETURNING *`,
    [key, JSON.stringify(value), userId || null]
  );
  return rows[0];
}

async function publish(key, userId) {
  const { rows } = await pool.query(
    `UPDATE website_content
        SET published = draft, published_at = NOW(), published_by = $2
      WHERE key = $1
      RETURNING *`,
    [key, userId || null]
  );
  return rows[0];
}

// Discards edits and takes the draft back to what is currently live.
async function revertDraft(key, userId) {
  const { rows } = await pool.query(
    `UPDATE website_content
        SET draft = COALESCE(published, '[]'::jsonb), updated_at = NOW(), updated_by = $2
      WHERE key = $1
      RETURNING *`,
    [key, userId || null]
  );
  return rows[0];
}

// True when the draft differs from what is live — drives the "unpublished
// changes" badge in the editor.
function hasUnpublishedChanges(row) {
  return JSON.stringify(row.draft) !== JSON.stringify(row.published ?? null);
}

async function getPreviewToken() {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [PREVIEW_TOKEN_KEY]);
  if (rows[0]?.value?.token) return rows[0].value.token;

  const token = crypto.randomBytes(24).toString('hex');
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [PREVIEW_TOKEN_KEY, JSON.stringify({ token })]
  );
  return token;
}

async function isValidPreviewToken(candidate) {
  if (!candidate) return false;
  const token = await getPreviewToken();
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  DEFAULTS,
  getContent,
  saveDraft,
  publish,
  revertDraft,
  hasUnpublishedChanges,
  getPreviewToken,
  isValidPreviewToken,
};
