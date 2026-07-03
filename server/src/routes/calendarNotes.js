const express = require('express');
const router = express.Router();
const c = require('../controllers/calendarNoteController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

router.get('/', c.list);
router.post('/', requireRole('admin', 'office'), c.create);
router.delete('/:id', requireRole('admin', 'office'), c.remove);

module.exports = router;
