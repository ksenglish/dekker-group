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
    const isAdmin = req.user.role === 'admin';
    res.json(isAdmin ? rows : rows.map(({ cost_price, ...rest }) => rest));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function get(req, res) {
  try {
    const { rows } = await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'admin') {
      const { cost_price, ...rest } = rows[0];
      return res.json(rest);
    }
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

// Re-importing a price list should update what's there, not pile up copies.
//
// Products are matched on name, ignoring case and surrounding spaces, which is
// the only thing identifying a product here — there is no SKU column. Anything
// the file doesn't supply is left alone rather than blanked, so a CSV-only
// re-import can't wipe the images and brochures a previous ZIP upload set.
//
// `fields` values of null/undefined/'' mean "not supplied".
async function upsertProduct(fields) {
  const name = (fields.name || '').trim();
  if (!name) return 'skipped';

  // Oldest first, so where earlier imports already left duplicates the original
  // is the one kept up to date rather than an arbitrary copy.
  const { rows: [existing] } = await pool.query(
    `SELECT id FROM products
     WHERE LOWER(TRIM(name)) = LOWER($1)
     ORDER BY created_at
     LIMIT 1`,
    [name]
  );

  const supplied = value => value !== null && value !== undefined && value !== '';

  if (!existing) {
    await pool.query(
      `INSERT INTO products (name, description, category, unit, unit_price, cost_price, supplier, media_base64, brochure_base64)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        name,
        supplied(fields.description) ? fields.description : null,
        supplied(fields.category) ? fields.category : null,
        supplied(fields.unit) ? fields.unit : 'each',
        supplied(fields.unit_price) ? fields.unit_price : 0,
        supplied(fields.cost_price) ? fields.cost_price : 0,
        supplied(fields.supplier) ? fields.supplier : null,
        supplied(fields.media_base64) ? fields.media_base64 : null,
        supplied(fields.brochure_base64) ? fields.brochure_base64 : null,
      ]
    );
    return 'imported';
  }

  // COALESCE leaves the stored value in place wherever the file said nothing,
  // so a partial file only touches the columns it actually carries.
  await pool.query(
    `UPDATE products SET
       description     = COALESCE($2, description),
       category        = COALESCE($3, category),
       unit            = COALESCE($4, unit),
       unit_price      = COALESCE($5, unit_price),
       cost_price      = COALESCE($6, cost_price),
       supplier        = COALESCE($7, supplier),
       media_base64    = COALESCE($8, media_base64),
       brochure_base64 = COALESCE($9, brochure_base64),
       updated_at      = NOW()
     WHERE id = $1`,
    [
      existing.id,
      supplied(fields.description) ? fields.description : null,
      supplied(fields.category) ? fields.category : null,
      supplied(fields.unit) ? fields.unit : null,
      supplied(fields.unit_price) ? fields.unit_price : null,
      supplied(fields.cost_price) ? fields.cost_price : null,
      supplied(fields.supplier) ? fields.supplier : null,
      supplied(fields.media_base64) ? fields.media_base64 : null,
      supplied(fields.brochure_base64) ? fields.brochure_base64 : null,
    ]
  );
  return 'updated';
}

// An absent or blank price means "leave it alone"; an explicit 0 is a real price.
function parsePrice(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
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

  const results = { imported: 0, updated: 0, errors: [] };
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const name = cols[idx.name];
    if (!name) continue;
    const at = key => (idx[key] > -1 ? cols[idx[key]] : '');
    try {
      const outcome = await upsertProduct({
        name,
        description: at('description'),
        category: at('category'),
        unit: at('unit'),
        unit_price: parsePrice(at('unit_price')),
        cost_price: parsePrice(at('cost_price')),
        supplier: at('supplier'),
      });
      if (outcome === 'imported') results.imported++;
      else if (outcome === 'updated') results.updated++;
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
        const outcome = await upsertProduct({
          name,
          description: get('description'),
          category: get('category'),
          unit: get('unit'),
          unit_price: parsePrice(get('unit_price')),
          cost_price: parsePrice(get('cost_price')),
          supplier: get('supplier'),
          // Only replaces the stored file when this ZIP actually carried one —
          // a named file that isn't in the ZIP leaves the existing image alone
          // rather than clearing it.
          media_base64,
          brochure_base64,
        });
        if (outcome === 'imported') results.imported++;
        else if (outcome === 'updated') results.updated++;
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
