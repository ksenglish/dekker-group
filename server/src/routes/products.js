const router = require('express').Router();
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/productController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

router.use(authenticate);

router.get('/', c.list);
router.get('/categories', c.categories);
router.get('/:id', c.get);
// Declared after /:id but they cannot collide — the extra segment makes them
// distinct routes.
router.get('/:id/media', c.serveMediaImage);
router.get('/:id/brochure', c.serveMediaBrochure);
router.post('/', requireRole('admin'), c.create);
router.put('/:id', requireRole('admin'), c.update);
router.delete('/:id', requireRole('admin'), c.remove);
router.post('/import', requireRole('admin'), c.importCsv);
router.post('/import-zip', requireRole('admin'), upload.single('file'), c.importZip);

module.exports = router;
