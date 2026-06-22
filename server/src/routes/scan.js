const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

function anthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw { status: 503, message: 'ANTHROPIC_API_KEY is not configured on this server' };
  return new Anthropic({ apiKey });
}

const MODEL = 'claude-sonnet-4-6';

router.post('/invoice', async (req, res) => {
  const { mime_type, data_base64 } = req.body;
  if (!data_base64 || !mime_type) return res.status(400).json({ error: 'file data required' });

  try {
    const client = anthropicClient();
    const base64Data = data_base64.replace(/^data:[^;]+;base64,/, '');
    const validMime = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime_type)
      ? mime_type : 'image/jpeg';

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: validMime, data: base64Data } },
          {
            type: 'text',
            text: `Extract all line items from this invoice or receipt.

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

Ignore totals, subtotals, GST lines, freight/delivery charges, and payment terms.
If you cannot find any line items, return: {"gst_treatment":"exclusive","items":[]}

Return ONLY a JSON object, no markdown fences, no explanation:
{"gst_treatment":"exclusive","items":[{"description":"Filter replacement","quantity":2,"unit_price":18.50}]}`,
          },
        ],
      }],
    });

    const raw = message.content[0].text.trim();
    const objMatch = raw.match(/\{[\s\S]*\}/);
    let parsed = {};
    try { parsed = objMatch ? JSON.parse(objMatch[0]) : {}; } catch { parsed = {}; }

    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const gst_treatment = parsed.gst_treatment === 'inclusive' ? 'inclusive' : 'exclusive';

    const clean = rawItems
      .filter(i => i.description && typeof i.unit_price === 'number')
      .map(i => ({
        description: String(i.description).slice(0, 255),
        quantity: Math.max(0.01, parseFloat(i.quantity) || 1),
        unit_price: Math.max(0, parseFloat(i.unit_price) || 0),
      }));

    res.json({ items: clean, gst_treatment, raw_count: rawItems.length });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Invoice scan error:', err);
    res.status(500).json({ error: err.message || 'AI extraction failed' });
  }
});

router.post('/plan', async (req, res) => {
  const { data_base64, mime_type } = req.body;
  if (!data_base64 || !mime_type) return res.status(400).json({ error: 'Image data required' });

  try {
    const client = anthropicClient();
    const base64Data = data_base64.replace(/^data:[^;]+;base64,/, '');
    const validMime = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime_type)
      ? mime_type : 'image/jpeg';

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: validMime, data: base64Data } },
          {
            type: 'text',
            text: `You are a building measurement expert. Analyse this floor plan or room plan image and calculate the total floor area in square metres (m²).

Instructions:
1. Find all labelled dimensions on the plan (e.g. 4200, 3.5m, 12'6", etc.)
2. Convert any imperial measurements to metres (1 foot = 0.3048m, 1 inch = 0.0254m)
3. Calculate the total floor area, accounting for any irregular shapes by breaking them into rectangles
4. If multiple rooms are shown, calculate each room's area and sum them unless the plan clearly shows only one room is intended
5. Ignore wall thickness unless dimensions are clearly interior measurements

Return ONLY a JSON object, no markdown fences, no explanation:
{"area_m2": <number>, "dimensions_found": ["list of key dimensions you found"], "notes": "<brief explanation of how you calculated it>", "confidence": "high|medium|low"}

If you cannot determine the area from the image, return: {"area_m2": null, "error": "reason why"}`,
          },
        ],
      }],
    });

    const raw = message.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not parse AI response' });

    const parsed = JSON.parse(match[0]);
    if (parsed.area_m2 == null) {
      return res.status(422).json({ error: parsed.error || 'Could not determine area from image' });
    }

    res.json({
      area_m2: Math.round(parsed.area_m2 * 100) / 100,
      dimensions_found: parsed.dimensions_found || [],
      notes: parsed.notes || '',
      confidence: parsed.confidence || 'medium',
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Plan scan error:', err);
    res.status(500).json({ error: err.message || 'AI scan failed' });
  }
});

module.exports = router;
