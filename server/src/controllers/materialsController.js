// The Materials tab: what a job needs, and getting it ordered.
//
// The list is built when a quote is accepted (see services/jobMaterials). This
// is everything after that — correcting it, adding to it, and sending an order
// to a supplier as either a collection or a delivery.
const pool = require('../db/pool');
const { sendMail } = require('../utils/email');
const { OFFICE_RECORDS_EMAIL } = require('../utils/recordsEmail');
const { getDefaultTheme, getThemeById } = require('../utils/documentThemes');
const { findJobType } = require('../services/jobTypes');
const materials = require('../services/jobMaterials');
const { diagnose } = require('../services/materialsDiagnosis');
const supplierMemory = require('../services/supplierMemory');

const escapeHtml = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const jobLabel = j => j?.external_ref
  || (j?.job_number != null ? 'JB' + String(j.job_number).padStart(5, '0') : 'Job');

const fmtDate = d => (d
  ? new Date(String(d).length <= 10 ? `${d}T12:00:00` : d)
      .toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  : null);

const qty = v => {
  const n = parseFloat(v) || 0;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
};

// A unit is worth printing when it tells the supplier something. "280 m" and
// "4 sheets" do; "280 each" does not — the number already said it, and on an
// order form the word is in the way of the number.
const FILLER_UNITS = new Set(['each', 'ea', 'ea.', 'item', 'items', 'unit', 'units', 'pc', 'pcs', 'qty', 'no', 'no.']);
const unitWord = u => {
  const s = String(u || '').trim();
  return s && !FILLER_UNITS.has(s.toLowerCase()) ? s : '';
};
const qtyWithUnit = (q, u) => `${qty(q)}${unitWord(u) ? ` ${unitWord(u)}` : ''}`;

const isEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
// One address or several, however they were separated — a comma, a semicolon
// or a new line are all things people type into a list of addresses.
const splitEmails = v => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/))
  .map(e => String(e).trim()).filter(Boolean);

