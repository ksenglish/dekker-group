// One box that finds anything. Read-only, and scoped to what the person
// asking is allowed to see — see services/globalSearch.
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const globalSearch = require('../services/globalSearch');

router.use(authenticate);

// Your own day, for "navigate to my first job". Declared above '/' only for
// tidiness — they are different paths — but kept together so it is obvious
// both are read-only and both are about the person asking.
router.get('/my-day', async (req, res) => {
  try {
    res.json({ date: req.query.date || null, items: await globalSearch.myDay(req.user, { date: req.query.date }) });
  } catch (err) {
    console.error('[search] my-day', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/', async (req, res) => {
  try {
    res.json(await globalSearch.search(req.query.q, req.user));
  } catch (err) {
    console.error('[search]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
