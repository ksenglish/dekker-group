const pool = require('../db/pool');
const { normaliseRole } = require('../middleware/auth');
const { buildPDF } = require('../utils/pdf');
const { sendMail } = require('../utils/email');
const { getTheme } = require('./settingsController');
const { logActivity } = require('../utils/activity');

function calcTotals(items) {
  const subtotal = items.reduce((s, i) => s + Math.round(i.unit_price * i.quantity), 0);
  const gst = Math.round(subtotal * 0.15);
  return { subtotal, gst, total: subtotal + gst };
}

// Fill {{placeholder}} tokens in a saved email template with this quote's real data
function resolveTemplateText(text, ctx) {
  return text.replace(/\{\{\s*([\w]+)\s*\}\}/g, (m, key) => (key in ctx ? ctx[key] : m));
}

async function buildQuoteEmailContext(q, theme, senderName) {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  return {
    customer_name: q.customer_name || '',
    customer_first_name: (q.customer_name || '').split(' ')[0] || '',
    customer_company: q.customer_company || '',
    company_name: theme.companyName,
    sender_name: senderName || theme.companyName,
    sender_email: theme.email || '',
    quote_number: q.quote_number ? `QT-${String(q.quote_number).padStart(4, '0')}` : `Q-${q.id.slice(0, 8).toUpperCase()}`,
    quote_total: `$${(q.total / 100).toFixed(2)}`,
    job_number: q.external_ref || (q.job_number ? `JB${String(q.job_number).padStart(5, '0')}` : ''),
    accept_link: `${clientUrl}/q/${q.public_token}`,
  };
}

