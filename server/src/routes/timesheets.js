const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const c = require('../controllers/timesheetController');

router.use(authenticate);
// Timers running right now. Declared before '/:id' so neither is mistaken
// for the other.
router.get('/timers', c.listTimers);
router.post('/timer', c.startTimer);
router.delete('/timer', c.stopTimer);

router.get('/', c.list);
router.get('/summary', c.summary);
router.post('/', c.create);
router.put('/:id', c.update);
router.delete('/:id', c.remove);

module.exports = router;
