const pool = require('../db/pool');
const AdmZip = require('adm-zip');
const sharp = require('sharp');
const fileStore = require('../services/fileStore');

// A product row on its way out. Media held in the bucket is handed over as a
// URL to fetch rather than as bytes inline, so a product with a 10MB brochure
// no longer means a 13MB JSON response. Rows from before the bucket still
// carry their data URL, so both kinds display the same way.
function productToJson(row) {
  if (!row) return row;
  const { media_key, brochure_key, ...rest } = row;
  return {
    ...rest,
    media_url: media_key ? `/api/products/${row.id}/media` : null,
    brochure_url: brochure_key ? `/api/products/${row.id}/brochure` : null,
  };
}

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
    // Exclude large binary columns from list — fetched on demand via GET /products/:id.
    // The has_* flags say whether there's anything to fetch, so the browse grid
    // knows which tiles have a picture or a brochure without carrying the bytes.
    const { rows } = await pool.query(
      `SELECT id, name, description, category,
              subcategory_1, subcategory_2, subcategory_3, subcategory_4,
              unit, unit_price, cost_price, supplier, is_active, created_at, updated_at,
              (media_key IS NOT NULL OR media_base64 IS NOT NULL)       AS has_image,
              (brochure_key IS NOT NULL OR brochure_base64 IS NOT NULL) AS has_brochure
       FROM products p WHERE ${conditions.join(' AND ')}
       ORDER BY p.category, p.subcategory_1, p.subcategory_2, p.subcategory_3, p.subcategory_4, p.name`,
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
    const product = productToJson(rows[0]);
    if (req.user.role !== 'admin') {
      const { cost_price, ...rest } = product;
      return res.json(rest);
    }
    res.json(product);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

// Deciding what a media field on an incoming request actually means.
//
// The edit form loads a product, shows its image, and posts the whole thing
// back on save — so the value that arrives is often the same one we handed out.
// Only a data: URL is a genuine new upload. A URL is what we gave the client to
// display, and means "unchanged"; an explicit empty value means "remove it".
// Getting this wrong would wipe an image every time a price was edited.
async function resolveMediaWrite({ incoming, existingKey, existingInline, prefix, filename }) {
  if (incoming === undefined) return { key: existingKey, inline: existingInline, unchanged: true };
  if (!incoming) return { key: null, inline: null, removedKey: existingKey };

  if (!String(incoming).startsWith('data:')) {
    return { key: existingKey, inline: existingInline, unchanged: true };
  }

  const stored = await fileStore.storeDataUrl({ prefix, filename, dataUrl: incoming });
  if (!stored) return { key: null, inline: incoming, removedKey: existingKey };
  return { key: stored.key, inline: null, removedKey: existingKey };
}

async function create(req, res) {
  const { name, description, category, subcategory_1, subcategory_2, subcategory_3, subcategory_4,
    unit, unit_price, supplier, cost_price, media_base64, brochure_base64 } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const media = await resolveMediaWrite({ incoming: media_base64, prefix: 'products/media', filename: `${name}-image` });
    const brochure = await resolveMediaWrite({ incoming: brochure_base64, prefix: 'products/brochures', filename: `${name}-brochure` });

    const { rows } = await pool.query(
      `INSERT INTO products (name, description, category,
         subcategory_1, subcategory_2, subcategory_3, subcategory_4,
         unit, unit_price, supplier, cost_price,
         media_base64, brochure_base64, media_key, brochure_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [name, description || null, category || null,
       subcategory_1 || null, subcategory_2 || null, subcategory_3 || null, subcategory_4 || null,
       unit || 'each', Math.round((unit_price || 0) * 100), supplier || null,
       Math.round((cost_price || 0) * 100), media.inline, brochure.inline, media.key, brochure.key]
    );
    res.status(201).json(productToJson(rows[0]));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function update(req, res) {
  const { name, description, category, subcategory_1, subcategory_2, subcategory_3, subcategory_4,
    unit, unit_price, is_active, supplier, cost_price, media_base64, brochure_base64 } = req.body;
  try {
    const { rows: [current] } = await pool.query(
      'SELECT media_key, brochure_key, media_base64, brochure_base64 FROM products WHERE id=$1', [req.params.id]
    );
    if (!current) return res.status(404).json({ error: 'Not found' });

    const media = await resolveMediaWrite({
      incoming: media_base64, existingKey: current.media_key, existingInline: current.media_base64,
      prefix: 'products/media', filename: `${name}-image`,
    });
    const brochure = await resolveMediaWrite({
      incoming: brochure_base64, existingKey: current.brochure_key, existingInline: current.brochure_base64,
      prefix: 'products/brochures', filename: `${name}-brochure`,
    });

    const { rows } = await pool.query(
      `UPDATE products SET name=$1, description=$2, category=$3,
       subcategory_1=$4, subcategory_2=$5, subcategory_3=$6, subcategory_4=$7,
       unit=$8, unit_price=$9, is_active=$10, supplier=$11, cost_price=$12,
       media_base64=$13, brochure_base64=$14, media_key=$15, brochure_key=$16, updated_at=NOW()
       WHERE id=$17 RETURNING *`,
      [name, description || null, category || null,
       subcategory_1 || null, subcategory_2 || null, subcategory_3 || null, subcategory_4 || null,
       unit || 'each', Math.round((unit_price || 0) * 100), is_active !== false,
       supplier || null, Math.round((cost_price || 0) * 100),
       media.inline, brochure.inline, media.key, brochure.key, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    // Only once the row is safely updated — otherwise a failed write would
    // leave the product pointing at a file that had already been removed.
    for (const gone of [media.removedKey, brochure.removedKey]) {
      if (gone && gone !== media.key && gone !== brochure.key) await fileStore.deleteObject(gone);
    }
    res.json(productToJson(rows[0]));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function remove(req, res) {
  try {
    const { rows } = await pool.query(
      'DELETE FROM products WHERE id=$1 RETURNING media_key, brochure_key', [req.params.id]
    );
    for (const key of [rows[0]?.media_key, rows[0]?.brochure_key]) {
      if (key) await fileStore.deleteObject(key);
    }
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

// Serving a product's image or brochure. Both are public to any signed-in user
// for the same reason the price list is.
function serveMedia(column) {
  return async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT ${column}_key AS key, ${column}_base64 AS inline FROM products WHERE id=$1`, [req.params.id]
      );
      if (!rows[0] || (!rows[0].key && !rows[0].inline)) return res.status(404).json({ error: 'Not found' });
      if (rows[0].key) {
        const { buffer, contentType } = await fileStore.getObject(rows[0].key);
        res.set('Content-Type', contentType);
        // Immutable in practice: replacing one writes a new key, so the URL
        // only ever serves the same bytes.
        res.set('Cache-Control', 'private, max-age=86400');
        return res.send(buffer);
      }
      const inline = rows[0].inline;
      const mime = (String(inline).match(/^data:([^;]+);base64,/) || [])[1] || 'application/octet-stream';
      res.set('Content-Type', mime);
      res.send(Buffer.from(fileStore.stripDataUrl(inline), 'base64'));
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
  };
}

