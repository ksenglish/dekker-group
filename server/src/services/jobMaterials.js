// Turning an accepted quote into a list of things to order.
//
// A quote is written for the customer. "Supply & install bathroom extractor"
// is one line and one price, and the person ordering needs the fan, the duct,
// the grille and the fixings, each against the supplier who sells it. So an
// accepted quote is exploded:
//
//   a kit          → its parts, multiplied through
//   a proposal     → the products the price was built from
//   anything else  → itself, if it is a product at all
//
// Labour lines, adjustments and anything typed straight onto a quote with no
// product behind it are left out: nobody orders those.
//
// Regenerating replaces only what a quote produced. Anything added by hand
// stays, because somebody put it there on purpose.
const pool = require('../db/pool');

const num = v => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
const round3 = n => Math.round(n * 1000) / 1000;

// The products a proposal was priced from, exploded — a kit inside one is
// parts all the way down, the same as a kit on the quote itself.
async function proposalProducts(proposalId, client) {
  const { rows } = await client.query(
    `SELECT pp.description, pp.quantity, pp.product_id,
            p.supplier, p.unit, p.name AS product_true_name,
            (SELECT COUNT(*)::int FROM product_components pc WHERE pc.parent_id = p.id) AS kit_parts
       FROM job_proposal_products pp
       LEFT JOIN products p ON p.id = pp.product_id
      WHERE pp.proposal_id = $1
      ORDER BY pp.sort_order, pp.id`,
    [proposalId]
  );
  const out = [];
  for (const pp of rows) {
    const qty = num(pp.quantity);
    if (qty <= 0) continue;
    if (pp.product_id && pp.kit_parts > 0) {
      out.push(...await kitParts(pp.product_id, qty, 'proposal_product', client));
    } else {
      out.push({
        product_id: pp.product_id || null,
        description: pp.description || pp.product_true_name || 'Material',
        supplier: pp.supplier || null,
        unit: pp.unit || null,
        quantity: qty,
        source: 'proposal_product',
      });
    }
  }
  return out;
}

// Which proposals this quote was built from.
//
// Asked of the proposal rather than of the quote's lines. A proposal records
// the quote it was quoted onto, and that survives things the line items do
// not: editing the quote deletes and rewrites every line, and a proposal is
// one summary line anyway when "Itemise on the quote" is left off — so the
// materials cannot depend on a tag riding along on a line that may not exist
// and may not have survived.
//
// The line tag is still read, for quotes raised before proposals recorded it.
async function proposalsFor(quoteId, client) {
  const { rows } = await client.query(
    `SELECT id FROM job_proposals WHERE quoted_on = $1
      UNION
     SELECT DISTINCT proposal_id FROM line_items
      WHERE quote_id = $1 AND proposal_id IS NOT NULL`,
    [quoteId]
  );
  return rows.map(r => r.id).filter(Boolean);
}

// One quote's worth of orderable material, already exploded and merged.
async function explodeQuote(quoteId, client = pool) {
  const { rows: lines } = await client.query(
    `SELECT li.id, li.description, li.quantity, li.product_id, li.product_name, li.proposal_id,
            p.name AS product_true_name, p.supplier, p.unit,
            (SELECT COUNT(*)::int FROM product_components pc WHERE pc.parent_id = p.id) AS kit_parts
       FROM line_items li
       LEFT JOIN products p ON p.id = li.product_id
      WHERE li.quote_id = $1
      ORDER BY li.created_at`,
    [quoteId]
  );

  const out = [];

  // The proposals first, whatever the quote's lines happen to look like. A
  // proposal that was quoted stands for its whole scope, and the materials are
  // the products that scope was priced from — one set per proposal, whether it
  // reached the quote as a single summary line or as one line per product.
  //
  // Every product a proposal accounts for is remembered, including the kits it
  // is made of, so the lines below cannot add the same thing a second time.
  const covered = new Set();
  for (const proposalId of await proposalsFor(quoteId, client)) {
    const { rows: own } = await client.query(
      'SELECT product_id FROM job_proposal_products WHERE proposal_id = $1 AND product_id IS NOT NULL',
      [proposalId]
    );
    own.forEach(r => covered.add(r.product_id));
    for (const item of await proposalProducts(proposalId, client)) {
      if (item.product_id) covered.add(item.product_id);
      out.push(item);
    }
  }

  for (const line of lines) {
    const qty = num(line.quantity);
    if (qty <= 0) continue;

    // Its proposal has been taken care of above, however the line is tagged.
    if (line.proposal_id) continue;

    // No product behind it: labour, an adjustment, something typed in. Nothing
    // to order.
    if (!line.product_id) continue;

    // An itemised proposal puts its products on the quote as ordinary lines,
    // and editing a quote strips the tag that said where they came from. The
    // proposal has already accounted for these, and merge() adds quantities
    // together — so counting them here would order twice as much timber.
    if (covered.has(line.product_id)) continue;

    if (line.kit_parts > 0) {
      out.push(...await kitParts(line.product_id, qty, 'kit_component', client));
      continue;
    }

    out.push({
      product_id: line.product_id,
      description: line.product_true_name || line.product_name || line.description,
      supplier: line.supplier || null,
      unit: line.unit || null,
      quantity: qty,
      source: 'quote_line',
    });
  }

  return merge(out);
}

