/**
 * Dekker Air — Automated Supplier Invoice Processor
 *
 * Runs every 5 minutes via a time-based trigger, working through as many
 * invoices as fit in the time Apps Script allows and leaving the rest for the
 * next run. Nothing older than EARLIEST is looked at.
 *
 * For each PDF attachment:
 *   1. Fingerprints the file and asks the app whether it has been seen. The
 *      same PDF quoted back on every reply in a thread stops here, before any
 *      OCR or model call is paid for.
 *   2. Extracts text from the PDF using Google Drive OCR
 *   3. Uses Claude to find the job number and parse line items
 *   4. Asks again now the supplier and invoice number are known, which catches
 *      the same invoice re-sent as a different file
 *   5. Posts the PDF + line items to the Dekker App as job costs
 *   6. Labels the thread so the search moves past it
 *
 * SETUP (one-time):
 *   1. Open script.google.com → New project → paste this file
 *   2. Add two Script Properties (Project Settings → Script Properties):
 *        DEKKER_API_KEY   →  <generate a random string, add same to Render env var AUTOMATION_API_KEY>
 *        ANTHROPIC_API_KEY → <your Anthropic API key from console.anthropic.com>
 *   3. Enable the Drive API: Services → Drive API → Add
 *   4. Run setupTrigger() once manually to create the recurring trigger
 *   5. Authorise the permissions when prompted
 *
 * After changing the schedule here, run setupTrigger() again — it clears the
 * old triggers first, so the new one does not end up running alongside them.
 */

const DEKKER_API = 'https://dekker-group.onrender.com';
const PROCESSED_LABEL = 'invoice-processed';
const FAILED_LABEL = 'invoice-failed';

// How often the trigger fires. Used by setupTrigger(), and by the run itself
// to work out how long it may keep going.
const RUN_EVERY_MINUTES = 5;

// Nothing older than this is looked at. Invoices before it were brought in by
// hand or are not wanted, and without a floor every run drags the whole
// mailbox back through the search.
const EARLIEST = '2026/09/01';

// Apps Script kills a run at six minutes. Stopping ourselves at four leaves
// room to finish the invoice in hand and label its thread, so a long OCR never
// loses work — the next run picks up where this one left off.
const BUDGET_MS = 4 * 60 * 1000;

// How many threads to pull per search page. The run stops on the clock, not on
// the count, so this only decides how often it goes back to Gmail for more.
const PAGE = 10;

// ─── Entry point (called by time trigger) ────────────────────────────────────

function processSupplierInvoices() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('DEKKER_API_KEY');
  const anthropicKey = props.getProperty('ANTHROPIC_API_KEY');

  if (!apiKey || !anthropicKey) {
    console.error('Missing DEKKER_API_KEY or ANTHROPIC_API_KEY in Script Properties');
    return;
  }

  ensureLabel(PROCESSED_LABEL);
  ensureLabel(FAILED_LABEL);

  const processedLabel = GmailApp.getUserLabelByName(PROCESSED_LABEL);
  const failedLabel = GmailApp.getUserLabelByName(FAILED_LABEL);

  const started = Date.now();
  const query = `has:attachment filename:pdf -label:${PROCESSED_LABEL} -label:${FAILED_LABEL} after:${EARLIEST}`;
  const tally = { threads: 0, posted: 0, inbox: 0, duplicates: 0, failed: 0 };

  // Keep going until the clock says stop. The label comes off a thread as it
  // is finished, so the next search starts where this one gave up and the same
  // page is never read twice.
  let outOfTime = false;
  while (!outOfTime) {
    const threads = GmailApp.search(query, 0, PAGE);
    if (threads.length === 0) break;

    for (const thread of threads) {
      if (Date.now() - started > BUDGET_MS) { outOfTime = true; break; }
      if (handleThread(thread, apiKey, anthropicKey, tally)) {
        thread.addLabel(processedLabel);
      } else {
        // Nothing in it we could deal with — label it so the search moves on
        // rather than returning the same thread every five minutes.
        thread.addLabel(failedLabel);
      }
      tally.threads++;
    }
  }

  console.log(
    `Run finished in ${Math.round((Date.now() - started) / 1000)}s — `
    + `${tally.threads} threads, ${tally.posted} posted to jobs, ${tally.inbox} to the inbox, `
    + `${tally.duplicates} already seen, ${tally.failed} failed`
    + (outOfTime ? ' (stopped on time, more to do next run)' : '')
  );
}

