const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { authenticate } = require('../middleware/auth');
const { extractLineItems } = require('../services/invoiceExtract');

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
    const { items, gst_treatment, raw_count } = await extractLineItems({
      base64: data_base64, mimeType: mime_type,
    });
    res.json({ items, gst_treatment, raw_count });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Invoice scan error:', err);
    res.status(500).json({ error: err.message || 'AI extraction failed' });
  }
});

// Fences, retaining walls and the like are priced by the metre run, not by
// enclosed area, so the scan asks a different question depending on mode.
const AREA_PROMPT = `You are a building measurement expert. Analyse this floor plan or room plan image and calculate the total floor area in square metres (m²).

Instructions:
1. Find all labelled dimensions on the plan (e.g. 4200, 3.5m, 12'6", etc.)
2. Convert any imperial measurements to metres (1 foot = 0.3048m, 1 inch = 0.0254m)
3. Calculate the total floor area, accounting for any irregular shapes by breaking them into rectangles
4. If multiple rooms are shown, calculate each room's area and sum them unless the plan clearly shows only one room is intended
5. Ignore wall thickness unless dimensions are clearly interior measurements

Return ONLY a JSON object, no markdown fences, no explanation:
{"area_m2": <number>, "dimensions_found": ["list of key dimensions you found"], "notes": "<brief explanation of how you calculated it>", "confidence": "high|medium|low"}

If you cannot determine the area from the image, return: {"area_m2": null, "error": "reason why"}`;

const LINEAR_PROMPT = `You are a fencing and site measurement expert. Analyse this site plan, boundary plan or sketch and calculate the TOTAL RUN LENGTH in linear metres (m) of the fence or boundary line marked.

Instructions:
1. Find all labelled dimensions along the boundary or fence line (e.g. 4200, 3.5m, 12'6", etc.)
2. Convert any imperial measurements to metres (1 foot = 0.3048m, 1 inch = 0.0254m)
3. Add together every segment that forms the run — a fence line often turns corners, so sum all the sides that are to be fenced
4. This is a LENGTH along a line, NOT an enclosed area. Do not multiply dimensions together.
5. If the plan shows a full perimeter but part of it is clearly an existing fence, a building wall, or marked as excluded, leave that out and say so in the notes
6. If gates are marked, still include their width in the total run and note how many there are

Return ONLY a JSON object, no markdown fences, no explanation:
{"length_m": <number>, "dimensions_found": ["list of the segment lengths you added up"], "notes": "<brief explanation of which sides you included>", "confidence": "high|medium|low"}

If you cannot determine the run length from the image, return: {"length_m": null, "error": "reason why"}`;

router.post('/plan', async (req, res) => {
  const { data_base64, mime_type, mode } = req.body;
  if (!data_base64 || !mime_type) return res.status(400).json({ error: 'Image data required' });
  const linear = mode === 'linear';

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
          { type: 'text', text: linear ? LINEAR_PROMPT : AREA_PROMPT },
        ],
      }],
    });

    const raw = message.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not parse AI response' });

    const parsed = JSON.parse(match[0]);
    const key = linear ? 'length_m' : 'area_m2';
    if (parsed[key] == null) {
      return res.status(422).json({
        error: parsed.error || `Could not determine ${linear ? 'run length' : 'area'} from image`,
      });
    }

    res.json({
      [key]: Math.round(parsed[key] * 100) / 100,
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
