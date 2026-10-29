// Putting what we actually bought onto the price list, as we buy it.
//
// Every scanned supplier invoice carries lines the price list has never heard
// of — a bracket, a length of flue, a drill. Until now those lived only as a
// cost on one job: the next time somebody quoted the same thing they had
// nothing to look it up in, and the only way to catch up was an admin running
// Price List → From Invoices over the whole history by hand.
//
// So anything that does not already match something on the price list is
// added as it arrives, under Supplier Purchases, filed under the supplier who
// sold it, priced at what we paid plus the usual markup.
//
// Two things keep this from filling the price list with rubbish:
//
//   it matches first   Name, description or code — the same rule the imports
//                      use, widened to the description column because an
//                      invoice line is prose and the description is the best
//                      thing it has to match against.
//
//   it skips non-things  Freight, rounding and payment lines are on nearly
//                        every invoice and are not products.
//
// A tool is the same thing with a different label on it: a document filed in
// the Tools folder is buying tools, so its lines arrive as tools and are
// counted apart from stock rather than as consumables.
const pool = require('../db/pool');
const { matchProduct, groupSame, usableSku, norm } = require('./productMatch');
const { DEFAULT_MARKUP, sellFrom } = require('./costsToPriceList');

const CATEGORY = 'Supplier Purchases';

// Lines below this are rounding, or a scan reading the wrong column. A product
// that costs a cent is not a product.
const MIN_COST_CENTS = 1;

// On nearly every invoice, and none of them is a thing you can fit to a house.
// Matched whole-word so a "Freight elevator bracket" is not caught by it.
const NOT_A_PRODUCT = [
  'freight', 'delivery', 'delivery fee', 'cartage', 'courier', 'shipping',
  'rounding', 'round', 'discount', 'surcharge', 'subtotal', 'total', 'gst',
  'payment', 'credit', 'balance', 'account', 'invoice', 'statement',
  'admin fee', 'service fee', 'environmental fee', 'levy', 'fuel levy',
];

const looksLikeAProduct = description => {
  const d = norm(description).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!d) return false;
  // A line that is nothing but one of those words. "Freight" is not a product;
  // "freight bracket 90mm" is.
  if (NOT_A_PRODUCT.includes(d)) return false;
  // A bare number or code fragment on its own tells nobody anything, and the
  // price list is read by people.
  if (d.length < 3) return false;
  return true;
};

// Whether a folder is the Tools folder, or anything underneath it.
//
// Read off the path rather than the name, so "Tools / Hire" and
// "Tools / Power tools" count — somebody who has bothered to nest their
// folders should not lose the behaviour for it.
async function isToolFolder(folderId, client = pool) {
  if (!folderId) return false;
  const { rows } = await client.query('SELECT id, name, parent_id FROM cost_folders');
  const byId = new Map(rows.map(f => [f.id, f]));
  let cur = byId.get(folderId);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    if (norm(cur.name) === 'tools' || norm(cur.name) === 'tool') return true;
    seen.add(cur.id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return false;
}

// Add whatever is new.
//
// `lines` are {description, sku, cost_cents} — cents, because that is what the
// database holds and converting in one place beats converting in four.
// `documentType` so a credit note contributes nothing: a credit is money back,
// not the price of anything.
//
// Never throws at the caller. This runs alongside posting costs to a job, and
// a price list that could not be added to is not a reason to lose the costs.
async function intake({
  lines = [], supplier = null, documentType = 'invoice', costKind = 'material',
  stockKind = 'material', markup = DEFAULT_MARKUP, client = pool,
} = {}) {
  const out = { created: [], matched: 0, skipped: 0 };
  if (documentType === 'credit_note') {
    out.skipped = lines.length;
    return out;
  }
  // A sub-contractor's lines are labour on one job — "install 3 x downlights,
  // 4 hrs" — not a thing anybody can buy again. They are a cost and nothing
  // else, and the price list filling up with them would make it useless.
  if (costKind === 'subcontractor') {
    out.skipped = lines.length;
    return out;
  }

  const usable = lines.filter(l =>
    looksLikeAProduct(l.description) && Number(l.cost_cents) >= MIN_COST_CENTS);
  out.skipped += lines.length - usable.length;

  // One invoice can list the same thing twice — two lengths of the same flue
  // at two quantities — and that is one product, not two rows racing to be
  // written. Grouped by the shared rule before anything is written.
  const groups = groupSame(usable, {
    skuOf: l => l.sku, nameOf: l => l.description, supplierOf: () => supplier,
  });

  for (const group of groups.values()) {
    const line = group[0];
    const name = String(line.description).trim();
    try {
      const { product } = await matchProduct(
        { sku: line.sku, name, supplier, alsoDescription: true }, client);
      if (product) { out.matched++; continue; }

      const cost = Math.round(Number(line.cost_cents));
      const { rows: [made] } = await client.query(
        `INSERT INTO products
           (name, category, subcategory_1, unit, cost_price, unit_price,
            supplier, sku, stock_kind, is_active)
         VALUES ($1,$2,$3,'each',$4,$5,$6,$7,$8,true)
         RETURNING id, name, stock_kind`,
        [
          name, CATEGORY,
          // Filed under whoever sold it, so Supplier Purchases is browsable
          // rather than one heap of four hundred invoice lines.
          supplier ? String(supplier).trim() : 'Supplier not read',
          cost, sellFrom(cost, markup),
          supplier ? String(supplier).trim() : null,
          usableSku(line.sku) ? String(line.sku).trim() : null,
          stockKind === 'tool' ? 'tool' : 'material',
        ]
      );
      out.created.push(made);
    } catch (err) {
      // One bad line must not cost the rest of the invoice its products, and
      // must never cost the invoice its costs.
      out.skipped++;
      console.error('[price-list-intake] could not add "%s": %s', name, err.message);
    }
  }

  return out;
}

// The same thing, from a scan's own parsed lines rather than posted costs —
// used when a document is filed into a folder instead of onto a job, which is
// how tools arrive. `parsed_items` carry dollars, since that is what came back
// off the document.
async function intakeFromScan(scan, { client = pool, stockKind = null } = {}) {
  const kind = stockKind || (await isToolFolder(scan.folder_id, client) ? 'tool' : 'material');
  return intake({
    lines: (scan.parsed_items || []).map(i => ({
      description: i.description,
      sku: i.sku,
      cost_cents: Math.round(Number(i.unit_price || 0) * 100),
    })),
    supplier: scan.supplier,
    documentType: scan.document_type,
    costKind: scan.cost_kind,
    stockKind: kind,
    client,
  });
}

module.exports = {
  intake, intakeFromScan, isToolFolder, looksLikeAProduct, CATEGORY, NOT_A_PRODUCT,
};
