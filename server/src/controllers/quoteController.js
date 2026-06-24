const pool = require('../db/pool');
const { buildPDF } = require('../utils/pdf');
const { sendMail } = require('../utils/email');
const { getTheme } = require('./settingsController');
const { logActivity } = require('../utils/activity');

function calcTotals(items) {
  const subtotal = items.reduce((s, i) => s + Math.round(i.unit_price * i.quantity), 0);
  const gst = Math.round(subtotal * 0.15);
  return { subtotal, gst, total: subtotal + gst };
}

async function list(req, res) {
  const { status, customer, job } = req.query;
  const conditions = [];
  const params = [];
  let p = 1;
  if (status)   { conditions.push(`q.status = $${p}`);      params.push(status);   p++; }
  if (customer) { conditions.push(`q.customer_id = $${p}`); params.push(customer); p++; }
  if (job)      { conditions.push(`q.job_id = $${p}`);      params.push(job);      p++; }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  try {
    const { rows } = await pool.query(
      `SELECT q.*, c.name AS customer_name, j.job_number,
              (q.expires_at IS NOT NULL AND q.expires_at < CURRENT_DATE AND q.status NOT IN ('accepted','declined','cancelled')) AS is_expired
       FROM quotes q
       LEFT JOIN customers c ON c.id = q.customer_id
       LEFT JOIN jobs j ON j.id = q.job_id
       ${where} ORDER BY q.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function get(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT q.*, q.public_token, q.accepted_at, q.accepted_name,
              c.name AS customer_name, c.email AS customer_email,
              c.phone AS customer_phone, c.company AS customer_company,
              j.job_number, j.description AS job_description
       FROM quotes q
       LEFT JOIN customers c ON c.id = q.customer_id
       LEFT JOIN jobs j ON j.id = q.job_id
       WHERE q.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Quote not found' });
    let q = rows[0];
    // Ensure token exists for quotes created before migration 007
    if (!q.public_token) {
      const { rows: updated } = await pool.query(
        `UPDATE quotes SET public_token = gen_random_uuid() WHERE id=$1 RETURNING public_token`,
        [q.id]
      );
      q = { ...q, public_token: updated[0].public_token };
    }
    const items = await pool.query(
      'SELECT * FROM line_items WHERE job_id = $1 ORDER BY created_at',
      [q.job_id]
    );
    res.json({ ...q, line_items: items.rows });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function create(req, res) {
  const { job_id, customer_id, notes } = req.body;
  if (!job_id) return res.status(400).json({ error: 'job_id is required' });
  try {
    // Pull line items from the job to calculate totals
    const items = await pool.query('SELECT * FROM line_items WHERE job_id=$1', [job_id]);
    const { subtotal, gst, total } = calcTotals(items.rows);
    const theme = await getTheme();
    const expiryDays = theme.quoteExpiryDays ?? 30;
    const expiresAt = expiryDays > 0 ? (() => { const d = new Date(); d.setDate(d.getDate() + expiryDays); return d; })() : null;
    const { rows } = await pool.query(
      `INSERT INTO quotes (job_id, customer_id, status, subtotal, gst, total, notes, expires_at)
       VALUES ($1,$2,'draft',$3,$4,$5,$6,$7) RETURNING *`,
      [job_id, customer_id || null, subtotal, gst, total, notes || null, expiresAt ? expiresAt.toISOString().split('T')[0] : null]
    );
    // Move job to quoted status
    await pool.query(
      `UPDATE jobs SET status='quoted', updated_at=NOW() WHERE id=$1 AND status NOT IN ('cancelled','complete')`,
      [job_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function update(req, res) {
  const { status, notes } = req.body;
  try {
    // Recalculate totals from current job line items
    const quote = await pool.query('SELECT job_id FROM quotes WHERE id=$1', [req.params.id]);
    if (!quote.rows[0]) return res.status(404).json({ error: 'Not found' });
    const items = await pool.query('SELECT * FROM line_items WHERE job_id=$1', [quote.rows[0].job_id]);
    const { subtotal, gst, total } = calcTotals(items.rows);
    const { rows } = await pool.query(
      `UPDATE quotes SET status=$1, subtotal=$2, gst=$3, total=$4, notes=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [status, subtotal, gst, total, notes || null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function remove(req, res) {
  try {
    await pool.query('DELETE FROM quotes WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function convertToInvoice(req, res) {
  const { rows: [quote] } = await pool.query(
    `SELECT q.*, c.name AS customer_name, c.email AS customer_email, c.company AS customer_company, c.phone AS customer_phone
     FROM quotes q LEFT JOIN customers c ON c.id=q.customer_id WHERE q.id=$1`,
    [req.params.id]
  );
  if (!quote) return res.status(404).json({ error: 'Quote not found' });
  if (quote.status !== 'accepted') return res.status(400).json({ error: 'Only accepted quotes can be converted' });
  try {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    const { rows } = await pool.query(
      `INSERT INTO invoices (job_id, quote_id, customer_id, status, subtotal, gst, total, due_date)
       VALUES ($1,$2,$3,'draft',$4,$5,$6,$7) RETURNING *`,
      [quote.job_id, quote.id, quote.customer_id, quote.subtotal, quote.gst, quote.total, dueDate.toISOString().split('T')[0]]
    );
    await pool.query(`UPDATE jobs SET status='invoiced', updated_at=NOW() WHERE id=$1`, [quote.job_id]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function enrichItemsWithImages(items) {
  const ids = items.map(i => i.product_id).filter(Boolean);
  if (!ids.length) return items;
  const { rows } = await pool.query(`SELECT id, media_base64, brochure_base64 FROM products WHERE id = ANY($1)`, [ids]);
  const map = Object.fromEntries(rows.map(r => [r.id, r]));
  return items.map(i => ({
    ...i,
    media_base64:    i.product_id ? (map[i.product_id]?.media_base64    || null) : null,
    brochure_base64: i.product_id ? (map[i.product_id]?.brochure_base64 || null) : null,
  }));
}

async function downloadPdf(req, res) {
  try {
    const { rows: [q] } = await pool.query(
      `SELECT q.*, c.name AS customer_name, c.email AS customer_email,
              c.company AS customer_company, c.phone AS customer_phone
       FROM quotes q LEFT JOIN customers c ON c.id=q.customer_id WHERE q.id=$1`,
      [req.params.id]
    );
    if (!q) return res.status(404).json({ error: 'Not found' });
    const items = await pool.query('SELECT * FROM line_items WHERE job_id=$1 ORDER BY created_at', [q.job_id]);
    const enrichedItems = await enrichItemsWithImages(items.rows);
    const theme = await getTheme();
    const pdf = await buildPDF({
      type: 'Quote', number: q.quote_number ? `QT-${String(q.quote_number).padStart(4,'0')}` : `Q-${q.id.slice(0,8).toUpperCase()}`,
      customer: { name: q.customer_name, company: q.customer_company, email: q.customer_email, phone: q.customer_phone },
      items: enrichedItems, subtotal: q.subtotal, gst: q.gst, total: q.total,
      status: q.status, notes: q.notes, terms: theme.quoteTerms || '', issuedAt: q.created_at, expiresAt: q.expires_at, theme,
    });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="quote-${q.id.slice(0,8)}.pdf"` });
    res.send(pdf);
  } catch (err) { console.error(err); res.status(500).json({ error: 'PDF generation failed' }); }
}

async function sendEmail(req, res) {
  try {
    const { rows: [q] } = await pool.query(
      `SELECT q.*, c.name AS customer_name, c.email AS customer_email,
              c.company AS customer_company, c.phone AS customer_phone
       FROM quotes q LEFT JOIN customers c ON c.id=q.customer_id WHERE q.id=$1`,
      [req.params.id]
    );
    if (!q) return res.status(404).json({ error: 'Not found' });
    if (!q.customer_email) return res.status(400).json({ error: 'Customer has no email address' });
    const items = await pool.query('SELECT * FROM line_items WHERE job_id=$1 ORDER BY created_at', [q.job_id]);
    const enrichedItems = await enrichItemsWithImages(items.rows);
    const theme = await getTheme();
    const pdf = await buildPDF({
      type: 'Quote', number: q.quote_number ? `QT-${String(q.quote_number).padStart(4,'0')}` : `Q-${q.id.slice(0,8).toUpperCase()}`,
      customer: { name: q.customer_name, company: q.customer_company, email: q.customer_email, phone: q.customer_phone },
      items: enrichedItems, subtotal: q.subtotal, gst: q.gst, total: q.total,
      status: q.status, notes: q.notes, terms: theme.quoteTerms || '', issuedAt: q.created_at, expiresAt: q.expires_at, theme,
    });
    const totalNZD = `$${(q.total / 100).toFixed(2)}`;
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const acceptUrl = `${clientUrl}/q/${q.public_token}`;
    await sendMail({
      to: q.customer_email,
      subject: `Quote from ${theme.companyName} — ${totalNZD} (incl. GST)`,
      html: `<p>Hi ${q.customer_name},</p>
<p>Please find your quote from ${theme.companyName} attached.</p>
<p><strong>Total: ${totalNZD} (incl. 15% GST)</strong></p>
<p>To accept this quote online, click the link below:</p>
<p><a href="${acceptUrl}" style="display:inline-block;padding:10px 20px;background:#000;color:#fff;text-decoration:none;border-radius:4px;">View &amp; Accept Quote</a></p>
<p>If you have any questions, please don't hesitate to get in touch.</p>
<p>Kind regards,<br>${theme.companyName}<br>${theme.email}</p>`,
      attachments: [{ filename: `quote-${q.id.slice(0,8)}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });
    await pool.query('UPDATE quotes SET status=\'sent\', delivery_status=\'sent\', sent_at=NOW(), updated_at=NOW() WHERE id=$1', [req.params.id]);
    await logActivity({ type: 'quote_sent', entity_type: 'quote', entity_id: req.params.id, user_id: req.user?.id,
      message: `Quote emailed to ${q.customer_email} ($${(q.total/100).toFixed(2)})` });
    await pool.query(
      `INSERT INTO email_log (job_id, customer_id, type, recipient, status) VALUES ($1,$2,'quote',$3,'sent')`,
      [q.job_id, q.customer_id, q.customer_email]
    );
    res.json({ message: 'Quote sent' });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Email failed' }); }
}

// Public: view quote by token (no auth)
async function publicGet(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT q.*, c.name AS customer_name, c.company AS customer_company,
              c.phone AS customer_phone
       FROM quotes q LEFT JOIN customers c ON c.id=q.customer_id
       WHERE q.public_token=$1`,
      [req.params.token]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Quote not found' });
    const q = rows[0];
    // Mark as viewed if it was only sent before
    if (q.delivery_status === 'sent') {
      await pool.query('UPDATE quotes SET delivery_status=\'viewed\' WHERE public_token=$1', [req.params.token]);
    }
    const items = await pool.query('SELECT * FROM line_items WHERE job_id=$1 ORDER BY created_at', [q.job_id]);
    const enrichedItems = await enrichItemsWithImages(items.rows);
    const theme = await getTheme();
    res.json({
      id: q.id,
      number: q.quote_number ? `QT-${String(q.quote_number).padStart(4,'0')}` : `Q-${q.id.slice(0,8).toUpperCase()}`,
      status: q.status,
      customer_name: q.customer_name,
      customer_company: q.customer_company,
      customer_phone: q.customer_phone,
      notes: q.notes,
      subtotal: q.subtotal, gst: q.gst, total: q.total,
      created_at: q.created_at,
      accepted_at: q.accepted_at,
      accepted_name: q.accepted_name,
      expires_at: q.expires_at,
      is_expired: q.expires_at ? new Date(q.expires_at) < new Date() : false,
      line_items: enrichedItems,
      company: { name: theme.companyName, email: theme.email, phone: theme.phone, logo: theme.logoBase64,
        logoSize: theme.logoSize, logoPosition: theme.logoPosition, contactPosition: theme.contactPosition },
    });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

// Public: accept quote by token (no auth)
async function publicAccept(req, res) {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required to accept this quote' });
  try {
    const { rows } = await pool.query(
      `UPDATE quotes SET status='accepted', accepted_at=NOW(), accepted_name=$1, updated_at=NOW()
       WHERE public_token=$2 AND status IN ('draft','sent')
       AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
       RETURNING id, status, accepted_at, accepted_name`,
      [name.trim(), req.params.token]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Quote not found or already accepted' });
    await logActivity({ type: 'quote_accepted', entity_type: 'quote', entity_id: rows[0].id, user_id: null,
      message: `Quote accepted online by ${name.trim()}` });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

module.exports = { list, get, create, update, remove, convertToInvoice, downloadPdf, sendEmail, publicGet, publicAccept };