// A kit's parts, multiplied by how many kits were quoted.
async function kitParts(kitId, kitQty, source, client) {
  const { rows } = await client.query(
    `SELECT pc.quantity, pc.component_id, p.name, p.supplier, p.unit,
            (SELECT COUNT(*)::int FROM product_components inner_pc
              WHERE inner_pc.parent_id = p.id) AS kit_parts
       FROM product_components pc
       JOIN products p ON p.id = pc.component_id
      WHERE pc.parent_id = $1
      ORDER BY pc.sort_order, p.name`,
    [kitId]
  );
  const out = [];
  for (const part of rows) {
    const qty = round3(num(part.quantity) * kitQty);
    if (qty <= 0) continue;
    // A kit made of kits: keep going down until there are only real products.
    if (part.kit_parts > 0) {
      out.push(...await kitParts(part.component_id, qty, source, client));
      continue;
    }
    out.push({
      product_id: part.component_id,
      description: part.name,
      supplier: part.supplier || null,
      unit: part.unit || null,
      quantity: qty,
      source,
    });
  }
  return out;
}

// The same product twice is one line of twice as many — a person ordering
// wants one number per thing, not a row per place it was quoted.
function merge(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = item.product_id || `desc:${item.description.toLowerCase()}`;
    const found = byKey.get(key);
    if (found) {
      found.quantity = round3(found.quantity + item.quantity);
      // A merged line that came from two different places is simply "from the
      // quote" — the distinction only matters for deciding what to replace.
      if (found.source !== item.source) found.source = 'quote_line';
    } else {
      byKey.set(key, { ...item, quantity: round3(item.quantity) });
    }
  }
  return [...byKey.values()];
}

// Writes the exploded list onto the job, replacing whatever that quote put
// there last time and leaving everything else alone.
//
// A material already ordered is kept as it is: it has been sent to a supplier,
// and quietly changing or removing it would make the order and the job
// disagree about what is coming.
async function syncFromQuote(quoteId, jobId) {
  if (!jobId || !quoteId) return { added: 0, kept: 0, removed: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const items = await explodeQuote(quoteId, client);

    const { rowCount: removed } = await client.query(
      `DELETE FROM job_materials
        WHERE job_id = $1 AND source_quote_id = $2 AND status = 'needed'`,
      [jobId, quoteId]
    );

    // What survived — ordered or received — is not added a second time.
    const { rows: kept } = await client.query(
      'SELECT product_id, description FROM job_materials WHERE job_id = $1 AND source_quote_id = $2',
      [jobId, quoteId]
    );
    const keptKeys = new Set(kept.map(k => k.product_id || `desc:${k.description.toLowerCase()}`));

    let added = 0;
    for (const [i, item] of items.entries()) {
      const key = item.product_id || `desc:${item.description.toLowerCase()}`;
      if (keptKeys.has(key)) continue;
      await client.query(
        `INSERT INTO job_materials
           (job_id, product_id, description, supplier, unit, quantity, source, source_quote_id, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [jobId, item.product_id, item.description, item.supplier, item.unit,
         item.quantity, item.source, quoteId, i]
      );
      added++;
    }

    await client.query('COMMIT');
    return { added, kept: kept.length, removed };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}

// The job's list, grouped the way it is ordered: by supplier.
async function listForJob(jobId) {
  const { rows } = await pool.query(
    `SELECT m.*, s.email AS supplier_email, s.account_ref AS supplier_account
       FROM job_materials m
       LEFT JOIN suppliers s ON LOWER(s.name) = LOWER(m.supplier)
      WHERE m.job_id = $1
      ORDER BY COALESCE(m.supplier, 'zzz'), m.sort_order, m.created_at`,
    [jobId]
  );
  const groups = new Map();
  for (const m of rows) {
    const key = m.supplier || '';
    if (!groups.has(key)) {
      groups.set(key, {
        supplier: m.supplier || null,
        supplier_email: m.supplier_email || null,
        supplier_account: m.supplier_account || null,
        items: [],
      });
    }
    groups.get(key).items.push({
      ...m,
      quantity: num(m.quantity),
    });
  }
  return [...groups.values()];
}

module.exports = { explodeQuote, syncFromQuote, listForJob, merge };
