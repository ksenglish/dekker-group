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
    const [groups, { rows: orders }] = await Promise.all([
      materials.listForJob(req.params.id),
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
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'That does not look like an email address' });
  }
  try {
    const { rows: [row] } = await pool.query(
      `INSERT INTO suppliers (name, email, phone, account_ref, notes)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (LOWER(name)) DO UPDATE
          SET email = EXCLUDED.email, phone = EXCLUDED.phone,
              account_ref = EXCLUDED.account_ref, notes = EXCLUDED.notes, updated_at = NOW()
       RETURNING *`,
      [name, email || null, req.body?.phone?.trim() || null,
       req.body?.account_ref?.trim() || null, req.body?.notes?.trim() || null]
    );
    res.json(row);
  } catch (err) { console.error('[materials]', err.message); res.status(500).json({ error: 'Server error' }); }
}

// ── Ordering ─────────────────────────────────────────────────────────────────

function orderEmail({ job, order, lines, theme }) {
  const collect = order.method === 'collect';
  const label = jobLabel(job);
  const title = collect ? 'Click & Collect order' : 'Delivery request';
  const ref = order.reference;

  const rows = lines.map(l => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${escapeHtml(l.description)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap;">
        ${escapeHtml(qty(l.quantity))}${l.unit ? ` ${escapeHtml(l.unit)}` : ''}
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
          <th align="left" style="padding:7px 10px;font-size:12px;letter-spacing:0.04em;">ITEM</th>
          <th align="right" style="padding:7px 10px;font-size:12px;letter-spacing:0.04em;">QTY</th>
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
    ...lines.map(l => `- ${l.description} — ${qty(l.quantity)}${l.unit ? ` ${l.unit}` : ''}`),
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
  const to = String(email_to || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return res.status(400).json({ error: 'An email address for the supplier is needed to send this' });
  }
  if (required_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(required_date))) {
    return res.status(400).json({ error: 'The date must be a real date' });
  }

  const client = await pool.connect();
  try {
    const job = await jobFor(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { rows: lines } = await pool.query(
      `SELECT id, description, unit, quantity FROM job_materials
        WHERE job_id = $1 AND id = ANY($2::uuid[]) ORDER BY sort_order, created_at`,
      [req.params.id, ids]
    );
    if (!lines.length) return res.status(400).json({ error: 'None of those materials are on this job' });

    // The theme the job documents itself with, so an order looks like the
    // quote the supplier may already have seen.
    const type = await findJobType(job.type);
    const theme = type?.theme_id ? await getThemeById(type.theme_id) : await getDefaultTheme();

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
      await sendMail({ to, cc: OFFICE_RECORDS_EMAIL, subject, html, text });
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

// What an order will say, before it is sent. The same builder as the email, so
// the preview cannot drift from what actually goes out.
async function previewOrder(req, res) {
  const ids = Array.isArray(req.body?.material_ids) ? req.body.material_ids.filter(Boolean) : [];
  try {
    const job = await jobFor(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const { rows: lines } = await pool.query(
      `SELECT id, description, unit, quantity FROM job_materials
        WHERE job_id = $1 AND id = ANY($2::uuid[]) ORDER BY sort_order, created_at`,
      [req.params.id, ids]
    );
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
  listSuppliers, saveSupplier, createOrder, previewOrder,
};