// The people on this job, for the order form to offer as the site contact
// rather than have somebody type a name and go hunting for a mobile number.
// Both the team on the job and anyone booked onto it, since a job often gets
// scheduled to someone who was never added to its team.
async function teamFor(jobId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id, u.name, u.mobile
       FROM users u
      WHERE u.is_active IS NOT FALSE
        AND (u.id IN (SELECT user_id FROM job_technicians WHERE job_id = $1)
          OR u.id IN (SELECT user_id FROM schedules WHERE job_id = $1))
      ORDER BY u.name`,
    [jobId]
  );
  return rows.map(u => ({ id: u.id, name: u.name, phone: u.mobile || '' }));
}

async function jobFor(jobId) {
  const { rows: [job] } = await pool.query(
    `SELECT j.id, j.job_number, j.external_ref, j.description, j.type,
            j.job_contact, j.job_contact_phone, j.job_contact_mobile,
            COALESCE(s.address, j.site_address) AS site_address,
            c.name AS customer_name
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN customer_sites s ON s.id = j.site_id
      WHERE j.id = $1`,
    [jobId]
  );
  return job || null;
}

// ── The list ─────────────────────────────────────────────────────────────────

async function list(req, res) {
  try {
    const job = await jobFor(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const [groups, team, { rows: orders }] = await Promise.all([
      materials.listForJob(req.params.id),
      teamFor(req.params.id),
      pool.query(
        `SELECT o.*, u.name AS sent_by_name,
                (SELECT COUNT(*)::int FROM material_order_lines l WHERE l.order_id = o.id) AS line_count
           FROM material_orders o
           LEFT JOIN users u ON u.id = o.sent_by
          WHERE o.job_id = $1
          ORDER BY o.created_at DESC`,
        [req.params.id]
      ),
    ]);
    res.json({
      job: {
        id: job.id, number: jobLabel(job), site_address: job.site_address || '',
        customer_name: job.customer_name || '',
        contact_name: job.job_contact || '', contact_phone: job.job_contact_mobile || job.job_contact_phone || '',
      },
      groups,
      orders,
      // Who could stand at the gate when the truck arrives.
      team,
      // Only when there is nothing to show. An empty list has several quite
      // different causes that look identical on screen, and saying which one
      // this is saves somebody going to read the database to find out.
      empty_because: groups.length ? null : await diagnose(req.params.id),
    });
  } catch (err) { console.error('[materials]', err.message); res.status(500).json({ error: 'Server error' }); }
}

// Rebuilding from the accepted quotes on this job. Anything added by hand, and
// anything already ordered, is left exactly where it is.
async function regenerate(req, res) {
  try {
    const { rows: quotes } = await pool.query(
      `SELECT id FROM quotes WHERE job_id = $1 AND status = 'accepted' ORDER BY created_at`,
      [req.params.id]
    );
    if (!quotes.length) {
      return res.status(400).json({ error: 'No accepted quote on this job to build a list from' });
    }
    let added = 0, kept = 0;
    for (const q of quotes) {
      const r = await materials.syncFromQuote(q.id, req.params.id);
      added += r.added; kept += r.kept;
    }
    res.json({ added, kept, quotes: quotes.length });
  } catch (err) { console.error('[materials]', err.message); res.status(500).json({ error: 'Server error' }); }
}

async function addItem(req, res) {
  const { description, supplier, unit, quantity, product_id, notes } = req.body || {};
  if (!String(description || '').trim()) return res.status(400).json({ error: 'Give the material a description' });
  const q = Number(quantity === undefined ? 1 : quantity);
  if (!Number.isFinite(q) || q <= 0) return res.status(400).json({ error: 'Quantity must be more than zero' });
  try {
    const { rows: [row] } = await pool.query(
      `INSERT INTO job_materials (job_id, product_id, description, supplier, unit, quantity, source, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,'manual',$7,
               (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM job_materials WHERE job_id = $1))
       RETURNING *`,
      [req.params.id, product_id || null, String(description).trim(),
       supplier?.trim() || null, unit?.trim() || null, q, notes?.trim() || null]
    );
    res.status(201).json(row);
  } catch (err) { console.error('[materials]', err.message); res.status(500).json({ error: 'Server error' }); }
}

async function updateItem(req, res) {
  const { description, supplier, unit, quantity, status, notes } = req.body || {};
  if (description !== undefined && !String(description).trim()) {
    return res.status(400).json({ error: 'Give the material a description' });
  }
  const q = quantity === undefined ? null : Number(quantity);
  if (q !== null && (!Number.isFinite(q) || q <= 0)) {
    return res.status(400).json({ error: 'Quantity must be more than zero' });
  }
  if (status !== undefined && !['needed', 'ordered', 'received', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'That is not a status a material can be in' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE job_materials
          SET description = COALESCE($1, description),
              supplier    = COALESCE($2, supplier),
              unit        = COALESCE($3, unit),
              quantity    = COALESCE($4, quantity),
              status      = COALESCE($5, status),
              notes       = COALESCE($6, notes),
              updated_at  = NOW()
        WHERE id = $7 AND job_id = $8
        RETURNING *`,
      [description === undefined ? null : String(description).trim(),
       supplier === undefined ? null : (supplier?.trim() || null),
       unit === undefined ? null : (unit?.trim() || null),
       q, status || null, notes === undefined ? null : (notes?.trim() || null),
       req.params.materialId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'That material is not on this job' });
    res.json(rows[0]);
  } catch (err) { console.error('[materials]', err.message); res.status(500).json({ error: 'Server error' }); }
}

async function removeItem(req, res) {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM job_materials WHERE id = $1 AND job_id = $2', [req.params.materialId, req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'That material is not on this job' });
    res.json({ ok: true });
  } catch (err) { console.error('[materials]', err.message); res.status(500).json({ error: 'Server error' }); }
}

// ── Suppliers ────────────────────────────────────────────────────────────────
// Only what is needed to send an order: where to email it, and the account to
// quote. The name itself comes off the product.

async function listSuppliers(req, res) {
  try {
    const { rows } = await pool.query('SELECT * FROM suppliers ORDER BY name');
    res.json(rows);
  } catch (err) { console.error('[materials]', err.message); res.status(500).json({ error: 'Server error' }); }
}

