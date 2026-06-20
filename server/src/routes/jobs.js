const express = require('express');
const router = express.Router();
const c = require('../controllers/jobController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

router.get('/', c.list);
router.post('/', requireRole('admin', 'office'), c.create);
router.get('/:id', c.get);
router.put('/:id', requireRole('admin', 'office'), c.update);
router.patch('/:id/status', requireRole('admin', 'office'), c.updateStatus);
router.delete('/:id', requireRole('admin'), c.remove);

// Line items
router.put('/:id/line-items', requireRole('admin', 'office'), c.updateLineItems);

// Notes
router.get('/:id/notes', c.listNotes);
router.post('/:id/notes', c.createNote);
router.delete('/:id/notes/:noteId', requireRole('admin', 'office'), c.deleteNote);

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

// Attachments (photos from site)
const pool = require('../db/pool');
router.get('/:id/attachments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.filename, a.mime_type, a.created_at, u.name AS uploader_name
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

module.exports = router;
