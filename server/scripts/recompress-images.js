#!/usr/bin/env node
/*
 * One-off maintenance: shrink images already stored as base64 in the database.
 *
 * New uploads are downscaled in the browser (client/src/lib/image.js), but
 * everything uploaded before that landed is still full-resolution. This applies
 * the same treatment retroactively.
 *
 *   node scripts/recompress-images.js                  # dry run, changes nothing
 *   node scripts/recompress-images.js --apply          # actually rewrite rows
 *   node scripts/recompress-images.js --table=job_attachments --apply
 *   node scripts/recompress-images.js --max-edge=1600 --quality=0.85 --apply
 *
 * Point it at production by setting DATABASE_URL for the command:
 *   DATABASE_URL="postgres://…" node scripts/recompress-images.js
 *
 * Safe to re-run: an image already within --max-edge and already in the target
 * format is left alone, so an interrupted run just picks up where it left off
 * and a second run is a no-op. The flip side is that an image already under the
 * edge limit is never re-encoded however heavy it is — lower --max-edge if you
 * want those revisited too.
 *
 * IMPORTANT: re-encoding is lossy and cannot be undone. Take a database backup
 * first. Postgres also won't hand freed space back to the disk on its own —
 * run VACUUM FULL (or pg_repack) afterwards or the usage figure won't move.
 */

require('dotenv').config();
const pool = require('../src/db/pool');

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('This script needs sharp:  npm install sharp');
  process.exit(1);
}

// Every column in the schema that holds an image. hub_documents is deliberately
// absent — it only ever holds PDFs, which this cannot usefully shrink.
const TARGETS = [
  { table: 'job_attachments',        column: 'data_base64',     mimeColumn: 'mime_type' },
  { table: 'job_coc_photos',         column: 'data_base64',     mimeColumn: 'mime_type' },
  { table: 'job_cost_scans',         column: 'document_base64', mimeColumn: 'mime_type' },
  { table: 'products',               column: 'media_base64' },
  { table: 'products',               column: 'brochure_base64' },
  { table: 'presenter_products',     column: 'image_base64' },
  { table: 'presenter_products',     column: 'brochure_base64' },
  { table: 'presenter_sections',     column: 'image_base64' },
  { table: 'presenter_subcategories',column: 'image_base64' },
  { table: 'document_themes',        column: 'logo_base64' },
];

const args = process.argv.slice(2);
const flag = name => args.some(a => a === `--${name}`);
const value = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const APPLY     = flag('apply');
const MAX_EDGE  = Number(value('max-edge', 1400));
const QUALITY   = Math.round(Number(value('quality', 0.8)) * 100);
const ONLY      = value('table', null);
const BATCH     = Number(value('batch', 25));
// Below this there's nothing worth reclaiming, and re-encoding risks looking worse.
const MIN_BYTES = Number(value('min-bytes', 60 * 1024));
// A re-encode has to earn its place. Without this the script isn't idempotent:
// running it twice would re-encode already-processed images for a percent or
// two, losing a little more quality to generation loss on every pass.
const MIN_SAVING = 0.10;

const kb = n => `${(n / 1024).toFixed(0)}KB`;
const mb = n => `${(n / 1024 / 1024).toFixed(1)}MB`;

// Stored values are usually full data URLs ("data:image/jpeg;base64,…") because
// that's what FileReader produces, but tolerate bare base64 too and write back
// in whichever form came in.
function parseStored(value) {
  if (!value || typeof value !== 'string') return null;
  const m = /^data:([^;,]+)?(;base64)?,/i.exec(value);
  if (m) {
    return { isDataUrl: true, mime: (m[1] || '').toLowerCase(), b64: value.slice(m[0].length) };
  }
  return { isDataUrl: false, mime: '', b64: value };
}

