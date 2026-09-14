// The Marketing Library — supplier brochures and photography, kept in folders.
//
// Files are kept exactly as supplied (a brochure stays a PDF, a WebP stays a
// WebP). Images get a small thumbnail made on the way in for the browse grid.
// Bytes go to object storage when it's configured and fall back to the database
// otherwise, the same as product media and website images.
const crypto = require('crypto');
const path = require('path');
const sharp = require('sharp');
const pool = require('../db/pool');
const fileStore = require('./fileStore');

// What the library takes, and how big. Anything else is refused rather than
// stored as an opaque blob nobody can preview. Shared with the sync script so it
// never sends a file this would turn away. A file is held in memory while it's
// processed, so the size limit is also what bounds that.
const { types: TYPES, maxBytes: MAX_BYTES } = require('../../../shared/marketingFileTypes.json');

const RASTER = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'image/avif', 'image/svg+xml']);

// ── Paths ────────────────────────────────────────────────────────────────────

// Control characters (tabs, newlines, NUL) have no business in a name. Filtered
// by code point rather than a regex: a character class of control characters is
// a lint error here, and lint runs before every deploy.
const stripControl = str => [...str].filter(ch => ch.charCodeAt(0) >= 32).join('');

// A folder path as stored: segments joined with '/', no leading or trailing
// slash, '' for the top. Backslashes are accepted because the sync script runs
// on Windows. '.' and '..' are refused outright rather than resolved — a path
// is a label here, and one that climbs out of itself is a mistake or worse.
function normalisePath(input) {
  if (input == null) return '';
  const segments = String(input)
    .split(/[\\/]+/)
    .map(s => stripControl(s).trim())
    .filter(Boolean);
  for (const s of segments) {
    if (s === '.' || s === '..') throw Object.assign(new Error('Folder names cannot be "." or ".."'), { status: 400 });
    if (s.length > 100) throw Object.assign(new Error('Folder names are limited to 100 characters'), { status: 400 });
  }
  if (segments.length > 10) throw Object.assign(new Error('Folders can be nested at most 10 deep'), { status: 400 });
  return segments.join('/');
}

// Just the file's own name, with anything a path could smuggle in removed.
function normaliseFilename(input) {
  const base = stripControl(path.basename(String(input || '').replace(/\\/g, '/'))).trim();
  if (!base || base === '.' || base === '..') throw Object.assign(new Error('The file needs a name'), { status: 400 });
  return base.slice(0, 200);
}

