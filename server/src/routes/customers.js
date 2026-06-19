const express = require('express');
const router = express.Router();
const c = require('../controllers/customerController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

router.get('/', c.list);
router.post('/', requireRole('admin', 'office'), c.create);
router.post('/import', requireRole('admin', 'office'), c.importCsv);
router.get('/:id', c.get);
router.put('/:id', requireRole('admin', 'office'), c.update);
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

module.exports = router;
