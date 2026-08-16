// Images uploaded for the marketing site.
//
// Everything is converted to WebP on the way in, which is what the site wants
// anyway and is the difference between a 1.4MB PNG and a 40KB file. Bytes go to
// object storage when it is configured, and fall back to the database
// otherwise — the same arrangement attachments and product media use.
const sharp = require('sharp');
const pool = require('../db/pool');
const fileStore = require('../services/fileStore');

// Big enough to stay sharp on a retina screen at full card width, small enough
// that nobody waits for it.
const MAX_WIDTH = 1600;
const WEBP_QUALITY = 82;

async function store({ buffer, filename, userId }) {
  const source = sharp(buffer, { failOn: 'none' });
  const meta = await source.metadata();
  if (!meta.width) throw new Error('That file does not look like an image');

  const webp = await sharp(buffer, { failOn: 'none' })
    .rotate() // honour EXIF orientation before dropping the metadata
    .resize({ width: Math.min(meta.width, MAX_WIDTH), withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  const out = await sharp(webp).metadata();
  const name = String(filename || 'image').replace(/\.[^.]+$/, '') + '.webp';

  const storageKey = fileStore.isConfigured()
    ? await fileStore.putObject({ prefix: 'website', filename: name, buffer: webp, contentType: 'image/webp' })
    : null;

  const { rows } = await pool.query(
    `INSERT INTO website_media (filename, mime, width, height, bytes, storage_key, data_base64, created_by)
     VALUES ($1, 'image/webp', $2, $3, $4, $5, $6, $7)
     RETURNING id, filename, mime, width, height, bytes, created_at`,
    [
      name, out.width, out.height, webp.length, storageKey,
      storageKey ? null : webp.toString('base64'),
      userId || null,
    ]
  );
  return rows[0];
}

async function readBuffer(id) {
  const { rows } = await pool.query(
    'SELECT mime, storage_key, data_base64 FROM website_media WHERE id = $1', [id]
  );
  const row = rows[0];
  if (!row) return null;
  const buffer = row.storage_key
    ? await fileStore.getObjectBuffer(row.storage_key)
    : Buffer.from(fileStore.stripDataUrl(row.data_base64), 'base64');
  return { buffer, mime: row.mime || 'image/webp' };
}

async function list(limit = 60) {
  const { rows } = await pool.query(
    `SELECT id, filename, mime, width, height, bytes, created_at
       FROM website_media ORDER BY created_at DESC LIMIT $1`, [limit]
  );
  return rows;
}

async function remove(id) {
  const { rows } = await pool.query(
    'DELETE FROM website_media WHERE id = $1 RETURNING storage_key', [id]
  );
  if (rows[0]?.storage_key) await fileStore.deleteObject(rows[0].storage_key);
  return rows.length > 0;
}

module.exports = { store, readBuffer, list, remove, MAX_WIDTH };
