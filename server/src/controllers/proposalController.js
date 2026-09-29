const pool = require('../db/pool');

// Priced proposals on a job — the Job Sheet spreadsheet, in the app.
//
// Every figure is integer cents excluding GST. The one place that isn't is
// the two markup percentages.

const GST_RATE = 0.15;

const DEFAULT_LABOUR = [
  { label: 'Builder Labour', cost_rate: 4000, charge_rate: 6500 },
  { label: 'Labourer', cost_rate: 3000, charge_rate: 5000 },
];

async function labourDefaults() {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key='proposal_labour_defaults'`);
  const v = rows[0]?.value;
  return Array.isArray(v) && v.length ? v : DEFAULT_LABOUR;
}

// Works a proposal's numbers out the way the sheet does.
//
//   materials sell = (cost total or RRP total) x (1 + markup%)
//   labour charge  = sum of charge_rate x qty
//   build-up       = materials sell + labour charge
//   quoted         = the typed price if there is one, else the build-up
//   margin         = quoted - (product COST total + labour COST total)
//
// The cost side deliberately ignores the markup and the charge rates: margin is
// what is left after what the job actually costs, which is the whole point of
// keeping two rates per labour line.
function priceProposal(proposal, products, labour) {
  const round = n => Math.round(n);

  const productCost = products.reduce((s, p) => s + round((Number(p.quantity) || 0) * p.cost_price), 0);
  const productRrp = products.reduce((s, p) => s + round((Number(p.quantity) || 0) * p.rrp), 0);

  const labourCost = labour.reduce((s, l) => s + round((Number(l.quantity) || 0) * l.cost_rate), 0);
  const labourCharge = labour.reduce((s, l) => s + round((Number(l.quantity) || 0) * l.charge_rate), 0);

  // Both options are returned, not just the chosen one — the sheet shows them
  // side by side so the estimator can see what the other would give. Each keeps
  // its own percentage.
  const costPct = Number(proposal.markup_cost_pct) || 0;
  const rrpPct = Number(proposal.markup_rrp_pct) || 0;
  const materialsFromCost = round(productCost * (1 + costPct / 100));
  const materialsFromRrp = round(productRrp * (1 + rrpPct / 100));
  const materialsSell = proposal.materials_basis === 'rrp' ? materialsFromRrp : materialsFromCost;

  const buildUp = materialsSell + labourCharge;
  const quoted = proposal.quote_price != null ? proposal.quote_price : buildUp;

  const totalCost = productCost + labourCost;
  const margin = quoted - totalCost;

  return {
    product_cost: productCost,
    product_rrp: productRrp,
    labour_cost: labourCost,
    labour_charge: labourCharge,
    materials_from_cost: materialsFromCost,
    materials_from_rrp: materialsFromRrp,
    materials_sell: materialsSell,
    build_up: buildUp,
    quoted,
    // Whether the quoted figure is the typed one or the computed build-up, so
    // the screen can say which and offer to reset it.
    is_overridden: proposal.quote_price != null,
    total_cost: totalCost,
    margin,
    margin_pct: quoted > 0 ? Math.round((margin / quoted) * 10000) / 100 : null,
    gst: Math.round(quoted * GST_RATE),
    total_incl_gst: quoted + Math.round(quoted * GST_RATE),
  };
}

async function loadProposals(jobId, proposalId) {
  const params = proposalId ? [proposalId] : [jobId];
  const where = proposalId ? 'p.id = $1' : 'p.job_id = $1';
  const { rows: proposals } = await pool.query(
    `SELECT * FROM job_proposals p WHERE ${where} ORDER BY p.sort_order, p.created_at`, params
  );
  if (!proposals.length) return [];
  const ids = proposals.map(p => p.id);
  const [{ rows: products }, { rows: labour }] = await Promise.all([
    pool.query('SELECT * FROM job_proposal_products WHERE proposal_id = ANY($1::uuid[]) ORDER BY sort_order, id', [ids]),
    pool.query('SELECT * FROM job_proposal_labour WHERE proposal_id = ANY($1::uuid[]) ORDER BY sort_order, id', [ids]),
  ]);
  return proposals.map(p => {
    const ps = products.filter(x => x.proposal_id === p.id);
    const ls = labour.filter(x => x.proposal_id === p.id);
    return { ...p, products: ps, labour: ls, totals: priceProposal(p, ps, ls) };
  });
}

async function list(req, res) {
  try {
    res.json(await loadProposals(req.params.id));
  } catch (err) {
    console.error('[proposals] list failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

async function create(req, res) {
  const jobId = req.params.id;
  try {
    const { rows: [job] } = await pool.query('SELECT id FROM jobs WHERE id=$1', [jobId]);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { rows: [{ n }] } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM job_proposals WHERE job_id=$1', [jobId]
    );
    // Proposal A, B, C… past Z it just keeps counting, which is fine — nobody
    // is pricing twenty-seven scopes on one job.
    const letter = n < 26 ? String.fromCharCode(65 + n) : String(n + 1);
    const name = (req.body?.name || '').trim() || `Proposal ${letter}`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [p] } = await client.query(
        `INSERT INTO job_proposals (job_id, name, sort_order, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
        [jobId, name, n, req.user?.id || null]
      );
      // Copying an existing proposal is how a second scope usually starts —
      // same labour lines, different materials.
      if (req.body?.copy_from) {
        const { rows: src } = await client.query(
          'SELECT * FROM job_proposals WHERE id=$1 AND job_id=$2', [req.body.copy_from, jobId]
        );
        if (src[0]) {
          await client.query(
            `UPDATE job_proposals SET materials_basis=$1, markup_cost_pct=$2, markup_rrp_pct=$3 WHERE id=$4`,
            [src[0].materials_basis, src[0].markup_cost_pct, src[0].markup_rrp_pct, p.id]
          );
          await client.query(
            `INSERT INTO job_proposal_labour (proposal_id, label, cost_rate, charge_rate, quantity, sort_order)
             SELECT $1, label, cost_rate, charge_rate, 0, sort_order FROM job_proposal_labour WHERE proposal_id=$2`,
            [p.id, src[0].id]
          );
        }
      } else {
        const defaults = await labourDefaults();
        for (const [i, d] of defaults.entries()) {
          await client.query(
            `INSERT INTO job_proposal_labour (proposal_id, label, cost_rate, charge_rate, quantity, sort_order)
             VALUES ($1,$2,$3,$4,0,$5)`,
            [p.id, d.label, Math.round(d.cost_rate) || 0, Math.round(d.charge_rate) || 0, i]
          );
        }
      }
      await client.query('COMMIT');
      const [full] = await loadProposals(jobId, p.id);
      res.status(201).json(full);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { client.release(); }
  } catch (err) {
    console.error('[proposals] create failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

const cents = v => (v == null || v === '' ? 0 : Math.max(0, Math.round(Number(v)) || 0));
const qty = v => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// One save for the whole proposal — header, products and labour together.
// Piecemeal endpoints would let a half-saved proposal exist, and the totals
// only mean anything when all three agree.
async function update(req, res) {
  const id = req.params.proposalId;
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [existing] } = await client.query('SELECT * FROM job_proposals WHERE id=$1', [id]);
    if (!existing) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Proposal not found' }); }

    const basis = b.materials_basis === 'rrp' ? 'rrp' : 'cost';
    const pct = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
    const costPct = pct(b.markup_cost_pct, Number(existing.markup_cost_pct));
    const rrpPct = pct(b.markup_rrp_pct, Number(existing.markup_rrp_pct));
    // An empty override means "go back to the build-up", which is different
    // from quoting zero — so only an explicit number is stored.
    const override = b.quote_price === '' || b.quote_price == null ? null : cents(b.quote_price);

    await client.query(
      `UPDATE job_proposals SET name=$1, materials_basis=$2, markup_cost_pct=$3, markup_rrp_pct=$4,
              quote_price=$5, notes=$6, updated_at=NOW() WHERE id=$7`,
      [(b.name || existing.name || '').trim() || existing.name, basis, costPct, rrpPct, override, b.notes ?? existing.notes, id]
    );

    if (Array.isArray(b.products)) {
      // The price list hides cost from anyone but an admin, so an office user
      // building a proposal has no cost to send. Fill it from the product here
      // rather than widening what /products gives out — the proposal still
      // costs correctly, and the price list keeps its rule.
      const needCost = b.products.filter(p => p.product_id && (p.cost_price == null || p.cost_price === ''));
      const costById = new Map();
      if (needCost.length) {
        const { rows } = await client.query(
          'SELECT id, cost_price, unit_price FROM products WHERE id = ANY($1::uuid[])',
          [needCost.map(p => p.product_id)]
        );
        rows.forEach(r => costById.set(r.id, r));
      }

      await client.query('DELETE FROM job_proposal_products WHERE proposal_id=$1', [id]);
      for (const [i, p] of b.products.entries()) {
        if (!String(p.description || '').trim()) continue;
        const looked = costById.get(p.product_id);
        const cost = p.cost_price == null || p.cost_price === ''
          ? (looked ? looked.cost_price : 0)
          : cents(p.cost_price);
        await client.query(
          `INSERT INTO job_proposal_products (proposal_id, product_id, description, product_name, quantity, cost_price, rrp, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, p.product_id || null, String(p.description).trim(), p.product_name || null,
           qty(p.quantity), cost, cents(p.rrp), i]
        );
      }
    }

    if (Array.isArray(b.labour)) {
      await client.query('DELETE FROM job_proposal_labour WHERE proposal_id=$1', [id]);
      for (const [i, l] of b.labour.entries()) {
        if (!String(l.label || '').trim()) continue;
        await client.query(
          `INSERT INTO job_proposal_labour (proposal_id, label, cost_rate, charge_rate, quantity, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, String(l.label).trim(), cents(l.cost_rate), cents(l.charge_rate), qty(l.quantity), i]
        );
      }
    }

    await client.query('COMMIT');
    const [full] = await loadProposals(existing.job_id, id);
    res.json(full);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[proposals] update failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
}

async function remove(req, res) {
  try {
    const { rowCount } = await pool.query('DELETE FROM job_proposals WHERE id=$1', [req.params.proposalId]);
    if (!rowCount) return res.status(404).json({ error: 'Proposal not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('[proposals] delete failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

// ── Onto the job's line items ───────────────────────────────────────────────

// What the customer should see. The build-up behind a proposal is internal —
// cost prices, markup and margin are nobody's business but ours — so a proposal
// becomes ONE line at its quoted price, named after the scope.
//
// `itemise: true` breaks it into materials and each labour line instead, for
// customers who want to see the parts. Cost prices never leave either way.
function proposalToLineItems(proposal, { itemise } = {}) {
  const t = proposal.totals;
  if (!itemise) {
    return [{ description: proposal.name, quantity: 1, unit_price: t.quoted }];
  }
  const lines = [];
  if (t.materials_sell > 0) {
    lines.push({ description: `${proposal.name} — materials`, quantity: 1, unit_price: t.materials_sell });
  }
  for (const l of proposal.labour) {
    const q = Number(l.quantity) || 0;
    if (q <= 0 || l.charge_rate <= 0) continue;
    lines.push({ description: `${proposal.name} — ${l.label}`, quantity: q, unit_price: l.charge_rate });
  }
  // A rounded quote has to still add up to the rounded figure, or the customer
  // sees a total that disagrees with the lines. The difference goes on its own
  // line rather than being smeared across the others.
  const sum = lines.reduce((s, l) => s + Math.round(l.quantity * l.unit_price), 0);
  const diff = t.quoted - sum;
  if (diff !== 0) {
    lines.push({ description: `${proposal.name} — adjustment`, quantity: 1, unit_price: diff });
  }
  return lines;
}

async function addToLineItems(req, res) {
  const jobId = req.params.id;
  const ids = Array.isArray(req.body?.proposal_ids) ? req.body.proposal_ids : [];
  if (!ids.length) return res.status(400).json({ error: 'Choose at least one proposal' });
  const itemise = req.body?.itemise === true;

  const client = await pool.connect();
  try {
    const all = await loadProposals(jobId);
    const chosen = all.filter(p => ids.includes(p.id));
    if (!chosen.length) return res.status(404).json({ error: 'Those proposals are not on this job' });

    await client.query('BEGIN');
    let added = 0;
    for (const p of chosen) {
      for (const line of proposalToLineItems(p, { itemise })) {
        await client.query(
          `INSERT INTO line_items (job_id, description, quantity, unit_price) VALUES ($1,$2,$3,$4)`,
          [jobId, line.description, line.quantity, line.unit_price]
        );
        added++;
      }
    }
    await client.query('COMMIT');

    const { rows: items } = await pool.query(
      'SELECT * FROM line_items WHERE job_id=$1 AND quote_id IS NULL ORDER BY created_at', [jobId]
    );
    res.status(201).json({ added, line_items: items });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[proposals] adding to line items failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
}

module.exports = { list, create, update, remove, addToLineItems, priceProposal, proposalToLineItems };
