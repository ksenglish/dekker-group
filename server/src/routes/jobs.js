const express = require('express');
const router = express.Router();
const c = require('../controllers/jobController');
const { importTradify } = require('../controllers/importController');
const { authenticate, requireRole, authenticateAutomation } = require('../middleware/auth');
const arcsite = require('../utils/arcsite');
const { htmlToText } = require('../utils/sanitizeHtml');

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
      const { rows: [scan] } = await pool.query(
        `INSERT INTO job_cost_scans (job_id, document_base64, mime_type, gst_treatment, status)
         VALUES ($1,$2,$3,$4,'matched') RETURNING id`,
        [req.params.id, document_base64, mime_type || 'image/jpeg', gst_treatment || 'exclusive']
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

router.get('/', c.list);
router.post('/', requireRole('admin', 'office'), c.create);
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

// Drawings are stored inline as base64, which makes a big drawing a big single
// statement — and base64 adds a third on top of the file itself. A managed
// database on a small instance does not survive that: one oversized insert took
// every connection in the pool down at once, which is a Postgres restart, not a
// dropped socket.
//
// So a PNG over the soft limit is swapped for the PDF of the same drawing.
// These are vector drawings, so the PDF is usually far smaller than a rendered
// image of it, and a PDF attachment is already a path the app handles — it is
// what a drawing with no PNG has always stored. Past the hard limit nothing is
// worth attempting and the drawing is skipped with its size, so the number is
// visible rather than guessed at.
const SOFT_DRAWING_BYTES = 4 * 1024 * 1024;
const MAX_DRAWING_BYTES = 8 * 1024 * 1024;

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

        if (isPng && buffer.length > SOFT_DRAWING_BYTES && drawing.pdf_url) {
          const pdf = await arcsite.downloadFile(drawing.pdf_url);
          console.log(`ArcSite drawing "${label}": PNG too large, PDF is ${asMb(pdf.buffer.length)}`);
          // Only worth taking if it is actually smaller — a raster-heavy drawing
          // can export to a PDF that just wraps the same image.
          if (pdf.buffer.length < buffer.length) {
            buffer = pdf.buffer;
            isPng = false;
          }
        }

        if (buffer.length > MAX_DRAWING_BYTES) {
          skipped.push(`${label} (${asMb(buffer.length)} — too large to store)`);
          continue;
        }

        const contentType = isPng ? 'image/png' : 'application/pdf';
        const ext = isPng ? 'png' : 'pdf';
        const filename = `${drawing.name || 'Drawing'}.${ext}`;
        const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;

        await queryRetryingDroppedConnection(
          pool,
          `INSERT INTO job_attachments (job_id, uploaded_by, filename, mime_type, data_base64, arcsite_drawing_id)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (job_id, arcsite_drawing_id) WHERE arcsite_drawing_id IS NOT NULL DO UPDATE
             SET filename=EXCLUDED.filename, mime_type=EXCLUDED.mime_type,
                 data_base64=EXCLUDED.data_base64, created_at=NOW()`,
          [job.id, req.user.id, filename, contentType, dataUrl, drawing.id]
        );
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
    const buf = Buffer.from(rows[0].data_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    res.set('Content-Type', rows[0].mime_type || 'image/jpeg');
    res.set('Content-Disposition', `inline; filename="${rows[0].filename}"`);
    res.send(buf);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.post('/:id/attachments', async (req, res) => {
  const { filename, mime_type, data_base64, category } = req.body;
  if (!data_base64 || !filename) return res.status(400).json({ error: 'filename and data_base64 required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO job_attachments (job_id, uploaded_by, filename, mime_type, data_base64, category)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, filename, mime_type, created_at, category`,
      [req.params.id, req.user.id, filename, mime_type || 'image/jpeg', data_base64,
       category === 'post_install' ? 'post_install' : 'pre_install']
    );
    res.status(201).json(rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.delete('/:id/attachments/:attId', async (req, res) => {
  try {
    await pool.query('DELETE FROM job_attachments WHERE id=$1 AND job_id=$2', [req.params.attId, req.params.id]);
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
      'SELECT document_base64, mime_type FROM job_cost_scans WHERE id=$1 AND job_id=$2',
      [req.params.scanId, req.params.id]
    );
    if (!rows[0] || !rows[0].document_base64) return res.status(404).json({ error: 'Not found' });
    const buf = Buffer.from(rows[0].document_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    res.set('Content-Type', rows[0].mime_type || 'image/jpeg');
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