// One thread. Returns true when everything in it was dealt with.
function handleThread(thread, apiKey, anthropicKey, tally) {
  let handled = false;

  for (const message of thread.getMessages()) {
    for (const attachment of message.getAttachments({ includeInlineImages: false })) {
      if (!attachment.getContentType().includes('pdf')) continue;

      const filename = attachment.getName();
      const bytes = attachment.getBytes();
      const fingerprint = sha256(bytes);

      // Asked before anything is read. A PDF quoted back on every reply in a
      // thread is the commonest duplicate there is, and recognising it from
      // its bytes costs nothing — no OCR pass, no model call, no money.
      const claim = claimDocument({ fingerprint, source: filename }, apiKey);
      if (claim && !claim.claimed) {
        console.log(`Skipping ${filename} — already dealt with (${claim.reason})`);
        tally.duplicates++;
        handled = true;
        continue;
      }

      let parsed = null;
      let pdfBase64 = null;

      try {
        const pdfText = extractTextFromPdf(attachment);
        console.log(`Extracted ${pdfText.length} chars from ${filename}`);

        parsed = parseInvoiceWithClaude(pdfText, anthropicKey);
        pdfBase64 = Utilities.base64Encode(bytes);

        if (!parsed) {
          console.warn(`Could not parse ${filename} — sending to Invoice Inbox`);
          saveToInbox(pdfBase64, null, apiKey);
          claimDocument({ fingerprint, outcome: 'inbox' }, apiKey);
          tally.inbox++;
          handled = true;
          continue;
        }

        const { jobNumber, items, supplier, invoiceNumber } = parsed;
        console.log(`Job: ${jobNumber}, Supplier: ${supplier}, Items: ${items.length}`);

        // Now the invoice has a name and a number, ask again: the same invoice
        // can arrive as a freshly rendered PDF, which the bytes cannot catch.
        const named = claimDocument(
          { fingerprint, supplier: supplier, invoice_number: invoiceNumber, outcome: 'claimed' }, apiKey);
        if (named && !named.claimed && named.reason === 'same_invoice') {
          const where = named.duplicate_of || {};
          console.log(`Skipping ${filename} — ${supplier} ${invoiceNumber} is already in the app`
            + (where.job_id ? ` on a job` : ''));
          tally.duplicates++;
          handled = true;
          continue;
        }

        // A statement is a summary of invoices already charged, and a
        // remittance is a record of paying them. Posting either onto a job
        // would charge the same materials to it twice, so they go to the
        // inbox to be filed whatever job number they happen to mention.
        const summary = parsed.documentType === 'statement' || parsed.documentType === 'remittance';
        if (summary) {
          console.log(`${filename} is a ${parsed.documentType} — filing it, not posting it to a job`);
          saveToInbox(pdfBase64, parsed, apiKey);
          claimDocument({ fingerprint, outcome: 'inbox' }, apiKey);
          tally.inbox++;
          handled = true;
          continue;
        }

        if (!jobNumber) {
          console.log(`No job number in ${filename} — sending to Invoice Inbox`);
          saveToInbox(pdfBase64, parsed, apiKey);
          claimDocument({ fingerprint, outcome: 'inbox' }, apiKey);
          tally.inbox++;
          handled = true;
          continue;
        }

        const job = findJob(jobNumber, apiKey);
        if (!job) {
          console.warn(`Job ${jobNumber} not found — sending to Invoice Inbox`);
          saveToInbox(pdfBase64, parsed, apiKey);
          claimDocument({ fingerprint, outcome: 'inbox' }, apiKey);
          tally.inbox++;
          handled = true;
          continue;
        }

        postCosts(job.id, pdfBase64, items, apiKey);
        claimDocument({ fingerprint, outcome: 'posted', job_id: job.id }, apiKey);
        console.log(`✅ Posted ${items.length} cost items to Job #${job.job_number}`);
        tally.posted++;
        handled = true;

      } catch (err) {
        console.error(`Error processing ${filename}: ${err.message}`);
        tally.failed++;
        try {
          if (!pdfBase64) pdfBase64 = Utilities.base64Encode(bytes);
          saveToInbox(pdfBase64, parsed, apiKey);
          claimDocument({ fingerprint, outcome: 'inbox' }, apiKey);
          handled = true;
        } catch (e2) {
          console.error('Could not save to inbox either:', e2.message);
          // The claim goes back, so a failure that might not happen again —
          // the app restarting, a timeout — does not bury the invoice for good.
          releaseDocument(fingerprint, apiKey);
        }
      }
    }
  }

  return handled;
}

// ─── PDF text extraction via Google Drive OCR ────────────────────────────────

function extractTextFromPdf(attachment) {
  const blob = attachment.copyBlob().setContentType('application/pdf');

  // Drive API v3: Files.create() with ocrLanguage triggers automatic OCR
  const file = Drive.Files.create(
    {
      name: `_ocr_temp_${Date.now()}`,
      mimeType: 'application/vnd.google-apps.document',
    },
    blob,
    { ocrLanguage: 'en' }
  );

  try {
    const doc = DocumentApp.openById(file.id);
    const text = doc.getBody().getText();
    return text;
  } finally {
    DriveApp.getFileById(file.id).setTrashed(true);
  }
}

