// The Job Form: everything a subcontractor needs to do the job, and nothing
// about what it is worth.
//
// The office was assembling this by hand — the address in one email, the scope
// pasted out of the quote in another, three photos as separate attachments,
// and the day in the diary mentioned over the phone. The subbie still rang to
// ask where the site was.
//
// Built the same way the job service report is, and drawn by the same
// letterhead and detail block, so a customer or a subbie who has had a quote,
// an invoice and one of these has had three documents from one company. The
// theme comes off the job rather than the house default, which is the whole
// reason they used to disagree.
//
// What it carries no trace of is money. No unit prices, no totals, no quote
// number, no terms of sale, no payment terms. That is not a filter applied at
// the end — the queries below never ask for a price, so there is no figure in
// hand to leak into the document by accident.
const pool = require('../db/pool');
const fileStore = require('./fileStore');
const { getThemeForJob } = require('../utils/documentThemes');
const { shrinkForPage } = require('../utils/imageForPrint');
const { toPdfImage } = require('../utils/pdfImage');

// sharp, used only to prove an image can be decoded at all. Optional, the same
// way it is everywhere else here: without it the check is skipped rather than
// the document failing.
let sharp = null;
try { sharp = require('sharp'); } catch { /* checked below */ }

const pad = n => String(n).padStart(2, '0');

// A DATE column comes back from pg as a JS Date at local midnight, and a string
// from anything that has already been through JSON. Either way what is wanted
// is the calendar day Postgres is holding, never an instant shifted by the
// server's zone — the server runs in UTC and the business is in Auckland.
function dayOf(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

// A TIME column is 'HH:MM:SS'. Keep the minutes, drop the seconds nobody set.
function hhmm(value) {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value));
  return m ? `${pad(m[1])}:${m[2]}` : null;
}

function jobRef(job) {
  if (!job) return '';
  if (job.external_ref) return job.external_ref;
  if (job.job_number != null) return 'JB' + String(job.job_number).padStart(5, '0');
  return '';
}

async function loadJob(jobId) {
  const { rows } = await pool.query(
    `SELECT j.id, j.job_number, j.external_ref, j.type, j.status, j.priority,
            j.description, j.due_date, j.materials, j.site_address AS job_site_address,
            j.job_contact, j.job_contact_phone, j.job_contact_mobile,
            c.name AS customer_name, c.company AS customer_company,
            c.contact_name AS customer_contact_name,
            c.phone AS customer_phone, c.mobile AS customer_mobile,
            c.email AS customer_email,
            c.address_street, c.address_city, c.address_region,
            c.address_postcode, c.address_country,
            cs.address AS site_address_full, cs.label AS site_label,
            lt.name AS lead_tech_name, lt.mobile AS lead_tech_mobile
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN customer_sites cs ON cs.id = j.site_id
       LEFT JOIN users lt ON lt.id = j.lead_tech_id
      WHERE j.id = $1`,
    [jobId]
  );
  return rows[0] || null;
}

// The quote the customer actually signed. More than one can be accepted on a
// job — a variation goes out as its own quote — so the most recently accepted
// is the live scope, and the count goes with it so the document can say there
// were others rather than quietly pick one.
async function loadAcceptedQuote(jobId) {
  const { rows } = await pool.query(
    `SELECT id, notes, accepted_at, accepted_name, quote_date
       FROM quotes
      WHERE job_id = $1 AND status = 'accepted'
      ORDER BY accepted_at DESC NULLS LAST, updated_at DESC`,
    [jobId]
  );
  if (!rows.length) return null;
  return { ...rows[0], accepted_count: rows.length };
}

// What is being installed and how many, with no column for what any of it
// costs. Selecting only description and quantity is the guardrail — a future
// edit here cannot put a price on the page without somebody deliberately
// adding unit_price to this query.
async function loadWorks(quoteId) {
  if (!quoteId) return [];
  const { rows } = await pool.query(
    `SELECT description, quantity, product_name
       FROM line_items WHERE quote_id = $1 ORDER BY created_at`,
    [quoteId]
  );
  return rows.map(r => ({
    description: r.description || r.product_name || '',
    quantity: Number(r.quantity) || 0,
  })).filter(r => r.description);
}

