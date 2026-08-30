const express = require('express');
const router = express.Router();
const c = require('../controllers/quoteController');
const { authenticate, requireRole } = require('../middleware/auth');

// Public routes — no auth required
router.get('/public/:token', c.publicGet);
router.post('/public/:token/accept', c.publicAccept);
router.post('/public/:token/decline', c.publicDecline);
router.get('/public/:token/pixel.gif', c.trackOpen);
router.get('/public/:token/drawings/:attachmentId', c.publicDrawing);
router.get('/public/:token/brochures/:productId', c.publicBrochure);

router.use(authenticate);
router.use(requireRole('admin', 'office'));

router.get('/', c.list);
router.post('/', c.create);
router.get('/:id', c.get);
router.put('/:id', c.update);
router.put('/:id/line-items', c.updateLineItems);
router.post('/:id/approve', c.approve);
router.post('/:id/reset-to-draft', c.resetToDraft);
router.post('/:id/job', c.attachJob);
router.delete('/:id/job', c.detachJob);
router.post('/:id/copy', c.copyQuote);
router.delete('/:id', c.remove);
router.post('/:id/convert', c.convertToInvoice);
router.get('/:id/pdf', c.downloadPdf);
router.get('/:id/email-preview', c.emailPreview);
router.post('/:id/email', c.sendEmail);
router.get('/:id/activity', c.getActivity);

module.exports = router;
