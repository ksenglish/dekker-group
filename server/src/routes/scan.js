const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.post('/invoice', async (req, res) => {
  const { filename, mime_type, data_base64 } = req.body;
  if (!data_base64 || !mime_type) return res.status(400).json({ error: 'file data required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured on this server' });

  try {
    const client = new Anthropic({ apiKey });

    // Strip data URI prefix if present
    const base64Data = data_base64.replace(/^data:[^;]+;base64,/, '');

    let contentBlock;
    if (mime_type === 'application/pdf') {
      contentBlock = {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64Data },
      };
    } else {
      const validImage = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime_type)
        ? mime_type : 'image/jpeg';
      contentBlock = {
        type: 'image',
        source: { type: 'base64', media_type: validImage, data: base64Data },
      };
    }

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          contentBlock,
          {
            type: 'text',
            text: `Extract all line items from this invoice or receipt. Return ONLY a JSON array, no markdown, no explanation.
Each item must have these fields:
- "description": string (item name/description)
- "quantity": number (default 1 if not specified)
- "unit_price": number in dollars (e.g. 45.00 — exclude GST/tax if shown separately)

If a price includes GST and there is no ex-GST price shown, divide by 1.15 to get the ex-GST price.
Ignore totals, subtotals, GST lines, freight/delivery lines, and payment terms.
If you cannot find any line items, return an empty array [].

Example output: [{"description":"Filter replacement","quantity":2,"unit_price":18.50},{"description":"Labour - 2hrs","quantity":1,"unit_price":120.00}]`,
          },
        ],
      }],
    });

    const raw = message.content[0]?.text?.trim() || '[]';
    // Extract JSON array even if model adds surrounding text
    const match = raw.match(/\[[\s\S]*\]/);
    const items = match ? JSON.parse(match[0]) : [];

    // Validate and sanitise
    const clean = items
      .filter(i => i.description && typeof i.unit_price === 'number')
      .map(i => ({
        description: String(i.description).slice(0, 255),
        quantity: Math.max(0.01, parseFloat(i.quantity) || 1),
        unit_price: Math.max(0, parseFloat(i.unit_price) || 0),
      }));

    res.json({ items: clean, raw_count: items.length });
  } catch (err) {
    console.error('Scan error:', err);
    res.status(500).json({ error: err.message || 'AI extraction failed' });
  }
});

module.exports = router;