async function saveSupplier(req, res) {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Which supplier?' });
  const email = String(req.body?.email || '').trim();
  if (email && !isEmail(email)) {
    return res.status(400).json({ error: 'That does not look like an email address' });
  }
  // The others an order must also reach. The main address is not repeated here
  // even if somebody types it twice.
  const extras = splitEmails(req.body?.order_emails);
  const badExtra = extras.find(e => !isEmail(e));
  if (badExtra) return res.status(400).json({ error: `"${badExtra}" does not look like an email address` });
  const orderEmails = [...new Set(extras.map(e => e.toLowerCase()))]
    .filter(e => e !== email.toLowerCase());

  // Only the fields that were actually sent are written. The order screen saves
  // an address and nothing else, and must not wipe the account number somebody
  // set up in Settings; the Settings form sends every field, so clearing one
  // there really does clear it.
  const sent = {};
  if (req.body?.email !== undefined) sent.email = email || null;
  for (const k of ['phone', 'account_ref', 'notes', 'contact_name']) {
    if (req.body?.[k] !== undefined) sent[k] = String(req.body[k] ?? '').trim() || null;
  }
  if (req.body?.order_emails !== undefined) sent.order_emails = orderEmails;

  const cols = Object.keys(sent);
  const values = [name, ...cols.map(k => sent[k])];
  try {
    const { rows: [row] } = await pool.query(
      `INSERT INTO suppliers (name${cols.map(c => `, ${c}`).join('')})
       VALUES ($1${cols.map((_, i) => `, $${i + 2}`).join('')})
       ON CONFLICT (LOWER(name)) DO UPDATE
          SET updated_at = NOW()${cols.map(c => `, ${c} = EXCLUDED.${c}`).join('')}
       RETURNING *`,
      values
    );
    res.json(row);
  } catch (err) { console.error('[materials]', err.message); res.status(500).json({ error: 'Server error' }); }
}

// Every table that holds a supplier's name as text rather than as a reference.
// Merging has to reach all of them, or the price list and the invoices end up
// disagreeing about who sold us something.
const SUPPLIER_NAME_COLUMNS = [
  ['products', 'supplier'],
  ['job_materials', 'supplier'],
  ['material_orders', 'supplier'],
  ['job_cost_scans', 'supplier'],
  ['supplier_identities', 'supplier'],
];

