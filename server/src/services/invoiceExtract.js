// Reading line items off an invoice, whether it arrived as a photo of a receipt
// or as a supplier PDF. The two differ only in the content block the API wants,
// so the prompt and the cleanup live here once and both callers share them.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-6';
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const PROMPT = `Extract all line items from this invoice or receipt.

STEP 1 — Determine GST treatment by reading the document carefully:
- If there is a separate "GST", "Tax", or "GST (15%)" line showing an amount, the line item prices are GST-EXCLUSIVE (ex-GST). Use them as-is.
- If the document says "GST inclusive", "incl. GST", or "inc GST" near the prices, the prices are GST-INCLUSIVE. Divide by 1.15 to get ex-GST.
- If the subtotal + a GST amount = the total, the line item prices are GST-EXCLUSIVE. Use them as-is.
- If only a grand total is shown with no breakdown, assume GST-INCLUSIVE and divide by 1.15.
Set "gst_treatment" to "exclusive" or "inclusive" to record which case applies.

STEP 2 — Extract each line item with these fields:
- "description": string (item name/description)
- "quantity": number (default 1 if not specified)
- "unit_price": number — always the GST-EXCLUSIVE (ex-GST) price after applying Step 1

STEP 3 — Also read off the supplier name, the invoice or receipt number, and
the date printed on the document as "invoice_date" in YYYY-MM-DD form. Use null
for any you cannot find.

STEP 4 — Decide what kind of document this is and set "document_type":
- "credit_note" if the document calls itself a CREDIT NOTE, CREDIT, REFUND,
  RETURN or ADJUSTMENT NOTE anywhere — most often as a heading at the top —
  or if its grand total is negative.
- "invoice" otherwise.
A credit note gives money back, so EVERY line on it is money off the job.

STEP 5 — Read the document's grand total into "document_total", as a number,
keeping its sign. On a credit note this is negative (e.g. -48.36). Use the
GST-exclusive total where the document shows one, otherwise the inclusive one.
Use null if you genuinely cannot find a total.

Credits, returns, refunds and discounts are real line items — keep them, and
keep the minus sign. A line showing -50.00, (50.00), a quantity of -1, "CREDIT
50.00" or "RETURN 50.00" must come back as a negative unit_price of -50.00 so
it comes off the job's costs. Never turn a credit into a positive number.

Ignore totals, subtotals, GST lines, freight/delivery charges, and payment terms.
If you cannot find any line items, return an empty "items" array.

Return ONLY a JSON object, no markdown fences, no explanation:
{"supplier":"Bunnings","invoice_number":"INV-1234","gst_treatment":"exclusive","invoice_date":"2026-09-29","document_type":"invoice","document_total":37.00,"items":[{"description":"Filter replacement","quantity":2,"unit_price":18.50}]}`;

// A PDF goes in a document block and an image in an image block. Anything we
// don't recognise is treated as a JPEG, which is what the old scan route did.
function sourceBlock(mimeType, data) {
  if (mimeType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  const media_type = IMAGE_MIMES.includes(mimeType) ? mimeType : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type, data } };
}

async function extractLineItems({ base64, mimeType }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error('ANTHROPIC_API_KEY is not configured on this server'), { status: 503 });

  const data = String(base64).replace(/^data:[^;]+;base64,/, '');
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: [sourceBlock(mimeType, data), { type: 'text', text: PROMPT }] }],
  });

  const raw = (message.content.find(b => b.type === 'text')?.text || '').trim();
  const objMatch = raw.match(/\{[\s\S]*\}/);
  let parsed = {};
  try { parsed = objMatch ? JSON.parse(objMatch[0]) : {}; } catch { parsed = {}; }

  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  let items = rawItems
    .filter(i => i.description && typeof i.unit_price === 'number')
    .map(i => {
      // A credit can arrive either way round — a negative price, or a negative
      // quantity against a positive price — so what matters is the sign of the
      // line total. That sign is carried on unit_price and the quantity kept
      // positive, which is the shape the costs table and its totals expect.
      // (Both negative multiplies out positive, and is left that way.)
      const qtyRaw = parseFloat(i.quantity);
      const priceRaw = parseFloat(i.unit_price);
      const qty = Number.isFinite(qtyRaw) && qtyRaw !== 0 ? qtyRaw : 1;
      const price = Number.isFinite(priceRaw) ? priceRaw : 0;
      const isCredit = qty * price < 0;
      return {
        description: String(i.description).slice(0, 255),
        quantity: Math.max(0.01, Math.abs(qty)),
        unit_price: isCredit ? -Math.abs(price) : Math.abs(price),
      };
    });

  // ── Make the sign depend on more than one minus character ────────────────
  //
  // A credit note was coming through as a positive cost. The sign was on a
  // quantity of -1 in a table cell — easy to miss, and once missed the money
  // was added to the job instead of taken off it.
  //
  // So it is cross-checked against two things that are hard to miss: the word
  // CREDIT NOTE printed across the top, and the grand total. Either one saying
  // "this is money back" is enough.
  const totalRaw = parseFloat(parsed.document_total);
  const documentTotal = Number.isFinite(totalRaw) ? totalRaw : null;
  const saysCredit = parsed.document_type === 'credit_note';
  const totalIsNegative = documentTotal != null && documentTotal < 0;
  const isCreditNote = saysCredit || totalIsNegative;

  const lineSum = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  let signCorrected = false;

  if (isCreditNote) {
    // Every line on a credit note comes off the job, whatever the model made
    // of the individual minus signs.
    if (items.some(i => i.unit_price > 0)) signCorrected = true;
    items = items.map(i => ({ ...i, unit_price: -Math.abs(i.unit_price) }));
  } else if (documentTotal != null && documentTotal > 0 && lineSum < 0 && items.length) {
    // The other way round, and rarer: a positive invoice whose lines came back
    // negative. Trust the printed total.
    signCorrected = true;
    items = items.map(i => ({ ...i, unit_price: Math.abs(i.unit_price) }));
  }

  return {
    items,
    gst_treatment: parsed.gst_treatment === 'inclusive' ? 'inclusive' : 'exclusive',
    supplier: parsed.supplier ? String(parsed.supplier).slice(0, 255) : null,
    invoice_number: parsed.invoice_number ? String(parsed.invoice_number).slice(0, 100) : null,
    // Only a real date gets through — anything else would be stored as null by
    // Postgres anyway, and a half-parsed date is worse than none.
    invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.invoice_date || '')) ? parsed.invoice_date : null,
    document_type: isCreditNote ? 'credit_note' : 'invoice',
    document_total: documentTotal,
    // So the screen can say "read as a credit note — every line comes off the
    // job" rather than leaving someone to notice the minus signs themselves.
    is_credit_note: isCreditNote,
    sign_corrected: signCorrected,
    raw_count: rawItems.length,
  };
}

module.exports = { extractLineItems, IMAGE_MIMES };
