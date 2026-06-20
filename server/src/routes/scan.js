const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.post('/invoice', async (req, res) => {
  const { filename, mime_type, data_base64 } = req.body;
  if (!data_base64 || !mime_type) return res.status(400).json({ error: 'file data required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'GEMINI_API_KEY is not configured on this server' });

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const base64Data = data_base64.replace(/^data:[^;]+;base64,/, '');
    const validMime = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'].includes(mime_type)
      ? mime_type : 'image/jpeg';

    const prompt = `Extract all line items from this invoice or receipt. Return ONLY a JSON array, no markdown fences, no explanation.
Each item must have these fields:
- "description": string (item name/description)
- "quantity": number (default 1 if not specified)
- "unit_price": number in dollars (exclude GST/tax if shown separately; if only GST-inclusive price shown, divide by 1.15)

Ignore totals, subtotals, GST lines, freight/delivery charges, and payment terms.
If you cannot find any line items, return an empty array [].

Example: [{"description":"Filter replacement","quantity":2,"unit_price":18.50},{"description":"Labour","quantity":1,"unit_price":120.00}]`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: validMime, data: base64Data } },
    ]);

    const raw = result.response.text().trim();
    const match = raw.match(/\[[\s\S]*\]/);
    const items = match ? JSON.parse(match[0]) : [];

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
