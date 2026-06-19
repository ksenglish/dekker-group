const express = require('express');
const router = express.Router();
const c = require('../controllers/scheduleController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

router.get('/', c.list);
router.post('/', requireRole('admin', 'office'), c.create);
router.put('/:id', requireRole('admin', 'office'), c.update);
router.delete('/:id', requireRole('admin', 'office'), c.remove);

// Quick reschedule a job's due_date via drag
router.patch('/jobs/:jobId/reschedule', requireRole('admin', 'office'), c.reschedule);

module.exports = router;
