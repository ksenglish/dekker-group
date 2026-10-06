const pool = require('../db/pool');
const { findJobType } = require('../services/jobTypes');
const { getThemeById, getDefaultTheme } = require('../utils/documentThemes');

// Priced proposals on a job — the Job Sheet spreadsheet, in the app.
//
// Every figure is integer cents excluding GST. The one exception is markup_pct.

const GST_RATE = 0.15;

// Works a proposal's numbers out the way the sheet does.
//
//   materials  = sum of each product's CHARGE x units
//                (charge defaults to cost + markup%, and can be overridden
//                 per row — the markup is the tool that fills the column)
//   labour     = sum of charge_rate x units
//   build-up   = materials + labour
//   quoted     = the typed price if there is one, else the build-up
//   margin     = quoted - (product COST total + labour COST total)
//
// The cost side deliberately ignores the charge rates: margin is what is left
// after what the job actually costs, which is why every line carries two rates.
function priceProposal(proposal, products, labour) {
  const round = n => Math.round(n);

  const productCost = products.reduce((s, p) => s + round((Number(p.quantity) || 0) * p.cost_price), 0);
  const productCharge = products.reduce((s, p) => s + round((Number(p.quantity) || 0) * p.charge_price), 0);

  const labourCost = labour.reduce((s, l) => s + round((Number(l.quantity) || 0) * l.cost_rate), 0);
  const labourCharge = labour.reduce((s, l) => s + round((Number(l.quantity) || 0) * l.charge_rate), 0);

  const markup = Number(proposal.markup_pct) || 0;
  // What the materials would come to if every row took the markup — shown
  // beside the actual figure so an overridden row is visible rather than
  // silently changing the total.
  const materialsAtMarkup = round(productCost * (1 + markup / 100));

  const buildUp = productCharge + labourCharge;
  const quoted = proposal.quote_price != null ? proposal.quote_price : buildUp;

  const totalCost = productCost + labourCost;
  const margin = quoted - totalCost;

  return {
    product_cost: productCost,
    product_charge: productCharge,
    materials_at_markup: materialsAtMarkup,
    labour_cost: labourCost,
    labour_charge: labourCharge,
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
    `SELECT p.*, q.quote_number
       FROM job_proposals p
       LEFT JOIN quotes q ON q.id = p.quoted_on
      WHERE ${where} ORDER BY p.sort_order, p.created_at`, params
  );
  if (!proposals.length) return [];
  const ids = proposals.map(p => p.id);
  const [{ rows: products }, { rows: labour }] = await Promise.all([
    // The product's quote wording is read live rather than snapshotted: prices
    // must not move under a sent proposal, but how a post is described on a
    // quote is wording the office is free to improve.
    pool.query(
      `SELECT pp.*, pr.quote_description
         FROM job_proposal_products pp
         LEFT JOIN products pr ON pr.id = pp.product_id
        WHERE pp.proposal_id = ANY($1::uuid[])
        ORDER BY pp.sort_order, pp.id`, [ids]),
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

      if (req.body?.copy_from) {
        // A copy is a copy: the materials, the hours against each labour line,
        // the markup and the notes all come across. The second scope on a job
        // is usually the first one with a few lines changed, and starting from
        // an empty sheet was no better than starting a new proposal.
        const { rows: src } = await client.query(
          'SELECT * FROM job_proposals WHERE id=$1 AND job_id=$2', [req.body.copy_from, jobId]
        );
        if (src[0]) {
          await client.query(
            'UPDATE job_proposals SET markup_pct=$1, notes=$2 WHERE id=$3',
            [src[0].markup_pct, src[0].notes, p.id]
          );
          await client.query(
            `INSERT INTO job_proposal_labour (proposal_id, label, cost_rate, charge_rate, quantity, sort_order)
             SELECT $1, label, cost_rate, charge_rate, quantity, sort_order
               FROM job_proposal_labour WHERE proposal_id=$2`,
            [p.id, src[0].id]
          );
          await client.query(
            `INSERT INTO job_proposal_products (proposal_id, product_id, description, product_name,
                                                quantity, cost_price, charge_price, sort_order)
             SELECT $1, product_id, description, product_name, quantity, cost_price, charge_price, sort_order
               FROM job_proposal_products WHERE proposal_id=$2`,
            [p.id, src[0].id]
          );
        }
        // The quoted price is deliberately NOT copied. It is a rounded figure
        // someone decided on for that scope, and carrying it over would quietly
        // price a different scope at the old number.
      } else {
        // Else from a template — the one asked for, else the default.
        const { rows: [tpl] } = await client.query(
          req.body?.template_id
            ? 'SELECT * FROM proposal_templates WHERE id=$1'
            : 'SELECT * FROM proposal_templates WHERE archived=false ORDER BY is_default DESC, sort_order, name LIMIT 1',
          req.body?.template_id ? [req.body.template_id] : []
        );
        if (tpl) {
          await client.query('UPDATE job_proposals SET markup_pct=$1 WHERE id=$2', [tpl.markup_pct, p.id]);
          await client.query(
            `INSERT INTO job_proposal_labour (proposal_id, label, cost_rate, charge_rate, quantity, sort_order)
             SELECT $1, label, cost_rate, charge_rate, quantity, sort_order
               FROM proposal_template_labour WHERE template_id=$2`,
            [p.id, tpl.id]
          );
          await client.query(
            `INSERT INTO job_proposal_products (proposal_id, product_id, description, product_name, quantity, cost_price, charge_price, sort_order)
             SELECT $1, product_id, description, product_name, quantity, cost_price, charge_price, sort_order
               FROM proposal_template_products WHERE template_id=$2`,
            [p.id, tpl.id]
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

    const markup = Number.isFinite(Number(b.markup_pct)) ? Number(b.markup_pct) : Number(existing.markup_pct);
    // An empty override means "go back to the build-up", which is different
    // from quoting zero — so only an explicit number is stored.
    const override = b.quote_price === '' || b.quote_price == null ? null : cents(b.quote_price);

    await client.query(
      `UPDATE job_proposals SET name=$1, markup_pct=$2, quote_price=$3, notes=$4, updated_at=NOW() WHERE id=$5`,
      [(b.name || existing.name || '').trim() || existing.name, markup, override, b.notes ?? existing.notes, id]
    );

    if (Array.isArray(b.products)) {
      await client.query('DELETE FROM job_proposal_products WHERE proposal_id=$1', [id]);
      for (const [i, p] of b.products.entries()) {
        if (!String(p.description || '').trim()) continue;
        await client.query(
          `INSERT INTO job_proposal_products (proposal_id, product_id, description, product_name, quantity, cost_price, charge_price, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, p.product_id || null, String(p.description).trim(), p.product_name || null,
           qty(p.quantity), cents(p.cost_price), cents(p.charge_price), i]
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

// ── Onto a quote ────────────────────────────────────────────────────────────

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
  for (const p of proposal.products) {
    const q = Number(p.quantity) || 0;
    if (q <= 0 || p.charge_price <= 0) continue;
    lines.push({ description: p.description, quantity: q, unit_price: p.charge_price, product_id: p.product_id, product_name: p.product_name });
  }
  for (const l of proposal.labour) {
    const q = Number(l.quantity) || 0;
    if (q <= 0 || l.charge_rate <= 0) continue;
    lines.push({ description: l.label, quantity: q, unit_price: l.charge_rate });
  }
  // A rounded quote has to still add up to the rounded figure, or the customer
  // sees a total that disagrees with the lines. The difference goes on its own
  // line rather than being smeared across the others.
  const sum = lines.reduce((s, l) => s + Math.round(l.quantity * l.unit_price), 0);
  const diff = t.quoted - sum;
  if (diff !== 0) lines.push({ description: 'Adjustment', quantity: 1, unit_price: diff });
  return lines;
}

// Raises a draft quote from the chosen proposals. Proposals are how a price is
// worked out; a quote is what the customer gets — so this is the step between
// the two, and it writes the line items onto the QUOTE, not the job.
// The wording a proposal contributes to the quote's description: its name as a
// heading, then one bullet per material line.
//
// The bullet is the product's "Quote Description" where it has one — that field
// exists precisely so a customer reads "100mm x 100mm H4 Treated Timber Fence
// Post" rather than the supplier's catalogue line. Falling back to the line's
// own description keeps a one-off, typed-in material on the list.
//
// Written as the same markup the description editor emits, so it can be edited
// afterwards like anything else typed in there.
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function scopeDescription(proposal) {
  const bullets = [];
  for (const line of proposal.products || []) {
    const text = String(line.quote_description || line.description || '').trim();
    // The same wording twice in one scope reads as a mistake on a customer's
    // quote — two fixings lines both saying "Galvanised Fixings" is one bullet.
    if (text && !bullets.includes(text)) bullets.push(text);
  }
  if (!bullets.length) return '';
  const heading = String(proposal.name || '').trim();
  return (heading ? `<div><span style="font-weight: bold">${escapeHtml(heading)}</span></div>` : '')
    + `<ul>${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`;
}

async function createQuote(req, res) {
  const jobId = req.params.id;
  const ids = Array.isArray(req.body?.proposal_ids) ? req.body.proposal_ids : [];
  if (!ids.length) return res.status(400).json({ error: 'Choose at least one proposal' });
  const itemise = req.body?.itemise === true;

  const client = await pool.connect();
  try {
    const { rows: [job] } = await pool.query('SELECT id, customer_id, type FROM jobs WHERE id=$1', [jobId]);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const all = await loadProposals(jobId);
    const chosen = all.filter(p => ids.includes(p.id));
    if (!chosen.length) return res.status(404).json({ error: 'Those proposals are not on this job' });

    const lines = chosen.flatMap(p => proposalToLineItems(p, { itemise }));
    const subtotal = lines.reduce((s, l) => s + Math.round(l.quantity * l.unit_price), 0);
    const gst = Math.round(subtotal * GST_RATE);

    // Same theme precedence quoting already uses: whatever was asked for, else
    // the theme on this job's type, else the global default.
    let themeId = req.body?.theme_id || null;
    if (!themeId && job.type) {
      const jobType = await findJobType(job.type);
      if (jobType?.theme_id) themeId = jobType.theme_id;
    }
    const docTheme = themeId ? await getThemeById(themeId) : await getDefaultTheme();

    const { rows: settingRows } = await pool.query(`SELECT value FROM settings WHERE key='quote_theme'`);
    const expiryDays = settingRows[0]?.value?.quoteExpiryDays ?? 30;
    const expiresAt = expiryDays > 0
      ? (() => { const d = new Date(); d.setDate(d.getDate() + expiryDays); return d.toISOString().split('T')[0]; })()
      : null;

    // The theme's standing wording first, then a block per scope quoted, in
    // the order they were chosen.
    const scopes = chosen.map(scopeDescription).filter(Boolean);
    const quoteDescription = [docTheme?.quoteDescription || '', ...scopes]
      .filter(Boolean).join('<div><br></div>') || null;

    await client.query('BEGIN');
    const { rows: [quote] } = await client.query(
      `INSERT INTO quotes (job_id, customer_id, status, subtotal, gst, total, notes, expires_at, created_by, theme_id, quote_date)
       VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,CURRENT_DATE) RETURNING *`,
      [jobId, job.customer_id, subtotal, gst, subtotal + gst,
       quoteDescription, expiresAt, req.user?.id || null, docTheme?.id || null]
    );

    for (const l of lines) {
      await client.query(
        `INSERT INTO line_items (job_id, quote_id, description, quantity, unit_price, product_id, product_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [jobId, quote.id, l.description, l.quantity, l.unit_price, l.product_id || null, l.product_name || null]
      );
    }

    // Noted so the job shows where each scope went, and the same one isn't
    // quoted twice without meaning to.
    await client.query(
      'UPDATE job_proposals SET quoted_on=$1, updated_at=NOW() WHERE id = ANY($2::uuid[])',
      [quote.id, chosen.map(p => p.id)]
    );
    await client.query('COMMIT');

    res.status(201).json({ quote, lines: lines.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[proposals] creating a quote failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
}

// ── Templates ───────────────────────────────────────────────────────────────

async function loadTemplates(id) {
  const { rows: templates } = await pool.query(
    id ? 'SELECT * FROM proposal_templates WHERE id=$1'
       : 'SELECT * FROM proposal_templates ORDER BY archived, is_default DESC, sort_order, name',
    id ? [id] : []
  );
  if (!templates.length) return [];
  const ids = templates.map(t => t.id);
  const [{ rows: labour }, { rows: products }] = await Promise.all([
    pool.query('SELECT * FROM proposal_template_labour WHERE template_id = ANY($1::uuid[]) ORDER BY sort_order, id', [ids]),
    pool.query('SELECT * FROM proposal_template_products WHERE template_id = ANY($1::uuid[]) ORDER BY sort_order, id', [ids]),
  ]);
  return templates.map(t => ({
    ...t,
    labour: labour.filter(x => x.template_id === t.id),
    products: products.filter(x => x.template_id === t.id),
  }));
}

async function listTemplates(req, res) {
  try { res.json(await loadTemplates()); }
  catch (err) { console.error('[proposals] template list failed:', err.message); res.status(500).json({ error: 'Server error' }); }
}

async function createTemplate(req, res) {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Give the template a name' });
  try {
    const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM proposal_templates');
    const { rows: [t] } = await pool.query(
      'INSERT INTO proposal_templates (name, sort_order, is_default) VALUES ($1,$2,$3) RETURNING *',
      [name, n, n === 0]
    );
    const [full] = await loadTemplates(t.id);
    res.status(201).json(full);
  } catch (err) { console.error('[proposals] template create failed:', err.message); res.status(500).json({ error: 'Server error' }); }
}

async function updateTemplate(req, res) {
  const id = req.params.templateId;
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [existing] } = await client.query('SELECT * FROM proposal_templates WHERE id=$1', [id]);
    if (!existing) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Template not found' }); }

    // One default at a time — the unique index enforces it, so the old one has
    // to be stood down first or the update trips over itself.
    if (b.is_default === true && !existing.is_default) {
      await client.query('UPDATE proposal_templates SET is_default=false WHERE is_default=true');
    }
    await client.query(
      `UPDATE proposal_templates SET name=$1, description=$2, markup_pct=$3, is_default=$4, archived=$5, updated_at=NOW()
       WHERE id=$6`,
      [(b.name || existing.name).trim() || existing.name, b.description ?? existing.description,
       Number.isFinite(Number(b.markup_pct)) ? Number(b.markup_pct) : Number(existing.markup_pct),
       b.is_default === undefined ? existing.is_default : !!b.is_default,
       b.archived === undefined ? existing.archived : !!b.archived, id]
    );

    if (Array.isArray(b.labour)) {
      await client.query('DELETE FROM proposal_template_labour WHERE template_id=$1', [id]);
      for (const [i, l] of b.labour.entries()) {
        if (!String(l.label || '').trim()) continue;
        await client.query(
          `INSERT INTO proposal_template_labour (template_id, label, cost_rate, charge_rate, quantity, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, String(l.label).trim(), cents(l.cost_rate), cents(l.charge_rate), qty(l.quantity), i]
        );
      }
    }
    if (Array.isArray(b.products)) {
      await client.query('DELETE FROM proposal_template_products WHERE template_id=$1', [id]);
      for (const [i, p] of b.products.entries()) {
        if (!String(p.description || '').trim()) continue;
        await client.query(
          `INSERT INTO proposal_template_products (template_id, product_id, description, product_name, quantity, cost_price, charge_price, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, p.product_id || null, String(p.description).trim(), p.product_name || null,
           qty(p.quantity), cents(p.cost_price), cents(p.charge_price), i]
        );
      }
    }
    await client.query('COMMIT');
    const [full] = await loadTemplates(id);
    res.json(full);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[proposals] template update failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
}

async function removeTemplate(req, res) {
  try {
    const { rows: [t] } = await pool.query('SELECT is_default FROM proposal_templates WHERE id=$1', [req.params.templateId]);
    if (!t) return res.status(404).json({ error: 'Template not found' });
    if (t.is_default) {
      const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM proposal_templates');
      if (n > 1) return res.status(400).json({ error: 'Make another template the default before deleting this one' });
    }
    await pool.query('DELETE FROM proposal_templates WHERE id=$1', [req.params.templateId]);
    res.json({ message: 'Deleted' });
  } catch (err) { console.error('[proposals] template delete failed:', err.message); res.status(500).json({ error: 'Server error' }); }
}

module.exports = {
  list, create, update, remove, createQuote,
  listTemplates, createTemplate, updateTemplate, removeTemplate,
  priceProposal, proposalToLineItems,
};
