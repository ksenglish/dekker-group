#!/usr/bin/env node
/*
 * One-off repair: convert HEIC photos that were already stored unconverted.
 *
 * Uploads have always tried to convert HEIC to JPEG on the way in, but the
 * decoder they relied on never worked — see the header of
 * src/utils/normaliseUpload.js. Everything uploaded before that fix is sitting
 * in the database as a .heic no browser can render, which is what the job
 * photo grids show as broken thumbnails. This converts them in place.
 *
 *   node scripts/convert-heic.js                     # dry run, changes nothing
 *   node scripts/convert-heic.js --apply             # actually rewrite rows
 *   node scripts/convert-heic.js --job=<uuid> --apply
 *
 * Point it at production by setting DATABASE_URL (and the bucket credentials,
 * if attachments live in object storage) for the command:
 *   DATABASE_URL="postgres://…" node scripts/convert-heic.js
 *
 * Safe to re-run: rows are selected by sniffing the stored bytes, so a
 * converted row is a JPEG and no longer matches. An interrupted run picks up
 * where it left off.
 *
 * IMPORTANT: this rewrites the stored image and cannot be undone. Take a
 * database backup first. Bucket-backed rows get a *new* object and the old
 * .heic is left in the bucket, so those are recoverable by hand if needed.
 */

require('dotenv').config();
const pool = require('../src/db/pool');
const fileStore = require('../src/services/fileStore');
const { looksLikeHeic, heicToJpeg, isSharpAvailable } = require('../src/utils/normaliseUpload');

const args = process.argv.slice(2);
const flag = name => args.some(a => a === `--${name}`);
const value = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const APPLY = flag('apply');
const JOB = value('job', null);

const mb = n => `${(n / 1024 / 1024).toFixed(1)}MB`;

// job_attachments holds the job photo grids and may point at the bucket.
// job_coc_photos is always inline base64 and carries no filename — the bytes
// are the only thing identifying it.
const TARGETS = [
  { table: 'job_attachments', column: 'data_base64', hasFilename: true,
    bucketColumn: 'storage_key', prefix: 'jobs/converted/photos' },
  { table: 'job_coc_photos',  column: 'data_base64', hasFilename: false },
];

async function tableExists(table) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [table]
  );
  return rows.length > 0;
}

async function loadBytes(row) {
  if (row.storage_key) return fileStore.getObjectBuffer(row.storage_key);
  if (!row.payload) return null;
  return Buffer.from(fileStore.stripDataUrl(row.payload), 'base64');
}

async function processTarget({ table, column, hasFilename, bucketColumn, prefix }) {
  if (!await tableExists(table)) return null;

  const params = [];
  let where = 'TRUE';
  if (JOB) { params.push(JOB); where = `job_id = $${params.length}`; }

  const { rows } = await pool.query(
    `SELECT id, ${hasFilename ? 'filename' : `'photo.heic' AS filename`}, mime_type,
            ${column} AS payload${bucketColumn ? `, ${bucketColumn} AS storage_key` : ''}
     FROM ${table} WHERE ${where} ORDER BY created_at DESC`,
    params
  );

  const stat = { table, scanned: rows.length, converted: 0, skipped: 0, failed: 0, before: 0, after: 0 };

  for (const row of rows) {
    // The filename and mime type are only hints — a phone can send
    // application/octet-stream for a HEIC. The bytes are the real test, but
    // fetching every attachment from the bucket to sniff them would be
    // wasteful, so bucket rows are pre-filtered on the hints first.
    const hinted = /\.(heic|heif|hif)$/i.test(row.filename || '') || /hei[cf]/i.test(row.mime_type || '');
    if (row.storage_key && !hinted) { stat.skipped++; continue; }

    let buffer;
    try { buffer = await loadBytes(row); }
    catch (err) { console.warn(`  ${row.id}: could not read — ${err.message}`); stat.failed++; continue; }
    if (!buffer || !looksLikeHeic(buffer, row.mime_type || '')) { stat.skipped++; continue; }

    // A dry run still decodes, so it reports real sizes and surfaces any photo
    // that won't convert before anything is written.
    const jpeg = await heicToJpeg(buffer);
    if (!jpeg) { console.warn(`  ${row.id}: ${row.filename} would not decode`); stat.failed++; continue; }

    stat.before += buffer.length;
    stat.after += jpeg.length;
    stat.converted++;
    const name = String(row.filename).replace(/\.(heic|heif|hif)$/i, '.jpg');
    console.log(`  ${row.filename} → ${name}  ${mb(buffer.length)} → ${mb(jpeg.length)}`);
    if (!APPLY) continue;

    // A bucket-backed row gets a new object rather than overwriting the old
    // key, so the original .heic stays recoverable if a conversion turns out
    // to have gone wrong.
    if (row.storage_key && fileStore.isConfigured()) {
      const key = await fileStore.putObject({ prefix, filename: name, buffer: jpeg, contentType: 'image/jpeg' });
      await pool.query(
        `UPDATE ${table} SET filename=$1, mime_type='image/jpeg', ${bucketColumn}=$2, size_bytes=$3 WHERE id=$4`,
        [name, key, jpeg.length, row.id]
      );
    } else {
      const value = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
      await pool.query(
        hasFilename
          ? `UPDATE ${table} SET mime_type='image/jpeg', ${column}=$1, filename=$3 WHERE id=$2`
          : `UPDATE ${table} SET mime_type='image/jpeg', ${column}=$1 WHERE id=$2`,
        hasFilename ? [value, row.id, name] : [value, row.id]
      );
    }
  }
  return stat;
}

(async () => {
  if (!isSharpAvailable()) {
    console.error('This script needs sharp:  npm install');
    process.exit(1);
  }
  const dbLabel = (process.env.DATABASE_URL || '').replace(/:[^:@/]*@/, ':***@');
  console.log(`\ndatabase : ${dbLabel || '(from pool defaults)'}`);
  console.log(`bucket   : ${fileStore.isConfigured() ? 'configured' : 'not configured — inline base64 only'}`);
  console.log(`mode     : ${APPLY ? 'APPLY — rows will be rewritten' : 'DRY RUN — nothing will be changed'}`);
  if (JOB) console.log(`job      : ${JOB}`);
  console.log('');

  const stats = [];
  for (const target of TARGETS) {
    console.log(`scanning ${target.table} …`);
    const stat = await processTarget(target);
    if (!stat) { console.log('  table not present'); continue; }
    stats.push(stat);
    console.log(`  ${stat.converted} to convert, ${stat.skipped} skipped, ${stat.failed} failed (of ${stat.scanned} rows)\n`);
  }

  const converted = stats.reduce((n, s) => n + s.converted, 0);
  const failed = stats.reduce((n, s) => n + s.failed, 0);
  const before = stats.reduce((n, s) => n + s.before, 0);
  const after = stats.reduce((n, s) => n + s.after, 0);

  console.log('────────────────────────────────────────');
  if (!converted) {
    console.log('No unconverted HEIC photos found.');
  } else {
    console.log(`photos   : ${converted}${failed ? `  (${failed} could not be decoded and were left alone)` : ''}`);
    console.log(`payload  : ${mb(before)} → ${mb(after)}`);
  }
  console.log('────────────────────────────────────────');
  if (!APPLY && converted) {
    console.log('\nDry run — nothing was written. Re-run with --apply to commit.');
    console.log('Take a backup first: the stored image is replaced and cannot be undone.');
  }
  await pool.end();
})().catch(err => { console.error(err); process.exit(1); });
