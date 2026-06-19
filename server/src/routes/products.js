const router = require('express').Router();
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/productController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

router.use(authenticate);

router.get('/', c.list);
router.get('/categories', c.categories);
router.get('/:id', c.get);
router.post('/', requireRole('admin', 'office'), c.create);
router.put('/:id', requireRole('admin', 'office'), c.update);
router.delete('/:id', requireRole('admin', 'office'), c.remove);
router.post('/import', requireRole('admin', 'office'), c.importCsv);
router.post('/import-zip', requireRole('admin', 'office'), upload.single('file'), c.importZip);

module.exports = router;
