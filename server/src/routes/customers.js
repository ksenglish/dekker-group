const express = require('express');
const router = express.Router();
const c = require('../controllers/customerController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

router.get('/lead-sources', c.getLeadSources);
router.post('/lead-sources', requireRole('admin', 'office'), c.addLeadSource);

router.get('/', c.list);
router.post('/', requireRole('admin', 'office'), c.create);
router.post('/import', requireRole('admin', 'office'), c.importCsv);
router.get('/:id', c.get);
router.put('/:id', requireRole('admin'), c.update);
router.delete('/:id', requireRole('admin'), c.remove);

// Sites
router.get('/:id/sites', c.listSites);
router.post('/:id/sites', requireRole('admin', 'office'), c.createSite);
router.put('/:id/sites/:siteId', requireRole('admin', 'office'), c.updateSite);
router.delete('/:id/sites/:siteId', requireRole('admin', 'office'), c.deleteSite);

// Notes
router.get('/:id/notes', c.listNotes);
router.post('/:id/notes', c.createNote);
router.delete('/:id/notes/:noteId', requireRole('admin', 'office'), c.deleteNote);

// Email history
router.get('/:id/emails', requireRole('admin', 'office'), async (req, res) => {
  try {
    const pool = require('../db/pool');
    const { rows } = await pool.query(
      `SELECT e.*, j.job_number FROM email_log e
       LEFT JOIN jobs j ON j.id = e.job_id
       WHERE e.customer_id=$1 ORDER BY e.sent_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
