// Everything a subcontractor needs to do the job, and nothing about what it
// is worth.
//
// The office was assembling this by hand: open the job, copy the customer's
// details into an email, copy the address, remember which day the sparky is
// booked, then forward three separate photos and a plan as separate
// attachments. The subbie got four emails and still rang to ask where the
// site was.
//
// So: one document. The customer, the site, the job, the scope off the
// accepted quote, the days and times the diary says people are booked, and
// every photo, plan and PDF held against the job's Pre-Install Forms tab,
// merged in behind it.
//
// What it deliberately leaves out is money. No unit prices, no totals, no
// quote number, no terms of sale, no payment terms. That is not a filter
// applied at the end — the queries below never ask for a price in the first
// place, so there is no figure in hand to leak into the document by accident.
const pool = require('../db/pool');
const fileStore = require('./fileStore');
const { shrinkForPage } = require('../utils/imageForPrint');
const { toPdfImage } = require('../utils/pdfImage');

// sharp, used only to prove an image can be decoded at all. Optional, the
// same way it is everywhere else here: without it the check is skipped rather
// than the document failing.
let sharp = null;
try { sharp = require('sharp'); } catch { /* checked below */ }

// Bytes pdfkit can be trusted with.
//
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

const pad = n => String(n).padStart(2, '0');

// A DATE column comes back from pg as a JS Date at local midnight, and a
// string from anything that has already been through JSON. Either way what is
// wanted is the calendar day Postgres is holding, never an instant shifted by
// the server's zone — the server runs in UTC and the business is in Auckland.
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

function customerAddress(job) {
  return [job.customer_address_street, job.customer_address_city,
    job.customer_address_region, job.customer_address_postcode]
    .filter(Boolean).join(', ');
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
            c.address_street AS customer_address_street, c.address_city AS customer_address_city,
            c.address_region AS customer_address_region, c.address_postcode AS customer_address_postcode,
            cs.address AS site_address, cs.label AS site_label,
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

// The works list: what is being installed and how many, with no column for
// what any of it costs. Selecting only description and quantity is the
// guardrail — a future edit here cannot put a price on the page without
// somebody deliberately adding unit_price to this query.
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
// Every booking on the job is listed, not only the ones typed 'operations':
// a booking left untyped is still a day somebody is expected on site, and
// leaving it off is how a subbie turns up alone. The type travels with each
// row so the document can mark the ones that aren't an install.
async function loadSchedule(jobId) {
  const { rows } = await pool.query(
    `SELECT s.scheduled_date, s.start_time, s.end_time, s.appointment_type, s.notes,
            u.name AS person, u.mobile
       FROM schedules s
       JOIN users u ON u.id = s.user_id
      WHERE s.job_id = $1
      ORDER BY s.scheduled_date, s.start_time NULLS FIRST, u.name`,
    [jobId]
  );
  return rows.map(r => ({
    date: dayOf(r.scheduled_date),
    start_time: hhmm(r.start_time),
    end_time: hhmm(r.end_time),
    appointment_type: r.appointment_type || null,
    notes: r.notes || null,
    person: r.person,
    mobile: r.mobile || null,
  }));
}

// Grouped by day, because that is how it gets read: "who is on site Tuesday".
function byDay(bookings) {
  const days = new Map();
  for (const b of bookings) {
    if (!days.has(b.date)) days.set(b.date, []);
    days.get(b.date).push(b);
  }
  return [...days.entries()].map(([date, people]) => ({ date, people }));
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
async function loadAttachmentList(jobId) {
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

// Who the pack can be sent to: the team, and the sub-contractors on file.
// Anyone without an email address is left out rather than listed and then
// refused on send.
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

// When this job's pack last went out, and to whom.
async function lastSent(jobId) {
  const { rows } = await pool.query(
    `SELECT recipient, sent_at FROM email_log
      WHERE job_id = $1 AND type = 'job_pack'
      ORDER BY sent_at DESC LIMIT 1`,
    [jobId]
  );
  return rows[0] || null;
}

// Everything the document and the panel that offers it both need.
async function gather(jobId) {
  const job = await loadJob(jobId);
  if (!job) return null;
  const quote = await loadAcceptedQuote(jobId);
  const [works, schedule, team, attachments] = await Promise.all([
    loadWorks(quote?.id),
    loadSchedule(jobId),
    loadTeam(jobId),
    loadAttachmentList(jobId),
  ]);
  return {
    job: { ...job, ref: jobRef(job), customer_postal: customerAddress(job) },
    quote,
    works,
    schedule,
    schedule_days: byDay(schedule),
    team,
    attachments,
  };
}

// The bytes behind those files, ready for the page.
//
// Fetched one at a time, by id, rather than selected in a single query: the
// legacy rows keep their bytes in the row itself, and a job carrying two 17MB
// ArcSite exports would hold both in memory at once before anything had been
// shrunk. Images are scaled to what an A4 page can show and converted to
// something pdfkit will actually draw; PDFs pass through whole to be merged.
async function loadAttachmentFiles(jobId) {
  const list = await loadAttachmentList(jobId);
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

module.exports = {
  gather, recipients, lastSent, loadAttachmentFiles, dayOf, hhmm, jobRef, byDay,
};
