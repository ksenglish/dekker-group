// Discounts applied to the website's calculator prices.
//
// One discount per calculator, edited under Website → Latest Deals and stored
// as a website_content key so it gets the same draft/preview/publish treatment
// as the deals themselves — a price change should never go live by accident.
//
// The discount comes off every model the calculator can recommend, so whatever
// size system a visitor lands on, the figure they see already has it applied.
const content = require('../services/websiteContent');

const CONTENT_KEY = 'calculator_discounts';

// The calculators a discount can be set against. Keys are stable — they are
// what the stored records are keyed by.
const CALCULATORS = {
  heatpump: 'Heat pumps',
  positive: 'Positive pressure ventilation',
  balanced: 'Balanced pressure ventilation',
};

const KINDS = ['percent', 'amount'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A ceiling on percentages, so a typo — 90 where 9 was meant — is caught here
// rather than on the website.
const MAX_PERCENT = 90;

// Today in New Zealand. Expiry is a calendar date someone typed, so it has to
// be compared against the local day, not UTC's.
const nzToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());

// Discounts arrive from a form. Anything unusable throws, and the message goes
// straight back to the editor — these are numbers someone will charge against.
function normalise(input) {
  if (!Array.isArray(input)) throw new Error('Discounts must be a list');

  const seen = new Set();
  return input.map((d) => {
    const calculator = String(d?.calculator || '');
    const name = CALCULATORS[calculator];
    if (!name) throw new Error(`Unknown calculator "${calculator}"`);
    if (seen.has(calculator)) throw new Error(`${name} has two discounts — it can only have one`);
    seen.add(calculator);

    const kind = KINDS.includes(d.kind) ? d.kind : 'percent';
    const enabled = !!d.enabled;
    const raw = Number(d.value);

    // An empty or zero value is allowed as long as the discount is switched
    // off — that's a half-filled row, not a mistake worth blocking a save for.
    if (enabled && !(raw > 0)) throw new Error(`${name} needs a discount amount`);
    if (enabled && kind === 'percent' && raw > MAX_PERCENT) {
      throw new Error(`${name}: ${raw}% is too large a discount (max ${MAX_PERCENT}%)`);
    }
    if (d.expires && !DATE_RE.test(d.expires)) throw new Error(`${name} has an invalid end date`);

    return {
      calculator,
      kind,
      // Percent keeps two decimals; an amount is cents off the price shown on
      // the site, which is inc GST.
      value: kind === 'percent'
        ? Math.round((raw || 0) * 100) / 100
        : Math.max(0, Math.round(raw || 0)),
      label: (d.label == null || d.label === '' ? null : String(d.label).slice(0, 60)),
      expires: d.expires || null,
      enabled,
    };
  });
}

// The discount in force for a calculator right now, or null. Pure, so the
// expiry rule can be checked without a database.
function activeFor(list, calculator, today = nzToday()) {
  const found = (Array.isArray(list) ? list : []).find(d => d && d.calculator === calculator);
  if (!found || !found.enabled || !(found.value > 0)) return null;
  if (found.expires && found.expires < today) return null;
  return found;
}

// What the public API hands the website: enough to badge the price and show
// what it was, without the site having to know the storage shape.
function describe(discount) {
  if (!discount) return null;
  return {
    kind: discount.kind,
    label: discount.label || null,
    percent: discount.kind === 'percent' ? discount.value : null,
    amountIncGstCents: discount.kind === 'amount' ? discount.value : null,
  };
}

// Takes the discount off a price. Never returns less than zero — a fixed
// amount larger than the price would otherwise come out negative.
function applyDiscount(cents, discount) {
  if (cents == null || !discount) return cents;
  const after = discount.kind === 'percent'
    ? Math.round(cents * (1 - discount.value / 100))
    : cents - discount.value;
  return Math.max(0, after);
}

// Reads the stored discounts. The preview token — the one the Website section
// hands out — sees the draft, so a discount can be checked on the real site
// before customers get it.
async function getActiveDiscount(calculator, { preview = false } = {}) {
  const row = await content.getContent(CONTENT_KEY);
  const list = (preview ? row.draft : row.published) || [];
  return activeFor(list, calculator);
}

module.exports = {
  CONTENT_KEY,
  CALCULATORS,
  KINDS,
  MAX_PERCENT,
  normalise,
  activeFor,
  describe,
  applyDiscount,
  getActiveDiscount,
  nzToday,
};
