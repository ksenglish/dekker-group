// Putting one line off an invoice where it actually went.
//
// Three destinations, and each has to do the thing it says rather than only
// record that somebody said it:
//
//   location   the warehouse or a van. Finds the product or makes one, then
//              writes the same `receive` movement scanning it in would, so it
//              shows on the Stock or Tools tab and in Recent movements.
//   job        onto that job as a cost, the same row linking the whole
//              document produces.
//   not_stock  consumed, a fee, a delivery. Nothing moves; the decision is
//              what is recorded, so the line is accounted for rather than
//              quietly skipped.
//
// Reversible, because a line placed on the wrong van has to be fixable: the
// movement and the cost row are both remembered against the placement and
// undone with it.
const pool = require('../db/pool');
const { matchProduct, usableSku } = require('./productMatch');
const { DEFAULT_MARKUP, sellFrom } = require('./costsToPriceList');

const CATEGORY = 'Supplier Purchases';

const cents = v => Math.round(Number(v || 0) * 100);

// The lines on a document that have to be accounted for.
//
// Not every row on an invoice is a thing: freight, rounding and the document
// total are lines too, and holding a receipt hostage over its own freight
// charge would make this a nuisance rather than a control. The same rule the
// price-list intake uses decides, so the two agree about what counts.
function placeableLines(parsedItems, looksLikeAProduct) {
  return (parsedItems || []).map((item, index) => ({
    index,
    description: String(item.description || '').trim(),
    sku: item.sku || null,
    quantity: Number(item.quantity) || 1,
    unit_price: Number(item.unit_price) || 0,
    placeable: looksLikeAProduct(item.description) && Number(item.unit_price) !== 0,
  }));
}

// The product this line is, finding it or making it.
//
// A line being placed into stock has to be a product: stock is counted per
// product, and there is nowhere to put a quantity of a sentence. So the price
// list gains it if it has not got it, at what the invoice charged plus the
// house markup — the same arithmetic the automatic intake uses.
async function productFor(line, { supplier, stockKind, client }) {
  const { product } = await matchProduct(
    { sku: line.sku, name: line.description, supplier, alsoDescription: true }, client);
  if (product) {
    // A line placed as a tool, against a product filed as a material, is
    // somebody telling us which it is. Taken as the correction it is — but
    // only in that direction, so placing a drill into a van as a material by
    // accident does not un-tool it.
    if (stockKind === 'tool' && product.stock_kind !== 'tool') {
      await client.query('UPDATE products SET stock_kind = $1, updated_at = NOW() WHERE id = $2',
        ['tool', product.id]);
    }
    return { product, created: false };
  }

  const cost = cents(line.unit_price);
  const { rows: [made] } = await client.query(
    `INSERT INTO products
       (name, description, category, subcategory_1, unit, cost_price, unit_price,
        supplier, sku, stock_kind, is_active)
     VALUES ($1,$9,$2,$3,'each',$4,$5,$6,$7,$8,true)
     RETURNING *`,
    [
      line.description, CATEGORY,
      supplier ? String(supplier).trim() : 'Supplier not read',
      cost, sellFrom(cost, DEFAULT_MARKUP),
      supplier ? String(supplier).trim() : null,
      usableSku(line.sku) ? String(line.sku).trim() : null,
      stockKind === 'tool' ? 'tool' : 'material',
      line.description,
    ]
  );
  return { product: made, created: true };
}

// Stock in, by the same route a scan takes. Written here rather than reusing
// the stock router's helper so this stays inside the caller's transaction.
async function receive(client, { productId, locationId, quantity, userId }) {
  await client.query(
    `INSERT INTO stock_levels (location_id, product_id, quantity, updated_at)
     VALUES ($1,$2,$3::numeric,NOW())
     ON CONFLICT (location_id, product_id)
     DO UPDATE SET quantity = stock_levels.quantity + $3::numeric, updated_at = NOW()`,
    [locationId, productId, quantity]
  );
  await client.query(
    `INSERT INTO stock_movements (product_id, from_location_id, to_location_id, quantity, reason, user_id)
     VALUES ($1,NULL,$2,$3,'receive',$4)`,
    [productId, locationId, quantity, userId]
  );
}