// Every folder above and including this one, top first: 'a/b/c' → a, a/b, a/b/c.
function ancestors(folderPath) {
  const parts = folderPath ? folderPath.split('/') : [];
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

const parentOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

async function ensureFolders(folderPath, client = pool) {
  for (const p of ancestors(folderPath)) {
    await client.query('INSERT INTO marketing_folders (path) VALUES ($1) ON CONFLICT DO NOTHING', [p]);
  }
}

// ── Reading ──────────────────────────────────────────────────────────────────

// Columns safe to send to a browser — never the bytes.
const ASSET_COLUMNS = `id, folder_path, filename, mime, bytes, width, height, content_hash,
  source, created_at, (thumb_key IS NOT NULL OR thumb_base64 IS NOT NULL) AS has_thumb`;

// One folder's contents: the folders directly inside it, each with how much it
// holds (at any depth), and the files sitting in it.
async function listFolder(folderPath) {
  const p = normalisePath(folderPath);
  const prefix = p ? `${p}/` : '';

  // Children are the folders that start with this one's path and have no
  // further '/' after it. The remainder is cut off by the raw prefix's
  // character length — not the LIKE pattern's, which is longer by its escapes.
  // Counts are at any depth, with each child's own path escaped for LIKE in SQL.
  const { rows: folderRows } = await pool.query(
    `SELECT f.path,
       (SELECT COUNT(*)::int FROM marketing_assets a
         WHERE a.folder_path = f.path OR a.folder_path LIKE (${SQL_LIKE_ESCAPE('f.path')} || '/%')) AS asset_count,
       (SELECT COUNT(*)::int FROM marketing_folders c
         WHERE c.path LIKE (${SQL_LIKE_ESCAPE('f.path')} || '/%')) AS folder_count
     FROM marketing_folders f
     WHERE f.path LIKE $1
       AND f.path <> $2
       AND position('/' in substr(f.path, char_length($3) + 1)) = 0
     ORDER BY lower(f.path)`,
    [`${likeEscape(prefix)}%`, p, prefix]
  );

  const folders = folderRows.map(r => ({
    name: r.path.slice(r.path.lastIndexOf('/') + 1),
    path: r.path,
    assetCount: r.asset_count,
    folderCount: r.folder_count,
  }));

  const { rows: assets } = await pool.query(
    `SELECT ${ASSET_COLUMNS} FROM marketing_assets WHERE folder_path = $1 ORDER BY lower(filename)`,
    [p]
  );

  const exists = !p || folderRows.length > 0 || assets.length > 0
    || (await pool.query('SELECT 1 FROM marketing_folders WHERE path = $1', [p])).rows.length > 0;

  return { path: p, exists, folders, assets };
}

// LIKE treats % and _ as wildcards; a folder literally called "50%_off" must
// match itself, not everything. Backslash is LIKE's default escape character.
function likeEscape(s) {
  return s.replace(/[\\%_]/g, m => `\\${m}`);
}

// The same escaping, done in SQL on a column.
const SQL_LIKE_ESCAPE = col =>
  `replace(replace(replace(${col}, '\\', '\\\\'), '%', '\\%'), '_', '\\_')`;

async function search(q, limit = 200) {
  const term = String(q || '').trim();
  if (!term) return [];
  const { rows } = await pool.query(
    `SELECT ${ASSET_COLUMNS} FROM marketing_assets
      WHERE filename ILIKE $1 OR folder_path ILIKE $1
      ORDER BY lower(folder_path), lower(filename) LIMIT $2`,
    [`%${likeEscape(term)}%`, limit]
  );
  return rows;
}

// Everything, for the website worker's local copy of the library.
async function catalogue() {
  const { rows } = await pool.query(
    `SELECT ${ASSET_COLUMNS} FROM marketing_assets ORDER BY lower(folder_path), lower(filename)`
  );
  return rows;
}

async function getAsset(id) {
  const { rows } = await pool.query(`SELECT ${ASSET_COLUMNS} FROM marketing_assets WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function readFile(id, which = 'file') {
  const { rows } = await pool.query(
    'SELECT filename, mime, storage_key, data_base64, thumb_key, thumb_base64 FROM marketing_assets WHERE id = $1',
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  if (which === 'thumb') {
    if (!row.thumb_key && !row.thumb_base64) return null;
    const buffer = row.thumb_key
      ? await fileStore.getObjectBuffer(row.thumb_key)
      : Buffer.from(row.thumb_base64, 'base64');
    return { buffer, mime: 'image/webp', filename: row.filename };
  }
  const buffer = row.storage_key
    ? await fileStore.getObjectBuffer(row.storage_key)
    : Buffer.from(row.data_base64, 'base64');
  return { buffer, mime: row.mime, filename: row.filename };
}

// Of these hashes, the ones already in the library — so the sync script only
// sends files that are genuinely new.
async function existingHashes(hashes) {
  const clean = [...new Set((hashes || []).map(h => String(h).toLowerCase()).filter(h => /^[0-9a-f]{64}$/.test(h)))];
  if (!clean.length) return [];
  const { rows } = await pool.query(
    'SELECT content_hash FROM marketing_assets WHERE content_hash = ANY($1)', [clean]
  );
  return rows.map(r => r.content_hash.trim());
}

// ── Writing ──────────────────────────────────────────────────────────────────

const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

async function makeThumb(buffer, mime) {
  if (!RASTER.has(mime)) return { thumb: null, width: null, height: null };
  try {
    const meta = await sharp(buffer, { failOn: 'none' }).metadata();
    const thumb = await sharp(buffer, { failOn: 'none', animated: false })
      // Orientation lives in EXIF on a lot of photos; re-encoding drops it, so
      // apply it first or portrait shots come out on their side.
      .rotate()
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer();
    return { thumb, width: meta.width || null, height: meta.height || null };
  } catch {
    // A file with the right extension that sharp can't decode still goes in —
    // it just has no preview tile.
    return { thumb: null, width: null, height: null };
  }
}

// Store one file. Returns { asset, duplicate }. A file whose bytes are already
// in the library isn't stored again — the existing one comes back instead, so
// re-running the sync or re-uploading by hand is harmless.
async function store({ buffer, filename, folderPath, source = 'upload', userId = null }) {
  const name = normaliseFilename(filename);
  const folder = normalisePath(folderPath);
  const ext = path.extname(name).toLowerCase();
  const mime = TYPES[ext];
  if (!mime) {
    throw Object.assign(new Error(`${ext || 'That'} files can't go in the Marketing Library`), { status: 415 });
  }
  if (!buffer?.length) throw Object.assign(new Error('The file is empty'), { status: 400 });
  if (buffer.length > MAX_BYTES) {
    throw Object.assign(new Error(`Files are limited to ${MAX_BYTES / 1024 / 1024} MB`), { status: 413 });
  }

  const hash = sha256(buffer);
  const { rows: [already] } = await pool.query(
    `SELECT ${ASSET_COLUMNS} FROM marketing_assets WHERE content_hash = $1`, [hash]
  );
  if (already) return { asset: already, duplicate: true };

  const { thumb, width, height } = await makeThumb(buffer, mime);

  const storageKey = fileStore.isConfigured()
    ? await fileStore.putObject({ prefix: 'marketing', filename: name, buffer, contentType: mime })
    : null;
  const thumbKey = thumb && fileStore.isConfigured()
    ? await fileStore.putObject({ prefix: 'marketing/thumbs', filename: `${path.parse(name).name}.webp`, buffer: thumb, contentType: 'image/webp' })
    : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureFolders(folder, client);
    const { rows: [asset] } = await client.query(
      `INSERT INTO marketing_assets
         (folder_path, filename, mime, bytes, width, height, content_hash,
          storage_key, data_base64, thumb_key, thumb_base64, source, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (content_hash) DO NOTHING
       RETURNING ${ASSET_COLUMNS}`,
      [
        folder, name, mime, buffer.length, width, height, hash,
        storageKey, storageKey ? null : buffer.toString('base64'),
        thumbKey, thumb && !thumbKey ? thumb.toString('base64') : null,
        source === 'sync' ? 'sync' : 'upload',
        // The sync script signs in as the automation user, which has no row.
        userId && userId !== 'automation' ? userId : null,
      ]
    );
    await client.query('COMMIT');

    if (asset) return { asset, duplicate: false };

    // Two uploads of the same file raced and the other one won. Tidy up the
    // copy this one put in storage and hand back the one that was kept.
    if (storageKey) await fileStore.deleteObject(storageKey).catch(() => {});
    if (thumbKey) await fileStore.deleteObject(thumbKey).catch(() => {});
    const { rows: [winner] } = await pool.query(
      `SELECT ${ASSET_COLUMNS} FROM marketing_assets WHERE content_hash = $1`, [hash]
    );
    return { asset: winner, duplicate: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (storageKey) await fileStore.deleteObject(storageKey).catch(() => {});
    if (thumbKey) await fileStore.deleteObject(thumbKey).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function createFolder(folderPath) {
  const p = normalisePath(folderPath);
  if (!p) throw Object.assign(new Error('Give the folder a name'), { status: 400 });
  await ensureFolders(p);
  return { path: p };
}

// Only an empty folder can go — deleting one full of files by accident is too
// easy to do and too hard to undo.
async function deleteFolder(folderPath) {
  const p = normalisePath(folderPath);
  if (!p) throw Object.assign(new Error("The top of the library can't be deleted"), { status: 400 });
  const like = `${likeEscape(p)}/%`;
  const { rows: [counts] } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM marketing_assets WHERE folder_path = $1 OR folder_path LIKE $2) AS assets,
       (SELECT COUNT(*)::int FROM marketing_folders WHERE path LIKE $2) AS folders`,
    [p, like]
  );
  if (counts.assets || counts.folders) {
    throw Object.assign(new Error('Only an empty folder can be deleted — move or delete what is in it first'), { status: 409 });
  }
  const { rowCount } = await pool.query('DELETE FROM marketing_folders WHERE path = $1', [p]);
  return rowCount > 0;
}

// Rename a file, or move it to another folder (which is made if need be).
async function updateAsset(id, { filename, folderPath }) {
  const sets = [];
  const params = [];
  if (filename !== undefined) {
    const name = normaliseFilename(filename);
    const current = await getAsset(id);
    if (!current) return null;
    // The extension decides how a file is shown and served, so it stays.
    if (path.extname(name).toLowerCase() !== path.extname(current.filename).toLowerCase()) {
      throw Object.assign(new Error("A file's extension can't be changed"), { status: 400 });
    }
    params.push(name); sets.push(`filename = $${params.length}`);
  }
  let folder;
  if (folderPath !== undefined) {
    folder = normalisePath(folderPath);
    params.push(folder); sets.push(`folder_path = $${params.length}`);
  }
  if (!sets.length) return getAsset(id);
  if (folder !== undefined) await ensureFolders(folder);
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE marketing_assets SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${ASSET_COLUMNS}`,
    params
  );
  return rows[0] || null;
}

async function removeAsset(id) {
  const { rows } = await pool.query(
    'DELETE FROM marketing_assets WHERE id = $1 RETURNING storage_key, thumb_key', [id]
  );
  if (!rows[0]) return false;
  for (const key of [rows[0].storage_key, rows[0].thumb_key]) {
    if (key) await fileStore.deleteObject(key).catch(() => {});
  }
  return true;
}

module.exports = {
  TYPES, MAX_BYTES,
  normalisePath, normaliseFilename, ancestors, parentOf, likeEscape,
  listFolder, search, catalogue, getAsset, readFile, existingHashes,
  store, createFolder, deleteFolder, updateAsset, removeAsset,
};