// ─── Claude invoice parser ────────────────────────────────────────────────────

function parseInvoiceWithClaude(invoiceText, anthropicKey) {
  const prompt = `You are parsing a supplier invoice to extract structured data for a job management system.

Extract the following from this invoice text:
1. jobNumber: The job reference number. It may appear as "JB00580", "Job #580", "Job: 1234", "Ref: JB1234" or similar. Return just the number including any JB prefix (e.g. "JB580" or "1234").
2. supplier: The supplier/company name
3. invoiceNumber: The invoice number/reference
4. documentType: What kind of document this is. One of exactly:
   - "invoice" — a charge for goods or services supplied
   - "statement" — a summary of an account over a period, usually listing several invoices and a balance owing
   - "credit_note" — a refund or reversal
   - "remittance" — advice that a payment has been made
   - "other" — anything else
   A statement normally says "Statement" at the top, covers a date range, and
   lists invoice numbers with a closing balance rather than individual products.
5. items: Array of line items, each with:
   - description: product or service description
   - quantity: numeric quantity (default 1 if not shown)
   - unit_price: unit price in dollars as a decimal number (e.g. 45.99)

Only include actual product/service line items. Exclude subtotals, GST, delivery charges, and grand totals.

Return ONLY valid JSON in this exact format, no explanation:
{
  "jobNumber": "JB580",
  "supplier": "Bunnings Warehouse",
  "invoiceNumber": "INV-12345",
  "documentType": "invoice",
  "items": [
    { "description": "25mm Copper Pipe 3m", "quantity": 2, "unit_price": 18.50 }
  ]
}

If you cannot find a job number, set jobNumber to null.
If you cannot find any line items, return an empty items array.

Invoice text:
${invoiceText.substring(0, 6000)}`;

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    payload: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    console.error('Claude API error:', response.getContentText());
    return null;
  }

  const result = JSON.parse(response.getContentText());
  const text = result.content[0].text.trim();

  try {
    return JSON.parse(text);
  } catch {
    // Claude sometimes wraps JSON in markdown code blocks
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return JSON.parse(match[1]);
    return null;
  }
}

// ─── Dekker App API calls ─────────────────────────────────────────────────────

// Asking the app whether this document has been dealt with, and telling it
// what we learned. Called more than once for the same file on purpose: first
// with only the fingerprint, before anything expensive happens, then again
// once the supplier and invoice number are known.
//
// A claim that cannot be made — the app down, the network gone — returns null,
// and the caller carries on. Scanning an invoice twice is a nuisance; refusing
// to scan anything because the bookkeeping call failed is worse.
function claimDocument(body, apiKey) {
  try {
    const response = UrlFetchApp.fetch(`${DEKKER_API}/api/invoice-inbox/claim`, {
      method: 'post',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) {
      console.warn('Claim failed:', response.getContentText());
      return null;
    }
    return JSON.parse(response.getContentText());
  } catch (err) {
    console.warn('Claim call failed:', err.message);
    return null;
  }
}

function releaseDocument(fingerprint, apiKey) {
  try {
    UrlFetchApp.fetch(`${DEKKER_API}/api/invoice-inbox/release`, {
      method: 'post',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ fingerprint: fingerprint }),
      muteHttpExceptions: true,
    });
  } catch (err) {
    console.warn('Release call failed:', err.message);
  }
}

