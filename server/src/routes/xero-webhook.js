// Receives Xero's INVOICE/CONTACT webhook events. Mounted in index.js with a
// path-scoped express.raw() body parser (before the shared express.json())
// so the exact request bytes survive for HMAC signature verification.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db/pool');
const xero = require('../utils/xero');
const { applyInvoicePayment } = require('./invoices');

async function handleInvoiceEvent(event) {
  const invoice = await xero.getInvoice(event.resourceId);
  if (!invoice) return;
  const { rows: [inv] } = await pool.query('SELECT id FROM invoices WHERE xero_invoice_id=$1', [invoice.invoiceID]);
  if (!inv) return; // an invoice not pushed from Dekker App — nothing to reconcile

  for (const payment of invoice.payments || []) {
    await applyInvoicePayment(inv.id, {
      amountCents: Math.round((payment.amount || 0) * 100),
      method: 'xero',
      reference: payment.reference || null,
      paidAt: payment.date ? payment.date.slice(0, 10) : undefined,
      xeroPaymentId: payment.paymentID,
    });
  }
}

async function handleContactEvent(event) {
  const contact = await xero.getContact(event.resourceId);
  if (!contact) return;
  const { rows: [cust] } = await pool.query('SELECT id FROM customers WHERE xero_contact_id=$1', [contact.contactID]);
  if (!cust) return; // a contact not linked to a Dekker customer — nothing to update

  const phone = (contact.phones || []).find(p => p.phoneType === 'DEFAULT') || (contact.phones || [])[0];
  const address = (contact.addresses || [])[0];

  // Xero wins on conflict for these overlapping fields — accounting-side
  // edits are the source of truth for billing accuracy. Dekker-only fields
  // (lead_source, contact_name, etc.) are never touched here.
  await pool.query(
    `UPDATE customers SET
       name = COALESCE($1, name),
       email = COALESCE($2, email),
       phone = COALESCE($3, phone),
       address_street = COALESCE($4, address_street),
       address_city = COALESCE($5, address_city),
       address_region = COALESCE($6, address_region),
       address_postcode = COALESCE($7, address_postcode),
       updated_at = NOW()
     WHERE id=$8`,
    [contact.name || null, contact.emailAddress || null, phone?.phoneNumber || null,
     address?.addressLine1 || null, address?.city || null, address?.region || null, address?.postalCode || null,
     cust.id]
  );
}

router.post('/', async (req, res) => {
  const key = process.env.XERO_WEBHOOK_KEY;
  const rawBody = req.body; // Buffer — see express.raw() mount in index.js

  // Financial data flows through this endpoint (invoice paid status,
  // customer contact details) — fail closed rather than soft-fail with a
  // warning like some other deferred-secret integrations in this codebase.
  if (!key) {
    console.warn('XERO_WEBHOOK_KEY is not set — rejecting Xero webhook request');
    return res.status(401).end();
  }

  const expected = Buffer.from(crypto.createHmac('sha256', key).update(rawBody).digest('base64'), 'utf8');
  const provided = Buffer.from(req.headers['x-xero-signature'] || '', 'utf8');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).end();
  }

  // Xero requires a signed 200 within 5 seconds — respond immediately, then
  // process events. The intent-to-receive validation ping has no `events`.
  res.status(200).end();

  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); } catch { return; }
  for (const event of payload.events || []) {
    try {
      if (event.eventCategory === 'INVOICE') await handleInvoiceEvent(event);
      else if (event.eventCategory === 'CONTACT') await handleContactEvent(event);
    } catch (err) {
      console.error('Xero webhook event failed:', event, err);
    }
  }
});

module.exports = router;