function sniffMime(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString('ascii') === 'RIFF'
      && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.length > 4 && buf.slice(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
  if (buf.length > 6 && buf.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  return '';
}

async function shrink(buf) {
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) return null;
  // GIF may be animated and SVG is vector — neither survives a raster resize well.
  if (meta.format === 'gif' || meta.format === 'svg') return null;

  // Idempotency is a structural check, not a size one. JPEG re-encoding keeps
  // yielding a slightly smaller file each pass while quietly degrading the
  // image, so "did it get smaller?" is not a safe stopping condition. An image
  // already within the size limit and already in the target format is done.
  const targetFormat = meta.hasAlpha ? 'png' : 'jpeg';
  const oversized = Math.max(meta.width, meta.height) > MAX_EDGE;
  if (!oversized && meta.format === targetFormat) return null;

  // .rotate() with no argument applies the EXIF orientation and clears it.
  // Without this, resized phone photos come out sideways, because resizing
  // drops the EXIF tag that was telling viewers to rotate them.
  let pipeline = sharp(buf).rotate().resize(MAX_EDGE, MAX_EDGE, {
    fit: 'inside',
    withoutEnlargement: true,
  });

  // Flattening alpha onto a JPEG would give logos a black background.
  const outMime = `image/${targetFormat}`;
  pipeline = meta.hasAlpha
    ? pipeline.png({ compressionLevel: 9, palette: true })
    : pipeline.jpeg({ quality: QUALITY, mozjpeg: true });

  const out = await pipeline.toBuffer();
  return { buf: out, mime: outMime };
}

async function processTarget({ table, column, mimeColumn }) {
  const { rows: exists } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column]
  );
  if (!exists.length) return null;

  const { rows } = await pool.query(
    `SELECT id, ${column} AS payload${mimeColumn ? `, ${mimeColumn} AS mime` : ''}
     FROM ${table}
     WHERE ${column} IS NOT NULL AND LENGTH(${column}) > $1
     ORDER BY LENGTH(${column}) DESC`,
    [Math.floor(MIN_BYTES * 4 / 3)] // base64 is ~4/3 the size of the bytes
  );
  if (!rows.length) return null;

  const stat = { table, column, rows: rows.length, changed: 0, skipped: 0, failed: 0, before: 0, after: 0 };
  const pending = [];

  for (const row of rows) {
    const parsed = parseStored(row.payload);
    if (!parsed) { stat.skipped++; continue; }

    let buf;
    try { buf = Buffer.from(parsed.b64, 'base64'); }
    catch { stat.failed++; continue; }

    const mime = parsed.mime || row.mime || sniffMime(buf);
    if (!mime.startsWith('image/')) { stat.skipped++; continue; }
    if (buf.length < MIN_BYTES) { stat.skipped++; continue; }

    let result;
    try { result = await shrink(buf); }
    catch (err) { stat.failed++; continue; }
    if (!result) { stat.skipped++; continue; }

    // Never trade a smaller file for a bigger one, and don't bother for a
    // marginal gain — see MIN_SAVING.
    if (result.buf.length > buf.length * (1 - MIN_SAVING)) { stat.skipped++; continue; }

    stat.before += buf.length;
    stat.after  += result.buf.length;
    stat.changed++;

    const b64 = result.buf.toString('base64');
    pending.push({
      id: row.id,
      value: parsed.isDataUrl ? `data:${result.mime};base64,${b64}` : b64,
      mime: result.mime,
    });

    if (APPLY && pending.length >= BATCH) await flush(table, column, mimeColumn, pending);
  }
  if (APPLY && pending.length) await flush(table, column, mimeColumn, pending);
  return stat;
}

async function flush(table, column, mimeColumn, pending) {
  for (const p of pending) {
    await pool.query(
      `UPDATE ${table} SET ${column}=$1${mimeColumn ? `, ${mimeColumn}=$3` : ''} WHERE id=$2`,
      mimeColumn ? [p.value, p.id, p.mime] : [p.value, p.id]
    );
  }
  pending.length = 0;
}

(async () => {
  const dbLabel = (process.env.DATABASE_URL || '').replace(/:[^:@/]*@/, ':***@');
  console.log(`\ndatabase : ${dbLabel || '(from pool defaults)'}`);
  console.log(`mode     : ${APPLY ? 'APPLY — rows will be rewritten' : 'DRY RUN — nothing will be changed'}`);
  console.log(`settings : max edge ${MAX_EDGE}px, quality ${QUALITY}, skip under ${kb(MIN_BYTES)}\n`);

  const before = await pool.query('SELECT pg_size_pretty(pg_database_size(current_database())) AS s');
  console.log(`database size before: ${before.rows[0].s}\n`);

  const targets = ONLY ? TARGETS.filter(t => t.table === ONLY) : TARGETS;
  if (!targets.length) { console.error(`No such table in the target list: ${ONLY}`); process.exit(1); }

  const stats = [];
  for (const target of targets) {
    process.stdout.write(`scanning ${target.table}.${target.column} … `);
    const stat = await processTarget(target);
    if (!stat) { console.log('nothing to do'); continue; }
    stats.push(stat);
    const saved = stat.before - stat.after;
    console.log(`${stat.changed} to shrink, ${stat.skipped} skipped, ${stat.failed} failed  ${mb(stat.before)} -> ${mb(stat.after)} (saves ${mb(saved)})`);
  }

  const before_ = stats.reduce((n, s) => n + s.before, 0);
  const after_  = stats.reduce((n, s) => n + s.after, 0);
  const changed = stats.reduce((n, s) => n + s.changed, 0);
  const failed  = stats.reduce((n, s) => n + s.failed, 0);

  console.log('\n────────────────────────────────────────');
  if (!changed) {
    console.log('Nothing needed shrinking.');
  } else {
    console.log(`images   : ${changed}${failed ? `  (${failed} failed to decode and were left alone)` : ''}`);
    console.log(`payload  : ${mb(before_)} -> ${mb(after_)}`);
    console.log(`saving   : ${mb(before_ - after_)}  (${(100 - after_ / before_ * 100).toFixed(0)}% smaller)`);
    console.log(`in the DB: roughly ${mb((before_ - after_) * 4 / 3)} once base64 overhead is counted`);
  }
  console.log('────────────────────────────────────────');

  if (!APPLY) {
    console.log('\nDry run — nothing was written. Re-run with --apply to commit.');
    console.log('Take a backup first: this re-encode is lossy and cannot be undone.');
  } else {
    const after = await pool.query('SELECT pg_size_pretty(pg_database_size(current_database())) AS s');
    console.log(`\ndatabase size after: ${after.rows[0].s}`);
    console.log('\nPostgres keeps the freed pages for reuse rather than returning them.');
    console.log('To actually reclaim disk (locks each table while it runs):');
    for (const t of [...new Set(stats.map(s => s.table))]) console.log(`  VACUUM FULL ${t};`);
  }
  await pool.end();
})().catch(err => { console.error(err); process.exit(1); });
