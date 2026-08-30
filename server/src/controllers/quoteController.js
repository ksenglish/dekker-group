const crypto = require('crypto');
const pool = require('../db/pool');
const { findJobType } = require('../services/jobTypes');
const { normaliseRole } = require('../middleware/auth');
const { buildPDF } = require('../utils/pdf');
const { sendMail } = require('../utils/email');
const { getTheme } = require('./settingsController');
const { getThemeById, getDefaultTheme } = require('../utils/documentThemes');
const { logActivity } = require('../utils/activity');
const { sanitizeHtml } = require('../utils/sanitizeHtml');
const { OFFICE_RECORDS_EMAIL, SALES_EMAIL } = require('../utils/recordsEmail');
const { advanceJobStatus, advanceJobStatusByLabel } = require('../utils/jobStatusFlow');
const fileStore = require('../services/fileStore');
const { shrinkForPage } = require('../utils/imageForPrint');

// An accepted quote is a won job, so it moves to Sale. Forward-only — a job
// already past Sale (e.g. install booked, second quote accepted later) stays.
const isSale = l => l === 'sale' || l.startsWith('sale ') || l.endsWith(' sale');
const advanceToSale = jobId => advanceJobStatusByLabel(jobId, isSale);

// The wording the customer confirms when they accept. Served to the public
// quote page as well, so what they read and what the notification records are
// always the same text.
const ACCEPTANCE_DECLARATION =
  'By entering my name and clicking Accept, I agree to proceed with the work described above and accept the Terms & Conditions of Sale set out in this quote.';

// A statuses a customer is still able to act on. 'approved' is included so a
// quote shared by link — rather than emailed — can still be accepted.
const OPEN_FOR_CUSTOMER = "('draft','approved','sent')";


// Edits to a quote nobody has seen yet aren't worth recording — they were the
// bulk of the activity log. Once a quote has been approved it may have gone to
// the customer, so every change from then on is worth an audit trail. Resetting
// to draft deliberately leaves approved_at in place, so edits made after a
// reset are still logged.
async function logIfApproved(quoteId, userId, message) {
  const { rows } = await pool.query('SELECT approved_at FROM quotes WHERE id=$1', [quoteId]);
  if (!rows[0]?.approved_at) return;
  await logActivity({ type: 'quote_modified', entity_type: 'quote', entity_id: quoteId, user_id: userId, message });
}

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
    sender_first_name: (sender?.name || '').trim().split(/\s+/)[0] || '',
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
  // A quote raised straight from the Quotes page has no job behind it yet —
  // the customer is then the only thing identifying who it's for, so it can't
  // be left out. (Quotes raised from a job inherit the job's customer, which
  // that job is allowed to not have.)
  if (!job_id && !customer_id) {
    return res.status(400).json({ error: 'A customer is required for a quote that has no job' });
  }
  try {
    // Seed the quote from the job's current line items — a job-less quote
    // starts empty and is priced up in the line items editor.
    const items = job_id
      ? await pool.query('SELECT * FROM line_items WHERE job_id=$1 AND quote_id IS NULL', [job_id])
      : { rows: [] };
    const { subtotal, gst, total } = calcTotals(items.rows);
    const theme = await getTheme();
    const expiryDays = theme.quoteExpiryDays ?? 30;
    const expiresAt = expiryDays > 0 ? (() => { const d = new Date(); d.setDate(d.getDate() + expiryDays); return d; })() : null;
    // Theme precedence: whatever the caller asked for, else the theme set
    // against this job's type in Settings, else the global default.
    let resolvedThemeId = theme_id || null;
    if (!resolvedThemeId && job_id) {
      const { rows: [jobRow] } = await pool.query('SELECT type FROM jobs WHERE id=$1', [job_id]);
      const jobType = jobRow ? await findJobType(jobRow.type) : null;
      if (jobType?.theme_id) resolvedThemeId = jobType.theme_id;
    }
    const docTheme = resolvedThemeId ? await getThemeById(resolvedThemeId) : await getDefaultTheme();
    // A new quote opens with its theme's standard description already in the
    // box, so the wording that goes on every quote doesn't have to be retyped.
    // Anything passed in explicitly wins — it's the caller being specific.
    const description = sanitizeHtml(notes) || docTheme?.quoteDescription || null;
    const { rows } = await pool.query(
      `INSERT INTO quotes (job_id, customer_id, status, subtotal, gst, total, notes, expires_at, created_by, theme_id, quote_date)
       VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,CURRENT_DATE) RETURNING *`,
      [job_id || null, customer_id || null, subtotal, gst, total, description, expiresAt ? expiresAt.toISOString().split('T')[0] : null, req.user.id, docTheme?.id || null]
    );
    // Take a copy of those items for the quote to own, so it can be priced
    // independently of the job and of any other quote on it.
    if (job_id) {
      await pool.query(
        `INSERT INTO line_items (job_id, quote_id, description, quantity, unit_price, product_id, product_name)
         SELECT job_id, $1, description, quantity, unit_price, product_id, product_name
         FROM line_items WHERE job_id=$2 AND quote_id IS NULL ORDER BY created_at`,
        [rows[0].id, job_id]
      );
    }
    // Deliberately does NOT move the job to Quoted. A draft that never leaves
    // the office isn't a quote as far as the customer is concerned — the job
    // advances when the quote is actually emailed (see sendEmail).
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
      await advanceToSale(quote.rows[0].job_id);
    }
    await logIfApproved(req.params.id, req.user?.id, 'Quote modified');
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
    await logIfApproved(req.params.id, req.user?.id, 'Quote line items updated');
    res.json({ line_items: rows, subtotal, gst, total });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

