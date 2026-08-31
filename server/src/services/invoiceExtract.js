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

STEP 3 — Also read off the supplier name and the invoice or receipt number if
they appear. Use null for either one you cannot find.

Credits, returns, refunds and discounts are real line items — keep them, and
keep the minus sign. A line showing -50.00, (50.00), "CREDIT 50.00" or
"RETURN 50.00" must come back as a negative unit_price of -50.00 so it comes
off the job's costs. Never turn a credit into a positive number.

Ignore totals, subtotals, GST lines, freight/delivery charges, and payment terms.
If you cannot find any line items, return an empty "items" array.

Return ONLY a JSON object, no markdown fences, no explanation:
{"supplier":"Bunnings","invoice_number":"INV-1234","gst_treatment":"exclusive","items":[{"description":"Filter replacement","quantity":2,"unit_price":18.50}]}`;

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
  const items = rawItems
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

  return {
    items,
    gst_treatment: parsed.gst_treatment === 'inclusive' ? 'inclusive' : 'exclusive',
    supplier: parsed.supplier ? String(parsed.supplier).slice(0, 255) : null,
    invoice_number: parsed.invoice_number ? String(parsed.invoice_number).slice(0, 100) : null,
    raw_count: rawItems.length,
  };
}

module.exports = { extractLineItems, IMAGE_MIMES };
