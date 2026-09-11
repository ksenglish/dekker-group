// Validators for the website content the app manages.
//
// These were written for the hand-editing forms under Website, where a bad
// expiry date would silently hide a live promotion and a mistyped percentage
// would be charged against. Claude writes the same content through the chat in
// that section, so it goes through these too rather than around them — the
// checks are the point, not the form.
const discounts = require('../utils/calculatorDiscounts');

const clip = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normaliseDeals(input) {
  if (!Array.isArray(input)) throw new Error('Deals must be a list');
  return input.map((d, i) => {
    if (!d || !String(d.title || '').trim()) throw new Error(`Deal ${i + 1} needs a title`);
    if (d.expires && !DATE_RE.test(d.expires)) throw new Error(`Deal ${i + 1} has an invalid expiry date`);
    return {
      id: clip(d.id, 100) || `deal-${i + 1}-${Date.now()}`,
      badge: clip(d.badge, 60),
      title: clip(d.title, 200),
      price: clip(d.price, 60),
      priceNote: clip(d.priceNote, 60),
      image: clip(d.image, 600),
      imageAlt: clip(d.imageAlt, 300),
      hook: clip(d.hook, 400),
      body: clip(d.body, 2000),
      terms: clip(d.terms, 1000),
      service: clip(d.service, 60),
      expires: d.expires || null,
    };
  });
}

module.exports = {
  deals: normaliseDeals,
  [discounts.CONTENT_KEY]: discounts.normalise,
};
