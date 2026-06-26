/**
 * Dekker Air — Automated Supplier Invoice Processor
 *
 * Runs every 5 minutes via a time-based trigger.
 * For each Gmail email with a PDF attachment:
 *   1. Extracts text from the PDF using Google Drive OCR
 *   2. Uses Claude AI to find the job number and parse line items
 *   3. Posts the PDF + line items to the Dekker App as job costs
 *   4. Labels the email as processed so it isn't processed again
 *
 * SETUP (one-time):
 *   1. Open script.google.com → New project → paste this file
 *   2. Add two Script Properties (Project Settings → Script Properties):
 *        DEKKER_API_KEY   →  <generate a random string, add same to Render env var AUTOMATION_API_KEY>
 *        ANTHROPIC_API_KEY → <your Anthropic API key from console.anthropic.com>
 *   3. Enable the Drive API: Services → Drive API → Add
 *   4. Run setupTrigger() once manually to create the recurring trigger
 *   5. Authorise the permissions when prompted
 */

const DEKKER_API = 'https://dekker-group.onrender.com';
const PROCESSED_LABEL = 'invoice-processed';
const FAILED_LABEL = 'invoice-failed';

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

  // Search for emails with PDF attachments not yet processed
  const threads = GmailApp.search(
    `has:attachment filename:pdf -label:${PROCESSED_LABEL} -label:${FAILED_LABEL} after:2026/06/27`,
    0, 5  // small batch — OCR is slow, keep well under the 6-min Apps Script limit
  );

  console.log(`Found ${threads.length} unprocessed threads`);

  for (const thread of threads) {
    let threadHandled = false;

    for (const message of thread.getMessages()) {
      const attachments = message.getAttachments({ includeInlineImages: false });

      for (const attachment of attachments) {
        if (!attachment.getContentType().includes('pdf')) continue;

        const filename = attachment.getName();
        console.log(`Processing attachment: ${filename} from ${message.getFrom()}`);

        try {
          // 1. Extract text from PDF via Google Drive OCR
          const pdfText = extractTextFromPdf(attachment);
          console.log(`Extracted ${pdfText.length} chars from ${filename}`);

          // 2. Use Claude to find job number + parse line items
          const parsed = parseInvoiceWithClaude(pdfText, anthropicKey);
          if (!parsed) {
            console.warn(`Claude could not parse ${filename}`);
            continue;
          }

          const { jobNumber, items, supplier, invoiceNumber } = parsed;
          console.log(`Job: ${jobNumber}, Supplier: ${supplier}, Items: ${items.length}`);

          if (!jobNumber) {
            console.log(`No job number found in ${filename} — skipping`);
            threadHandled = true; // still label so we don't retry
            continue;
          }

          // 3. Look up job in Dekker App
          const job = findJob(jobNumber, apiKey);
          if (!job) {
            console.warn(`Job ${jobNumber} not found in app — skipping`);
            threadHandled = true; // still label so we don't retry
            continue;
          }

          // 4. Convert PDF to base64 for upload
          const pdfBase64 = Utilities.base64Encode(attachment.getBytes());

          // 5. Post PDF + line items to app
          postCosts(job.id, pdfBase64, items, apiKey);

          console.log(`✅ Posted ${items.length} cost items to Job #${job.job_number} (${job.title})`);
          threadHandled = true;

        } catch (err) {
          console.error(`Error processing ${filename}: ${err.message}`);
          thread.addLabel(failedLabel);
        }
      }
    }

    if (threadHandled) {
      thread.addLabel(processedLabel);
    }
  }
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
4. items: Array of line items, each with:
   - description: product or service description
   - quantity: numeric quantity (default 1 if not shown)
   - unit_price: unit price in dollars as a decimal number (e.g. 45.99)

Only include actual product/service line items. Exclude subtotals, GST, delivery charges, and grand totals.

Return ONLY valid JSON in this exact format, no explanation:
{
  "jobNumber": "JB580",
  "supplier": "Bunnings Warehouse",
  "invoiceNumber": "INV-12345",
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

// Run this ONCE manually to set up the recurring trigger
function setupTrigger() {
  // Remove any existing triggers for this function
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processSupplierInvoices')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // Run every 5 minutes
  ScriptApp.newTrigger('processSupplierInvoices')
    .timeBased()
    .everyMinutes(5)
    .create();

  console.log('Trigger created — processSupplierInvoices will run every 5 minutes');
}

// Run this ONCE to label all old emails (before 27 Jun 2026) as processed so they are skipped
function labelOldEmailsAsProcessed() {
  ensureLabel(PROCESSED_LABEL);
  const label = GmailApp.getUserLabelByName(PROCESSED_LABEL);
  let start = 0;
  let total = 0;
  while (true) {
    const threads = GmailApp.search(
      `has:attachment filename:pdf -label:${PROCESSED_LABEL} before:2026/06/27`,
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
