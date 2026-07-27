const pool = require('../db/pool');
const { normaliseRole } = require('../middleware/auth');
const { buildPDF } = require('../utils/pdf');
const { sendMail } = require('../utils/email');
const { getTheme } = require('./settingsController');
const { getThemeById, getDefaultTheme } = require('../utils/documentThemes');
const { logActivity } = require('../utils/activity');
const { sanitizeHtml } = require('../utils/sanitizeHtml');

function calcTotals(items) {
  const subtotal = items.reduce((s, i) => s + Math.round(i.unit_price * i.quantity), 0);
  const gst = Math.round(subtotal * 0.15);
  return { subtotal, gst, total: subtotal + gst };
}

// Fill {{placeholder}} tokens in a saved email template with this quote's real data
function resolveTemplateText(text, ctx) {
  return text.replace(/\{\{\s*([\w]+)\s*\}\}/g, (m, key) => (key in ctx ? ctx[key] : m));
}

// The JWT payload (req.user) only carries id/name/email/role — mobile isn't
// on it, so it needs its own lookup for the {{sender_mobile}} placeholder.
async function getSenderInfo(userId) {
  if (!userId) return { name: '', mobile: '' };
  const { rows } = await pool.query('SELECT name, mobile FROM users WHERE id=$1', [userId]);
  return { name: rows[0]?.name || '', mobile: rows[0]?.mobile || '' };
}

