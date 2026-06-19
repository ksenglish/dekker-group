const express = require('express');
const router = express.Router();
const c = require('../controllers/quoteController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);
router.use(requireRole('admin', 'office'));

router.get('/', c.list);
router.post('/', c.create);
router.get('/:id', c.get);
router.put('/:id', c.update);
router.delete('/:id', c.remove);
router.post('/:id/convert', c.convertToInvoice);
router.get('/:id/pdf', c.downloadPdf);
router.post('/:id/email', c.sendEmail);

module.exports = router;
