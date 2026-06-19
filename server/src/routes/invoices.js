const express = require('express');
const router = express.Router();
const c = require('../controllers/invoiceController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);
router.use(requireRole('admin', 'office'));

router.get('/', c.list);
router.get('/:id', c.get);
router.put('/:id', c.update);
router.post('/:id/paid', c.markPaid);
router.get('/:id/pdf', c.downloadPdf);
router.post('/:id/email', c.sendEmail);

module.exports = router;