// The file's own fingerprint. computeDigest hands back signed bytes, so each
// one is masked to 0-255 before it is written out as hex — without that, half
// of them come out negative and the digest is wrong.
function sha256(bytes) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  let out = '';
  for (let i = 0; i < digest.length; i++) {
    const b = (digest[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function findJob(jobNumber, apiKey) {
  const response = UrlFetchApp.fetch(
    `${DEKKER_API}/api/jobs/by-number/${encodeURIComponent(jobNumber)}`,
    {
      headers: { 'X-API-Key': apiKey },
      muteHttpExceptions: true,
    }
  );

  if (response.getResponseCode() === 404) return null;
  if (response.getResponseCode() !== 200) {
    throw new Error(`Job lookup failed: ${response.getContentText()}`);
  }

  return JSON.parse(response.getContentText());
}

// ─── Invoice Inbox (unmatched invoices) ──────────────────────────────────────

function saveToInbox(pdfBase64, parsed, apiKey) {
  const body = {
    document_base64: `data:application/pdf;base64,${pdfBase64}`,
    mime_type: 'application/pdf',
    supplier: parsed ? parsed.supplier : null,
    invoice_number: parsed ? parsed.invoiceNumber : null,
    detected_job_number: parsed ? parsed.jobNumber : null,
    parsed_items: parsed && parsed.items ? parsed.items : [],
    // What kind of document it is. The app files on this: a statement and an
    // invoice from the same supplier belong in different folders.
    document_type: parsed ? parsed.documentType : null,
  };
  const response = UrlFetchApp.fetch(`${DEKKER_API}/api/invoice-inbox`, {
    method: 'post',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 201) {
    console.error('Failed to save to inbox:', response.getContentText());
  } else {
    console.log('Saved to Invoice Inbox for manual review');
  }
}

function postCosts(jobId, pdfBase64, items, apiKey) {
  const body = {
    document_base64: `data:application/pdf;base64,${pdfBase64}`,
    mime_type: 'application/pdf',
    gst_treatment: 'exclusive',
    items: items.map(item => ({
      description: item.description,
      quantity: item.quantity || 1,
      unit_price: item.unit_price || 0,
    })),
  };

  const response = UrlFetchApp.fetch(`${DEKKER_API}/api/jobs/${jobId}/costs`, {
    method: 'post',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 201) {
    throw new Error(`Failed to post costs: ${response.getContentText()}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureLabel(name) {
  if (!GmailApp.getUserLabelByName(name)) {
    GmailApp.createLabel(name);
  }
}

// Run this ONCE manually to set up the recurring trigger.
//
// Re-run it after changing the schedule: it clears whatever is there first, so
// it cannot leave the old triggers running alongside the new one.
function setupTrigger() {
  // Remove any existing triggers for this function
  const existing = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processSupplierInvoices');
  existing.forEach(t => ScriptApp.deleteTrigger(t));
  if (existing.length) console.log(`Removed ${existing.length} existing trigger(s)`);

  ScriptApp.newTrigger('processSupplierInvoices')
    .timeBased()
    .everyMinutes(RUN_EVERY_MINUTES)
    .create();

  console.log(`Trigger created — processSupplierInvoices runs every ${RUN_EVERY_MINUTES} minutes`);
}

// Run this ONCE to label everything before EARLIEST as processed, so the
// search has less to wade through. The date floor in the query already skips
// them; this just stops Gmail looking at them at all.
function labelOldEmailsAsProcessed() {
  ensureLabel(PROCESSED_LABEL);
  const label = GmailApp.getUserLabelByName(PROCESSED_LABEL);
  let start = 0;
  let total = 0;
  while (true) {
    const threads = GmailApp.search(
      `has:attachment filename:pdf -label:${PROCESSED_LABEL} before:${EARLIEST}`,
      start, 50
    );
    if (threads.length === 0) break;
    threads.forEach(t => t.addLabel(label));
    total += threads.length;
    console.log(`Labelled ${total} threads so far…`);
    start += 50;
    Utilities.sleep(1000); // avoid hitting rate limits
  }
  console.log(`Done — ${total} old threads labelled as ${PROCESSED_LABEL}`);
}

// Run this manually to queue older emails for reprocessing.
// Example: reprocessEmailsFrom('2026/06/01', '2026/07/01') — re-queues all
// invoice emails from June 2026.  The daily trigger will then work through them
// 5 at a time.  Safe to call multiple times — it only touches emails that
// already have the invoice-processed label.
function reprocessEmailsFrom(afterDate, beforeDate) {
  const label = GmailApp.getUserLabelByName(PROCESSED_LABEL);
  if (!label) { console.log('No invoice-processed label found — nothing to do'); return; }

  const datePart = beforeDate ? `after:${afterDate} before:${beforeDate}` : `after:${afterDate}`;
  let start = 0;
  let total = 0;
  while (true) {
    const threads = GmailApp.search(
      `has:attachment filename:pdf label:${PROCESSED_LABEL} ${datePart}`,
      start, 50
    );
    if (threads.length === 0) break;
    threads.forEach(t => t.removeLabel(label));
    total += threads.length;
    console.log(`Re-queued ${total} threads so far…`);
    start += 50;
    Utilities.sleep(1000);
  }
  console.log(`Done — ${total} threads removed from invoice-processed and queued for reprocessing`);
}

// Run this manually to test on a single thread by Gmail thread ID
function testWithThread(threadId) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('DEKKER_API_KEY');
  const anthropicKey = props.getProperty('ANTHROPIC_API_KEY');
  const thread = GmailApp.getThreadById(threadId);
  if (!thread) { console.error('Thread not found'); return; }
  console.log(`Testing with thread: ${thread.getFirstMessageSubject()}`);
  // Temporarily remove processed label so it gets picked up
  const processed = GmailApp.getUserLabelByName(PROCESSED_LABEL);
  if (processed) thread.removeLabel(processed);
  processSupplierInvoices();
}
