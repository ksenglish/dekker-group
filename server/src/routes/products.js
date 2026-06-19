const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/productController');

router.use(authenticate);

router.get('/', c.list);
router.get('/categories', c.categories);
router.get('/:id', c.get);
router.post('/', requireRole('admin', 'office'), c.create);
router.put('/:id', requireRole('admin', 'office'), c.update);
router.delete('/:id', requireRole('admin', 'office'), c.remove);
router.post('/import', requireRole('admin', 'office'), c.importCsv);

module.exports = router;