// Gives a job-less quote its job, either by opening a new one for the quote's
// customer or by pointing it at a job that already exists. Only ever fills a
// gap — a quote already on a job is refused rather than moved, so this can't
// silently detach a quote from the job its history and invoice refer to.
async function attachJob(req, res) {
  const { job_id, type, description, site_id } = req.body || {};
  try {
    const { rows: [quote] } = await pool.query(
      'SELECT id, job_id, customer_id, status FROM quotes WHERE id=$1', [req.params.id]
    );
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (quote.job_id) return res.status(409).json({ error: 'This quote is already linked to a job' });

    let jobId = job_id;
    if (jobId) {
      const { rows: [job] } = await pool.query('SELECT id FROM jobs WHERE id=$1', [jobId]);
      if (!job) return res.status(404).json({ error: 'Job not found' });
    } else {
      if (!type) return res.status(400).json({ error: 'Job type is required' });
      if (!quote.customer_id) return res.status(400).json({ error: 'This quote has no customer to raise a job for' });
      const { rows: [job] } = await pool.query(
        `INSERT INTO jobs (customer_id, site_id, type, description, priority)
         VALUES ($1,$2,$3,$4,'medium') RETURNING id`,
        [quote.customer_id, site_id || null, type, sanitizeHtml(description) || null]
      );
      jobId = job.id;
      // Mirrors jobController.create: a non-admin who raises a job is assigned
      // to it, or the job list — which scopes them to their own work — would
      // hide the job they just made.
      if (normaliseRole(req.user.role) !== 'admin') {
        await pool.query(
          'INSERT INTO job_technicians (job_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [jobId, req.user.id]
        );
      }
    }

    await pool.query('UPDATE quotes SET job_id=$1, updated_at=NOW() WHERE id=$2', [jobId, quote.id]);
    // The quote's own items carry the job too, matching how they'd look had
    // the quote been raised from the job in the first place. quote_id still
    // separates them from the job's own items, so nothing is confused for a
    // job line item.
    await pool.query('UPDATE line_items SET job_id=$1 WHERE quote_id=$2', [jobId, quote.id]);

    // A quote accepted before it had a job never got to push its scope onto
    // one. Do it now, so the job it lands on reflects what was signed off.
    if (quote.status === 'accepted') {
      await syncJobLineItemsFromQuote(quote.id, jobId);
      await advanceToSale(jobId);
    }

    await logActivity({ type: 'quote_modified', entity_type: 'quote', entity_id: quote.id, user_id: req.user.id,
      message: job_id ? 'Quote linked to an existing job' : 'Job created from quote' });
    const { rows: [updated] } = await pool.query(
      `SELECT q.*, j.job_number, j.external_ref
       FROM quotes q LEFT JOIN jobs j ON j.id = q.job_id WHERE q.id=$1`,
      [quote.id]
    );
    res.status(201).json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
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

// Deliberately explicit: once a quote is approved, sent or accepted it may be
// in front of the customer, so editing is locked until someone consciously
// pulls it back to draft. approved_at is left in place — it's what marks the
// quote as having been out, and keeps later edits in the activity log.
async function resetToDraft(req, res) {
  try {
    const { rows: [quote] } = await pool.query('SELECT status FROM quotes WHERE id=$1', [req.params.id]);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (quote.status === 'draft') return res.status(400).json({ error: 'This quote is already a draft' });
    if (!['approved', 'sent', 'accepted'].includes(quote.status)) {
      return res.status(400).json({ error: `A ${quote.status} quote can't be reset to draft` });
    }
    const { rows } = await pool.query(
      `UPDATE quotes SET status='draft', updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    await logActivity({
      type: 'quote_reset_to_draft', entity_type: 'quote', entity_id: req.params.id, user_id: req.user?.id,
      message: `Quote reset to draft from ${quote.status}`,
    });
    res.json({ ...rows[0], attachment_ids: await getQuoteAttachmentIds(req.params.id) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

// Take a quote off its job without deleting either. Its own line items keep
// quote_id but lose job_id, so they stop counting toward the job's costs.
//
// Refused once accepted: accepting copies the agreed scope onto the job and
// moves the job to Sale, so unpicking the link afterwards would leave the job
// holding work nothing explains. Reset it to draft first if that's really the
// intent.
async function detachJob(req, res) {
  const client = await pool.connect();
  try {
    const { rows: [quote] } = await client.query('SELECT id, job_id, status FROM quotes WHERE id=$1', [req.params.id]);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    if (!quote.job_id) return res.status(400).json({ error: 'This quote isn\'t attached to a job' });
    if (quote.status === 'accepted') {
      return res.status(400).json({
        error: 'This quote has been accepted and its scope is on the job. Reset it to draft first if you need to unattach it.',
      });
    }
    await client.query('BEGIN');
    await client.query('UPDATE line_items SET job_id=NULL WHERE quote_id=$1', [req.params.id]);
    await client.query('UPDATE quotes SET job_id=NULL, updated_at=NOW() WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    await logActivity({
      type: 'quote_modified', entity_type: 'quote', entity_id: req.params.id, user_id: req.user?.id,
      message: 'Quote unattached from its job',
    });
    const { rows } = await pool.query(
      `SELECT q.*, j.job_number, j.external_ref FROM quotes q LEFT JOIN jobs j ON j.id=q.job_id WHERE q.id=$1`,
      [req.params.id]
    );
    res.json({ ...rows[0], attachment_ids: await getQuoteAttachmentIds(req.params.id) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
}

// Duplicate a quote as a fresh draft. Everything that describes the work is
// copied; everything recording what happened to the original — approval,
// sending, opens, acceptance — deliberately isn't, and the copy gets its own
// quote number, public link and expiry.
async function copyQuote(req, res) {
  const client = await pool.connect();
  try {
    const { rows: [src] } = await client.query('SELECT * FROM quotes WHERE id=$1', [req.params.id]);
    if (!src) return res.status(404).json({ error: 'Quote not found' });

    const theme = await getTheme();
    const expiryDays = theme.quoteExpiryDays ?? 30;
    const expiresAt = expiryDays > 0
      ? (() => { const d = new Date(); d.setDate(d.getDate() + expiryDays); return d.toISOString().split('T')[0]; })()
      : null;

    await client.query('BEGIN');
    const { rows: [copy] } = await client.query(
      `INSERT INTO quotes (job_id, customer_id, status, subtotal, gst, total, notes, theme_id,
                           quote_date, expires_at, created_by, delivery_status)
       VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,CURRENT_DATE,$8,$9,'unsent') RETURNING *`,
      [src.job_id, src.customer_id, src.subtotal, src.gst, src.total, src.notes, src.theme_id,
       expiresAt, req.user?.id || null]
    );

    // The copy's own line items — same scope, owned by the new quote
    await client.query(
      `INSERT INTO line_items (job_id, quote_id, description, quantity, unit_price, product_id, product_name)
       SELECT job_id, $1, description, quantity, unit_price, product_id, product_name
       FROM line_items WHERE quote_id=$2 ORDER BY created_at`,
      [copy.id, req.params.id]
    );

    // Drawings/photos chosen for the original are chosen for the copy too
    await client.query(
      `INSERT INTO quote_attachments (quote_id, attachment_id)
       SELECT $1, attachment_id FROM quote_attachments WHERE quote_id=$2
       ON CONFLICT DO NOTHING`,
      [copy.id, req.params.id]
    );
    await client.query('COMMIT');

    await logActivity({
      type: 'quote_created', entity_type: 'quote', entity_id: copy.id, user_id: req.user?.id,
      message: `Copied from ${src.quote_number ? `QT-${String(src.quote_number).padStart(4, '0')}` : 'another quote'}`,
    });
    res.status(201).json(copy);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
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
    if (quote.job_id) {
      await pool.query(`UPDATE jobs SET status='invoiced', updated_at=NOW() WHERE id=$1`, [quote.job_id]);
    }
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
    `SELECT a.data_base64, a.storage_key, a.mime_type
     FROM quote_attachments qa
     JOIN job_attachments a ON a.id = qa.attachment_id
     WHERE qa.quote_id = $1
     ORDER BY a.arcsite_drawing_id IS NULL, a.created_at`,
    [quoteId]
  );

  // One at a time, and shrunk before the next is fetched. Loading them all at
  // once held every full-size drawing in memory simultaneously, which is what
  // ran the server out of memory on a quote carrying two 17MB ArcSite exports.
  // Buffers rather than data URLs for the same reason — a base64 string is a
  // third larger again, and the builder only decoded it straight back.
  // Split by kind: images get drawn onto a Proposal page, PDFs are merged in
  // whole at the end — pdfkit's doc.image() only understands JPEG and PNG, so
  // a PDF sent down that path was silently dropped.
  const images = [];
  const pdfs = [];
  for (const row of rows) {
    try {
      const full = await fileStore.readAttachmentBuffer(row);
      if ((row.mime_type || '').includes('pdf')) {
        pdfs.push(full);   // shrinkForPage passes PDFs through untouched anyway
      } else {
        images.push(await shrinkForPage(full, row.mime_type));
      }
    } catch (err) {
      console.error('Could not load quote attachment for the PDF:', err.message);
    }
  }
  return { images, pdfs };
}

async function getQuoteAttachmentIds(quoteId) {
  const { rows } = await pool.query('SELECT attachment_id FROM quote_attachments WHERE quote_id=$1', [quoteId]);
  return rows.map(r => r.attachment_id);
}

async function enrichItemsWithImages(items) {
  const ids = items.map(i => i.product_id).filter(Boolean);
  if (!ids.length) return items;
  const { rows } = await pool.query(
    `SELECT id, media_base64, brochure_base64, media_key, brochure_key FROM products WHERE id = ANY($1)`,
    [ids]
  );

  // The PDF builder wants data URLs, so bucket-stored media is fetched back
  // here — one product at a time, and only for products actually on the quote.
  // A brochure is as big as a drawing, so loading them all at once has the same
  // memory cost that took the server down.
  const map = {};
  for (const row of rows) {
    map[row.id] = {
      media_base64: await fileStore.readDataUrl({ key: row.media_key, inline: row.media_base64 }),
      brochure_base64: await fileStore.readDataUrl({ key: row.brochure_key, inline: row.brochure_base64 }),
    };
  }

  return items.map(i => ({
    ...i,
    media_base64:    i.product_id ? (map[i.product_id]?.media_base64    || null) : null,
    brochure_base64: i.product_id ? (map[i.product_id]?.brochure_base64 || null) : null,
  }));
}

// The customer-facing page, unlike the PDF, wants a link to the brochure
// rather than the bytes of one.
//
// A brochure sent inline as a data: URL cannot be displayed: Chrome refuses to
// render a PDF from a data: URL in a frame, so the block came out blank while
// the same brochure appeared correctly in the downloaded PDF. Served from a URL
// it renders normally — and a customer on a phone no longer downloads every
// brochure on the quote before the page appears.
//
// Thumbnails stay inline. They are small, and an <img> renders a data: URL
// without complaint.
async function enrichItemsForPublic(items, token) {
  const ids = items.map(i => i.product_id).filter(Boolean);
  if (!ids.length) return items;

  const { rows } = await pool.query(
    `SELECT id, media_base64, media_key, brochure_key, brochure_hash,
            (brochure_key IS NOT NULL OR brochure_base64 IS NOT NULL) AS has_brochure
       FROM products WHERE id = ANY($1)`,
    [ids]
  );

  const map = {};
  for (const row of rows) {
    map[row.id] = {
      media_base64: await fileStore.readDataUrl({ key: row.media_key, inline: row.media_base64 }),
      brochure_url: row.has_brochure ? `/api/quotes/public/${token}/brochures/${row.id}` : null,
      brochure_hash: row.has_brochure ? await brochureHash(row) : null,
    };
  }

  return items.map(i => ({
    ...i,
    media_base64: i.product_id ? (map[i.product_id]?.media_base64 || null) : null,
    brochure_url: i.product_id ? (map[i.product_id]?.brochure_url || null) : null,
    // Lets the page collapse one brochure shared across several products —
    // the URL can't, since it's keyed per product.
    brochure_hash: i.product_id ? (map[i.product_id]?.brochure_hash || null) : null,
  }));
}

// Migration 087 hashes brochures held inline; ones in object storage are done
// here, once, the first time they're needed. After that it's a column read, so
// the bytes never get pulled just to compare two brochures.
async function brochureHash(row) {
  if (row.brochure_hash) return row.brochure_hash;
  if (!row.brochure_key) return null;
  try {
    const buffer = await fileStore.getObjectBuffer(row.brochure_key);
    const hash = crypto.createHash('md5').update(buffer).digest('hex');
    await pool.query('UPDATE products SET brochure_hash=$1 WHERE id=$2', [hash, row.id]);
    return hash;
  } catch {
    // Falling back to null just means this one isn't deduped — better than
    // failing the whole quote page over a brochure we couldn't read.
    return null;
  }
}

// Unauthenticated like the rest of the public quote, but joined through the
// quote the token belongs to and its line items — so a product id on its own
// gets nothing, and a token only reaches brochures for products actually on
// that quote.
async function publicBrochure(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT p.brochure_base64, p.brochure_key, p.name
         FROM quotes q
         JOIN line_items li ON li.quote_id = q.id
         JOIN products p ON p.id = li.product_id
        WHERE q.public_token = $1 AND p.id = $2
        LIMIT 1`,
      [req.params.token, req.params.productId]
    );
    const row = rows[0];
    if (!row || (!row.brochure_key && !row.brochure_base64)) return res.status(404).json({ error: 'Not found' });

    let buffer, contentType;
    if (row.brochure_key) {
      ({ buffer, contentType } = await fileStore.getObject(row.brochure_key));
    } else {
      contentType = (String(row.brochure_base64).match(/^data:([^;]+);base64,/) || [])[1] || 'application/pdf';
      buffer = Buffer.from(fileStore.stripDataUrl(row.brochure_base64), 'base64');
    }

    res.set('Content-Type', contentType);
    // inline so the browser displays it in the page rather than downloading it.
    res.set('Content-Disposition', `inline; filename="${(row.name || 'brochure').replace(/[^\w.\- ]+/g, '_')}"`);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  } catch (err) {
    console.error('Public brochure fetch failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

async function downloadPdf(req, res) {
  try {
    const q = await getQuoteFull({ id: req.params.id });
    if (!q) return res.status(404).json({ error: 'Not found' });
    const items = await pool.query('SELECT * FROM line_items WHERE quote_id=$1 ORDER BY created_at', [q.id]);
    const enrichedItems = await enrichItemsWithImages(items.rows);
    const { images: appendixImages, pdfs: appendixPdfs } = await getQuoteAttachmentImages(q.id);
    const docTheme = await getThemeById(q.theme_id);
    const pdf = await buildPDF({
      type: 'Quote', number: q.quote_number ? `QT-${String(q.quote_number).padStart(4,'0')}` : `Q-${q.id.slice(0,8).toUpperCase()}`,
      customer: { name: q.customer_name, company: q.customer_company, email: q.customer_email, phone: q.customer_phone, address: formatCustomerAddress(q) },
      jobNumber: formatJobNumberDisplay(q), jobAddress: formatJobAddress(q),
      items: enrichedItems, subtotal: q.subtotal, gst: q.gst, total: q.total,
      status: q.status, notes: q.notes, paymentTerms: docTheme.paymentTerms || '', terms: docTheme.termsAndConditions || '',
      issuedAt: q.quote_date || q.created_at, expiresAt: q.expires_at, theme: docTheme,
      appendixImages,
      appendixPdfs,
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
    const { images: appendixImages, pdfs: appendixPdfs } = await getQuoteAttachmentImages(q.id);
    const docTheme = await getThemeById(q.theme_id);
    const pdf = await buildPDF({
      type: 'Quote', number: q.quote_number ? `QT-${String(q.quote_number).padStart(4,'0')}` : `Q-${q.id.slice(0,8).toUpperCase()}`,
      customer: { name: q.customer_name, company: q.customer_company, email: q.customer_email, phone: q.customer_phone, address: formatCustomerAddress(q) },
      jobNumber: formatJobNumberDisplay(q), jobAddress: formatJobAddress(q),
      items: enrichedItems, subtotal: q.subtotal, gst: q.gst, total: q.total,
      status: q.status, notes: q.notes, paymentTerms: docTheme.paymentTerms || '', terms: docTheme.termsAndConditions || '',
      issuedAt: q.quote_date || q.created_at, expiresAt: q.expires_at, theme: docTheme,
      appendixImages,
      appendixPdfs,
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

    // The pixel and the View Quote link are stamped per recipient below, so an
    // open can be traced to the address it came from rather than assumed to be
    // the customer.

    const attachments = [{ filename: `quote-${q.id.slice(0,8)}.pdf`, content: pdf, contentType: 'application/pdf' }];
    const { attachment_ids } = req.body || {};
    if (Array.isArray(attachment_ids) && attachment_ids.length) {
      const extra = await pool.query(
        'SELECT filename, mime_type, data_base64, storage_key FROM job_attachments WHERE job_id=$1 AND id = ANY($2::uuid[])',
        [q.job_id, attachment_ids]
      );
      // Same one-at-a-time handling as the embedded drawings, and shrunk for
      // the same second reason: most mail providers bounce anything over 25MB,
      // so two full-size ArcSite exports would not have arrived regardless.
      for (const a of extra.rows) {
        try {
          const full = await fileStore.readAttachmentBuffer(a);
          attachments.push({
            filename: a.filename,
            content: await shrinkForPage(full, a.mime_type),
            contentType: a.mime_type || 'application/octet-stream',
          });
        } catch (err) {
          console.error('Could not attach file to quote email:', a.filename, err.message);
        }
      }
    }

    // The rep still gets their own copy of exactly what the customer received,
    // and sits on Reply-To alongside the sales inbox — a customer replying
    // reaches the person who knows the job, without the shared inbox losing it.
    //
    // Sent as two messages rather than one with a BCC: a BCC is byte-identical,
    // so the rep's copy carried the customer's tracking pixel and their opening
    // it was logged as the customer reading the quote. Separate messages let
    // each copy carry its own tracking id.
    const recipients = [{ email: q.customer_email, role: 'customer' }];
    if (req.user?.email && req.user.email.toLowerCase() !== String(q.customer_email).toLowerCase()) {
      recipients.push({ email: req.user.email, role: 'sender' });
    }

    for (const r of recipients) {
      const { rows: [row] } = await pool.query(
        `INSERT INTO quote_email_recipients (quote_id, email, role) VALUES ($1,$2,$3) RETURNING id`,
        [req.params.id, r.email, r.role]
      );
      // Same body, but the link and pixel carry this recipient's id
      const trackedUrl = `${acceptUrl}?r=${row.id}`;
      const html = htmlBody.split(acceptUrl).join(trackedUrl)
        + `<img src="${clientUrl}/api/quotes/public/${q.public_token}/pixel.gif?r=${row.id}" width="1" height="1" alt="" style="display:none;">`;
      await sendMail({
        to: r.email,
        subject,
        html,
        text: body.split(acceptUrl).join(trackedUrl),
        attachments,
        replyTo: [req.user?.email, SALES_EMAIL],
      });
    }
    await pool.query('UPDATE quotes SET status=\'sent\', delivery_status=\'sent\', sent_at=NOW(), updated_at=NOW() WHERE id=$1', [req.params.id]);
    await logActivity({ type: 'quote_sent', entity_type: 'quote', entity_id: req.params.id, user_id: req.user?.id,
      message: `Quote emailed to ${q.customer_email} ($${(q.total/100).toFixed(2)})` });
    await pool.query(
      `INSERT INTO email_log (job_id, customer_id, type, recipient, status) VALUES ($1,$2,'quote',$3,'sent')`,
      [q.job_id, q.customer_id, q.customer_email]
    );
    // The quote has actually reached the customer now, so the job can move to
    // Quoted — only forwards, so a job already further along stays put.
    await advanceJobStatus(q.job_id, 'quoted');
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
      const who = await identifyRecipient(req.params.token, req.query.r);
      // The rep following the link in their own copy isn't the customer
      // reading it, so it doesn't advance the delivery status.
      if (who.role !== 'sender' && (q.delivery_status === 'sent' || q.delivery_status === 'opened')) {
        await pool.query('UPDATE quotes SET delivery_status=\'viewed\' WHERE public_token=$1', [req.params.token]);
      }
      await logActivity({
        type: 'quote_viewed', entity_type: 'quote', entity_id: q.id,
        message: `Quote viewed by ${who.label}`,
      });
      if (who.recipientId) {
        await pool.query(
          'UPDATE quote_email_recipients SET viewed_at=COALESCE(viewed_at, NOW()) WHERE id=$1',
          [who.recipientId]
        );
      }
    }
    const items = await pool.query('SELECT * FROM line_items WHERE quote_id=$1 ORDER BY created_at', [q.id]);
    const enrichedItems = await enrichItemsForPublic(items.rows, req.params.token);
    // Links, not bytes. These are the same drawings the PDF embeds, and putting
    // them inline meant a customer opening the quote on a phone downloaded
    // several megabytes of base64 inside the JSON before anything rendered.
    const { rows: drawingRows } = await pool.query(
      `SELECT a.id, a.mime_type, a.filename
       FROM quote_attachments qa
       JOIN job_attachments a ON a.id = qa.attachment_id
       WHERE qa.quote_id = $1
       ORDER BY a.arcsite_drawing_id IS NULL, a.created_at`,
      [q.id]
    );
    const drawingUrl = r => `/api/quotes/public/${req.params.token}/drawings/${r.id}`;
    const isPdfRow = r => (r.mime_type || '').toLowerCase().includes('pdf');
    // Kept to images only. The field is a plain list of URLs the page renders
    // as <img>, so a PDF in here came out as a broken image — and a client
    // cached by the service worker still reads it that way.
    const arcsiteDrawings = drawingRows.filter(r => !isPdfRow(r)).map(drawingUrl);
    // PDFs travel separately, with the filename, so the page can embed them
    // properly and link to them by name.
    const proposalPdfs = drawingRows.filter(isPdfRow).map(r => ({
      url: drawingUrl(r), filename: r.filename || 'Attachment.pdf',
    }));
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
      declined_at: q.declined_at,
      declined_name: q.declined_name,
      // Served rather than duplicated in the client, so the wording the
      // customer agrees to is the same wording recorded in the notification.
      acceptance_declaration: ACCEPTANCE_DECLARATION,
      // product_name is the internal ordering code — strip it so it never
      // reaches the customer-facing quote page.
      line_items: enrichedItems.map(({ product_name, ...item }) => item),
      arcsite_drawings: arcsiteDrawings,
      proposal_pdfs: proposalPdfs,
      company: { name: docTheme.companyName, contactDetails: docTheme.contactDetails, logo: docTheme.logoBase64,
        logoSize: docTheme.logoSize, logoPosition: docTheme.logoPosition, contactPosition: docTheme.contactPosition,
        gstNumber: docTheme.gstNumber || '' },
    });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

// Public: accept quote by token (no auth)

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Reproduces the "Accept this quote" panel as it appeared to the customer,
// with the name they typed, so the notification carries a record of exactly
// what was agreed and by whom.
function acceptanceRecordHtml({ heading, declaration, name, when, reason }) {
  const stamp = new Date(when || Date.now()).toLocaleString('en-NZ', {
    day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:20px;background:#fafafa;font-family:Arial,Helvetica,sans-serif;max-width:560px;">
  <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px;">${escapeHtml(heading)}</div>
  <div style="font-size:13px;color:#0f172a;margin-bottom:14px;">${escapeHtml(declaration)}</div>
  <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px;font-size:15px;font-weight:600;color:#0f172a;">${escapeHtml(name)}</div>
  ${reason ? `<div style="margin-top:12px;font-size:13px;color:#0f172a;"><strong>Reason given:</strong> ${escapeHtml(reason)}</div>` : ''}
  <div style="margin-top:12px;font-size:12px;color:#64748b;">Submitted ${escapeHtml(stamp)}</div>
</div>`;
}

// Tells whoever sent the quote, and the office, that the customer has acted.
// Best effort — a mail failure must never undo the customer's decision.
async function notifyQuoteDecision({ quoteId, decision, name, reason, when }) {
  try {
    const { rows: [q] } = await pool.query(
      `SELECT q.quote_number, q.id, q.total, q.accepted_terms,
              c.name AS customer_name, u.email AS sender_email,
              j.job_number, j.external_ref
       FROM quotes q
       LEFT JOIN customers c ON c.id = q.customer_id
       LEFT JOIN users u ON u.id = q.created_by
       LEFT JOIN jobs j ON j.id = q.job_id
       WHERE q.id = $1`,
      [quoteId]
    );
    if (!q) return;
    const to = [...new Set([q.sender_email, OFFICE_RECORDS_EMAIL].filter(Boolean).map(e => e.toLowerCase()))];
    if (!to.length) return;

    const quoteNo = q.quote_number ? `QT-${String(q.quote_number).padStart(4, '0')}` : `Q-${q.id.slice(0, 8).toUpperCase()}`;
    const jobNo = q.external_ref || (q.job_number != null ? `JB${String(q.job_number).padStart(5, '0')}` : '');
    const accepted = decision === 'accepted';

    await sendMail({
      to: to.join(', '),
      subject: `Quote ${quoteNo} ${accepted ? 'accepted' : 'declined'} by ${name}`,
      html: `<p>${escapeHtml(q.customer_name || 'The customer')} has <strong>${accepted ? 'accepted' : 'declined'}</strong> quote <strong>${escapeHtml(quoteNo)}</strong>${jobNo ? ` (job ${escapeHtml(jobNo)})` : ''} online.</p>
<p>Quote total: <strong>$${(q.total / 100).toFixed(2)}</strong> incl. GST</p>
${acceptanceRecordHtml({
  heading: accepted ? 'Accept this quote' : 'Decline this quote',
  declaration: accepted ? ACCEPTANCE_DECLARATION : 'The customer declined this quote online.',
  name, when, reason,
})}
${accepted && q.accepted_terms ? `<p style="margin-top:18px;font-size:12px;color:#64748b;">Terms &amp; Conditions agreed to at the time of acceptance are recorded against this quote.</p>` : ''}`,
    });
  } catch (err) {
    console.error('[quote] decision notification failed:', err.message);
  }
}

async function publicAccept(req, res) {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required to accept this quote' });
  try {
    // Snapshot the terms in force right now, so a later edit to the theme
    // can't rewrite what the customer appears to have agreed to.
    const { rows: [current] } = await pool.query('SELECT theme_id FROM quotes WHERE public_token=$1', [req.params.token]);
    const docTheme = current ? await getThemeById(current.theme_id) : null;

    const { rows } = await pool.query(
      `UPDATE quotes SET status='accepted', accepted_at=NOW(), accepted_name=$1,
              accepted_terms=$2, updated_at=NOW()
       WHERE public_token=$3 AND status IN ${OPEN_FOR_CUSTOMER}
       AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
       RETURNING id, job_id, status, accepted_at, accepted_name`,
      [name.trim(), docTheme?.termsAndConditions || null, req.params.token]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Quote not found, expired, or already actioned' });
    await syncJobLineItemsFromQuote(rows[0].id, rows[0].job_id);
    await advanceToSale(rows[0].job_id);
    await logActivity({ type: 'quote_accepted', entity_type: 'quote', entity_id: rows[0].id, user_id: null,
      message: `Quote accepted online by ${name.trim()}` });
    await notifyQuoteDecision({
      quoteId: rows[0].id, decision: 'accepted', name: name.trim(), when: rows[0].accepted_at,
    });
    res.json(rows[0]);
  } catch (err) { console.error('[quote]', err.message); res.status(500).json({ error: 'Server error' }); }
}

async function publicDecline(req, res) {
  const { name, reason } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required to decline this quote' });
  try {
    const { rows } = await pool.query(
      `UPDATE quotes SET status='declined', declined_at=NOW(), declined_name=$1,
              decline_reason=$2, updated_at=NOW()
       WHERE public_token=$3 AND status IN ${OPEN_FOR_CUSTOMER}
       RETURNING id, status, declined_at, declined_name, decline_reason`,
      [name.trim(), (reason || '').trim() || null, req.params.token]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Quote not found or already actioned' });
    await logActivity({ type: 'quote_declined', entity_type: 'quote', entity_id: rows[0].id, user_id: null,
      message: `Quote declined online by ${name.trim()}${rows[0].decline_reason ? ` — ${rows[0].decline_reason}` : ''}` });
    await notifyQuoteDecision({
      quoteId: rows[0].id, decision: 'declined', name: name.trim(),
      reason: rows[0].decline_reason, when: rows[0].declined_at,
    });
    res.json(rows[0]);
  } catch (err) { console.error('[quote]', err.message); res.status(500).json({ error: 'Server error' }); }
}

// 1x1 transparent gif embedded in the sent HTML email to detect opens.
const TRACKING_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

// Public: email open-tracking pixel (no auth). Only ever advances
// delivery_status forward (sent -> opened) — never overwrites a later
// 'viewed' status or a quote that's already been acted on.
// Works out who an open/view belongs to from the ?r= tracking id carried by
// that recipient's copy of the email. Quotes emailed before this existed have
// no id, and links get forwarded — both fall back to naming the customer,
// which is the old behaviour and the likeliest reader.
async function identifyRecipient(token, recipientId) {
  const { rows: [quote] } = await pool.query(
    'SELECT id, customer_id FROM quotes WHERE public_token=$1', [token]
  );
  if (!quote) return { quoteId: null, label: 'customer', role: null, recipientId: null };

  if (recipientId && /^[0-9a-f-]{36}$/i.test(recipientId)) {
    const { rows: [r] } = await pool.query(
      'SELECT id, email, role FROM quote_email_recipients WHERE id=$1 AND quote_id=$2',
      [recipientId, quote.id]
    );
    if (r) return { quoteId: quote.id, label: r.email, role: r.role, recipientId: r.id };
  }

  // No usable id — name the customer's address if we hold one, so the log
  // still says who rather than just "customer".
  const { rows: [c] } = await pool.query(
    'SELECT email FROM customers WHERE id=$1', [quote.customer_id]
  );
  return { quoteId: quote.id, label: c?.email || 'customer', role: null, recipientId: null };
}

async function trackOpen(req, res) {
  try {
    const who = await identifyRecipient(req.params.token, req.query.r);
    // Only the customer's copy moves the quote's delivery status — the rep
    // opening their own copy says nothing about whether it's been read.
    if (who.role !== 'sender') {
      await pool.query(
        `UPDATE quotes SET delivery_status='opened' WHERE public_token=$1 AND delivery_status='sent'`,
        [req.params.token]
      );
    }
    if (who.quoteId) {
      // Log every open, including repeats — who read it and when is the point.
      await logActivity({
        type: 'quote_email_opened', entity_type: 'quote', entity_id: who.quoteId,
        message: `Quote email opened by ${who.label}`,
      });
      if (who.recipientId) {
        await pool.query(
          'UPDATE quote_email_recipients SET opened_at=COALESCE(opened_at, NOW()) WHERE id=$1',
          [who.recipientId]
        );
      }
    }
  } catch { /* tracking is best-effort — never fail the pixel request */ }
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
  res.send(TRACKING_PIXEL);
}

// A drawing on the customer-facing quote. Unauthenticated like the rest of the
// public quote, but the join ties the attachment to the quote the token belongs
// to — the id alone gets you nothing, so a token cannot be used to read files
// from anyone else's job.
async function publicDrawing(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT a.data_base64, a.storage_key, a.mime_type, a.filename
       FROM quotes q
       JOIN quote_attachments qa ON qa.quote_id = q.id
       JOIN job_attachments a ON a.id = qa.attachment_id
       WHERE q.public_token = $1 AND a.id = $2`,
      [req.params.token, req.params.attachmentId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    const buf = await fileStore.readAttachmentBuffer(rows[0]);
    res.set('Content-Type', rows[0].mime_type || 'image/png');
    res.set('Content-Disposition', `inline; filename="${rows[0].filename || 'drawing'}"`);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(buf);
  } catch (err) {
    console.error('Public drawing fetch failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
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

module.exports = { list, get, create, update, resetToDraft, detachJob, copyQuote, updateLineItems, remove, approve, attachJob, convertToInvoice, downloadPdf, sendEmail, emailPreview, publicGet, publicAccept, publicDecline, trackOpen, publicDrawing, publicBrochure, getActivity };
