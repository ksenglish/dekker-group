// Deciding whether something is a product the price list already holds.
//
// One rule, in one place, used by everything that can create a product: the
// CSV and ZIP imports, the build-from-invoices job, and the price-change
// report that has to find the product an invoice line refers to. Three
// different answers to "is this the same thing" is how a price list ends up
// with the same heat pump on it four times at four prices, and whichever row
// happens to be picked on a quote is the price the customer gets.
//
// Two ways in:
//
//   by code   The supplier's own code, matched within that supplier. Codes are
//             stable where names are not — "MSZ-AP35VGKD2 SMART" and "MSZ
//             AP35VGKD2" are one product and two names, but one code.
//
//             Scoped to the supplier on purpose. Codes are only unique inside
//             the business that issues them, and merging Bunnings' 0123456
//             with Mico's 0123456 would put two unrelated things on one row
//             with one price — a quieter and worse failure than a duplicate.
//
//   by name   Everything else, and the only option for the rows already on
//             file, which have no code. Compared with case and surrounding
//             space ignored, which is what the importer has always done.
//
// Name matching is deliberately global rather than per-supplier: the same
// product bought from two merchants should be one row, and the name is the
// only thing the two have in common.
const pool = require('../db/pool');

const norm = v => String(v ?? '').trim().toLowerCase();

// Empty, whitespace, and the strings a scan produces when it found nothing
// are all "no code" — none of them should match another product that also
// has no code.
function usableSku(sku) {
  const s = norm(sku);
  if (!s || s === 'n/a' || s === 'na' || s === '-' || s === 'none' || s === 'null') return null;
  return s;
}

// The product this refers to, or null. `client` so a caller inside a
// transaction sees its own uncommitted rows.
//
// `alsoDescription` widens the name test to the description column, in both
// directions: an invoice line reading "Insulated flexible duct 300mm x 6m"
// finds the product called DCT4276 that describes itself that way, and vice
// versa. Opt-in rather than always on, because the callers differ in what
// they are holding. A line off an invoice is prose and the description is the
// best thing it has to go on; a row in a supplier's CSV has a real name, and
// letting that match somebody else's description column is how two different
// products quietly become one.
async function matchProduct({ sku, name, supplier, alsoDescription = false }, client = pool) {
  const code = usableSku(sku);

  if (code && norm(supplier)) {
    const { rows } = await client.query(
      `SELECT * FROM products
        WHERE LOWER(TRIM(sku)) = $1 AND LOWER(TRIM(COALESCE(supplier, ''))) = $2
        ORDER BY created_at
        LIMIT 1`,
      [code, norm(supplier)]
    );
    if (rows[0]) return { product: rows[0], matchedOn: 'sku' };
  }

  if (norm(name)) {
    const { rows } = await client.query(
      `SELECT * FROM products WHERE LOWER(TRIM(name)) = $1 ORDER BY created_at LIMIT 1`,
      [norm(name)]
    );
    if (rows[0]) return { product: rows[0], matchedOn: 'name' };
  }

  // Tried after the name, never instead of it, so a description match can only
  // ever find something the name test missed.
  if (alsoDescription && norm(name)) {
    const { rows } = await client.query(
      `SELECT * FROM products
        WHERE LOWER(TRIM(COALESCE(description, ''))) = $1
        ORDER BY created_at LIMIT 1`,
      [norm(name)]
    );
    if (rows[0]) return { product: rows[0], matchedOn: 'description' };
  }

  return { product: null, matchedOn: null };
}

// Groups rows that are the same product before any of them is written.
//
// An invoice history holds the same item dozens of times — bought in March,
// bought again in July — and importing it row by row would ask the database
// the same question over and over and still risk two rows racing in. So the
// grouping is done first, in memory, by the same rule.
//
// Returns a Map of key -> rows, in the order the keys were first seen.
function groupSame(rows, { skuOf = r => r.sku, nameOf = r => r.name, supplierOf = r => r.supplier } = {}) {
  const groups = new Map();
  // A code claims a name: once "0123456" and "Timber 90x45" have been seen on
  // the same line, a later line carrying only that name joins the code's group
  // rather than starting a second one.
  const nameToKey = new Map();

  for (const row of rows) {
    const code = usableSku(skuOf(row));
    const supplier = norm(supplierOf(row));
    const name = norm(nameOf(row));

    const byCode = code ? `sku:${supplier}|${code}` : null;
    const byName = name ? `name:${name}` : null;
    const key = byCode || nameToKey.get(byName) || byName || `row:${groups.size}`;

    if (byCode && byName && !nameToKey.has(byName)) nameToKey.set(byName, byCode);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

module.exports = { matchProduct, groupSame, usableSku, norm };
