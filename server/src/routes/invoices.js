const express = require('express');
const router = express.Router();
const c = require('../controllers/invoiceController');
const { authenticate, requireRawRole } = require('../middleware/auth');
const xero = require('../utils/xero');

router.use(authenticate);
// Raw role check — sales/operations must NOT get in via the sales/operations
// -> office equivalence that requireRole normally applies.
router.use(requireRawRole('admin', 'office'));

router.get('/', c.list);
router.get('/:id', c.get);
router.put('/:id', c.update);
router.post('/:id/paid', c.markPaid);
router.get('/:id/pdf', c.downloadPdf);
router.post('/:id/email', c.sendEmail);

// Payments
const pool = require('../db/pool');

// Records a payment against an invoice and, once the cumulative total is
// met, marks the invoice paid and cascades the job to complete. Shared by
// the manual "record payment" route below and the Xero webhook, so both
// paths apply payments identically. `amountCents` is always integer cents;
// `xeroPaymentId` (if set) dedupes against Xero's webhook retry behaviour —
// a duplicate insert is silently skipped via the partial unique index.
async function applyInvoicePayment(invoiceId, { amountCents, method, reference, paidAt, recordedBy, xeroPaymentId }) {
  const { rows: [inv] } = await pool.query('SELECT * FROM invoices WHERE id=$1', [invoiceId]);
  if (!inv) return null;
  const { rows: [payment] } = await pool.query(
    `INSERT INTO invoice_payments (invoice_id, amount, method, reference, paid_at, recorded_by, xero_payment_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (xero_payment_id) WHERE xero_payment_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [invoiceId, amountCents, method || 'bank_transfer', reference || null,
     paidAt || new Date().toISOString().split('T')[0], recordedBy || null, xeroPaymentId || null]
  );
  if (!payment) return null; // deduped — already recorded from a prior webhook delivery

  const { rows: [totals] } = await pool.query(
    'SELECT SUM(amount) AS paid FROM invoice_payments WHERE invoice_id=$1', [invoiceId]
  );
  if (parseInt(totals.paid) >= inv.total) {
    await pool.query(`UPDATE invoices SET status='paid', paid_at=NOW(), updated_at=NOW() WHERE id=$1`, [invoiceId]);
    await pool.query(`UPDATE jobs SET status='complete', updated_at=NOW() WHERE id=$1`, [inv.job_id]);
  }
  return payment;
}

router.get('/:id/payments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.name AS recorded_by_name FROM invoice_payments p
       LEFT JOIN users u ON u.id = p.recorded_by
       WHERE p.invoice_id=$1 ORDER BY p.paid_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
router.post('/:id/payments', async (req, res) => {
  const { amount, method, reference, paid_at } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount is required' });
  try {
    const payment = await applyInvoicePayment(req.params.id, {
      amountCents: Math.round(amount * 100), method, reference, paidAt: paid_at, recordedBy: req.user.id,
    });
    if (!payment) return res.status(404).json({ error: 'Invoice not found' });
    res.status(201).json(payment);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});
router.delete('/:id/payments/:payId', async (req, res) => {
  try {
    await pool.query('DELETE FROM invoice_payments WHERE id=$1 AND invoice_id=$2', [req.params.payId, req.params.id]);
    res.json({ message: 'Deleted' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// Push this invoice to Xero as a DRAFT (never auto-authorised — a bad push
// shouldn't finalise a real invoice in the customer's accounting system
// without a human reviewing it in Xero first).
router.post('/:id/push-to-xero', async (req, res) => {
  try {
    const { rows: [inv] } = await pool.query('SELECT * FROM invoices WHERE id=$1', [req.params.id]);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (!inv.customer_id) return res.status(400).json({ error: 'Invoice has no customer' });

    const conn = await xero.getXeroConnection();
    if (!conn) return res.status(400).json({ error: 'Xero is not connected' });
    if (!conn.defaultAccountCode || !conn.defaultTaxType) {
      return res.status(400).json({ error: 'Set a default Xero account code and tax rate in Settings → Integrations first' });
    }

    const { rows: [customer] } = await pool.query('SELECT * FROM customers WHERE id=$1', [inv.customer_id]);
    const items = await pool.query('SELECT * FROM line_items WHERE job_id=$1 ORDER BY created_at', [inv.job_id]);

    let xeroContactId = customer.xero_contact_id;
    if (!xeroContactId) {
      const contact = await xero.findOrCreateContact(customer);
      xeroContactId = contact.contactID;
      await pool.query('UPDATE customers SET xero_contact_id=$1 WHERE id=$2', [xeroContactId, customer.id]);
    }

    const invoiceBody = {
      type: 'ACCREC',
      contact: { contactID: xeroContactId },
      lineItems: items.rows.map(item => ({
        description: item.description,
        quantity: parseFloat(item.quantity),
        unitAmount: item.unit_price / 100,
        accountCode: conn.defaultAccountCode,
        taxType: conn.defaultTaxType,
      })),
      status: 'DRAFT',
    };

    const result = await xero.createOrUpdateInvoice(invoiceBody, inv.xero_invoice_id);

    const { rows: [updated] } = await pool.query(
      `UPDATE invoices SET xero_invoice_id=$1, xero_invoice_number=$2, xero_synced_at=NOW(), updated_at=NOW()
       WHERE id=$3 RETURNING *`,
      [result.invoiceID, result.invoiceNumber, req.params.id]
    );
    res.json(updated);
  } catch (err) {
    console.error('Push to Xero failed:', err);
    res.status(502).json({ error: err.message || 'Failed to push invoice to Xero' });
  }
});

module.exports = router;
module.exports.applyInvoicePayment = applyInvoicePayment;
