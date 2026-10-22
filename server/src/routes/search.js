// One box that finds anything. Read-only, and scoped to what the person
// asking is allowed to see — see services/globalSearch.
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const globalSearch = require('../services/globalSearch');

router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    res.json(await globalSearch.search(req.query.q, req.user));
  } catch (err) {
    console.error('[search]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