async function buildQuoteEmailContext(q, theme, sender) {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  return {
    customer_name: q.customer_name || '',
    customer_first_name: (q.customer_name || '').split(' ')[0] || '',
    customer_company: q.customer_company || '',
    company_name: theme.companyName,
    company_logo: theme.logoBase64 ? `<img src="${theme.logoBase64}" alt="${theme.companyName}" style="max-height:48px;max-width:220px;">` : '',
    sender_name: sender?.name || theme.companyName,
    sender_email: theme.email || '',
    sender_mobile: sender?.mobile || '',
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
      'SELECT * FROM line_items WHERE quote_id = $1 ORDER BY created_at',
      [q.id]
    );
    res.json({ ...q, line_items: items.rows, attachment_ids: await getQuoteAttachmentIds(q.id) });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function create(req, res) {
  const { job_id, customer_id, notes, theme_id } = req.body;
  if (!job_id) return res.status(400).json({ error: 'job_id is required' });
  try {
    // Seed the quote from the job's current line items
    const items = await pool.query('SELECT * FROM line_items WHERE job_id=$1 AND quote_id IS NULL', [job_id]);
    const { subtotal, gst, total } = calcTotals(items.rows);
    const theme = await getTheme();
    const expiryDays = theme.quoteExpiryDays ?? 30;
    const expiresAt = expiryDays > 0 ? (() => { const d = new Date(); d.setDate(d.getDate() + expiryDays); return d; })() : null;
    const docTheme = theme_id ? await getThemeById(theme_id) : await getDefaultTheme();
    const { rows } = await pool.query(
      `INSERT INTO quotes (job_id, customer_id, status, subtotal, gst, total, notes, expires_at, created_by, theme_id, quote_date)
       VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,CURRENT_DATE) RETURNING *`,
      [job_id, customer_id || null, subtotal, gst, total, sanitizeHtml(notes) || null, expiresAt ? expiresAt.toISOString().split('T')[0] : null, req.user.id, docTheme?.id || null]
    );
    // Take a copy of those items for the quote to own, so it can be priced
    // independently of the job and of any other quote on it.
    await pool.query(
      `INSERT INTO line_items (job_id, quote_id, description, quantity, unit_price, product_id, product_name)
       SELECT job_id, $1, description, quantity, unit_price, product_id, product_name
       FROM line_items WHERE job_id=$2 AND quote_id IS NULL ORDER BY created_at`,
      [rows[0].id, job_id]
    );
    // Move job to quoted status
    await pool.query(
      `UPDATE jobs SET status='quoted', updated_at=NOW() WHERE id=$1 AND status NOT IN ('cancelled','complete')`,
      [job_id]
    );
    await logActivity({ type: 'quote_created', entity_type: 'quote', entity_id: rows[0].id, user_id: req.user.id, message: 'Quote created' });
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

// Once a quote is accepted it's the agreed scope of work, so the job's own
// line items are replaced with that quote's — the job (and the invoice raised
// from it) then reflects only what the customer actually signed off.
async function syncJobLineItemsFromQuote(quoteId, jobId) {
  if (!jobId) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM line_items WHERE job_id=$1 AND quote_id IS NULL', [jobId]);
    await client.query(
      `INSERT INTO line_items (job_id, quote_id, description, quantity, unit_price, product_id, product_name)
       SELECT $1, NULL, description, quantity, unit_price, product_id, product_name
       FROM line_items WHERE quote_id=$2 ORDER BY created_at`,
      [jobId, quoteId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function update(req, res) {
  const { status, notes, theme_id, quote_date, expires_at, attachment_ids } = req.body;
  try {
    // Totals always come from the quote's own line items
    const quote = await pool.query('SELECT job_id, status FROM quotes WHERE id=$1', [req.params.id]);
    if (!quote.rows[0]) return res.status(404).json({ error: 'Not found' });
    const items = await pool.query('SELECT * FROM line_items WHERE quote_id=$1', [req.params.id]);
    const { subtotal, gst, total } = calcTotals(items.rows);
    const { rows } = await pool.query(
      `UPDATE quotes SET status=$1, subtotal=$2, gst=$3, total=$4, notes=$5, updated_at=NOW(),
              theme_id=COALESCE($6, theme_id), quote_date=COALESCE($7, quote_date), expires_at=COALESCE($8, expires_at)
       WHERE id=$9 RETURNING *`,
      [status, subtotal, gst, total, notes != null ? sanitizeHtml(notes) : null, theme_id || null, quote_date || null, expires_at || null, req.params.id]
    );
    // Sent as the full selection, so replace rather than merge. Restricted to
    // attachments actually on this quote's job.
    if (Array.isArray(attachment_ids)) {
      await pool.query('DELETE FROM quote_attachments WHERE quote_id=$1', [req.params.id]);
      if (attachment_ids.length) {
        await pool.query(
          `INSERT INTO quote_attachments (quote_id, attachment_id)
           SELECT $1, a.id FROM job_attachments a
           WHERE a.id = ANY($2::uuid[]) AND a.job_id = $3
           ON CONFLICT DO NOTHING`,
          [req.params.id, attachment_ids, quote.rows[0].job_id]
        );
      }
    }
    if (status === 'accepted' && quote.rows[0].status !== 'accepted') {
      await syncJobLineItemsFromQuote(req.params.id, quote.rows[0].job_id);
    }
    await logActivity({ type: 'quote_modified', entity_type: 'quote', entity_id: req.params.id, user_id: req.user?.id, message: 'Quote modified' });
    res.json({ ...rows[0], attachment_ids: await getQuoteAttachmentIds(req.params.id) });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function updateLineItems(req, res) {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Items must be an array' });
  const client = await pool.connect();
  try {
    const { rows: [quote] } = await pool.query('SELECT job_id FROM quotes WHERE id=$1', [req.params.id]);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    await client.query('BEGIN');
    await client.query('DELETE FROM line_items WHERE quote_id=$1', [req.params.id]);
    for (const item of items) {
      if (!item.description) continue;
      await client.query(
        'INSERT INTO line_items (job_id, quote_id, description, quantity, unit_price, product_id, product_name) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [quote.job_id, req.params.id, item.description, item.quantity || 1, Math.round((item.unit_price || 0) * 100), item.product_id || null, item.product_name || null]
      );
    }
    await client.query('COMMIT');
    const { rows } = await pool.query('SELECT * FROM line_items WHERE quote_id=$1 ORDER BY created_at', [req.params.id]);
    const { subtotal, gst, total } = calcTotals(rows);
    await pool.query('UPDATE quotes SET subtotal=$1, gst=$2, total=$3, updated_at=NOW() WHERE id=$4',
      [subtotal, gst, total, req.params.id]);
    await logActivity({ type: 'quote_modified', entity_type: 'quote', entity_id: req.params.id, user_id: req.user?.id, message: 'Quote line items updated' });
    res.json({ line_items: rows, subtotal, gst, total });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
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
    await logActivity({ type: 'quote_approved', entity_type: 'quote', entity_id: req.params.id, user_id: req.user.id, message: 'Quote approved' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

// Admins can delete any quote; everyone else only the ones they raised.
function canDeleteQuote(user, quote) {
  return normaliseRole(user.role) === 'admin' || quote.created_by === user.id;
}

// An invoice keeps a reference to the quote it came from, so deleting that
// quote would break the paper trail behind a financial record — those are
// refused rather than cascaded away.
async function remove(req, res) {
  try {
    const { rows: [quote] } = await pool.query(
      `SELECT q.created_by, EXISTS(SELECT 1 FROM invoices i WHERE i.quote_id=q.id) AS invoiced
       FROM quotes q WHERE q.id=$1`,
      [req.params.id]
    );
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (!canDeleteQuote(req.user, quote)) {
      return res.status(403).json({ error: 'You can only delete quotes you created' });
    }
    if (quote.invoiced) {
      return res.status(409).json({ error: 'This quote has been converted to an invoice and can no longer be deleted.' });
    }
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
      `INSERT INTO invoices (job_id, quote_id, customer_id, status, subtotal, gst, total, due_date, theme_id)
       VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8) RETURNING *`,
      [quote.job_id, quote.id, quote.customer_id, quote.subtotal, quote.gst, quote.total, dueDate.toISOString().split('T')[0], quote.theme_id]
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

// Only what this quote has explicitly selected — never everything sitting on
// the job, or a drawing pulled later would appear on quotes already sent.
async function getQuoteAttachmentImages(quoteId) {
  const { rows } = await pool.query(
    `SELECT a.data_base64
     FROM quote_attachments qa
     JOIN job_attachments a ON a.id = qa.attachment_id
     WHERE qa.quote_id = $1
     ORDER BY a.arcsite_drawing_id IS NULL, a.created_at`,
    [quoteId]
  );
  return rows.map(r => r.data_base64);
}

async function getQuoteAttachmentIds(quoteId) {
  const { rows } = await pool.query('SELECT attachment_id FROM quote_attachments WHERE quote_id=$1', [quoteId]);
  return rows.map(r => r.attachment_id);
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
    const items = await pool.query('SELECT * FROM line_items WHERE quote_id=$1 ORDER BY created_at', [q.id]);
    const enrichedItems = await enrichItemsWithImages(items.rows);
    const appendixImages = await getQuoteAttachmentImages(q.id);
    const docTheme = await getThemeById(q.theme_id);
    const pdf = await buildPDF({
      type: 'Quote', number: q.quote_number ? `QT-${String(q.quote_number).padStart(4,'0')}` : `Q-${q.id.slice(0,8).toUpperCase()}`,
      customer: { name: q.customer_name, company: q.customer_company, email: q.customer_email, phone: q.customer_phone, address: formatCustomerAddress(q) },
      jobNumber: formatJobNumberDisplay(q), jobAddress: formatJobAddress(q),
      items: enrichedItems, subtotal: q.subtotal, gst: q.gst, total: q.total,
      status: q.status, notes: q.notes, paymentTerms: docTheme.paymentTerms || '', terms: docTheme.termsAndConditions || '',
      issuedAt: q.quote_date || q.created_at, expiresAt: q.expires_at, theme: docTheme,
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
    const docTheme = await getThemeById(q.theme_id);
    const sender = await getSenderInfo(req.user?.id);
    const ctx = await buildQuoteEmailContext(q, docTheme, sender);

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
    const items = await pool.query('SELECT * FROM line_items WHERE quote_id=$1 ORDER BY created_at', [q.id]);
    const enrichedItems = await enrichItemsWithImages(items.rows);
    const appendixImages = await getQuoteAttachmentImages(q.id);
    const docTheme = await getThemeById(q.theme_id);
    const pdf = await buildPDF({
      type: 'Quote', number: q.quote_number ? `QT-${String(q.quote_number).padStart(4,'0')}` : `Q-${q.id.slice(0,8).toUpperCase()}`,
      customer: { name: q.customer_name, company: q.customer_company, email: q.customer_email, phone: q.customer_phone, address: formatCustomerAddress(q) },
      jobNumber: formatJobNumberDisplay(q), jobAddress: formatJobAddress(q),
      items: enrichedItems, subtotal: q.subtotal, gst: q.gst, total: q.total,
      status: q.status, notes: q.notes, paymentTerms: docTheme.paymentTerms || '', terms: docTheme.termsAndConditions || '',
      issuedAt: q.quote_date || q.created_at, expiresAt: q.expires_at, theme: docTheme,
      appendixImages,
    });

    // A user-edited draft (subject/body) takes priority; fall back to the
    // category's default template so the endpoint still works if called directly.
    let { subject, body } = req.body || {};
    if (!subject || !body) {
      const sender = await getSenderInfo(req.user?.id);
      const ctx = await buildQuoteEmailContext(q, docTheme, sender);
      const { rows } = await pool.query(
        `SELECT * FROM email_templates WHERE category='quote' ORDER BY is_default DESC, name LIMIT 1`
      );
      const template = rows[0];
      subject = subject || (template ? resolveTemplateText(template.subject, ctx) : `Quote from ${docTheme.companyName} — ${ctx.quote_total}`);
      body = body || (template ? resolveTemplateText(template.body, ctx) : `Hi ${ctx.customer_first_name},\n\nPlease find your quote attached.`);
    }
    let htmlBody = body.split('\n').map(line => `<p>${line || '&nbsp;'}</p>`).join('\n');

    // The plain-text body (shown/edited in the compose modal) keeps the raw
    // accept link as visible text; the HTML version sent to the customer
    // gets that same URL swapped for a styled "View Quote" button instead.
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const acceptUrl = `${clientUrl}/q/${q.public_token}`;
    const buttonHtml = `<a href="${acceptUrl}" style="display:inline-block;background:${docTheme.brandColour || '#1e40af'};color:#ffffff;padding:12px 26px;border-radius:6px;text-decoration:none;font-weight:600;font-family:Arial,Helvetica,sans-serif;">View Quote</a>`;
    htmlBody = htmlBody.split(acceptUrl).join(buttonHtml);

    // Open-tracking pixel — 1x1 gif, HTML only (plain-text fallback has no
    // concept of it, which is normal/expected for text emails).
    htmlBody += `<img src="${clientUrl}/api/quotes/public/${q.public_token}/pixel.gif" width="1" height="1" alt="" style="display:none;">`;

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
    // Staff hitting this from the quote editor's Preview button — show the
    // quote, but don't count it as the customer having viewed it. The emailed
    // link and Copy Link both omit the flag, so genuine views still record.
    const isPreview = req.query.preview === '1';
    if (!isPreview) {
      // Mark as viewed if it was only sent/opened before
      if (q.delivery_status === 'sent' || q.delivery_status === 'opened') {
        await pool.query('UPDATE quotes SET delivery_status=\'viewed\' WHERE public_token=$1', [req.params.token]);
      }
      await logActivity({ type: 'quote_viewed', entity_type: 'quote', entity_id: q.id, message: 'Quote viewed by customer' });
    }
    const items = await pool.query('SELECT * FROM line_items WHERE quote_id=$1 ORDER BY created_at', [q.id]);
    const enrichedItems = await enrichItemsWithImages(items.rows);
    const arcsiteDrawings = await getQuoteAttachmentImages(q.id);
    const docTheme = await getThemeById(q.theme_id);
    res.json({
      id: q.id,
      number: q.quote_number ? `QT-${String(q.quote_number).padStart(4,'0')}` : `Q-${q.id.slice(0,8).toUpperCase()}`,
      status: q.status,
      customer_name: q.customer_name,
      customer_company: q.customer_company,
      customer_email: q.customer_email,
      customer_phone: q.customer_phone,
      customer_address: formatCustomerAddress(q),
      job_number: q.job_number,
      job_external_ref: q.external_ref,
      job_address: formatJobAddress(q),
      notes: q.notes,
      payment_terms: docTheme.paymentTerms || '',
      terms: docTheme.termsAndConditions || '',
      subtotal: q.subtotal, gst: q.gst, total: q.total,
      created_at: q.created_at,
      quote_date: q.quote_date,
      accepted_at: q.accepted_at,
      accepted_name: q.accepted_name,
      expires_at: q.expires_at,
      is_expired: q.expires_at ? new Date(q.expires_at) < new Date() : false,
      // product_name is the internal ordering code — strip it so it never
      // reaches the customer-facing quote page.
      line_items: enrichedItems.map(({ product_name, ...item }) => item),
      arcsite_drawings: arcsiteDrawings,
      company: { name: docTheme.companyName, contactDetails: docTheme.contactDetails, logo: docTheme.logoBase64,
        logoSize: docTheme.logoSize, logoPosition: docTheme.logoPosition, contactPosition: docTheme.contactPosition,
        gstNumber: docTheme.gstNumber || '' },
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
       RETURNING id, job_id, status, accepted_at, accepted_name`,
      [name.trim(), req.params.token]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Quote not found or already accepted' });
    await syncJobLineItemsFromQuote(rows[0].id, rows[0].job_id);
    await logActivity({ type: 'quote_accepted', entity_type: 'quote', entity_id: rows[0].id, user_id: null,
      message: `Quote accepted online by ${name.trim()}` });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

// 1x1 transparent gif embedded in the sent HTML email to detect opens.
const TRACKING_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

// Public: email open-tracking pixel (no auth). Only ever advances
// delivery_status forward (sent -> opened) — never overwrites a later
// 'viewed' status or a quote that's already been acted on.
async function trackOpen(req, res) {
  try {
    const { rows } = await pool.query(
      `UPDATE quotes SET delivery_status='opened' WHERE public_token=$1 AND delivery_status='sent' RETURNING id`,
      [req.params.token]
    );
    if (rows[0]) {
      await logActivity({ type: 'quote_email_opened', entity_type: 'quote', entity_id: rows[0].id, message: 'Quote email opened by customer' });
    }
  } catch { /* tracking is best-effort — never fail the pixel request */ }
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
  res.send(TRACKING_PIXEL);
}

async function getActivity(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, u.name AS user_name FROM activity_log a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity_type='quote' AND a.entity_id=$1
       ORDER BY a.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

module.exports = { list, get, create, update, updateLineItems, remove, approve, convertToInvoice, downloadPdf, sendEmail, emailPreview, publicGet, publicAccept, trackOpen, getActivity };