// A small WebP for the browse grid, made from whichever image the product has.
//
// Product images arrive at whatever size the supplier's export happened to be,
// and a grid of forty of them at full size is several megabytes. Resizing here
// keeps that to a few KB each. Generated per request and left to the browser's
// cache rather than stored — replacing an image writes a new key, so a stale
// thumbnail can't outlive the picture it came from.
async function serveThumb(req, res) {
  try {
    const { rows } = await pool.query(
      'SELECT media_key AS key, media_base64 AS inline FROM products WHERE id=$1', [req.params.id]
    );
    if (!rows[0] || (!rows[0].key && !rows[0].inline)) return res.status(404).json({ error: 'Not found' });

    const source = rows[0].key
      ? await fileStore.getObjectBuffer(rows[0].key)
      : Buffer.from(fileStore.stripDataUrl(rows[0].inline), 'base64');

    const thumb = await sharp(source, { failOn: 'none' })
      // Phone photos record their orientation in EXIF rather than in the pixels.
      // Re-encoding drops that tag, so without applying it first every photo
      // taken in portrait comes out on its side.
      .rotate()
      .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();

    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(thumb);
  } catch (err) {
    console.error('Product thumbnail failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
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
    `SELECT id, media_key, brochure_key FROM products
     WHERE LOWER(TRIM(name)) = LOWER($1)
     ORDER BY created_at
     LIMIT 1`,
    [name]
  );

  const supplied = value => value !== null && value !== undefined && value !== '';

  // A price list ZIP is where most images and brochures actually arrive, so
  // this is the path that matters most for keeping them out of the database.
  const media = supplied(fields.media_base64)
    ? await fileStore.storeDataUrl({ prefix: 'products/media', filename: `${name}-image`, dataUrl: fields.media_base64 })
    : null;
  const brochure = supplied(fields.brochure_base64)
    ? await fileStore.storeDataUrl({ prefix: 'products/brochures', filename: `${name}-brochure`, dataUrl: fields.brochure_base64 })
    : null;
  // Without a bucket these stay in their columns exactly as before.
  const mediaInline = media ? null : (supplied(fields.media_base64) ? fields.media_base64 : null);
  const brochureInline = brochure ? null : (supplied(fields.brochure_base64) ? fields.brochure_base64 : null);

  if (!existing) {
    await pool.query(
      `INSERT INTO products (name, description, category,
         subcategory_1, subcategory_2, subcategory_3, subcategory_4,
         unit, unit_price, cost_price, supplier,
         media_base64, brochure_base64, media_key, brochure_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        name,
        supplied(fields.description) ? fields.description : null,
        supplied(fields.category) ? fields.category : null,
        supplied(fields.subcategory_1) ? fields.subcategory_1 : null,
        supplied(fields.subcategory_2) ? fields.subcategory_2 : null,
        supplied(fields.subcategory_3) ? fields.subcategory_3 : null,
        supplied(fields.subcategory_4) ? fields.subcategory_4 : null,
        supplied(fields.unit) ? fields.unit : 'each',
        supplied(fields.unit_price) ? fields.unit_price : 0,
        supplied(fields.cost_price) ? fields.cost_price : 0,
        supplied(fields.supplier) ? fields.supplier : null,
        mediaInline, brochureInline, media?.key || null, brochure?.key || null,
      ]
    );
    return 'imported';
  }

  // COALESCE leaves the stored value in place wherever the file said nothing,
  // so a partial file only touches the columns it actually carries.
  // Where a new file went to the bucket, the old inline copy is cleared as well
  // as the key replaced — leaving it would keep the bytes in the database
  // forever, which is the whole thing this is trying to stop.
  await pool.query(
    `UPDATE products SET
       description     = COALESCE($2, description),
       category        = COALESCE($3, category),
       subcategory_1   = COALESCE($4, subcategory_1),
       subcategory_2   = COALESCE($5, subcategory_2),
       subcategory_3   = COALESCE($6, subcategory_3),
       subcategory_4   = COALESCE($7, subcategory_4),
       unit            = COALESCE($8, unit),
       unit_price      = COALESCE($9, unit_price),
       cost_price      = COALESCE($10, cost_price),
       supplier        = COALESCE($11, supplier),
       media_base64    = CASE WHEN $14::text IS NOT NULL THEN NULL ELSE COALESCE($12, media_base64) END,
       brochure_base64 = CASE WHEN $15::text IS NOT NULL THEN NULL ELSE COALESCE($13, brochure_base64) END,
       media_key       = COALESCE($14, media_key),
       brochure_key    = COALESCE($15, brochure_key),
       updated_at      = NOW()
     WHERE id = $1`,
    [
      existing.id,
      supplied(fields.description) ? fields.description : null,
      supplied(fields.category) ? fields.category : null,
      supplied(fields.subcategory_1) ? fields.subcategory_1 : null,
      supplied(fields.subcategory_2) ? fields.subcategory_2 : null,
      supplied(fields.subcategory_3) ? fields.subcategory_3 : null,
      supplied(fields.subcategory_4) ? fields.subcategory_4 : null,
      supplied(fields.unit) ? fields.unit : null,
      supplied(fields.unit_price) ? fields.unit_price : null,
      supplied(fields.cost_price) ? fields.cost_price : null,
      supplied(fields.supplier) ? fields.supplier : null,
      mediaInline, brochureInline, media?.key || null, brochure?.key || null,
    ]
  );
  // Only after the row points at the new file — the keys were read before the
  // update, since afterwards there is nothing left saying where the old one was.
  if (media?.key && existing.media_key) await fileStore.deleteObject(existing.media_key);
  if (brochure?.key && existing.brochure_key) await fileStore.deleteObject(existing.brochure_key);
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
  // Spreadsheets spell these however the person exporting them felt at the
  // time, so each column accepts the obvious variants.
  const firstOf = (...names) => {
    for (const n of names) { const i = headers.indexOf(n); if (i > -1) return i; }
    return -1;
  };
  const idx = { name: headers.indexOf('name'), description: headers.indexOf('description'),
    category: headers.indexOf('category'),
    subcategory_1: firstOf('sub category 1', 'subcategory 1', 'sub_category_1', 'subcategory1', 'sub category'),
    subcategory_2: firstOf('sub category 2', 'subcategory 2', 'sub_category_2', 'subcategory2'),
    subcategory_3: firstOf('sub category 3', 'subcategory 3', 'sub_category_3', 'subcategory3'),
    subcategory_4: firstOf('sub category 4', 'subcategory 4', 'sub_category_4', 'subcategory4'),
    unit: headers.indexOf('unit'),
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
        subcategory_1: at('subcategory_1'),
        subcategory_2: at('subcategory_2'),
        subcategory_3: at('subcategory_3'),
        subcategory_4: at('subcategory_4'),
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
      // Same tolerance for header spelling as the plain CSV import.
      const getAny = (...names) => { for (const n of names) { const v = get(n); if (v) return v; } return ''; };
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
          subcategory_1: getAny('sub category 1', 'subcategory 1', 'sub_category_1', 'subcategory1', 'sub category'),
          subcategory_2: getAny('sub category 2', 'subcategory 2', 'sub_category_2', 'subcategory2'),
          subcategory_3: getAny('sub category 3', 'subcategory 3', 'sub_category_3', 'subcategory3'),
          subcategory_4: getAny('sub category 4', 'subcategory 4', 'sub_category_4', 'subcategory4'),
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

module.exports = {
  list, get, create, update, remove, importCsv, importZip, categories,
  serveMediaImage: serveMedia('media'),
  serveMediaBrochure: serveMedia('brochure'),
  serveThumb,
};
