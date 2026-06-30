const pool = require('../db/pool');
const { buildPDF } = require('../utils/pdf');
const { sendMail } = require('../utils/email');
const { getTheme } = require('./settingsController');
const { logActivity } = require('../utils/activity');

async function enrichItemsWithImages(items) {
  const ids = items.map(i => i.product_id).filter(Boolean);
  if (!ids.length) return items;
  const { rows } = await pool.query(`SELECT id, media_base64 FROM products WHERE id = ANY($1)`, [ids]);
  const map = Object.fromEntries(rows.map(r => [r.id, r.media_base64]));
  return items.map(i => ({ ...i, media_base64: i.product_id ? (map[i.product_id] || null) : null }));
}

async function list(req, res) {
  const { status, customer, job } = req.query;
  const conditions = [];
  const params = [];
  let p = 1;
  if (status === 'overdue') {
    conditions.push(`i.status NOT IN ('paid','cancelled') AND i.due_date < CURRENT_DATE`);
  } else if (status === 'unpaid') {
    conditions.push(`i.status NOT IN ('paid','cancelled') AND (i.due_date IS NULL OR i.due_date >= CURRENT_DATE)`);
  } else if (status) {
    conditions.push(`i.status = $${p}`); params.push(status); p++;
  }
  if (customer) { conditions.push(`i.customer_id = $${p}`); params.push(customer); p++; }
  if (job)      { conditions.push(`i.job_id = $${p}`);      params.push(job);      p++; }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  try {
    const { rows } = await pool.query(
      `SELECT i.*, c.name AS customer_name, j.job_number, j.external_ref,
              (i.status NOT IN ('paid','cancelled') AND i.due_date < CURRENT_DATE) AS is_overdue,
              COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id=i.id), 0) AS paid_amount
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN jobs j ON j.id = i.job_id
       ${where} ORDER BY i.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function get(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, c.name AS customer_name, c.email AS customer_email,
              c.phone AS customer_phone, c.company AS customer_company,
              j.job_number, j.external_ref, j.description AS job_description
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN jobs j ON j.id = i.job_id
       WHERE i.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });
    const items = await pool.query('SELECT * FROM line_items WHERE job_id=$1 ORDER BY created_at', [rows[0].job_id]);
    res.json({ ...rows[0], line_items: items.rows });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function update(req, res) {
  const { status, due_date, notes } = req.body;
  try {
    const paidAt = status === 'paid' ? 'NOW()' : 'NULL';
    const { rows } = await pool.query(
      `UPDATE invoices SET status=$1, due_date=$2, notes=$3, paid_at=${paidAt}, updated_at=NOW() WHERE id=$4 RETURNING *`,
      [status, due_date || null, notes ?? null, req.params.id]
    );
    if (status === 'paid') {
      await pool.query(`UPDATE jobs SET status='complete', updated_at=NOW() WHERE id=$1`, [rows[0].job_id]);
      await logActivity({ type: 'invoice_paid', entity_type: 'invoice', entity_id: rows[0].id, user_id: req.user?.id,
        message: `Invoice ${rows[0].invoice_number ? `INV-${String(rows[0].invoice_number).padStart(4,'0')}` : `INV-${rows[0].id.slice(0,8).toUpperCase()}`} marked as paid ($${(rows[0].total/100).toFixed(2)})` });
    }
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function markPaid(req, res) {
  try {
    const { rows } = await pool.query(
      `UPDATE invoices SET status='paid', paid_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    await pool.query(`UPDATE jobs SET status='complete', updated_at=NOW() WHERE id=$1`, [rows[0].job_id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function downloadPdf(req, res) {
  try {
    const { rows: [inv] } = await pool.query(
      `SELECT i.*, c.name AS customer_name, c.email AS customer_email,
              c.company AS customer_company, c.phone AS customer_phone
       FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id WHERE i.id=$1`,
      [req.params.id]
    );
    if (!inv) return res.status(404).json({ error: 'Not found' });
    const items = await pool.query('SELECT * FROM line_items WHERE job_id=$1 ORDER BY created_at', [inv.job_id]);
    const enrichedItems = await enrichItemsWithImages(items.rows);
    const theme = await getTheme();
    const pdf = await buildPDF({
      type: 'Invoice', number: inv.invoice_number ? `INV-${String(inv.invoice_number).padStart(4,'0')}` : `INV-${inv.id.slice(0,8).toUpperCase()}`,
      customer: { name: inv.customer_name, company: inv.customer_company, email: inv.customer_email, phone: inv.customer_phone },
      items: enrichedItems, subtotal: inv.subtotal, gst: inv.gst, total: inv.total,
      status: inv.status, dueDate: inv.due_date, notes: inv.notes, terms: theme.invoiceTerms || '', issuedAt: inv.created_at, theme,
    });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="invoice-${inv.id.slice(0,8)}.pdf"` });
    res.send(pdf);
  } catch (err) { console.error(err); res.status(500).json({ error: 'PDF generation failed' }); }
}

async function sendEmail(req, res) {
  try {
    const { rows: [inv] } = await pool.query(
      `SELECT i.*, c.name AS customer_name, c.email AS customer_email,
              c.company AS customer_company, c.phone AS customer_phone
       FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id WHERE i.id=$1`,
      [req.params.id]
    );
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!inv.customer_email) return res.status(400).json({ error: 'Customer has no email address' });
    const items = await pool.query('SELECT * FROM line_items WHERE job_id=$1 ORDER BY created_at', [inv.job_id]);
    const enrichedItems = await enrichItemsWithImages(items.rows);
    const theme = await getTheme();
    const pdf = await buildPDF({
      type: 'Invoice', number: inv.invoice_number ? `INV-${String(inv.invoice_number).padStart(4,'0')}` : `INV-${inv.id.slice(0,8).toUpperCase()}`,
      customer: { name: inv.customer_name, company: inv.customer_company, email: inv.customer_email, phone: inv.customer_phone },
      items: enrichedItems, subtotal: inv.subtotal, gst: inv.gst, total: inv.total,
      status: inv.status, dueDate: inv.due_date, notes: inv.notes, terms: theme.invoiceTerms || '', issuedAt: inv.created_at, theme,
    });
    const totalNZD = `$${(inv.total / 100).toFixed(2)}`;
    const dueStr = inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    await sendMail({
      to: inv.customer_email,
      subject: `Invoice from ${theme.companyName} — ${totalNZD} due ${dueStr}`,
      html: `<p>Hi ${inv.customer_name},</p>
<p>Please find your invoice from ${theme.companyName} attached.</p>
<p><strong>Amount due: ${totalNZD} (incl. 15% GST)</strong>${dueStr ? `<br>Due date: ${dueStr}` : ''}</p>
<p>If you have any questions, please contact us at ${theme.email}.</p>
<p>Kind regards,<br>${theme.companyName}</p>`,
      attachments: [{ filename: `invoice-${inv.id.slice(0,8)}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });
    await pool.query(`UPDATE invoices SET status='sent', delivery_status='sent', updated_at=NOW() WHERE id=$1`, [req.params.id]);
    await logActivity({ type: 'invoice_sent', entity_type: 'invoice', entity_id: req.params.id, user_id: req.user?.id,
      message: `Invoice emailed to ${inv.customer_email} ($${(inv.total/100).toFixed(2)})` });
    await pool.query(
      `INSERT INTO email_log (job_id, customer_id, type, recipient, status) VALUES ($1,$2,'invoice',$3,'sent')`,
      [inv.job_id, inv.customer_id, inv.customer_email]
    );
    res.json({ message: 'Invoice sent' });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Email failed' }); }
}

module.exports = { list, get, update, markPaid, downloadPdf, sendEmail };
