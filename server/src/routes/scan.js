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
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

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

router.post('/plan', async (req, res) => {
  const { data_base64, mime_type } = req.body;
  if (!data_base64 || !mime_type) return res.status(400).json({ error: 'Image data required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'GEMINI_API_KEY is not configured on this server' });

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

    const base64Data = data_base64.replace(/^data:[^;]+;base64,/, '');
    const validMime = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime_type) ? mime_type : 'image/jpeg';

    const prompt = `You are a building measurement expert. Analyse this floor plan or room plan image and calculate the total floor area in square metres (m²).

Instructions:
1. Find all labelled dimensions on the plan (e.g. 4200, 3.5m, 12'6", etc.)
2. Convert any imperial measurements to metres (1 foot = 0.3048m, 1 inch = 0.0254m)
3. Calculate the total floor area, accounting for any irregular shapes by breaking them into rectangles
4. If multiple rooms are shown, calculate each room's area and sum them unless the plan clearly shows only one room is intended
5. Ignore wall thickness unless dimensions are clearly interior measurements

Return ONLY a JSON object, no markdown fences, no explanation:
{"area_m2": <number>, "dimensions_found": ["list of key dimensions you found"], "notes": "<brief explanation of how you calculated it>", "confidence": "high|medium|low"}

If you cannot determine the area from the image, return: {"area_m2": null, "error": "reason why"}`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType: validMime, data: base64Data } },
    ]);

    const raw = result.response.text().trim();
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
    console.error('Plan scan error:', err);
    res.status(500).json({ error: err.message || 'AI scan failed' });
  }
});

module.exports = router;
