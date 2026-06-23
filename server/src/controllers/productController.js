const pool = require('../db/pool');
const AdmZip = require('adm-zip');

async function list(req, res) {
  const { search, category, active } = req.query;
  const conditions = ['1=1'];
  const params = [];
  let p = 1;

  if (active !== 'false') { conditions.push(`p.is_active = true`); }
  if (category) { conditions.push(`p.category = $${p}`); params.push(category); p++; }
  if (search) {
    conditions.push(`(p.name ILIKE $${p} OR p.description ILIKE $${p} OR p.category ILIKE $${p})`);
    params.push(`%${search}%`); p++;
  }

  try {
    // Exclude large binary columns from list — fetched on demand via GET /products/:id
    const { rows } = await pool.query(
      `SELECT id, name, description, category, unit, unit_price, cost_price, supplier, is_active, created_at, updated_at
       FROM products p WHERE ${conditions.join(' AND ')} ORDER BY p.category, p.name`,
      params
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function get(req, res) {
  try {
    const { rows } = await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function create(req, res) {
  const { name, description, category, unit, unit_price, supplier, cost_price, media_base64, brochure_base64 } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO products (name, description, category, unit, unit_price, supplier, cost_price, media_base64, brochure_base64)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, description || null, category || null, unit || 'each',
       Math.round((unit_price || 0) * 100), supplier || null,
       Math.round((cost_price || 0) * 100), media_base64 || null, brochure_base64 || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function update(req, res) {
  const { name, description, category, unit, unit_price, is_active, supplier, cost_price, media_base64, brochure_base64 } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE products SET name=$1, description=$2, category=$3, unit=$4,
       unit_price=$5, is_active=$6, supplier=$7, cost_price=$8, media_base64=$9, brochure_base64=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [name, description || null, category || null, unit || 'each',
       Math.round((unit_price || 0) * 100), is_active !== false,
       supplier || null, Math.round((cost_price || 0) * 100),
       media_base64 !== undefined ? media_base64 : null,
       brochure_base64 !== undefined ? brochure_base64 : null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function remove(req, res) {
  try {
    await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function importCsv(req, res) {
  // Expects: name, description, category, unit, unit_price (dollars)
  const lines = (req.body.csv || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one product' });

  const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
  const idx = { name: headers.indexOf('name'), description: headers.indexOf('description'),
    category: headers.indexOf('category'), unit: headers.indexOf('unit'),
    unit_price: headers.indexOf('unit_price'), cost_price: headers.indexOf('cost_price'),
    supplier: headers.indexOf('supplier') };

  if (idx.name === -1) return res.status(400).json({ error: 'CSV must have a "name" column' });

  const results = { imported: 0, errors: [] };
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const name = cols[idx.name];
    if (!name) continue;
    try {
      await pool.query(
        `INSERT INTO products (name, description, category, unit, unit_price, cost_price, supplier)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT DO NOTHING`,
        [name,
         idx.description > -1 ? cols[idx.description] || null : null,
         idx.category > -1 ? cols[idx.category] || null : null,
         idx.unit > -1 ? cols[idx.unit] || 'each' : 'each',
         Math.round(parseFloat(idx.unit_price > -1 ? cols[idx.unit_price] || 0 : 0) * 100),
         Math.round(parseFloat(idx.cost_price > -1 ? cols[idx.cost_price] || 0 : 0) * 100),
         idx.supplier > -1 ? cols[idx.supplier] || null : null]
      );
      results.imported++;
    } catch (e) { results.errors.push(`Row ${i}: ${e.message}`); }
  }
  res.json(results);
}

async function importZip(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No ZIP file uploaded' });

  const results = { imported: 0, updated: 0, errors: [] };

  try {
    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries();

    // Find CSV file
    const csvEntry = entries.find(e => e.entryName.match(/\.csv$/i) && !e.entryName.startsWith('__MACOSX'));
    if (!csvEntry) return res.status(400).json({ error: 'No CSV file found in ZIP' });

    // Build file map: filename (lowercase) → base64 data URL (images + PDFs)
    const images = {};
    const FILE_EXTS = /\.(jpg|jpeg|png|webp|pdf)$/i;
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const fname = entry.entryName.split('/').pop(); // strip folder prefix
      if (!FILE_EXTS.test(fname)) continue;
      const ext = fname.split('.').pop().toLowerCase();
      const mime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg';
      const b64 = entry.getData().toString('base64');
      images[fname.toLowerCase()] = `data:${mime};base64,${b64}`;
    }

    // Parse CSV
    const csvText = csvEntry.getData().toString('utf8');
    const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one product' });

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
    const col = name => headers.indexOf(name);

    if (col('name') === -1) return res.status(400).json({ error: 'CSV must have a "name" column' });

    for (let i = 1; i < lines.length; i++) {
      // Handle quoted fields with commas
      const cols = [];
      let current = '';
      let inQuote = false;
      for (const ch of lines[i]) {
        if (ch === '"') { inQuote = !inQuote; }
        else if (ch === ',' && !inQuote) { cols.push(current.trim()); current = ''; }
        else { current += ch; }
      }
      cols.push(current.trim());

      const get = name => col(name) > -1 ? (cols[col(name)] || '').replace(/"/g, '').trim() : '';
      const name = get('name');
      if (!name) continue;

      const imageFilename    = get('image').toLowerCase();
      const brochureFilename = (get('brochure') || get('product brochure') || get('media')).toLowerCase();
      const media_base64    = imageFilename    && images[imageFilename]    ? images[imageFilename]    : null;
      const brochure_base64 = brochureFilename && images[brochureFilename] ? images[brochureFilename] : null;

      try {
        const { rowCount } = await pool.query(
          `INSERT INTO products (name, description, category, unit, unit_price, cost_price, supplier, media_base64, brochure_base64)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT DO NOTHING`,
          [
            name,
            get('description') || null,
            get('category') || null,
            get('unit') || 'each',
            Math.round(parseFloat(get('unit_price') || 0) * 100),
            Math.round(parseFloat(get('cost_price') || 0) * 100),
            get('supplier') || null,
            media_base64,
            brochure_base64,
          ]
        );
        if (rowCount > 0) results.imported++;
        else results.updated++;
      } catch (e) {
        results.errors.push(`Row ${i}: ${e.message}`);
      }
    }

    res.json({ ...results, imagesFound: Object.keys(images).length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'ZIP import failed' });
  }
}

async function categories(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND is_active=true ORDER BY category`
    );
    res.json(rows.map(r => r.category));
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

module.exports = { list, get, create, update, remove, importCsv, importZip, categories };
