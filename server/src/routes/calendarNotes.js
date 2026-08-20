const express = require('express');
const router = express.Router();
const c = require('../controllers/calendarNoteController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

router.get('/', c.list);
router.post('/', requireRole('admin', 'office'), c.create);
router.put('/:id', requireRole('admin', 'office'), c.update);
router.post('/:id/exclude', requireRole('admin', 'office'), c.excludeOccurrence);
// Edits one day of a repeating note, leaving the rest of the series alone.
router.put('/:id/occurrence', requireRole('admin', 'office'), c.updateOccurrence);
router.delete('/:id', requireRole('admin', 'office'), c.remove);

module.exports = router;