// Who is booked on, when, off the Operations diary.
//
// Every booking on the job is loaded, not only the ones typed 'operations': a
// booking left untyped is still a day somebody is expected on site, and
// leaving it off is how a subbie turns up alone. The type travels with each
// row so the document can mark the ones that are not an install, and the
// office chooses per share which of them that person actually needs.
async function loadSchedule(jobId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.scheduled_date, s.start_time, s.end_time, s.appointment_type, s.notes,
            u.name AS person, u.mobile
       FROM schedules s
       JOIN users u ON u.id = s.user_id
      WHERE s.job_id = $1
      ORDER BY s.scheduled_date, s.start_time NULLS FIRST, u.name`,
    [jobId]
  );
  return rows.map(r => ({
    id: r.id,
    date: dayOf(r.scheduled_date),
    start_time: hhmm(r.start_time),
    end_time: hhmm(r.end_time),
    appointment_type: r.appointment_type || null,
    notes: r.notes || null,
    person: r.person,
    mobile: r.mobile || null,
  }));
}

async function loadTeam(jobId) {
  const { rows } = await pool.query(
    `SELECT u.name, u.mobile FROM job_technicians jt
       JOIN users u ON u.id = jt.user_id
      WHERE jt.job_id = $1 ORDER BY u.name`,
    [jobId]
  );
  return rows;
}

// What the Pre-Install Forms tab is holding. Metadata only — the bytes are
// fetched one at a time when a PDF is actually being built, because a job
// carrying two 17MB ArcSite exports is what ran the server out of memory once
// already.
async function loadFiles(jobId) {
  const { rows } = await pool.query(
    `SELECT id, filename, mime_type, size_bytes, arcsite_drawing_id, created_at
       FROM job_attachments
      WHERE job_id = $1 AND category = 'pre_install'
      ORDER BY arcsite_drawing_id IS NULL, created_at`,
    [jobId]
  );
  return rows.map(r => ({
    id: r.id,
    filename: r.filename,
    mime_type: r.mime_type || '',
    size_bytes: r.size_bytes == null ? null : Number(r.size_bytes),
    is_drawing: !!r.arcsite_drawing_id,
    kind: (r.mime_type || '').includes('pdf') ? 'pdf' : 'image',
  }));
}

const customerAddress = job => [
  job.address_street, job.address_city, job.address_region,
  job.address_postcode, job.address_country,
].filter(Boolean).join(', ');

// A list the caller asked to narrow. Null means they did not — everything
// stays. An empty array is a real choice, and leaves nothing.
function pick(items, ids) {
  if (!Array.isArray(ids)) return items;
  const want = new Set(ids.map(String));
  return items.filter(i => want.has(String(i.id)));
}

// The report, in the same shape the job service report uses, so one set of
// components draws both and they cannot drift into looking like two documents.
//
// `selection` narrows it to one person's copy: which files, which bookings,
// and whether the works list is on it.
async function buildReport(jobId, selection = {}) {
  const job = await loadJob(jobId);
  if (!job) return null;

  const quote = await loadAcceptedQuote(jobId);
  const [theme, works, schedule, team, files] = await Promise.all([
    getThemeForJob(job),
    loadWorks(quote?.id),
    loadSchedule(jobId),
    loadTeam(jobId),
    loadFiles(jobId),
  ]);

  // The scope is what the customer signed, where there is one. A job with no
  // accepted quote falls back to its own description rather than printing an
  // empty heading — and the document says which it is reading.
  const scope = quote?.notes || job.description || '';
  const scopeSource = quote?.notes ? 'quote' : (job.description ? 'job' : null);

  return {
    job: {
      id: job.id,
      number: jobRef(job),
      address: job.site_address_full || job.job_site_address || '',
      site_label: job.site_label || '',
      scope,
      scope_source: scopeSource,
      type: job.type,
      status: job.status,
      priority: job.priority,
      due_date: dayOf(job.due_date),
      contact: job.job_contact || '',
      contact_phone: job.job_contact_mobile || job.job_contact_phone || '',
      lead: [job.lead_tech_name, job.lead_tech_mobile].filter(Boolean).join(' · '),
      materials: job.materials || '',
    },
    customer: {
      name: job.customer_name || '',
      company: job.customer_company || '',
      contact_name: job.customer_contact_name || '',
      email: job.customer_email || '',
      phone: job.customer_phone || job.customer_mobile || '',
      address: customerAddress(job),
    },
    // The same block the public quote page and the service report draw their
    // header from, so all three carry one letterhead.
    company: {
      name: theme.companyName,
      logo: theme.logoBase64,
      logoSize: theme.logoSize,
      logoPosition: theme.logoPosition,
      contactPosition: theme.contactPosition,
      contactDetails: theme.contactDetails,
      gstNumber: theme.gstNumber || '',
      brandColour: theme.brandColour,
      theme_name: theme.name,
    },
    // Kept out of the body the client renders: the PDF builder wants the whole
    // theme, and the logo alone is a large string nobody on screen needs twice.
    _theme: theme,
    quote: quote
      ? {
        accepted_at: quote.accepted_at,
        accepted_name: quote.accepted_name,
        accepted_count: quote.accepted_count,
      }
      : null,
    works: selection.includeWorks ? works : [],
    works_available: works.length,
    team,
    files: pick(files, selection.attachmentIds),
    files_available: files.length,
    schedule: pick(schedule, selection.scheduleIds),
    schedule_available: schedule.length,
    generated_at: new Date().toISOString(),
  };
}

// Everything the office picks from, which is the whole job rather than one
// person's copy of it.
async function buildPicker(jobId) {
  const report = await buildReport(jobId, { includeWorks: true });
  if (!report) return null;
  const [files, schedule] = await Promise.all([loadFiles(jobId), loadSchedule(jobId)]);
  return { ...report, files, schedule };
}

// ── The bytes behind the files ───────────────────────────────────────────────

// pdfkit decodes a PNG asynchronously, inside a zlib callback, and when the
// bytes are bad it throws out of that callback — past the try/catch around
// doc.image(), past the request, and out of the process. One corrupt photo on
// one job could take the server down with it, which a document nobody is
// waiting on has no business doing.
//
// So the image is decoded here first, where a failure is an ordinary rejected
// promise. Resized to a thumbnail on the way through: libvips still has to
// read the whole input to produce it, which is the point, but nothing large
// comes back out.
async function decodes(buffer) {
  if (!buffer || !sharp) return !!buffer;
  try {
    await sharp(buffer, { limitInputPixels: 512 * 1024 * 1024, sequentialRead: true })
      .resize({ width: 8 }).toBuffer();
    return true;
  } catch {
    return false;
  }
}

// Fetched one at a time, by id, rather than selected in a single query: the
// legacy rows keep their bytes in the row itself, and a job carrying two 17MB
// ArcSite exports would hold both in memory at once before anything had been
// shrunk.
async function loadFileBytes(list) {
  const images = [];
  const pdfs = [];
  const skipped = [];
  for (const meta of list) {
    try {
      const { rows: [row] } = await pool.query(
        'SELECT storage_key, data_base64, mime_type FROM job_attachments WHERE id = $1', [meta.id]
      );
      if (!row) { skipped.push(meta.filename); continue; }
      const full = await fileStore.readAttachmentBuffer(row);
      if (meta.kind === 'pdf') {
        pdfs.push({ buffer: full, filename: meta.filename });
        continue;
      }
      const ready = await toPdfImage(await shrinkForPage(full, row.mime_type));
      if (ready && await decodes(ready)) images.push({ buffer: ready, filename: meta.filename });
      else skipped.push(meta.filename);
    } catch (err) {
      // One file nobody can read is worth a line in the log and a mention on
      // the page, not a failed document.
      console.error(`Could not load "${meta.filename}" for the job form:`, err.message);
      skipped.push(meta.filename);
    }
  }
  return { images, pdfs, skipped };
}

// One file, for the page to show. Used by the public endpoint, which is why it
// takes the attachment id and the job together: a token must only ever reach
// files on its own job.
async function readFile(jobId, attachmentId) {
  const { rows: [row] } = await pool.query(
    `SELECT storage_key, data_base64, mime_type, filename
       FROM job_attachments
      WHERE id = $1 AND job_id = $2 AND category = 'pre_install'`,
    [attachmentId, jobId]
  );
  if (!row) return null;
  return { buffer: await fileStore.readAttachmentBuffer(row), mime: row.mime_type, filename: row.filename };
}

// ── Who it can go to ─────────────────────────────────────────────────────────

// The team, and the sub-contractors on file. Anyone without an email address
// is left out rather than listed and then refused on send.
async function recipients() {
  const [{ rows: team }, { rows: subbies }] = await Promise.all([
    pool.query(
      `SELECT id, name, email, role FROM users
        WHERE is_active AND email IS NOT NULL AND email <> '' ORDER BY name`
    ),
    pool.query(
      `SELECT id, name, trade, contact_name, email FROM subcontractors
        WHERE is_active AND email IS NOT NULL AND email <> '' ORDER BY LOWER(name)`
    ),
  ]);
  return {
    team: team.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
    subcontractors: subbies.map(s => ({
      id: s.id, name: s.name, email: s.email,
      trade: s.trade || null, contact_name: s.contact_name || null,
    })),
  };
}

// ── Shares ───────────────────────────────────────────────────────────────────

const shareRow = r => ({
  id: r.id,
  token: r.token,
  path: `/jf/${r.token}`,
  recipient_name: r.recipient_name || '',
  recipient_email: r.recipient_email || '',
  message: r.message || '',
  attachment_ids: r.attachment_ids,     // null means everything
  schedule_ids: r.schedule_ids,
  include_works: r.include_works,
  created_at: r.created_at,
  updated_at: r.updated_at,
  sent_at: r.sent_at,
  created_by_name: r.created_by_name || null,
});

async function listShares(jobId) {
  const { rows } = await pool.query(
    `SELECT s.*, u.name AS created_by_name
       FROM job_form_shares s
       LEFT JOIN users u ON u.id = s.created_by
      WHERE s.job_id = $1 AND s.revoked_at IS NULL
      ORDER BY s.created_at DESC`,
    [jobId]
  );
  return rows.map(shareRow);
}

// An array of ids, or null for "everything". An empty array stays an empty
// array: choosing nothing is a choice, and must not quietly become all of it.
const idList = v => (Array.isArray(v) ? v.filter(Boolean).map(String) : null);

async function createShare(jobId, body, userId) {
  const { rows: [row] } = await pool.query(
    `INSERT INTO job_form_shares
       (job_id, recipient_name, recipient_email, message,
        attachment_ids, schedule_ids, include_works, created_by)
     VALUES ($1,$2,$3,$4,$5::uuid[],$6::uuid[],$7,$8)
     RETURNING *`,
    [jobId, body.recipient_name || null, body.recipient_email || null, body.message || null,
      idList(body.attachment_ids), idList(body.schedule_ids), !!body.include_works, userId || null]
  );
  return shareRow(row);
}

async function updateShare(jobId, shareId, body) {
  const { rows: [row] } = await pool.query(
    `UPDATE job_form_shares SET
       recipient_name  = COALESCE($3, recipient_name),
       recipient_email = COALESCE($4, recipient_email),
       message         = COALESCE($5, message),
       -- These three are the whole point of editing a share, so they are set
       -- rather than coalesced: clearing a selection has to be possible.
       attachment_ids  = $6::uuid[],
       schedule_ids    = $7::uuid[],
       include_works   = $8,
       updated_at      = NOW()
     WHERE id = $2 AND job_id = $1 AND revoked_at IS NULL
     RETURNING *`,
    [jobId, shareId, body.recipient_name ?? null, body.recipient_email ?? null,
      body.message ?? null, idList(body.attachment_ids), idList(body.schedule_ids),
      !!body.include_works]
  );
  return row ? shareRow(row) : null;
}

// Revoked, not deleted: the record of who was sent what outlives the link, and
// the token is never reissued.
async function revokeShare(jobId, shareId) {
  const { rowCount } = await pool.query(
    `UPDATE job_form_shares SET revoked_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND job_id = $2 AND revoked_at IS NULL`,
    [shareId, jobId]
  );
  return rowCount > 0;
}

async function getShare(jobId, shareId) {
  const { rows } = await pool.query(
    `SELECT s.*, u.name AS created_by_name FROM job_form_shares s
       LEFT JOIN users u ON u.id = s.created_by
      WHERE s.id = $1 AND s.job_id = $2 AND s.revoked_at IS NULL`,
    [shareId, jobId]
  );
  return rows[0] ? shareRow(rows[0]) : null;
}

// The same 404 whether a link never existed or has been revoked — there is
// nothing to be learned by guessing tokens.
async function shareByToken(token) {
  const { rows } = await pool.query(
    `SELECT s.*, u.name AS created_by_name FROM job_form_shares s
       LEFT JOIN users u ON u.id = s.created_by
      WHERE s.token = $1 AND s.revoked_at IS NULL`,
    [token]
  );
  if (!rows[0]) return null;
  return { ...shareRow(rows[0]), job_id: rows[0].job_id };
}

async function markSent(shareId) {
  await pool.query('UPDATE job_form_shares SET sent_at = NOW() WHERE id = $1', [shareId]);
}

// What a share's copy of the report should contain.
const selectionOf = share => ({
  attachmentIds: share?.attachment_ids ?? null,
  scheduleIds: share?.schedule_ids ?? null,
  includeWorks: !!share?.include_works,
});

module.exports = {
  buildReport, buildPicker, selectionOf,
  loadFileBytes, readFile, recipients,
  listShares, createShare, updateShare, revokeShare, getShare, shareByToken, markSent,
  dayOf, hhmm, jobRef,
};