async function list(req, res) {
  const { status, customer, job } = req.query;
  const conditions = [];
  const params = [];
  let p = 1;
  if (status)   { conditions.push(`q.status = $${p}`);      params.push(status);   p++; }
  if (customer) { conditions.push(`q.customer_id = $${p}`); params.push(customer); p++; }
  if (job)      { conditions.push(`q.job_id = $${p}`);      params.push(job);      p++; }
  // Non-admin users only see quotes they created
  if (normaliseRole(req.user.role) !== 'admin') {
    conditions.push(`q.created_by = $${p}`); params.push(req.user.id); p++;
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  try {
    const { rows } = await pool.query(
      `SELECT q.*, c.name AS customer_name, j.job_number, j.external_ref,
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
              j.job_number, j.external_ref, j.description AS job_description
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
      `INSERT INTO quotes (job_id, customer_id, status, subtotal, gst, total, notes, expires_at, created_by)
       VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8) RETURNING *`,
      [job_id, customer_id || null, subtotal, gst, total, notes || null, expiresAt ? expiresAt.toISOString().split('T')[0] : null, req.user.id]
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

// Internal sales-review step, ahead of actually sending — flips the badge
// from DRAFT to APPROVED so a customer never sees "Draft" on a quote that
// was in fact reviewed and sent to them.
async function approve(req, res) {
  try {
    const { rows } = await pool.query(
      `UPDATE quotes SET status='approved', approved_at=NOW(), approved_by=$1, updated_at=NOW()
       WHERE id=$2 AND status='draft' RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!rows[0]) return res.status(400).json({ error: 'Only draft quotes can be approved' });
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

// Shared fetch for anything that needs the full quote picture — customer
// (incl. postal address), linked job's number/address, everything the
// Tradify-style layout needs — used by downloadPdf, sendEmail, and
// publicGet so those three call sites stop maintaining separate near-
// identical queries.
async function getQuoteFull({ id, token }) {
  const { rows: [q] } = await pool.query(
    `SELECT q.*,
            c.name AS customer_name, c.email AS customer_email,
            c.company AS customer_company, c.phone AS customer_phone,
            c.address_street AS customer_address_street, c.address_city AS customer_address_city,
            c.address_region AS customer_address_region, c.address_postcode AS customer_address_postcode,
            c.address_country AS customer_address_country,
            j.job_number, j.external_ref, j.site_address AS job_freeform_address,
            s.address AS job_site_address
     FROM quotes q
     LEFT JOIN customers c ON c.id = q.customer_id
     LEFT JOIN jobs j ON j.id = q.job_id
     LEFT JOIN customer_sites s ON s.id = j.site_id
     WHERE ${id ? 'q.id=$1' : 'q.public_token=$1'}`,
    [id || token]
  );
  return q;
}

function formatCustomerAddress(q) {
  return [q.customer_address_street, q.customer_address_city, q.customer_address_region, q.customer_address_postcode, q.customer_address_country]
    .filter(Boolean).join(', ');
}

function formatJobAddress(q) {
  return q.job_site_address || q.job_freeform_address || '';
}

function formatJobNumberDisplay(q) {
  if (q.external_ref) return q.external_ref;
  if (q.job_number != null) return 'JB' + String(q.job_number).padStart(5, '0');
  return '';
}

async function getJobDrawingImages(jobId) {
  const { rows } = await pool.query(
    `SELECT data_base64 FROM job_attachments WHERE job_id=$1 AND arcsite_drawing_id IS NOT NULL ORDER BY created_at`,
    [jobId]
  );
  return rows.map(r => r.data_base64);
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
    const q = await getQuoteFull({ id: req.params.id });
    if (!q) return res.status(404).json({ error: 'Not found' });
    const items = await pool.query('SELECT * FROM line_items WHERE job_id=$1 ORDER BY created_at', [q.job_id]);
    const enrichedItems = await enrichItemsWithImages(items.rows);
    const appendixImages = await getJobDrawingImages(q.job_id);
    const theme = await getTheme();
    const pdf = await buildPDF({
      type: 'Quote', number: q.quote_number ? `QT-${String(q.quote_number).padStart(4,'0')}` : `Q-${q.id.slice(0,8).toUpperCase()}`,
      customer: { name: q.customer_name, company: q.customer_company, email: q.customer_email, phone: q.customer_phone, address: formatCustomerAddress(q) },
      jobNumber: formatJobNumberDisplay(q), jobAddress: formatJobAddress(q),
      items: enrichedItems, subtotal: q.subtotal, gst: q.gst, total: q.total,
      status: q.status, notes: q.notes, terms: theme.quoteTerms || '', issuedAt: q.created_at, expiresAt: q.expires_at, theme,
      appendixImages,
    });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="quote-${q.id.slice(0,8)}.pdf"` });
    res.send(pdf);
  } catch (err) { console.error(err); res.status(500).json({ error: 'PDF generation failed' }); }
}

async function getQuoteForEmail(id) {
  const { rows: [q] } = await pool.query(
    `SELECT q.*, c.name AS customer_name, c.email AS customer_email,
            c.company AS customer_company, c.phone AS customer_phone,
            j.job_number, j.external_ref
     FROM quotes q LEFT JOIN customers c ON c.id=q.customer_id
     LEFT JOIN jobs j ON j.id=q.job_id WHERE q.id=$1`,
    [id]
  );
  return q;
}

// Resolve a saved template (or the category default) against this quote's real data,
// so the compose modal can show the customer's actual name/total/link before sending
async function emailPreview(req, res) {
  try {
    const q = await getQuoteForEmail(req.params.id);
    if (!q) return res.status(404).json({ error: 'Not found' });
    const theme = await getTheme();
    const ctx = await buildQuoteEmailContext(q, theme, req.user?.name);

    let template;
    if (req.query.templateId) {
      const { rows } = await pool.query('SELECT * FROM email_templates WHERE id=$1', [req.query.templateId]);
      template = rows[0];
    }
    if (!template) {
      const { rows } = await pool.query(
        `SELECT * FROM email_templates WHERE category='quote' ORDER BY is_default DESC, name LIMIT 1`
      );
      template = rows[0];
    }
    if (!template) return res.status(404).json({ error: 'No email template found' });

    res.json({
      templateId: template.id,
      subject: resolveTemplateText(template.subject, ctx),
      body: resolveTemplateText(template.body, ctx),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function sendEmail(req, res) {
  try {
    const q = await getQuoteFull({ id: req.params.id });
    if (!q) return res.status(404).json({ error: 'Not found' });
    if (!q.customer_email) return res.status(400).json({ error: 'Customer has no email address' });
    const items = await pool.query('SELECT * FROM line_items WHERE job_id=$1 ORDER BY created_at', [q.job_id]);
    const enrichedItems = await enrichItemsWithImages(items.rows);
    const appendixImages = await getJobDrawingImages(q.job_id);
    const theme = await getTheme();
    const pdf = await buildPDF({
      type: 'Quote', number: q.quote_number ? `QT-${String(q.quote_number).padStart(4,'0')}` : `Q-${q.id.slice(0,8).toUpperCase()}`,
      customer: { name: q.customer_name, company: q.customer_company, email: q.customer_email, phone: q.customer_phone, address: formatCustomerAddress(q) },
      jobNumber: formatJobNumberDisplay(q), jobAddress: formatJobAddress(q),
      items: enrichedItems, subtotal: q.subtotal, gst: q.gst, total: q.total,
      status: q.status, notes: q.notes, terms: theme.quoteTerms || '', issuedAt: q.created_at, expiresAt: q.expires_at, theme,
      appendixImages,
    });

    // A user-edited draft (subject/body) takes priority; fall back to the
    // category's default template so the endpoint still works if called directly.
    let { subject, body } = req.body || {};
    if (!subject || !body) {
      const ctx = await buildQuoteEmailContext(q, theme, req.user?.name);
      const { rows } = await pool.query(
        `SELECT * FROM email_templates WHERE category='quote' ORDER BY is_default DESC, name LIMIT 1`
      );
      const template = rows[0];
      subject = subject || (template ? resolveTemplateText(template.subject, ctx) : `Quote from ${theme.companyName} — ${ctx.quote_total}`);
      body = body || (template ? resolveTemplateText(template.body, ctx) : `Hi ${ctx.customer_first_name},\n\nPlease find your quote attached.`);
    }
    const htmlBody = body.split('\n').map(line => `<p>${line || '&nbsp;'}</p>`).join('\n');

    const attachments = [{ filename: `quote-${q.id.slice(0,8)}.pdf`, content: pdf, contentType: 'application/pdf' }];
    const { attachment_ids } = req.body || {};
    if (Array.isArray(attachment_ids) && attachment_ids.length) {
      const extra = await pool.query(
        'SELECT filename, mime_type, data_base64 FROM job_attachments WHERE job_id=$1 AND id = ANY($2::uuid[])',
        [q.job_id, attachment_ids]
      );
      for (const a of extra.rows) {
        attachments.push({
          filename: a.filename,
          content: Buffer.from(a.data_base64.replace(/^data:[^;]+;base64,/, ''), 'base64'),
          contentType: a.mime_type || 'application/octet-stream',
        });
      }
    }

    await sendMail({
      to: q.customer_email,
      subject,
      html: htmlBody,
      text: body,
      attachments,
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
    const q = await getQuoteFull({ token: req.params.token });
    if (!q) return res.status(404).json({ error: 'Quote not found' });
    // Mark as viewed if it was only sent before
    if (q.delivery_status === 'sent') {
      await pool.query('UPDATE quotes SET delivery_status=\'viewed\' WHERE public_token=$1', [req.params.token]);
    }
    const items = await pool.query('SELECT * FROM line_items WHERE job_id=$1 ORDER BY created_at', [q.job_id]);
    const enrichedItems = await enrichItemsWithImages(items.rows);
    const arcsiteDrawings = await getJobDrawingImages(q.job_id);
    const theme = await getTheme();
    res.json({
      id: q.id,
      number: q.quote_number ? `QT-${String(q.quote_number).padStart(4,'0')}` : `Q-${q.id.slice(0,8).toUpperCase()}`,
      status: q.status,
      customer_name: q.customer_name,
      customer_company: q.customer_company,
      customer_phone: q.customer_phone,
      customer_address: formatCustomerAddress(q),
      job_number: q.job_number,
      job_external_ref: q.external_ref,
      job_address: formatJobAddress(q),
      notes: q.notes,
      terms: theme.quoteTerms || '',
      subtotal: q.subtotal, gst: q.gst, total: q.total,
      created_at: q.created_at,
      accepted_at: q.accepted_at,
      accepted_name: q.accepted_name,
      expires_at: q.expires_at,
      is_expired: q.expires_at ? new Date(q.expires_at) < new Date() : false,
      line_items: enrichedItems,
      arcsite_drawings: arcsiteDrawings,
      company: { name: theme.companyName, email: theme.email, phone: theme.phone, logo: theme.logoBase64,
        logoSize: theme.logoSize, logoPosition: theme.logoPosition, contactPosition: theme.contactPosition,
        gstNumber: theme.gstNumber || '' },
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

module.exports = { list, get, create, update, remove, approve, convertToInvoice, downloadPdf, sendEmail, emailPreview, publicGet, publicAccept };