// Place one line. Replaces whatever that line was placed as before, undoing
// its effect first, so changing your mind is a correction rather than a second
// helping of stock.
async function place(client, {
  scan, line, destination, locationId = null, jobId = null,
  stockKind = 'material', note = null, userId,
}) {
  await unplace(client, { scanId: scan.id, lineIndex: line.index });

  let productId = null;
  let jobCostId = null;
  let createdProduct = false;

  if (destination === 'location') {
    const { product, created } = await productFor(line, {
      supplier: scan.supplier, stockKind, client,
    });
    productId = product.id;
    createdProduct = created;
    await receive(client, {
      productId, locationId, quantity: line.quantity, userId,
    });
  } else if (destination === 'job') {
    const { rows: [cost] } = await client.query(
      `INSERT INTO job_costs (job_id, scan_id, description, sku, quantity, unit_price, sort_order, cost_kind)
       VALUES ($1,$2,$3,$4,$5,$6,
               COALESCE((SELECT MAX(sort_order) + 1 FROM job_costs WHERE job_id = $1), 0),
               $7)
       RETURNING id`,
      [jobId, scan.id, line.description, line.sku, line.quantity, cents(line.unit_price),
       scan.cost_kind || 'material']
    );
    jobCostId = cost.id;
  }

  const { rows: [row] } = await client.query(
    `INSERT INTO scan_line_placements
       (scan_id, line_index, description, quantity, destination,
        location_id, job_id, product_id, job_cost_id, note, placed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [scan.id, line.index, line.description, line.quantity, destination,
     destination === 'location' ? locationId : null,
     destination === 'job' ? jobId : null,
     productId, jobCostId, note, userId]
  );

  return { ...row, created_product: createdProduct };
}

// Take a placement back, and take back what it did.
//
// Stock that was received comes off again by the opposite movement rather than
// by editing the figure, so Recent movements tells the whole story — including
// the mistake and its correction, which is what somebody checking a count
// needs to see.
async function unplace(client, { scanId, lineIndex }) {
  const { rows: [existing] } = await client.query(
    `SELECT * FROM scan_line_placements
      WHERE scan_id = $1 AND line_index = $2 FOR UPDATE`,
    [scanId, lineIndex]
  );
  if (!existing) return null;

  if (existing.destination === 'location' && existing.product_id && existing.location_id) {
    await client.query(
      `UPDATE stock_levels SET quantity = quantity - $1::numeric, updated_at = NOW()
        WHERE location_id = $2 AND product_id = $3`,
      [existing.quantity, existing.location_id, existing.product_id]
    );
    await client.query(
      `INSERT INTO stock_movements (product_id, from_location_id, to_location_id, quantity, reason, user_id)
       VALUES ($1,$2,NULL,$3,'adjust',$4)`,
      [existing.product_id, existing.location_id, existing.quantity, existing.placed_by]
    );
  }

  if (existing.destination === 'job' && existing.job_cost_id) {
    // Only while the job has not been billed for it. Once it is on an invoice
    // the money has been asked for, and quietly removing the cost would make
    // the job look more profitable than it was.
    const { rows: [cost] } = await client.query(
      'SELECT billed_at FROM job_costs WHERE id = $1', [existing.job_cost_id]);
    if (cost && !cost.billed_at) {
      await client.query('DELETE FROM job_costs WHERE id = $1', [existing.job_cost_id]);
    }
  }

  await client.query('DELETE FROM scan_line_placements WHERE id = $1', [existing.id]);
  return existing;
}

// What is still outstanding on a document.
async function outstanding(scanId, parsedItems, looksLikeAProduct, client = pool) {
  const lines = placeableLines(parsedItems, looksLikeAProduct).filter(l => l.placeable);
  if (lines.length === 0) return { total: 0, placed: 0, missing: [] };
  const { rows } = await client.query(
    'SELECT line_index FROM scan_line_placements WHERE scan_id = $1', [scanId]);
  const done = new Set(rows.map(r => r.line_index));
  const missing = lines.filter(l => !done.has(l.index));
  return { total: lines.length, placed: lines.length - missing.length, missing };
}

module.exports = { placeableLines, place, unplace, outstanding, CATEGORY };
