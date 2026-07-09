const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/settingsController');
const { buildPDF } = require('../utils/pdf');
const { testConnection, getEmailSettings } = require('../utils/email');
const { getXeroConnection, saveXeroConnection } = require('../utils/xero');
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
    const s = await getEmailSettings();
    if (!s) return res.json({ provider: 'smtp', user: '', pass: '', from: '', fromName: 'Dekker Group', host: 'smtp-relay.brevo.com', port: 587 });
    const safe = { ...s };
    if (safe.pass) safe.pass = '••••••••';
    res.json(safe);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Save email settings
router.put('/email', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const incoming = req.body;
    // If password is masked, keep existing
    if (incoming.pass === '••••••••') {
      const existing = await getEmailSettings();
      incoming.pass = existing?.pass || '';
    }
    const settings = {
      provider: incoming.provider || 'smtp',
      host: incoming.host || 'smtp.gmail.com',
      port: parseInt(incoming.port) || 465,
      secure: incoming.secure !== false,
      user: incoming.user || '',
      pass: incoming.pass || '',
      from: incoming.from || incoming.user || '',
      fromName: incoming.fromName || 'Dekker Group',
    };
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('email', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
      [JSON.stringify(settings)]
    );
    const safe = { ...settings, pass: settings.pass ? '••••••••' : '' };
    res.json(safe);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Test email connection
router.post('/email/test', authenticate, requireRole('admin'), async (req, res) => {
  try {
    // Save first so testConnection picks up the latest
    const incoming = req.body;
    if (incoming.pass === '••••••••') {
      const existing = await getEmailSettings();
      incoming.pass = existing?.pass || '';
    }
    await testConnection(incoming);
    res.json({ ok: true, message: '✓ Connected successfully — emails are ready to send' });
  } catch (err) { res.status(400).json({ ok: false, message: err.message }); }
});

// Job Types (stored in settings table as JSON)
const DEFAULT_JOB_TYPES = ['Installation', 'Service', 'Inspection', 'Repair', 'Quote Only'];

router.get('/job-types', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key='job_types'`);
    res.json(rows[0]?.value || DEFAULT_JOB_TYPES);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.put('/job-types', authenticate, requireRole('admin', 'office'), async (req, res) => {
  try {
    const types = req.body;
    if (!Array.isArray(types)) return res.status(400).json({ error: 'Array required' });
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('job_types', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
      [JSON.stringify(types)]
    );
    res.json(types);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Job Status Colours — used to colour appointments on the Schedule by the job's status
const JOB_STATUSES = ['new', 'quoted', 'scheduled', 'in_progress', 'invoiced', 'complete', 'cancelled'];
const DEFAULT_STATUS_COLOURS = {
  new: '#1e40af', quoted: '#7c3aed', scheduled: '#0891b2',
  in_progress: '#d97706', invoiced: '#9333ea', complete: '#16a34a', cancelled: '#6b7280',
};
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

router.get('/job-status-colours', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key='job_status_colours'`);
    res.json({ ...DEFAULT_STATUS_COLOURS, ...(rows[0]?.value || {}) });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.put('/job-status-colours', authenticate, requireRole('admin', 'office'), async (req, res) => {
  try {
    const colours = req.body;
    if (typeof colours !== 'object' || Array.isArray(colours) || colours === null) {
      return res.status(400).json({ error: 'Object of status -> hex colour required' });
    }
    for (const [status, colour] of Object.entries(colours)) {
      if (!JOB_STATUSES.includes(status)) return res.status(400).json({ error: `Unknown status "${status}"` });
      if (!HEX_RE.test(colour)) return res.status(400).json({ error: `Invalid colour for "${status}" — must be a hex value like #1e40af` });
    }
    const merged = { ...DEFAULT_STATUS_COLOURS, ...colours };
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('job_status_colours', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
      [JSON.stringify(merged)]
    );
    res.json(merged);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Job Templates
router.get('/job-templates', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM job_templates ORDER BY sort_order, name');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/job-templates', authenticate, requireRole('admin', 'office'), async (req, res) => {
  const { name, type, description, priority, is_recurring, recurrence_interval } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO job_templates (name, type, description, priority, is_recurring, recurrence_interval)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, type || null, description || null, priority || 'medium',
       is_recurring || false, recurrence_interval || 'annual']
    );
    res.status(201).json(rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.put('/job-templates/:id', authenticate, requireRole('admin', 'office'), async (req, res) => {
  const { name, type, description, priority, is_recurring, recurrence_interval } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE job_templates SET name=$1, type=$2, description=$3, priority=$4,
         is_recurring=$5, recurrence_interval=$6
       WHERE id=$7 RETURNING *`,
      [name, type || null, description || null, priority || 'medium',
       is_recurring || false, recurrence_interval || 'annual', req.params.id]
    );
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/job-templates/:id', authenticate, requireRole('admin', 'office'), async (req, res) => {
  try {
    await pool.query('DELETE FROM job_templates WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Billing rates
const DEFAULT_BILLING_RATES = [
  { id: 'standard',     label: 'Standard',        rate: 0 },
  { id: 'overtime',     label: 'Overtime',         rate: 0 },
  { id: 'after_hours',  label: 'After Hours',      rate: 0 },
  { id: 'public_hol',   label: 'Public Holiday',   rate: 0 },
  { id: 'subcontractor',label: 'Subcontractor',    rate: 0 },
];

router.get('/billing-rates', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key='billing_rates'`);
    res.json(rows[0]?.value || DEFAULT_BILLING_RATES);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.put('/billing-rates', authenticate, requireRole('admin', 'office'), async (req, res) => {
  try {
    const rates = req.body;
    if (!Array.isArray(rates)) return res.status(400).json({ error: 'Array required' });
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('billing_rates', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
      [JSON.stringify(rates)]
    );
    res.json(rates);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Integrations (reserved for future API keys)
router.get('/integrations', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key='integrations'`);
    res.json(rows[0]?.value || {});
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.put('/integrations', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('integrations', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
      [JSON.stringify(req.body)]
    );
    res.json(req.body);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Xero connection status — never returns the stored access/refresh tokens.
router.get('/xero', authenticate, requireRole('admin', 'office'), async (req, res) => {
  try {
    const conn = await getXeroConnection();
    res.json({
      connected: !!conn,
      tenant_name: conn?.tenantName || null,
      connected_at: conn?.connectedAt || null,
      default_account_code: conn?.defaultAccountCode || null,
      default_tax_type: conn?.defaultTaxType || null,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/xero', authenticate, requireRole('admin'), async (req, res) => {
  const { default_account_code, default_tax_type } = req.body;
  try {
    const conn = await getXeroConnection();
    if (!conn) return res.status(400).json({ error: 'Xero is not connected' });
    const updated = await saveXeroConnection({ defaultAccountCode: default_account_code, defaultTaxType: default_tax_type });
    res.json({ default_account_code: updated.defaultAccountCode, default_tax_type: updated.defaultTaxType });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
