const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, authenticateAutomation, requireRole } = require('../middleware/auth');
const fileStore = require('../services/fileStore');
const costFiling = require('../services/costFiling');
const priceListIntake = require('../services/priceListIntake');
const subcontractors = require('../services/subcontractors');

// Count unmatched (for sidebar badge)
router.get('/count', authenticate, async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM job_cost_scans WHERE status = 'unmatched'`
    );
    res.json({ count: row.count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// List all unmatched scans
router.get('/', authenticate, async (req, res) => {
  try {
    // Deliberately not the document itself. This list sent every unmatched
    // PDF down with it, so opening PDF Check with a few dozen waiting meant
    // downloading all of them to show a list of suppliers and totals. The
    // client asks for one when someone actually clicks View PDF.
    const { rows } = await pool.query(
      `SELECT s.id, s.supplier, s.invoice_number, s.detected_job_number, s.parsed_items,
              s.mime_type, s.created_at, s.document_type,
              (s.document_base64 IS NOT NULL OR s.storage_key IS NOT NULL) AS has_document,
              -- Where the app thinks it goes, for a row that can be filed with
              -- one press instead of a hunt through the folder tree.
              s.suggested_folder_id, f.name AS suggested_folder_name, s.filed_because
       FROM job_cost_scans s
       LEFT JOIN cost_folders f ON f.id = s.suggested_folder_id
       WHERE s.status = 'unmatched'
       ORDER BY s.created_at DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── What the scanner has already dealt with ──────────────────────────────────
//
// The scanner asks before it reads an invoice, and tells us again once it
// knows what the invoice is. Asking first is the point: reading a PDF costs an
// OCR pass and a model call, and the commonest duplicate — the same attachment
// riding along on every reply in a thread — can be recognised from the file's
// bytes alone, before a cent is spent on it.
//
// Claiming is the insert itself, so two runs that overlap cannot both decide
// they are the one handling an invoice.

// Folded the way the indexes fold it: same supplier, same number, however it
// was punctuated or capitalised.
const foldInvoice = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

router.post('/claim', authenticateAutomation, async (req, res) => {
  const fingerprint = String(req.body?.fingerprint || '').trim();
  if (!fingerprint) return res.status(400).json({ error: 'A fingerprint is needed to claim a document' });

  const supplier = String(req.body?.supplier || '').trim() || null;
  const invoiceNumber = String(req.body?.invoice_number || '').trim() || null;

  try {
    // Already claimed, by an earlier run or an earlier message in the thread.
    const { rows: [sameFile] } = await pool.query(
      'SELECT id, supplier, invoice_number, outcome, job_id, created_at FROM scanned_documents WHERE fingerprint = $1',
      [fingerprint]
    );

    // The same invoice as a different file: a supplier re-sending it, or a
    // statement attaching a fresh render of the same thing.
    let sameInvoice = null;
    if (supplier && invoiceNumber) {
      const { rows } = await pool.query(
        `SELECT id, supplier, invoice_number, outcome, job_id, created_at, 'scanner' AS found_in
           FROM scanned_documents
          WHERE fingerprint <> $1
            AND LOWER(TRIM(supplier)) = LOWER(TRIM($2))
            AND UPPER(REGEXP_REPLACE(COALESCE(invoice_number,''), '[^A-Za-z0-9]', '', 'g')) = $3
          UNION ALL
         SELECT id, supplier, invoice_number, status AS outcome, job_id, created_at, 'app' AS found_in
           FROM job_cost_scans
          WHERE LOWER(TRIM(supplier)) = LOWER(TRIM($2))
            AND UPPER(REGEXP_REPLACE(COALESCE(invoice_number,''), '[^A-Za-z0-9]', '', 'g')) = $3
          LIMIT 1`,
        [fingerprint, supplier, foldInvoice(invoiceNumber)]
      );
      sameInvoice = rows[0] || null;
    }

    if (sameFile) {
      // Our own earlier claim coming back with what it has since learned.
      await pool.query(
        `UPDATE scanned_documents
            SET supplier = COALESCE($2, supplier),
                invoice_number = COALESCE($3, invoice_number),
                outcome = COALESCE($4, outcome),
                job_id = COALESCE($5, job_id),
                updated_at = NOW()
          WHERE fingerprint = $1`,
        [fingerprint, supplier, invoiceNumber,
         String(req.body?.outcome || '').trim() || null, req.body?.job_id || null]
      );
      // A claim with nothing learned yet is a duplicate; one carrying what it
      // just read is the same run reporting back, and is not.
      const reporting = Boolean(supplier || invoiceNumber || req.body?.outcome);
      return res.json({
        claimed: reporting,
        reason: reporting ? 'updated' : 'same_file',
        duplicate_of: reporting ? null : sameFile,
      });
    }

    if (sameInvoice) {
      // Recorded so the next copy is recognised from its bytes alone.
      await pool.query(
        `INSERT INTO scanned_documents (fingerprint, supplier, invoice_number, outcome, source)
         VALUES ($1,$2,$3,'duplicate',$4) ON CONFLICT (fingerprint) DO NOTHING`,
        [fingerprint, supplier, invoiceNumber, String(req.body?.source || '').slice(0, 300) || null]
      );
      return res.json({ claimed: false, reason: 'same_invoice', duplicate_of: sameInvoice });
    }

    const { rows: [claimed] } = await pool.query(
      `INSERT INTO scanned_documents (fingerprint, supplier, invoice_number, outcome, job_id, source)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (fingerprint) DO NOTHING
       RETURNING id`,
      [fingerprint, supplier, invoiceNumber,
       String(req.body?.outcome || '').trim() || null, req.body?.job_id || null,
       String(req.body?.source || '').slice(0, 300) || null]
    );
    // Nothing returned means another run inserted it between the two queries.
    if (!claimed) return res.json({ claimed: false, reason: 'same_file' });
    res.json({ claimed: true, reason: 'new', id: claimed.id });
  } catch (err) {
    console.error('[invoice-inbox] claim failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Giving a claim back, when reading the invoice failed for a reason that might
// not happen next time. Without this a PDF that broke once would never be
// looked at again.
router.post('/release', authenticateAutomation, async (req, res) => {
  const fingerprint = String(req.body?.fingerprint || '').trim();
  if (!fingerprint) return res.status(400).json({ error: 'Which document?' });
  try {
    // Only a claim that got nowhere is given back. One that reached a job or
    // the inbox stays claimed, whatever the scanner thinks happened after.
    const { rowCount } = await pool.query(
      `DELETE FROM scanned_documents
        WHERE fingerprint = $1 AND job_id IS NULL
          AND (outcome IS NULL OR outcome IN ('failed', 'claimed'))`,
      [fingerprint]
    );
    res.json({ released: rowCount > 0 });
  } catch (err) {
    console.error('[invoice-inbox] release failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Automation: save an unmatched invoice to the inbox
router.post('/', authenticateAutomation, async (req, res) => {
  const { document_base64, mime_type, supplier, invoice_number, detected_job_number, parsed_items } = req.body;
  // What kind of document it is, as the scanner read it. A statement and an
  // invoice from the same supplier live in different folders, so the supplier
  // name alone cannot file either of them.
  const documentType = ['invoice', 'statement', 'credit_note', 'remittance', 'other']
    .includes(String(req.body?.document_type || '').toLowerCase())
    ? String(req.body.document_type).toLowerCase()
    : null;
  try {
    // Arrives from the Apps Script as a data URL; the bucket takes it from here.
    const stored = await fileStore.storeDataUrl({
      prefix: 'cost-scans/inbox',
      filename: `${invoice_number || 'invoice'}.pdf`,
      dataUrl: document_base64,
    });

    const { rows: [row] } = await pool.query(
      `INSERT INTO job_cost_scans
         (document_base64, mime_type, supplier, invoice_number, detected_job_number, parsed_items, status,
          storage_key, size_bytes, document_type, cost_kind)
       VALUES ($1, $2, $3, $4, $5, $6, 'unmatched', $7, $8, $9, $10)
       RETURNING id, supplier, invoice_number, detected_job_number, created_at`,
      [
        stored ? null : document_base64,
        mime_type || 'application/pdf',
        supplier || null,
        invoice_number || null,
        detected_job_number || null,
        JSON.stringify(parsed_items || []),
        stored?.key || null, stored?.size || null,
        documentType,
        // A sub-contractor's invoice is a different kind of cost and must not
        // reach the price list, so it is labelled the moment it arrives.
        await subcontractors.kindFor({ supplier }),
      ]
    );

    // Filed on arrival where the folders and the filing already done agree on
    // where it goes. Anything less certain keeps its suggestion and waits in
    // PDF Check — the folder is chosen, somebody just says yes.
    let filing = null;
    try {
      filing = await costFiling.fileScan(row.id);
    } catch (err) {
      // Never at the cost of the document itself: an invoice in the wrong
      // place is a nuisance, one that never arrived is a lost cost.
      console.error('[invoice-inbox] auto-file failed:', err.message);
    }
    res.status(201).json({ ...row, filing });
  } catch (err) {
    console.error('Invoice inbox save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Correct what the reader pulled off the PDF. Saved back onto the scan rather
// than held in the browser, so an invoice can be fixed now and linked later —
// and so filing it to a folder, which reads the same field, gets the corrected
// figures too.
router.put('/:id/items', authenticate, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be a list' });

  const cleaned = [];
  for (const raw of items) {
    const description = String(raw?.description || '').trim();
    if (!description) return res.status(400).json({ error: 'Every line needs a description' });
    const quantity = parseFloat(raw?.quantity);
    const unitPrice = parseFloat(raw?.unit_price);
    if (!Number.isFinite(unitPrice)) return res.status(400).json({ error: `"${description}" needs a unit price` });
    cleaned.push({
      description: description.slice(0, 255),
      // Quantity is a magnitude; a credit is carried as a negative unit price,
      // matching how the scanner normalises them.
      quantity: Math.max(0.01, Math.abs(Number.isFinite(quantity) && quantity !== 0 ? quantity : 1)),
      unit_price: unitPrice,
    });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE job_cost_scans SET parsed_items = $1
       WHERE id = $2 AND status = 'unmatched'
       RETURNING id, parsed_items`,
      [JSON.stringify(cleaned), req.params.id]
    );
    // Once it's been linked or filed the figures are on the job, so editing
    // here would no longer change anything.
    if (!rows[0]) return res.status(404).json({ error: 'Not found, or it has already been linked or filed' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Invoice inbox item edit failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Link an inbox scan to a job and post its cost items
router.post('/:id/link', authenticate, async (req, res) => {
  const { job_id, items, gst_treatment } = req.body;
  if (!job_id) return res.status(400).json({ error: 'job_id required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch the scan and update it to matched
    const { rows: [scan] } = await client.query(
      `UPDATE job_cost_scans
       SET job_id = $1, status = 'matched', gst_treatment = $2
       WHERE id = $3 AND status = 'unmatched'
       RETURNING *`,
      [job_id, gst_treatment || 'exclusive', req.params.id]
    );
    if (!scan) return res.status(404).json({ error: 'Inbox item not found' });

    // Use items from request, falling back to what Claude parsed originally
    const costItems = (items && items.length > 0) ? items : (scan.parsed_items || []);
    for (let i = 0; i < costItems.length; i++) {
      const { description, sku, quantity, unit_price } = costItems[i];
      await client.query(
        `INSERT INTO job_costs (job_id, scan_id, description, sku, quantity, unit_price, sort_order, cost_kind)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [job_id, scan.id, description, sku || null, quantity || 1, Math.round((unit_price || 0) * 100), i, scan.cost_kind]
      );
    }

    await client.query('COMMIT');

    // Onto the price list, after the costs are safely committed. A document
    // linked to a job is buying materials for it — tools arrive by being filed
    // in the Tools folder instead.
    const added = await priceListIntake.intake({
      lines: costItems.map(i => ({
        description: i.description, sku: i.sku,
        cost_cents: Math.round(Number(i.unit_price || 0) * 100),
      })),
      supplier: scan.supplier,
      documentType: scan.document_type,
      costKind: scan.cost_kind,
    });

    res.json({ message: 'Linked successfully', items_posted: costItems.length, price_list: added });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// File an unmatched scan into an operating-cost folder. It leaves PDF Check
// and shows up under Reports → Costs → Operating Costs, keeping the line items
// Claude parsed so the document isn't just a PDF with no figures behind it.
router.post('/:id/file', authenticate, async (req, res) => {
  const { folder_id } = req.body;
  if (!folder_id) return res.status(400).json({ error: 'folder_id required' });
  try {
    const { rows: [folder] } = await pool.query('SELECT id FROM cost_folders WHERE id = $1', [folder_id]);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const { rows } = await pool.query(
      `UPDATE job_cost_scans
       SET folder_id = $1, status = 'filed'
       WHERE id = $2 AND status = 'unmatched'
       RETURNING id, supplier, invoice_number, folder_id, document_type, parsed_items, cost_kind`,
      [folder_id, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Inbox item not found' });

    // What was bought goes onto the price list — and where the folder is Tools,
    // it goes on as tools. That is the whole way a tool gets onto the price
    // list without anybody typing it in: buy it, file the invoice under Tools.
    const added = await priceListIntake.intakeFromScan(rows[0]);

    const { parsed_items, document_type, ...filed } = rows[0];
    res.json({ ...filed, price_list: added });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Put away everything waiting that can be, and mark the rest with where it
// probably goes. Run when this is switched on, or after adding a folder that
// makes a backlog filable.
router.post('/file-waiting', authenticate, requireRole('admin', 'office'), async (req, res) => {
  try {
    res.json(await costFiling.fileWaiting({ limit: Number(req.body?.limit) || 500 }));
  } catch (err) {
    console.error('[invoice-inbox] file-waiting failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Putting one back, when the app filed it somewhere wrong.
//
// It returns to PDF Check rather than to another folder: the app has already
// had its guess, and the point of undoing is for a person to decide. The wrong
// answer stays recorded as the suggestion, so the next one like it is not
// filed the same way on the strength of a mistake.
router.post('/:id/unfile', authenticate, requireRole('admin', 'office'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE job_cost_scans
          SET status = 'unmatched', folder_id = NULL, filed_automatically = false,
              filed_at = NULL, suggested_folder_id = folder_id,
              filed_because = 'Put back by hand after the app filed it'
        WHERE id = $1 AND status = 'filed'
        RETURNING id, supplier, invoice_number, suggested_folder_id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'That document is not filed' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[invoice-inbox] unfile failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Bulk delete — declared before /:id so "bulk-delete" isn't read as an id
router.post('/bulk-delete', authenticate, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
  try {
    const { rows, rowCount } = await pool.query(
      `DELETE FROM job_cost_scans WHERE id = ANY($1::uuid[]) AND status = 'unmatched' RETURNING storage_key`,
      [ids]
    );
    for (const row of rows) {
      if (row.storage_key) await fileStore.deleteObject(row.storage_key);
    }
    res.json({ message: `Deleted ${rowCount} invoice${rowCount === 1 ? '' : 's'}`, deleted: rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete an inbox scan (not relevant to any job)
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rows, rowCount } = await pool.query(
      `DELETE FROM job_cost_scans WHERE id = $1 AND status = 'unmatched' RETURNING storage_key`,
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
    if (rows[0].storage_key) await fileStore.deleteObject(rows[0].storage_key);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
