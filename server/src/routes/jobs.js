const express = require('express');
const router = express.Router();
const c = require('../controllers/jobController');
const { importTradify } = require('../controllers/importController');
const { authenticate, requireRole, authenticateAutomation } = require('../middleware/auth');
const arcsite = require('../utils/arcsite');

// Automation endpoint — accepts X-API-Key or user JWT
router.get('/by-number/:number', authenticateAutomation, async (req, res) => {
  try {
    const pool = require('../db/pool');
    // Strip optional "JB" prefix and leading zeros to get the integer
    const num = parseInt(req.params.number.replace(/^[A-Za-z]+0*/,''), 10);
    if (isNaN(num)) return res.status(400).json({ error: 'Invalid job number' });
    const { rows } = await pool.query(
      `SELECT j.id, j.job_number, j.title, j.status,
              c.name AS customer_name
       FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id
       WHERE j.job_number = $1`,
      [num]
    );
    if (!rows[0]) return res.status(404).json({ error: `No job found with number ${req.params.number}` });
    res.json(rows[0]);
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
router.delete('/:id/notes/:noteId', requireRole('admin', 'office'), c.deleteNote);

// Op Form — completed by whoever's on site, so any authenticated team member can fill it in
router.get('/:id/op-form', c.getOpForm);
router.put('/:id/op-form', c.saveOpForm);

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
      name: job.site_address ? `${jobNumber} - ${job.site_address}` : (job.description || `Job ${jobNumber}`),
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
        // Prefer the image (PNG) so it can be viewed inline in the app and
        // merged straight into the quote PDF, same as product brochures.
        const fileUrl = drawing.png_url || drawing.pdf_url;
        if (!fileUrl) { skipped.push(`${drawing.name} (not ready yet — try again shortly)`); continue; }

        // Trust which endpoint we called, not the CDN's Content-Type header —
        // ArcSite's asset URLs don't reliably report it, which was causing
        // PNG drawings to be stored with the wrong mime type.
        const { buffer } = await arcsite.downloadFile(fileUrl);
        const isPng = !!drawing.png_url;
        const contentType = isPng ? 'image/png' : 'application/pdf';
        const ext = isPng ? 'png' : 'pdf';
        const filename = `${drawing.name || 'Drawing'}.${ext}`;
        const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;

        await pool.query(
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
        skipped.push(`${summary.name || summary.id} (${err.message})`);
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
router.get('/:id/attachments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.filename, a.mime_type, a.created_at, a.arcsite_drawing_id, u.name AS uploader_name
       FROM job_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.job_id=$1 ORDER BY a.created_at DESC`,
      [req.params.id]
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
  const { filename, mime_type, data_base64 } = req.body;
  if (!data_base64 || !filename) return res.status(400).json({ error: 'filename and data_base64 required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO job_attachments (job_id, uploaded_by, filename, mime_type, data_base64)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, filename, mime_type, created_at`,
      [req.params.id, req.user.id, filename, mime_type || 'image/jpeg', data_base64]
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

router.post('/:id/costs', authenticateAutomation, async (req, res) => {
  const { items, document_base64, mime_type, gst_treatment } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required' });
  try {
    let scanId = null;
    if (document_base64) {
      const { rows: [scan] } = await pool.query(
        `INSERT INTO job_cost_scans (job_id, document_base64, mime_type, gst_treatment)
         VALUES ($1,$2,$3,$4) RETURNING id`,
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
