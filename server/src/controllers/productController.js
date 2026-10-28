const pool = require('../db/pool');
const AdmZip = require('adm-zip');
const sharp = require('sharp');
const { toStoredImage } = require('../utils/productImage');
const { matchProduct } = require('../services/productMatch');
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
      `SELECT id, name, description, quote_description, category,
              subcategory_1, subcategory_2, subcategory_3, subcategory_4,
              unit, unit_price, cost_price, supplier, is_active, created_at, updated_at,
              stock_kind,
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
    const { rows: [kitCount] } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM product_components WHERE parent_id = $1', [req.params.id]
    );
    const product = { ...productToJson(rows[0]), component_count: kitCount.n };
    if (req.user.role !== 'admin') {
      const { cost_price, ...rest } = product;
      return res.json(rest);
    }
    res.json(product);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

// Throwing away a stored file, but only if nothing else is still using it.
//
// Product images are stored under a key derived from their contents, so one
// photograph used by many products is one object rather than one per row —
// which is the difference between 120MB and 10MB on a price list where a gate
// is sold in ninety-nine sizes. The cost of that is this check: deleting a
// product's picture must not take it away from every other product sharing it.
//
// Asked of the database rather than counted anywhere, so it cannot drift out
// of step with what the rows actually say.
async function deleteFileIfUnused(key, exceptProductId = null) {
  if (!key) return;
  const { rows } = await pool.query(
    `SELECT 1 FROM products
      WHERE (media_key = $1 OR brochure_key = $1)
        AND ($2::uuid IS NULL OR id <> $2)
      LIMIT 1`,
    [key, exceptProductId]
  );
  if (rows.length) return;   // still in use by another product
  await fileStore.deleteObject(key);
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

  const stored = await fileStore.storeDataUrl({
    prefix, filename, dataUrl: await toStoredImage(incoming), dedupe: true,
  });
  if (!stored) return { key: null, inline: incoming, removedKey: existingKey };
  return { key: stored.key, inline: null, removedKey: existingKey };
}

// ── BOM kits ─────────────────────────────────────────────────────────────────
//
// A kit is a product whose price comes from its parts. Both figures are rolled
// up and stored on the kit itself, rather than worked out on every read: a
// quote already snapshots the price it was raised at, and a kit that silently
// changed value between being looked at and being quoted would be worse than
// one that has to be re-saved. Saving a kit adopts its components' prices as
// they stand.

// What the parts come to, from the prices on file right now.
async function rollUp(components, client = pool) {
  if (!components.length) return { cost_price: 0, unit_price: 0, lines: [] };
  const ids = components.map(c => c.component_id);
  const { rows } = await client.query(
    'SELECT id, name, unit, unit_price, cost_price FROM products WHERE id = ANY($1::uuid[])', [ids]
  );
  const byId = new Map(rows.map(r => [r.id, r]));
  let cost = 0, sell = 0;
  const lines = [];
  for (const c of components) {
    const p = byId.get(c.component_id);
    if (!p) continue;
    const qty = parseFloat(c.quantity) || 0;
    cost += Math.round(p.cost_price * qty);
    sell += Math.round(p.unit_price * qty);
    lines.push({
      component_id: p.id, name: p.name, unit: p.unit, quantity: qty,
      cost_price: p.cost_price, unit_price: p.unit_price,
      line_cost: Math.round(p.cost_price * qty), line_price: Math.round(p.unit_price * qty),
    });
  }
  return { cost_price: cost, unit_price: sell, lines };
}

// A kit may contain a kit, but nothing may contain itself at any depth — that
// is a price that can never be worked out. Walks down from each component
// looking for the kit being saved.
async function wouldCycle(parentId, componentIds, client = pool) {
  if (!parentId) return false;
  if (componentIds.includes(parentId)) return true;
  const seen = new Set(componentIds);
  let frontier = componentIds;
  while (frontier.length) {
    const { rows } = await client.query(
      'SELECT DISTINCT component_id FROM product_components WHERE parent_id = ANY($1::uuid[])', [frontier]
    );
    const next = [];
    for (const r of rows) {
      if (r.component_id === parentId) return true;
      if (!seen.has(r.component_id)) { seen.add(r.component_id); next.push(r.component_id); }
    }
    frontier = next;
  }
  return false;
}

// Normalises what the form sent: [{ component_id, quantity }], de-duplicated,
// anything without a real id or a positive quantity dropped.
function cleanComponents(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const out = [];
  raw.forEach((c, i) => {
    const id = c?.component_id || c?.id;
    const qty = parseFloat(c?.quantity);
    if (!id || seen.has(id) || !Number.isFinite(qty) || qty <= 0) return;
    seen.add(id);
    out.push({ component_id: id, quantity: Math.round(qty * 1000) / 1000, sort_order: i });
  });
  return out;
}

async function writeComponents(productId, components, client) {
  await client.query('DELETE FROM product_components WHERE parent_id = $1', [productId]);
  for (const c of components) {
    await client.query(
      `INSERT INTO product_components (parent_id, component_id, quantity, sort_order)
       VALUES ($1,$2,$3,$4)`,
      [productId, c.component_id, c.quantity, c.sort_order]
    );
  }
}

// What a kit is made of, for the editor and for anyone looking at the product.
async function components(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT pc.component_id, pc.quantity, pc.sort_order,
              p.name, p.unit, p.unit_price, p.cost_price, p.is_active
         FROM product_components pc
         JOIN products p ON p.id = pc.component_id
        WHERE pc.parent_id = $1
        ORDER BY pc.sort_order, p.name`,
      [req.params.id]
    );
    const isAdmin = req.user.role === 'admin';
    res.json(rows.map(r => {
      const line = {
        component_id: r.component_id, name: r.name, unit: r.unit,
        quantity: parseFloat(r.quantity), unit_price: r.unit_price,
        line_price: Math.round(r.unit_price * parseFloat(r.quantity)), is_active: r.is_active,
      };
      // Cost stays with admin here for the same reason it does everywhere else
      // in the price list.
      if (isAdmin) {
        line.cost_price = r.cost_price;
        line.line_cost = Math.round(r.cost_price * parseFloat(r.quantity));
      }
      return line;
    }));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function create(req, res) {
  const { name, description, quote_description, category, subcategory_1, subcategory_2, subcategory_3, subcategory_4,
    unit, unit_price, supplier, cost_price, media_base64, brochure_base64, sku } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  // Material unless the form says otherwise. Anything typed in that is neither
  // reads as a material, because the wrong half of the stock figure is worse
  // than a drill filed as a consumable.
  const stockKind = req.body?.stock_kind === 'tool' ? 'tool' : 'material';
  const kit = cleanComponents(req.body.components);
  try {
    // A kit is priced from its parts, so whatever was typed in the price boxes
    // is ignored rather than argued with.
    let prices = null;
    if (kit && kit.length) {
      if (await wouldCycle(null, kit.map(c => c.component_id))) {
        return res.status(400).json({ error: 'A kit cannot contain itself' });
      }
      prices = await rollUp(kit);
    }
    const media = await resolveMediaWrite({ incoming: media_base64, prefix: 'products/media', filename: `${name}-image` });
    const brochure = await resolveMediaWrite({ incoming: brochure_base64, prefix: 'products/brochures', filename: `${name}-brochure` });

    const { rows } = await pool.query(
      `INSERT INTO products (name, description, quote_description, category,
         subcategory_1, subcategory_2, subcategory_3, subcategory_4,
         unit, unit_price, supplier, cost_price,
         media_base64, brochure_base64, media_key, brochure_key, sku, stock_kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [name, description || null, quote_description || null, category || null,
       subcategory_1 || null, subcategory_2 || null, subcategory_3 || null, subcategory_4 || null,
       unit || 'each',
       prices ? prices.unit_price : Math.round((unit_price || 0) * 100), supplier || null,
       prices ? prices.cost_price : Math.round((cost_price || 0) * 100),
       media.inline, brochure.inline, media.key, brochure.key,
       sku && String(sku).trim() ? String(sku).trim() : null, stockKind]
    );
    if (kit && kit.length) {
      const client = await pool.connect();
      try { await writeComponents(rows[0].id, kit, client); }
      finally { client.release(); }
    }
    res.status(201).json({ ...productToJson(rows[0]), component_count: kit ? kit.length : 0 });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function update(req, res) {
  const { name, description, quote_description, category, subcategory_1, subcategory_2, subcategory_3, subcategory_4,
    unit, unit_price, is_active, supplier, cost_price, media_base64, brochure_base64, sku } = req.body;
  // A tool is counted and valued in the same places as stock but apart from it.
  // Left alone when the form does not mention it, so an older client saving a
  // product cannot quietly turn a drill back into a consumable.
  const stockKind = ['material', 'tool'].includes(req.body?.stock_kind) ? req.body.stock_kind : null;
  // Undefined means the form never mentioned components, so whatever the kit
  // already is stays as it is. An empty list means "not a kit any more".
  const kit = cleanComponents(req.body.components);
  try {
    let prices = null;
    if (kit && kit.length) {
      if (await wouldCycle(req.params.id, kit.map(c => c.component_id))) {
        return res.status(400).json({ error: 'That would make a kit contain itself' });
      }
      prices = await rollUp(kit);
    }
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
      `UPDATE products SET name=$1, description=$2, quote_description=$3, category=$4,
       subcategory_1=$5, subcategory_2=$6, subcategory_3=$7, subcategory_4=$8,
       unit=$9, unit_price=$10, is_active=$11, supplier=$12, cost_price=$13,
       media_base64=$14, brochure_base64=$15, media_key=$16, brochure_key=$17,
       -- Typed in the form, so an empty box genuinely clears it, unlike an
       -- import where a missing column means "said nothing".
       sku=$19, stock_kind=COALESCE($20, stock_kind), updated_at=NOW()
       WHERE id=$18 RETURNING *`,
      [name, description || null, quote_description || null, category || null,
       subcategory_1 || null, subcategory_2 || null, subcategory_3 || null, subcategory_4 || null,
       unit || 'each',
       prices ? prices.unit_price : Math.round((unit_price || 0) * 100), is_active !== false,
       supplier || null, prices ? prices.cost_price : Math.round((cost_price || 0) * 100),
       media.inline, brochure.inline, media.key, brochure.key, req.params.id,
       sku && String(sku).trim() ? String(sku).trim() : null, stockKind]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    if (kit) {
      const client = await pool.connect();
      try { await writeComponents(req.params.id, kit, client); }
      finally { client.release(); }
    }
    // Only once the row is safely updated — otherwise a failed write would
    // leave the product pointing at a file that had already been removed.
    for (const gone of [media.removedKey, brochure.removedKey]) {
      if (gone && gone !== media.key && gone !== brochure.key) {
        await deleteFileIfUnused(gone, req.params.id);
      }
    }
    res.json({ ...productToJson(rows[0]), component_count: kit ? kit.length : undefined });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function remove(req, res) {
  try {
    // Deleting a part of a kit would silently change that kit's price, so the
    // kits are named and the delete refused.
    const { rows: usedBy } = await pool.query(
      `SELECT p.name FROM product_components pc JOIN products p ON p.id = pc.parent_id
        WHERE pc.component_id = $1 ORDER BY p.name LIMIT 5`, [req.params.id]
    );
    if (usedBy.length) {
      return res.status(400).json({
        error: `This product is part of ${usedBy.length === 1 ? 'a kit' : 'kits'}: ${usedBy.map(u => u.name).join(', ')}. Take it out first.`,
      });
    }
    const { rows } = await pool.query(
      'DELETE FROM products WHERE id=$1 RETURNING media_key, brochure_key', [req.params.id]
    );
    for (const key of [rows[0]?.media_key, rows[0]?.brochure_key]) {
      await deleteFileIfUnused(key);
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

  // Matched by the shared rule rather than by name alone: the supplier's own
  // code first, within that supplier, and the name only when there is no code
  // to go on. A merchant writes the same product's name three different ways
  // across three invoices, and matching on the name alone put it on the price
  // list three times at three prices.
  //
  // Oldest first inside that rule, so where earlier imports already left
  // duplicates the original is the one kept up to date rather than an
  // arbitrary copy.
  const { product: existing } = await matchProduct(
    { sku: fields.sku, name, supplier: fields.supplier });

  const supplied = value => value !== null && value !== undefined && value !== '';

  // A price list can say which rows are tools. Read generously — "tool",
  // "Tools", "TOOL" — because this is a column someone types by hand, and
  // anything that is not a tool is a material, which is the safe way round.
  const kindWord = String(fields.stock_kind || '').trim().toLowerCase();
  const stockKind = /^tools?$/.test(kindWord) ? 'tool'
    : /^(material|materials|consumable|consumables)$/.test(kindWord) ? 'material'
    : null;

  // A price list ZIP is where most images and brochures actually arrive, so
  // this is the path that matters most for keeping them out of the database.
  // Converted to WebP on the way in, and stored under a key derived from the
  // bytes. A supplier's price list is the same photograph repeated across
  // every size a product comes in, so without both of those a single import
  // writes the same picture to the bucket a hundred times over at full size.
  const mediaIn = supplied(fields.media_base64) ? await toStoredImage(fields.media_base64) : null;
  const brochureIn = supplied(fields.brochure_base64) ? await toStoredImage(fields.brochure_base64) : null;
  const media = mediaIn
    ? await fileStore.storeDataUrl({ prefix: 'products/media', filename: `${name}-image`, dataUrl: mediaIn, dedupe: true })
    : null;
  const brochure = brochureIn
    ? await fileStore.storeDataUrl({ prefix: 'products/brochures', filename: `${name}-brochure`, dataUrl: brochureIn, dedupe: true })
    : null;
  // Without a bucket these stay in their columns exactly as before.
  const mediaInline = media ? null : mediaIn;
  const brochureInline = brochure ? null : brochureIn;

  if (!existing) {
    await pool.query(
      `INSERT INTO products (name, description, quote_description, category,
         subcategory_1, subcategory_2, subcategory_3, subcategory_4,
         unit, unit_price, cost_price, supplier,
         media_base64, brochure_base64, media_key, brochure_key, sku, stock_kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        name,
        supplied(fields.description) ? fields.description : null,
        supplied(fields.quote_description) ? fields.quote_description : null,
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
        supplied(fields.sku) ? String(fields.sku).trim() : null,
        stockKind || 'material',
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
       description       = COALESCE($2, description),
       quote_description = COALESCE($3, quote_description),
       category          = COALESCE($4, category),
       subcategory_1     = COALESCE($5, subcategory_1),
       subcategory_2     = COALESCE($6, subcategory_2),
       subcategory_3     = COALESCE($7, subcategory_3),
       subcategory_4     = COALESCE($8, subcategory_4),
       unit              = COALESCE($9, unit),
       unit_price        = COALESCE($10, unit_price),
       cost_price        = COALESCE($11, cost_price),
       supplier          = COALESCE($12, supplier),
       media_base64      = CASE WHEN $15::text IS NOT NULL THEN NULL ELSE COALESCE($13, media_base64) END,
       brochure_base64   = CASE WHEN $16::text IS NOT NULL THEN NULL ELSE COALESCE($14, brochure_base64) END,
       media_key         = COALESCE($15, media_key),
       brochure_key      = COALESCE($16, brochure_key),
       sku               = COALESCE(NULLIF(TRIM(COALESCE(sku, '')), ''), $17),
       stock_kind        = COALESCE($18, stock_kind),
       updated_at        = NOW()
     WHERE id = $1`,
    [
      existing.id,
      supplied(fields.description) ? fields.description : null,
      supplied(fields.quote_description) ? fields.quote_description : null,
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
      supplied(fields.sku) ? String(fields.sku).trim() : null,
      stockKind,
    ]
  );
  // Only after the row points at the new file — the keys were read before the
  // update, since afterwards there is nothing left saying where the old one was.
  if (media?.key && existing.media_key) await deleteFileIfUnused(existing.media_key, existing.id);
  if (brochure?.key && existing.brochure_key) await deleteFileIfUnused(existing.brochure_key, existing.id);
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
    // However the spreadsheet spells it. A supplier's export says one of
    // these and never the same one twice.
    sku: firstOf('sku', 'code', 'product code', 'item code', 'item', 'part no', 'part number', 'product_code', 'item_code'),
    quote_description: firstOf('quote description', 'quote_description', 'quotedescription'),
    category: headers.indexOf('category'),
    subcategory_1: firstOf('sub category 1', 'subcategory 1', 'sub_category_1', 'subcategory1', 'sub category'),
    subcategory_2: firstOf('sub category 2', 'subcategory 2', 'sub_category_2', 'subcategory2'),
    subcategory_3: firstOf('sub category 3', 'subcategory 3', 'sub_category_3', 'subcategory3'),
    subcategory_4: firstOf('sub category 4', 'subcategory 4', 'sub_category_4', 'subcategory4'),
    // 'tool' here keeps the row out of the materials figure and puts it on the
    // Tools tab. Anything else, or nothing at all, is a material.
    stock_kind: firstOf('type', 'stock kind', 'stock_kind', 'kind'),
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
        quote_description: at('quote_description'),
        category: at('category'),
        subcategory_1: at('subcategory_1'),
        subcategory_2: at('subcategory_2'),
        subcategory_3: at('subcategory_3'),
        subcategory_4: at('subcategory_4'),
        unit: at('unit'),
        sku: at('sku'),
        stock_kind: at('stock_kind'),
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
      // Named rather than assumed. This used to call everything that was not
      // a .png a JPEG, so a WebP went in labelled image/jpeg — a data URL
      // whose declared type contradicts its bytes, which is not reliably
      // displayable and which a format check downstream would believe.
      const mime = {
        pdf: 'application/pdf', png: 'image/png', webp: 'image/webp',
        jpg: 'image/jpeg', jpeg: 'image/jpeg',
      }[ext] || 'application/octet-stream';
      const b64 = entry.getData().toString('base64');
      images[fname.toLowerCase()] = `data:${mime};base64,${b64}`;
    }

    // Converted once per file, before any row is written.
    //
    // A price list names the same picture on many rows — one gate sold in
    // ninety-nine sizes is ninety-nine rows and one photograph — so doing this
    // per row would re-encode the same image ninety-nine times. On a small
    // instance that is both slow and a lot of memory churn for no difference
    // in what gets stored.
    for (const name of Object.keys(images)) {
      images[name] = await toStoredImage(images[name]);
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
          quote_description: getAny('quote description', 'quote_description', 'quotedescription'),
          category: get('category'),
          subcategory_1: getAny('sub category 1', 'subcategory 1', 'sub_category_1', 'subcategory1', 'sub category'),
          subcategory_2: getAny('sub category 2', 'subcategory 2', 'sub_category_2', 'subcategory2'),
          subcategory_3: getAny('sub category 3', 'subcategory 3', 'sub_category_3', 'subcategory3'),
          subcategory_4: getAny('sub category 4', 'subcategory 4', 'sub_category_4', 'subcategory4'),
          unit: get('unit'),
          // The same column the plain CSV import reads, spelled the same ways.
          stock_kind: getAny('type', 'stock kind', 'stock_kind', 'kind'),
          sku: getAny('sku', 'code', 'product code', 'item code', 'item', 'part no', 'part number'),
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

// Every supplier already on the price list, so adding a product can pick one
// rather than retype it — "Ideal Electrical" and "Ideal electrical" become two
// suppliers otherwise, and nothing ever tells you.
//
// Archived products are included: a supplier you have stopped buying a
// particular item from is still a supplier, and leaving them out would invite
// typing the name in fresh.
async function suppliers(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT supplier FROM products
        WHERE supplier IS NOT NULL AND TRIM(supplier) <> ''
        ORDER BY supplier`
    );
    res.json(rows.map(r => r.supplier));
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

// Every value already in use in each of the free-text fields, so a form can
// offer them rather than have them retyped. One call rather than six, since
// the only caller wants the lot.
//
// Archived products are included: a category you have stopped stocking is
// still a category, and leaving it out invites typing the name in fresh —
// which is the whole thing this is meant to prevent.
const CATEGORY_LEVELS = ['category', 'subcategory_1', 'subcategory_2', 'subcategory_3', 'subcategory_4'];

// `paths` is the distinct combinations rather than five flat lists, so the form
// can offer only the sub-categories that actually sit under whatever has been
// chosen above — "Ventilation" belongs to Dekker Air and has no business
// appearing once Dekker Landscaping is picked.
//
// One row per combination in use, so at most one per product and in practice
// far fewer. Suppliers are independent of the tree and come back flat.
async function taxonomy(req, res) {
  try {
    const [{ rows: paths }, { rows: sup }] = await Promise.all([
      pool.query(
        `SELECT DISTINCT ${CATEGORY_LEVELS.join(', ')}
           FROM products
          WHERE category IS NOT NULL AND TRIM(category) <> ''
          ORDER BY ${CATEGORY_LEVELS.join(', ')}`
      ),
      pool.query(
        `SELECT DISTINCT supplier FROM products
          WHERE supplier IS NOT NULL AND TRIM(supplier) <> ''
          ORDER BY supplier`
      ),
    ]);
    // Blank levels come back as null rather than '' so the client has one
    // thing to test for.
    const tree = paths.map(r => CATEGORY_LEVELS.map(c => (r[c] && String(r[c]).trim()) || null));

    // The flat per-level lists go out alongside the tree. A browser running a
    // cached copy of the app from before the tree existed reads these, and gets
    // working dropdowns instead of empty ones until its bundle catches up —
    // which is exactly what went wrong the first time this shipped.
    const flat = Object.fromEntries(CATEGORY_LEVELS.map((c, i) => [
      c, [...new Set(tree.map(p => p[i]).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    ]));

    res.json({ ...flat, paths: tree, supplier: sup.map(r => r.supplier) });
  } catch (err) {
    console.error('[products] taxonomy failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  list, get, create, update, remove, components, importCsv, importZip, categories, suppliers, taxonomy,
  serveMediaImage: serveMedia('media'),
  serveMediaBrochure: serveMedia('brochure'),
  serveThumb,
};
