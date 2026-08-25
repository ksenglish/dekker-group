const express = require('express');
const router = express.Router();
const c = require('../controllers/jobController');
const { importTradify, backfillTradifyTime } = require('../controllers/importController');
const { authenticate, requireRole, authenticateAutomation } = require('../middleware/auth');
const arcsite = require('../utils/arcsite');
const { normaliseImageDataUrl, normaliseFilename } = require('../utils/normaliseUpload');
const { htmlToText } = require('../utils/sanitizeHtml');
const fileStore = require('../services/fileStore');

// Automation endpoint — accepts X-API-Key or user JWT
router.get('/by-number/:number', authenticateAutomation, async (req, res) => {
  try {
    const pool = require('../db/pool');
    // Strip optional "JB" prefix and leading zeros to get the integer
    const num = parseInt(req.params.number.replace(/^[A-Za-z]+0*/,''), 10);
    if (isNaN(num)) return res.status(400).json({ error: 'Invalid job number' });
    // Match either the new sequential job_number (integer) or the original
    // Tradify external_ref (stored as e.g. "JB00867")
    const rawRef = req.params.number.toUpperCase();
    const { rows } = await pool.query(
      `SELECT j.id, j.job_number, j.description AS title, j.status,
              c.name AS customer_name
       FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id
       WHERE j.job_number = $1 OR j.external_ref = $2`,
      [num, rawRef]
    );
    if (!rows[0]) return res.status(404).json({ error: `No job found with number ${req.params.number}` });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Automation: post cost items + PDF to a job (accepts X-API-Key or user JWT).
// Must be declared before router.use(authenticate) so the global middleware
// doesn't block API-key requests before authenticateAutomation can check them.
router.post('/:id/costs', authenticateAutomation, async (req, res) => {
  const { items, document_base64, mime_type, gst_treatment } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required' });
  try {
    let scanId = null;
    if (document_base64) {
      const stored = await fileStore.storeDataUrl({
        prefix: `cost-scans/${req.params.id}`, filename: 'invoice', dataUrl: document_base64,
      });
      const { rows: [scan] } = await pool.query(
        `INSERT INTO job_cost_scans (job_id, document_base64, mime_type, gst_treatment, status, storage_key, size_bytes)
         VALUES ($1,$2,$3,$4,'matched',$5,$6) RETURNING id`,
        [req.params.id, stored ? null : document_base64, mime_type || 'image/jpeg',
         gst_treatment || 'exclusive', stored?.key || null, stored?.size || null]
      );
      scanId = scan.id;
    }
    const inserted = [];
    for (let i = 0; i < items.length; i++) {
      const { description, quantity, unit_price } = items[i];
      const { rows: [row] } = await pool.query(
        `INSERT INTO job_costs (job_id, scan_id, description, quantity, unit_price, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.params.id, scanId, description, quantity || 1, Math.round((unit_price || 0) * 100), i]
      );
      inserted.push(row);
    }
    res.status(201).json({ items: inserted, scan_id: scanId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.use(authenticate);

// Geocode an address using Nominatim (OpenStreetMap) — free, no API key required
router.post('/geocode', requireRole('admin', 'office'), async (req, res) => {
  const { address, site_id } = req.body;
  if (!address) return res.status(400).json({ error: 'address required' });
  try {
    const pool = require('../db/pool');
    const https = require('https');
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=nz`;
    const data = await new Promise((resolve, reject) => {
      https.get(url, {
        headers: { 'User-Agent': 'DekkerGroupApp/1.0 (kyle@dekkergroup.co.nz)' }
      }, r => {
        let body = '';
        r.on('data', d => body += d);
        r.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });
    if (!data[0]) return res.status(404).json({ error: 'Address not found' });
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    if (site_id) {
      await pool.query('UPDATE customer_sites SET lat=$1, lng=$2 WHERE id=$3', [lat, lng, site_id]);
    }
    res.json({ lat, lng, formatted: data[0].display_name });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Geocode failed' }); }
});

// Bulk import jobs from a Tradify CSV export (admin only)
router.post('/import/tradify', requireRole('admin'), importTradify);
// Converts jobs.time_log into timesheet entries for jobs imported before the
// importer did that itself. ?dryRun=true reports without writing.
router.post('/import/tradify-time', requireRole('admin'), backfillTradifyTime);

// The sweep runs hourly on its own. This is here so it can be run on demand
// rather than waiting an hour to see whether it does what was intended, and so
// a run can be forced after the pipeline's statuses are renamed.
router.post('/maintenance/site-visit-sweep', requireRole('admin'), async (req, res) => {
  try {
    const result = await require('../services/siteVisitSweep').runSiteVisitSweep();
    res.json({
      moved: result.moved.map(j => j.job_number),
      count: result.moved.length,
      skipped: result.skipped || null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', c.list);
router.post('/', requireRole('admin', 'office'), c.create);
// Must stay above '/:id' or it gets read as a job id.
router.get('/notify-targets', c.getNotifyTargets);
router.get('/:id', c.get);
router.put('/:id', requireRole('admin'), c.update);
router.patch('/:id/status', requireRole('admin', 'office'), c.updateStatus);
router.delete('/:id', requireRole('admin'), c.remove);

// Line items
router.put('/:id/line-items', requireRole('admin', 'office'), c.updateLineItems);

// Notes
router.get('/:id/notes', c.listNotes);
router.post('/:id/notes', c.createNote);
// No requireRole — the controller restricts editing to the note's own author,
// which includes field techs editing what they wrote on site.
router.put('/:id/notes/:noteId', c.updateNote);
router.delete('/:id/notes/:noteId', requireRole('admin', 'office'), c.deleteNote);

// Op Form — completed by whoever's on site, so any authenticated team member can fill it in
router.get('/:id/op-form', c.getOpForm);
router.put('/:id/op-form', c.saveOpForm);

// Electrical Certificate of Compliance — anyone onsite can complete it; once
// it exists, editing is Admin-or-original-completer (checked in the
// controller since it depends on row ownership, not just role); deleting is
// Admin only.
router.get('/:id/quote-delivery', c.getQuoteDelivery);
// Admin-built forms attached to this job (the Electrical COC below is separate
// — it's a statutory certificate with its own table and PDF)
const jobForms = require('../controllers/jobFormController');
router.get('/:id/forms', jobForms.list);
router.post('/:id/forms', requireRole('admin', 'office'), jobForms.attach);
router.put('/:id/forms/:submissionId', jobForms.save);
router.delete('/:id/forms/:submissionId', requireRole('admin', 'office'), jobForms.remove);

router.get('/:id/electrical-coc', c.getElectricalCoc);
router.put('/:id/electrical-coc', c.saveElectricalCoc);
router.delete('/:id/electrical-coc', c.deleteElectricalCoc);
router.get('/:id/electrical-coc/pdf', c.downloadElectricalCocPdf);
router.post('/:id/electrical-coc/email', c.emailElectricalCoc);

// Email customer from job
router.post('/:id/email', requireRole('admin', 'office'), async (req, res) => {
  try {
    const pool = require('../db/pool');
    const { sendMail } = require('../utils/email');
    const { logActivity } = require('../utils/activity');
    const { subject, body } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'subject and body are required' });
    const { rows: [job] } = await pool.query(
      `SELECT j.*, c.email AS customer_email, c.name AS customer_name
       FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id WHERE j.id=$1`,
      [req.params.id]
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.customer_email) return res.status(400).json({ error: 'Customer has no email address' });
    await sendMail({ to: job.customer_email, subject, html: body.replace(/\n/g, '<br>'), text: body });
    await pool.query(
      `INSERT INTO email_log (customer_id, job_id, type, recipient) VALUES ($1,$2,'job_email',$3)`,
      [job.customer_id, job.id, job.customer_email]
    );
    await logActivity({ type: 'email_sent', entity_type: 'job', entity_id: job.id, user_id: req.user.id,
      message: `Email sent to ${job.customer_name} re Job #${job.job_number}` });
    res.json({ message: 'Email sent' });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Failed to send email' }); }
});

// ── ArcSite integration ──────────────────────────────────────────────────────

function formatJobNumber(job) {
  if (job.external_ref) return job.external_ref;
  if (job.job_number != null && job.job_number !== '') return 'JB' + String(job.job_number).padStart(5, '0');
  return '';
}

// Push this job + its customer to ArcSite as a Project (creates on first call, updates thereafter)
router.post('/:id/arcsite-sync', requireRole('admin', 'office'), async (req, res) => {
  try {
    const pool = require('../db/pool');
    // site_address comes from the linked customer_sites row (matching how the
    // rest of the app resolves it) — the raw jobs.site_address column is only
    // ever populated by the Tradify CSV importer and is null otherwise.
    const { rows: [job] } = await pool.query(
      `SELECT j.*, s.address AS site_address
       FROM jobs j LEFT JOIN customer_sites s ON s.id = j.site_id
       WHERE j.id=$1`,
      [req.params.id]
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.customer_id) return res.status(400).json({ error: 'Job must have a customer before syncing to ArcSite' });

    const { rows: [customer] } = await pool.query('SELECT * FROM customers WHERE id=$1', [job.customer_id]);

    const jobNumber = formatJobNumber(job);
    const project = {
      name: job.site_address ? `${jobNumber} - ${job.site_address}` : (htmlToText(job.description) || `Job ${jobNumber}`),
      owner: process.env.ARCSITE_OWNER_EMAIL,
      job_number: jobNumber,
      customer: {
        name: customer?.name,
        phone: customer?.phone,
        second_phone: customer?.mobile,
        email: customer?.email,
        address: {
          street: customer?.address_street,
          city: customer?.address_city,
          state: customer?.address_region,
          zip_code: customer?.address_postcode,
        },
      },
      sales_rep: {
        name: req.user.name,
        email: req.user.email,
      },
    };

    const result = await arcsite.createOrUpdateProject(project, job.arcsite_project_id);
    if (!job.arcsite_project_id) {
      await pool.query('UPDATE jobs SET arcsite_project_id=$1, updated_at=NOW() WHERE id=$2', [result.id, job.id]);
    }
    res.json({ arcsite_project_id: result.id, name: result.name });
  } catch (err) {
    console.error('ArcSite sync failed:', err);
    res.status(502).json({ error: err.message || 'Failed to sync with ArcSite' });
  }
});

// With a bucket configured a drawing is just a file and its size stops being
// interesting — 50MB is a sanity check, not a real ceiling. Without one the
// bytes still go into the database as base64, where a big drawing is a very
// large single statement: a 17MB export took every connection down at once,
// which is Postgres restarting rather than a socket dropping. So the old limits
// still apply on that path, including swapping an oversized PNG for the PDF of
// the same drawing — these are vector drawings, so the PDF is usually far
// smaller than a rendered image of one.
const SOFT_DRAWING_BYTES = 4 * 1024 * 1024;
const MAX_DRAWING_DB_BYTES = 8 * 1024 * 1024;
const MAX_DRAWING_BYTES = 50 * 1024 * 1024;

const asMb = bytes => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

// A connection can be dropped between being handed out and being used — the far
// end closed it and the socket had no way to say so. That failure lands on the
// first query, so retrying it once on a fresh client is enough; a second
// failure is a real one and is left to the caller.
const DROPPED_CONNECTION = /Connection terminated|ECONNRESET|EPIPE|server closed the connection/i;

async function queryRetryingDroppedConnection(pool, text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    if (!DROPPED_CONNECTION.test(err.message || '')) throw err;
    console.warn('Database connection was dropped, retrying once:', err.message);
    // If every connection went at once the database is coming back up, and an
    // immediate retry just lands on a server that is not listening yet.
    await new Promise(resolve => setTimeout(resolve, 2000));
    return pool.query(text, params);
  }
}

// Pull every drawing currently on this job's ArcSite project into job_attachments
router.post('/:id/arcsite-pull-drawings', requireRole('admin', 'office'), async (req, res) => {
  try {
    const pool = require('../db/pool');
    const { rows: [job] } = await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.arcsite_project_id) return res.status(400).json({ error: 'Send this job to ArcSite first' });

    const drawings = await arcsite.listProjectDrawings(job.arcsite_project_id);
    const pulled = [];
    const skipped = [];

    for (const summary of drawings) {
      try {
        const drawing = await arcsite.getDrawing(summary.id);
        const label = drawing.name || summary.name || summary.id;
        // Prefer the image (PNG) so it can be viewed inline in the app and
        // merged straight into the quote PDF, same as product brochures.
        if (!drawing.png_url && !drawing.pdf_url) {
          skipped.push(`${label} (not ready yet — try again shortly)`);
          continue;
        }

        // Trust which endpoint we called, not the CDN's Content-Type header —
        // ArcSite's asset URLs don't reliably report it, which was causing
        // PNG drawings to be stored with the wrong mime type.
        let isPng = !!drawing.png_url;
        let { buffer } = await arcsite.downloadFile(isPng ? drawing.png_url : drawing.pdf_url);
        console.log(`ArcSite drawing "${label}": ${isPng ? 'PNG' : 'PDF'} ${asMb(buffer.length)}`);

        // Only worth trading resolution for size when the bytes have to fit in
        // a database column.
        if (!fileStore.isConfigured() && isPng && buffer.length > SOFT_DRAWING_BYTES && drawing.pdf_url) {
          const pdf = await arcsite.downloadFile(drawing.pdf_url);
          console.log(`ArcSite drawing "${label}": PNG too large, PDF is ${asMb(pdf.buffer.length)}`);
          // Only worth taking if it is actually smaller — a raster-heavy drawing
          // can export to a PDF that just wraps the same image.
          if (pdf.buffer.length < buffer.length) {
            buffer = pdf.buffer;
            isPng = false;
          }
        }

        const ceiling = fileStore.isConfigured() ? MAX_DRAWING_BYTES : MAX_DRAWING_DB_BYTES;
        if (buffer.length > ceiling) {
          skipped.push(`${label} (${asMb(buffer.length)} — too large to store)`);
          continue;
        }

        const contentType = isPng ? 'image/png' : 'application/pdf';
        const ext = isPng ? 'png' : 'pdf';
        const filename = `${drawing.name || 'Drawing'}.${ext}`;

        // The bucket holds the bytes where it can; the row keeps the record.
        const storageKey = fileStore.isConfigured()
          ? await fileStore.putObject({ prefix: `jobs/${job.id}/drawings`, filename, buffer, contentType })
          : null;
        const dataUrl = storageKey ? null : `data:${contentType};base64,${buffer.toString('base64')}`;

        // Re-pulling a drawing replaces the row, which would leave the file it
        // used to point at orphaned in the bucket. The old key has to be read
        // before the upsert overwrites it.
        const { rows: [existing] } = await pool.query(
          'SELECT storage_key FROM job_attachments WHERE job_id=$1 AND arcsite_drawing_id=$2',
          [job.id, drawing.id]
        );

        await queryRetryingDroppedConnection(
          pool,
          `INSERT INTO job_attachments
             (job_id, uploaded_by, filename, mime_type, data_base64, arcsite_drawing_id, storage_key, size_bytes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (job_id, arcsite_drawing_id) WHERE arcsite_drawing_id IS NOT NULL DO UPDATE
             SET filename=EXCLUDED.filename, mime_type=EXCLUDED.mime_type,
                 data_base64=EXCLUDED.data_base64, storage_key=EXCLUDED.storage_key,
                 size_bytes=EXCLUDED.size_bytes, created_at=NOW()`,
          [job.id, req.user.id, filename, contentType, dataUrl, drawing.id, storageKey, buffer.length]
        );
        if (existing?.storage_key && existing.storage_key !== storageKey) {
          await fileStore.deleteObject(existing.storage_key);
        }
        pulled.push(filename);
      } catch (err) {
        console.error('ArcSite drawing pull failed for', summary.id, err);
        // "Connection terminated unexpectedly" means nothing to whoever clicked
        // the button, and it reads like the drawing is broken when it isn't.
        const reason = DROPPED_CONNECTION.test(err.message || '')
          ? 'lost the database connection — try again'
          : err.message;
        skipped.push(`${summary.name || summary.id} (${reason})`);
      }
    }

    res.json({ pulled, skipped });
  } catch (err) {
    console.error('ArcSite pull-drawings failed:', err);
    res.status(502).json({ error: err.message || 'Failed to pull drawings from ArcSite' });
  }
});

// Attachments (photos from site)
const pool = require('../db/pool');
// ?category=pre_install|post_install narrows to one tab's photos. Omitted
// returns everything, which is what the quote attachment picker wants.
router.get('/:id/attachments', async (req, res) => {
  const { category } = req.query;
  const params = [req.params.id];
  let filter = '';
  if (category === 'pre_install' || category === 'post_install') {
    params.push(category);
    filter = ' AND a.category = $2';
  }
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.filename, a.mime_type, a.created_at, a.arcsite_drawing_id, a.category, u.name AS uploader_name
       FROM job_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.job_id=$1${filter} ORDER BY a.created_at DESC`,
      params
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.get('/:id/attachments/:attId/data', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM job_attachments WHERE id=$1 AND job_id=$2', [req.params.attId, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    // Bytes live in the bucket for anything stored since that was set up, and
    // in the row itself for everything before it.
    const buf = await fileStore.readAttachmentBuffer(rows[0]);
    res.set('Content-Type', rows[0].mime_type || 'image/jpeg');
    res.set('Content-Disposition', `inline; filename="${rows[0].filename}"`);
    res.send(buf);
  } catch (err) {
    console.error('Attachment read failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});
router.post('/:id/attachments', async (req, res) => {
  const { filename, mime_type, data_base64, category } = req.body;
  if (!data_base64 || !filename) return res.status(400).json({ error: 'filename and data_base64 required' });
  try {
    // iPhone HEICs arrive uncompressed — no browser outside Safari can decode
    // them, so the client couldn't downscale them. Converted to JPEG here.
    const normalised = await normaliseImageDataUrl(data_base64);
    const storedDataUrl = normalised.dataUrl;
    const storedName = normaliseFilename(filename, normalised.converted);
    const contentType = normalised.mimeType || mime_type || 'image/jpeg';
    const buffer = Buffer.from(fileStore.stripDataUrl(storedDataUrl), 'base64');
    const storageKey = fileStore.isConfigured()
      ? await fileStore.putObject({ prefix: `jobs/${req.params.id}/photos`, filename: storedName, buffer, contentType })
      : null;

    const { rows } = await pool.query(
      `INSERT INTO job_attachments
         (job_id, uploaded_by, filename, mime_type, data_base64, category, storage_key, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, filename, mime_type, created_at, category`,
      [req.params.id, req.user.id, storedName, contentType, storageKey ? null : storedDataUrl,
       category === 'post_install' ? 'post_install' : 'pre_install', storageKey, buffer.length]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Attachment upload failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});
router.delete('/:id/attachments/:attId', async (req, res) => {
  try {
    // Delete the row first — the record disappearing is what the user asked
    // for, and a file left in the bucket is a tidy-up rather than a failure.
    const { rows } = await pool.query(
      'DELETE FROM job_attachments WHERE id=$1 AND job_id=$2 RETURNING storage_key',
      [req.params.attId, req.params.id]
    );
    if (rows[0]?.storage_key) await fileStore.deleteObject(rows[0].storage_key);
    res.json({ message: 'Deleted' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── Job Costs ─────────────────────────────────────────────────────────────────

router.get('/:id/costs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, s.gst_treatment, s.created_at AS scan_date
       FROM job_costs c
       LEFT JOIN job_cost_scans s ON s.id = c.scan_id
       WHERE c.job_id=$1 ORDER BY c.created_at, c.sort_order`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


router.delete('/:id/costs/:costId', async (req, res) => {
  try {
    await pool.query('DELETE FROM job_costs WHERE id=$1 AND job_id=$2', [req.params.costId, req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/cost-scans', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, job_id, mime_type, gst_treatment, created_at FROM job_cost_scans WHERE job_id=$1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/cost-scans/:scanId/document', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT document_base64, storage_key, mime_type FROM job_cost_scans WHERE id=$1 AND job_id=$2',
      [req.params.scanId, req.params.id]
    );
    if (!rows[0] || (!rows[0].document_base64 && !rows[0].storage_key)) {
      return res.status(404).json({ error: 'Not found' });
    }
    const buf = await fileStore.readBytes({ key: rows[0].storage_key, inline: rows[0].document_base64 });
    res.set('Content-Type', rows[0].mime_type || 'image/jpeg');
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
