const router = require('express').Router();
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/productController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

router.use(authenticate);

router.get('/', c.list);
router.get('/categories', c.categories);
router.get('/suppliers', c.suppliers);
router.get('/taxonomy', c.taxonomy);
router.get('/:id', c.get);
// Declared after /:id but they cannot collide — the extra segment makes them
// distinct routes.
// What a BOM kit is made of. Readable by anyone who can read the price list —
// the cost figures inside are stripped for everyone but admin, as elsewhere.
router.get('/:id/components', c.components);
router.get('/:id/media', c.serveMediaImage);
router.get('/:id/thumb', c.serveThumb);
router.get('/:id/brochure', c.serveMediaBrochure);
router.post('/', requireRole('admin'), c.create);
router.put('/:id', requireRole('admin'), c.update);
router.delete('/:id', requireRole('admin'), c.remove);
router.post('/import', requireRole('admin'), c.importCsv);
router.post('/import-zip', requireRole('admin'), upload.single('file'), c.importZip);

module.exports = router;
