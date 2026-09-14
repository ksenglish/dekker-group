// ── Marketing Library ─────────────────────────────────────────────────────────
// Backs Website → Marketing Library. Also used by two scripts that run on the
// office PC with AUTOMATION_API_KEY: automation/marketing-sync.js, which uploads
// whatever lands in a local folder, and automation/website-worker.js, which
// keeps a local copy so Claude Code can use the images when it changes the site.
//
// Anyone signed in can browse. Adding, moving and deleting is office level,
// the same as editing the website's content.
const router = require('express').Router();
const multer = require('multer');
const { authenticateAutomation, requireRole } = require('../middleware/auth');
const lib = require('../services/marketingLibrary');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: lib.MAX_BYTES, files: 1 },
});

// A signed-in person, or one of the scripts above with the automation key.
router.use(authenticateAutomation);

const manage = requireRole('admin', 'office');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// An id that isn't a UUID can't match anything, and passing it to Postgres
// would come back as a 500 rather than the 404 it is.
router.param('id', (req, res, next, id) => (UUID.test(id) ? next() : res.status(404).json({ error: 'Not found' })));

// Errors the service raises on purpose carry a status; anything else is ours.
function fail(res, err, what) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(`Marketing Library: ${what} failed:`, err.message);
  res.status(500).json({ error: 'Server error' });
}

// ── Browsing ─────────────────────────────────────────────────────────────────

router.get('/folders', async (req, res) => {
  try { res.json(await lib.listFolder(req.query.path)); }
  catch (err) { fail(res, err, 'listing a folder'); }
});

router.get('/search', async (req, res) => {
  try { res.json(await lib.search(req.query.q)); }
  catch (err) { fail(res, err, 'search'); }
});

// Every file's details, no bytes — what the website worker mirrors.
router.get('/catalogue', async (req, res) => {
  try { res.json(await lib.catalogue()); }
  catch (err) { fail(res, err, 'the catalogue'); }
});

router.get('/assets/:id', async (req, res) => {
  try {
    const asset = await lib.getAsset(req.params.id);
    asset ? res.json(asset) : res.status(404).json({ error: 'Not found' });
  } catch (err) { fail(res, err, 'reading a file'); }
});

function sendFile(which) {
  return async (req, res) => {
    try {
      const file = await lib.readFile(req.params.id, which);
      if (!file) return res.status(404).json({ error: 'Not found' });
      res.set('Content-Type', file.mime);
      // A file's bytes never change under its id — replacing one is a new
      // upload with a new id — so the browser can keep it.
      res.set('Cache-Control', 'private, max-age=86400');
      if (which === 'file') {
        const disposition = req.query.download ? 'attachment' : 'inline';
        // RFC 5987 form so a name with macrons or spaces survives the header.
        res.set('Content-Disposition',
          `${disposition}; filename="${file.filename.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
      }
      res.send(file.buffer);
    } catch (err) { fail(res, err, `sending a ${which}`); }
  };
}
router.get('/assets/:id/file', sendFile('file'));
router.get('/assets/:id/thumb', sendFile('thumb'));

// ── Adding and organising ────────────────────────────────────────────────────

// Of a list of SHA-256 hashes, which the library already has. The sync script
// asks this before uploading, so a folder of a thousand files already synced
// costs one small request rather than a thousand uploads.
router.post('/check', manage, async (req, res) => {
  const hashes = Array.isArray(req.body?.hashes) ? req.body.hashes.slice(0, 5000) : [];
  try { res.json({ existing: await lib.existingHashes(hashes) }); }
  catch (err) { fail(res, err, 'checking hashes'); }
});

// multer reports a file over the limit as its own error; turn that into a
// message someone can act on instead of a generic failure.
function receiveFile(req, res, next) {
  upload.single('file')(req, res, err => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `Files are limited to ${lib.MAX_BYTES / 1024 / 1024} MB` });
    }
    return res.status(400).json({ error: err.message || 'Could not read that upload' });
  });
}

router.post('/assets', manage, receiveFile, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { asset, duplicate } = await lib.store({
      buffer: req.file.buffer,
      // Browsers and the sync script send the name as a field too. multer
      // decodes the multipart filename as Latin-1, which mangles anything
      // outside plain ASCII, so the field wins when it's there.
      filename: req.body.filename || Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
      folderPath: req.body.path,
      source: req.user.id === 'automation' ? 'sync' : 'upload',
      userId: req.user.id,
    });
    res.status(duplicate ? 200 : 201).json({ asset, duplicate });
  } catch (err) { fail(res, err, 'an upload'); }
});

router.post('/folders', manage, async (req, res) => {
  try { res.status(201).json(await lib.createFolder(req.body?.path)); }
  catch (err) { fail(res, err, 'creating a folder'); }
});

router.delete('/folders', manage, async (req, res) => {
  try {
    const ok = await lib.deleteFolder(req.query.path);
    ok ? res.status(204).end() : res.status(404).json({ error: 'Not found' });
  } catch (err) { fail(res, err, 'deleting a folder'); }
});

router.patch('/assets/:id', manage, async (req, res) => {
  try {
    const asset = await lib.updateAsset(req.params.id, {
      filename: req.body?.filename,
      folderPath: req.body?.path,
    });
    asset ? res.json(asset) : res.status(404).json({ error: 'Not found' });
  } catch (err) { fail(res, err, 'updating a file'); }
});

router.delete('/assets/:id', manage, async (req, res) => {
  try {
    const ok = await lib.removeAsset(req.params.id);
    ok ? res.status(204).end() : res.status(404).json({ error: 'Not found' });
  } catch (err) { fail(res, err, 'deleting a file'); }
});

module.exports = router;
