const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/settingsController');
const { buildPDF } = require('../utils/pdf');
const { testConnection, getResendSettings } = require('../utils/email');
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
      subtotal: 347500, gst: 52125, total: 399625, status: 'draft',
      notes: 'This is a sample quote to preview your theme. All values are for demonstration only.',
      issuedAt: new Date(), theme,
    });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="preview.pdf"' });
    res.send(pdf);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Preview failed' }); }
});

// Get email settings
router.get('/email', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const s = await getResendSettings();
    if (!s) return res.json({ apiKey: '', from: '', fromName: '' });
    res.json({ apiKey: s.apiKey ? '••••••••••••••••' : '', from: s.from || '', fromName: s.fromName || '' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Save email settings
router.put('/email', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { apiKey, from, fromName } = req.body;
    let saveKey = apiKey;
    if (apiKey === '••••••••••••••••') {
      const existing = await getResendSettings();
      saveKey = existing?.apiKey || '';
    }
    const settings = { apiKey: saveKey, from: from || 'noreply@dekkergroup.co.nz', fromName: fromName || 'Dekker Group' };
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('resend', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
      [JSON.stringify(settings)]
    );
    res.json({ ...settings, apiKey: saveKey ? '••••••••••••••••' : '' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Test email connection
router.post('/email/test', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { apiKey } = req.body;
    const keyToTest = (apiKey && apiKey !== '••••••••••••••••') ? apiKey : null;
    await testConnection(keyToTest);
    res.json({ ok: true, message: '✓ API key is valid and connected' });
  } catch (err) { res.status(400).json({ ok: false, message: err.message }); }
});

module.exports = router;
