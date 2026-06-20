const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/settingsController');
const { buildPDF } = require('../utils/pdf');
const { testConnection, getSmtpSettings } = require('../utils/email');
const pool = require('../db/pool');

router.get('/', authenticate, c.get);
router.put('/', authenticate, requireRole('admin', 'office'), c.update);

// Preview PDF using current theme with sample data
router.get('/preview-pdf', authenticate, requireRole('admin', 'office'), async (req, res) => {
  try {
    const theme = await c.getTheme();
    const pdf = await buildPDF({
      type: 'Quote',
      number: 'Q-PREVIEW',
      customer: { name: 'Sample Customer', company: 'Sample Company Ltd', email: 'customer@example.com', phone: '+64 21 000 000' },
      items: [
        { description: 'Supply & install heat pump unit', quantity: 1, unit_price: 250000 },
        { description: 'Installation labour (4 hrs)', quantity: 4, unit_price: 12500 },
        { description: 'Refrigerant pipework', quantity: 1, unit_price: 45000 },
      ],
      subtotal: 347500,
      gst: 52125,
      total: 399625,
      status: 'draft',
      notes: 'This is a sample quote to preview your theme. All values are for demonstration only.',
      issuedAt: new Date(),
      theme,
    });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="preview.pdf"' });
    res.send(pdf);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Preview failed' }); }
});

// Get SMTP settings (password masked)
router.get('/smtp', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const s = await getSmtpSettings();
    if (!s) return res.json({});
    res.json({ ...s, pass: s.pass ? '••••••••' : '' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Save SMTP settings
router.put('/smtp', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { host, port, secure, user, pass, from, fromName } = req.body;
    // If password is masked placeholder, keep existing
    let savePass = pass;
    if (pass === '••••••••') {
      const existing = await getSmtpSettings();
      savePass = existing?.pass || '';
    }
    const settings = { host, port: parseInt(port) || 587, secure: !!secure, user, pass: savePass, from, fromName };
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('smtp', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
      [JSON.stringify(settings)]
    );
    res.json({ ...settings, pass: savePass ? '••••••••' : '' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Test SMTP connection
router.post('/smtp/test', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await testConnection();
    res.json({ ok: true, message: 'Connection successful' });
  } catch (err) { res.status(400).json({ ok: false, message: err.message }); }
});

module.exports = router;
