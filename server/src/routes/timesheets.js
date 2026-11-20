const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/timesheetController');

router.use(authenticate);
// Timers running right now. Declared before '/:id' so neither is mistaken
// for the other.
router.get('/timers', c.listTimers);
router.post('/timer', c.startTimer);
router.delete('/timer', c.stopTimer);
// Somebody else's — the office clearing a timer that was left running. The
// hours, if there are any worth keeping, go in as an ordinary timesheet entry
// against that person, through the same checks as anything else.
router.delete('/timer/:userId', requireRole('admin'), c.stopTimerFor);

router.get('/', c.list);
router.get('/summary', c.summary);
router.post('/', c.create);
// The office accepting hours that fell outside the diary. Not c.update: the
// person whose hours they are may edit their own entry, and may not sign off
// their own exception.
router.put('/:id/approve', requireRole('admin', 'office'), c.approveSchedule);
router.put('/:id', c.update);
router.delete('/:id', c.remove);

module.exports = router;