// Bunnings, Bunnings Limited and Bunnings Trade are one supplier with three
// spellings, and until they are one name the price list has three of every
// product and an order goes to whichever address happened to be saved.
//
// Merging picks the name to keep and rewrites the others to it everywhere.
// Contact details fill in rather than fight: a field the kept supplier has is
// left alone, one it is missing is taken from whichever of the others has it,
// and the addresses an order goes to are pooled.
//
// The old spellings are remembered as aliases, so an invoice that still says
// "BUNNINGS TRADE" is filed under the kept name instead of starting the whole
// thing again.
async function mergeSuppliers(req, res) {
  const keep = String(req.body?.keep || '').trim();
  const fold = s => String(s || '').trim().toLowerCase();
  const merge = [...new Set((Array.isArray(req.body?.merge) ? req.body.merge : [])
    .map(n => String(n || '').trim()).filter(Boolean)
    .filter(n => fold(n) !== fold(keep)))];

  if (!keep) return res.status(400).json({ error: 'Which name should be kept?' });
  if (!merge.length) return res.status(400).json({ error: 'Choose at least one supplier to merge in' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // The details held against the names being merged away, so anything the
    // kept one is missing can be taken from them.
    const { rows: losing } = await client.query(
      `SELECT * FROM suppliers WHERE LOWER(name) = ANY($1::text[]) ORDER BY updated_at DESC`,
      [merge.map(fold)]
    );
    const { rows: [kept] } = await client.query(
      'SELECT * FROM suppliers WHERE LOWER(name) = LOWER($1)', [keep]);

    const firstOf = f => kept?.[f] || losing.map(l => l[f]).find(Boolean) || null;
    const pooled = [...new Set([
      ...(kept?.order_emails || []),
      ...losing.flatMap(l => l.order_emails || []),
      // An address that was the main one for a name being merged away is still
      // an address that supplier wants orders at.
      ...losing.map(l => l.email).filter(Boolean),
    ].map(e => e.toLowerCase()))];
    const mainEmail = firstOf('email');

    await client.query(
      `INSERT INTO suppliers (name, email, phone, account_ref, notes, contact_name, order_emails)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (LOWER(name)) DO UPDATE
          SET email = EXCLUDED.email, phone = EXCLUDED.phone,
              account_ref = EXCLUDED.account_ref, notes = EXCLUDED.notes,
              contact_name = EXCLUDED.contact_name, order_emails = EXCLUDED.order_emails,
              updated_at = NOW()`,
      [keep, mainEmail, firstOf('phone'), firstOf('account_ref'), firstOf('notes'),
       firstOf('contact_name'),
       pooled.filter(e => e !== String(mainEmail || '').toLowerCase())]
    );

    // The name itself, everywhere it is written down.
    const moved = {};
    for (const [table, column] of SUPPLIER_NAME_COLUMNS) {
      const { rowCount } = await client.query(
        `UPDATE ${table} SET ${column} = $1 WHERE LOWER(${column}) = ANY($2::text[])`,
        [keep, merge.map(fold)]
      );
      if (rowCount) moved[table] = rowCount;
    }

    await client.query(
      'DELETE FROM suppliers WHERE LOWER(name) = ANY($1::text[])', [merge.map(fold)]);
    await client.query('COMMIT');

    // Outside the transaction: teaching the scanner an alias is worth having
    // but never worth failing the merge over.
    for (const old of merge) {
      await supplierMemory.learn({ supplier: keep, readAs: old }).catch(() => {});
    }

    res.json({ ok: true, keep, merged: merge, moved });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[materials] merge failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
}

// Removing a supplier takes away the contact details, nothing else. The orders
// already sent keep their own copy of where they went, and the products keep
// the supplier's name — that comes off the product, not from here.
async function removeSupplier(req, res) {
  try {
    const { rowCount } = await pool.query('DELETE FROM suppliers WHERE id = $1', [req.params.supplierId]);
    if (!rowCount) return res.status(404).json({ error: 'No such supplier' });
    res.json({ ok: true });
  } catch (err) { console.error('[materials]', err.message); res.status(500).json({ error: 'Server error' }); }
}

// ── Ordering ─────────────────────────────────────────────────────────────────

// The chosen materials, with the product behind each one. A supplier matches
// an order against their own catalogue, so the code they know it by goes on
// the order next to the name.
async function orderLines(jobId, ids) {
  const { rows } = await pool.query(
    `SELECT m.id, m.description, m.unit, m.quantity,
            COALESCE(p.name, m.description) AS product_name, p.sku
       FROM job_materials m
       LEFT JOIN products p ON p.id = m.product_id
      WHERE m.job_id = $1 AND m.id = ANY($2::uuid[])
      ORDER BY m.sort_order, m.created_at`,
    [jobId, ids]
  );
  return rows;
}

function orderEmail({ job, order, lines, theme }) {
  const collect = order.method === 'collect';
  const label = jobLabel(job);
  const title = collect ? 'Click & Collect order' : 'Delivery request';
  const ref = order.reference;

  // The product as the supplier knows it — their own code first where we hold
  // one, since that is what they pick off a shelf — then the name, then the
  // number wanted. The unit only appears when it means something: "280 each"
  // is a worse line on an order form than "280".
  const rows = lines.map(l => `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;">
        ${l.sku ? `<span style="font-family:monospace;color:#475569;">${escapeHtml(l.sku)}</span><br>` : ''}
        ${escapeHtml(l.product_name || l.description)}
      </td>
      <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap;font-weight:700;">
        ${escapeHtml(qty(l.quantity))}${unitWord(l.unit) ? `<span style="font-weight:400;color:#475569;"> ${escapeHtml(unitWord(l.unit))}</span>` : ''}
      </td>
    </tr>`).join('');

  const detail = [
    ['Our reference', ref],
    ['Job number', label],
    [collect ? 'Collection date' : 'Delivery date', fmtDate(order.required_date)],
    collect ? null : ['Deliver to', order.deliver_to],
    ['Site contact', [order.contact_name, order.contact_phone].filter(Boolean).join(' · ')],
    ['Account', theme?.accountRef || null],
  ].filter(r => r && r[1]);

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;color:#0f172a;">
      <p style="margin:0 0 4px;font-size:18px;font-weight:700;">${escapeHtml(title)}</p>
      <p style="margin:0 0 16px;color:#475569;font-size:14px;">
        From ${escapeHtml(theme?.companyName || 'Dekker Group')}${theme?.gstNumber ? ` · GST ${escapeHtml(theme.gstNumber)}` : ''}
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;margin:0 0 16px;">
        ${detail.map(([k, v]) => `<tr>
          <td style="padding:3px 14px 3px 0;color:#64748b;white-space:nowrap;">${escapeHtml(k)}</td>
          <td style="padding:3px 0;">${escapeHtml(v)}</td></tr>`).join('')}
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr style="background:#f1f5f9;">
          <th align="left" style="padding:7px 10px;font-size:12px;letter-spacing:0.04em;">PRODUCT</th>
          <th align="right" style="padding:7px 10px;font-size:12px;letter-spacing:0.04em;">QUANTITY</th>
        </tr>
        ${rows}
      </table>
      ${order.instructions ? `<p style="margin:16px 0 0;font-size:14px;"><strong>Notes:</strong><br>${escapeHtml(order.instructions).replace(/\n/g, '<br>')}</p>` : ''}
      <p style="margin:20px 0 0;font-size:13px;color:#475569;">
        Please reply to confirm${collect ? ' when this is ready to collect' : ' the delivery'}. Thank you.
      </p>
      ${theme?.contactDetails ? `<p style="margin:16px 0 0;font-size:12px;color:#94a3b8;">${escapeHtml(theme.contactDetails).replace(/\n/g, '<br>')}</p>` : ''}
    </div>`;

  const text = [
    title,
    `From ${theme?.companyName || 'Dekker Group'}`,
    '',
    ...detail.map(([k, v]) => `${k}: ${v}`),
    '',
    ...lines.map(l => `- ${qtyWithUnit(l.quantity, l.unit)} × ${l.sku ? `[${l.sku}] ` : ''}${l.product_name || l.description}`),
    order.instructions ? `\nNotes: ${order.instructions}` : '',
    '',
    `Please reply to confirm${collect ? ' when this is ready to collect' : ' the delivery'}. Thank you.`,
  ].filter(v => v !== undefined).join('\n');

  const subject = `${title} — ${label}${job.site_address ? ` — ${String(job.site_address).split(',')[0]}` : ''}`;
  return { subject, html, text };
}

async function createOrder(req, res) {
  const { method, material_ids, required_date, instructions, email_to,
          deliver_to, contact_name, contact_phone, supplier } = req.body || {};
  if (!['collect', 'delivery'].includes(method)) {
    return res.status(400).json({ error: 'An order is either a collection or a delivery' });
  }
  const ids = Array.isArray(material_ids) ? material_ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Choose at least one material to order' });
  // More than one address is ordinary: a branch desk and a head-office account
  // both wanting the order.
  const typed = splitEmails(email_to);
  const bad = typed.find(e => !isEmail(e));
  if (bad) return res.status(400).json({ error: `"${bad}" does not look like an email address` });
  if (!typed.length) {
    return res.status(400).json({ error: 'An email address for the supplier is needed to send this' });
  }
  const to = typed.join(', ');
  if (required_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(required_date))) {
    return res.status(400).json({ error: 'The date must be a real date' });
  }

  const client = await pool.connect();
  try {
    const job = await jobFor(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const lines = await orderLines(req.params.id, ids);
    if (!lines.length) return res.status(400).json({ error: 'None of those materials are on this job' });

    // The theme the job documents itself with, so an order looks like the
    // quote the supplier may already have seen.
    const type = await findJobType(job.type);
    const theme = type?.theme_id ? await getThemeById(type.theme_id) : await getDefaultTheme();

    // Addresses held against the supplier in Settings, so an order cannot go
    // out missing the branch that actually picks it.
    const { rows: [known] } = await pool.query(
      'SELECT order_emails FROM suppliers WHERE LOWER(name) = LOWER($1)',
      [String(supplier || '').trim()]
    );
    const supplierExtras = (known?.order_emails || []).filter(isEmail);

    await client.query('BEGIN');
    const { rows: [order] } = await client.query(
      `INSERT INTO material_orders
         (job_id, supplier, method, required_date, deliver_to, contact_name, contact_phone,
          instructions, email_to, status, reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',
               'MO-' || LPAD((SELECT COUNT(*) + 1 FROM material_orders)::text, 4, '0'))
       RETURNING *`,
      [req.params.id, String(supplier || '').trim() || 'Supplier', method,
       required_date || null,
       method === 'delivery' ? (deliver_to?.trim() || job.site_address || null) : null,
       contact_name?.trim() || job.job_contact || null,
       contact_phone?.trim() || job.job_contact_mobile || job.job_contact_phone || null,
       instructions?.trim() || null, to]
    );
    for (const [i, l] of lines.entries()) {
      await client.query(
        `INSERT INTO material_order_lines (order_id, material_id, description, unit, quantity, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [order.id, l.id, l.description, l.unit, l.quantity, i]
      );
    }
    await client.query('COMMIT');

    // Sent after the order is safely saved: a mail server being down must not
    // lose the record of what was asked for.
    const { subject, html, text } = orderEmail({ job, order, lines, theme });
    let sent = false, error = null;
    try {
      // Everyone this supplier has said must receive an order, plus whatever
      // was typed on the form. The office copy goes bcc: it is our filing, not
      // something the supplier needs to see on the order.
      const recipients = [...new Set([...typed, ...supplierExtras].map(e => e.toLowerCase()))];
      await sendMail({ to: recipients, bcc: OFFICE_RECORDS_EMAIL, subject, html, text });
      sent = true;
    } catch (err) {
      error = err.message;
      console.error('[materials] order email failed:', err.message);
    }

    await pool.query(
      `UPDATE material_orders SET status = $1, sent_at = $2, sent_by = $3 WHERE id = $4`,
      [sent ? 'sent' : 'failed', sent ? new Date() : null, req.user?.id || null, order.id]
    );
    if (sent) {
      await pool.query(
        `UPDATE job_materials SET status = 'ordered', updated_at = NOW()
          WHERE id = ANY($1::uuid[]) AND status = 'needed'`,
        [lines.map(l => l.id)]
      );
    }

    res.status(201).json({
      order: { ...order, status: sent ? 'sent' : 'failed' },
      lines: lines.length, sent, error,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[materials] order failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
}

// Undoing an order: the wrong method picked, the wrong supplier, the wrong job.
//
// The email cannot be unsent. All this does is put our own record straight —
// the order is marked cancelled and its materials go back to "To order" so
// they can be ordered properly. Whoever undoes it still has to ring the
// supplier, and the screen says so before they press it.
//
// A material already received is left alone: it is on site, whatever the
// paperwork says about the order that brought it.
async function undoOrder(req, res) {
  const client = await pool.connect();
  try {
    const { rows: [order] } = await client.query(
      'SELECT * FROM material_orders WHERE id = $1 AND job_id = $2',
      [req.params.orderId, req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'That order is not on this job' });
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'That order has already been undone' });
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE material_orders
          SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1, cancelled_reason = $2
        WHERE id = $3`,
      [req.user?.id || null, String(req.body?.reason || '').trim() || null, order.id]
    );
    const { rowCount: freed } = await client.query(
      `UPDATE job_materials
          SET status = 'needed', updated_at = NOW()
        WHERE job_id = $1 AND status = 'ordered'
          AND id IN (SELECT material_id FROM material_order_lines WHERE order_id = $2)`,
      [req.params.id, order.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, freed, reference: order.reference });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[materials] undo order failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
}

// What an order will say, before it is sent. The same builder as the email, so
// the preview cannot drift from what actually goes out.
async function previewOrder(req, res) {
  const ids = Array.isArray(req.body?.material_ids) ? req.body.material_ids.filter(Boolean) : [];
  try {
    const job = await jobFor(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const lines = await orderLines(req.params.id, ids);
    const type = await findJobType(job.type);
    const theme = type?.theme_id ? await getThemeById(type.theme_id) : await getDefaultTheme();
    const order = {
      method: req.body?.method === 'collect' ? 'collect' : 'delivery',
      required_date: req.body?.required_date || null,
      deliver_to: req.body?.deliver_to || job.site_address || '',
      contact_name: req.body?.contact_name || job.job_contact || '',
      contact_phone: req.body?.contact_phone || job.job_contact_mobile || job.job_contact_phone || '',
      instructions: req.body?.instructions || '',
      reference: 'MO-preview',
    };
    res.json(orderEmail({ job, order, lines, theme }));
  } catch (err) { console.error('[materials]', err.message); res.status(500).json({ error: 'Server error' }); }
}

module.exports = {
  list, regenerate, addItem, updateItem, removeItem,
  listSuppliers, saveSupplier, removeSupplier, mergeSuppliers,
  createOrder, previewOrder, undoOrder,
};
