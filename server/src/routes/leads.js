const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendMail } = require('../utils/email');

const LEAD_STATUSES = ['new', 'contacted', 'converted', 'dismissed'];
const SALES_EMAIL = 'sales@dekkergroup.co.nz';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function leadEmailHtml(lead) {
  const row = (label, value) => value
    ? `<tr><td style="padding:6px 12px;color:#64748b;white-space:nowrap;">${label}</td><td style="padding:6px 12px;font-weight:600;">${esc(value)}</td></tr>`
    : '';
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;">
      <h2 style="color:#1e40af;">New Website Lead</h2>
      <table style="border-collapse:collapse;background:#f8fafc;border-radius:8px;width:100%;">
        ${row('Name', lead.name)}
        ${row('Phone', lead.phone)}
        ${row('Email', lead.email)}
        ${row('Address', lead.address)}
        ${row('Service Required', lead.service_required)}
        ${row('Source', lead.source)}
      </table>
      ${lead.message ? `<p style="margin-top:16px;"><strong>Message:</strong></p><p style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;white-space:pre-wrap;">${esc(lead.message)}</p>` : ''}
      <p style="margin-top:20px;font-size:13px;color:#64748b;">
        This lead has been added to the <a href="https://dekker-group.onrender.com/leads">New Leads</a> tab in Dekker App.
      </p>
    </div>`;
}

// ── Public webhook — website contact forms POST here (no login required) ──────
router.post('/webhook', async (req, res) => {
  const { name, email, phone, address, service_required, message, source, website } = req.body || {};
  // `website` is a honeypot field: real visitors never fill it, bots do.
  // Return 201 so the bot thinks it worked, but store nothing.
  if (website) return res.status(201).json({ ok: true });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (!email && !phone) return res.status(400).json({ error: 'email or phone is required' });

  const clip = (v, n) => (v ? String(v).slice(0, n) : null);
  try {
    const { rows } = await pool.query(
      `INSERT INTO leads (name, email, phone, address, service_required, message, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [clip(name, 255), clip(email, 255), clip(phone, 50), clip(address, 1000),
       clip(service_required, 255), clip(message, 5000), clip(source, 255)]
    );
    const lead = rows[0];

    // Notify sales — a failed email must never lose the lead itself
    sendMail({
      to: SALES_EMAIL,
      subject: `New Lead — ${lead.name}${lead.source ? ` (${lead.source})` : ''}`,
      html: leadEmailHtml(lead),
      text: `New website lead\nName: ${lead.name}\nPhone: ${lead.phone || '-'}\nEmail: ${lead.email || '-'}\nAddress: ${lead.address || '-'}\nService: ${lead.service_required || '-'}\nSource: ${lead.source || '-'}\nMessage: ${lead.message || '-'}`,
    }).catch(err => console.error('Lead email failed:', err.message));

    res.status(201).json({ ok: true, id: lead.id });
  } catch (err) {
    console.error('Lead webhook error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Authenticated endpoints (admin + office staff) ────────────────────────────
router.use(authenticate);

router.get('/', requireRole('admin', 'office'), async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = '';
  if (status && LEAD_STATUSES.includes(status)) { where = 'WHERE l.status = $1'; params.push(status); }
  try {
    const { rows } = await pool.query(
      `SELECT l.*, c.name AS customer_name
       FROM leads l LEFT JOIN customers c ON c.id = l.customer_id
       ${where} ORDER BY l.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.patch('/:id/status', requireRole('admin', 'office'), async (req, res) => {
  const { status } = req.body;
  if (!LEAD_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const { rows } = await pool.query(
      'UPDATE leads SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Lead not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Convert a lead into a customer (links the new customer back to the lead)
router.post('/:id/convert', requireRole('admin', 'office'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: leadRows } = await client.query('SELECT * FROM leads WHERE id=$1', [req.params.id]);
    if (!leadRows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Lead not found' }); }
    const lead = leadRows[0];
    if (lead.customer_id) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Lead already converted' }); }

    const { rows: custRows } = await client.query(
      `INSERT INTO customers (name, email, phone, lead_source) VALUES ($1,$2,$3,$4) RETURNING id`,
      [lead.name, lead.email, lead.phone, lead.source]
    );
    if (lead.address) {
      await client.query(
        `INSERT INTO customer_sites (customer_id, address) VALUES ($1,$2)`,
        [custRows[0].id, lead.address]
      );
    }
    await client.query(
      `UPDATE leads SET status='converted', customer_id=$1, updated_at=NOW() WHERE id=$2`,
      [custRows[0].id, lead.id]
    );
    await client.query('COMMIT');
    res.json({ customer_id: custRows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM leads WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
