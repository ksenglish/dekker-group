const router = require('express').Router();
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/productController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

router.use(authenticate);

router.get('/', c.list);
router.get('/categories', c.categories);
router.get('/suppliers', c.suppliers);
// Who to email an order to, and the account to quote. Kept with the products
// because the supplier name itself lives on the product.
const supplierContacts = require('../controllers/materialsController');
router.get('/supplier-contacts', supplierContacts.listSuppliers);
router.put('/supplier-contacts', requireRole('admin', 'office'), supplierContacts.saveSupplier);
router.delete('/supplier-contacts/:supplierId', requireRole('admin', 'office'), supplierContacts.removeSupplier);
router.get('/taxonomy', c.taxonomy);

// Building the price list out of what has actually been bought, and watching
// for a supplier quietly putting a price up. See priceWatchController.
//
// Declared above /:id deliberately: Express takes the first route that
// matches, and /price-changes is a single segment just like an id, so below
// this line it would be read as a product called "price-changes".
const priceWatch = require('../controllers/priceWatchController');
router.get('/from-costs/preview', requireRole('admin'), priceWatch.previewFromCosts);
router.post('/from-costs', requireRole('admin'), priceWatch.applyFromCosts);
router.get('/price-changes', requireRole('admin'), priceWatch.priceChanges);

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

router.post('/:id/accept-price', requireRole('admin'), priceWatch.acceptPrice);

module.exports = router;
