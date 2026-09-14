#!/usr/bin/env node
/**
 * Dekker App — Marketing Library sync
 *
 * Uploads whatever lands in a folder on this PC into Website → Marketing
 * Library in the app, keeping the folder structure. Claude Co-Work saves the
 * supplier downloads into that folder; this carries them the rest of the way,
 * so Co-Work never needs a connection to the app or a key for it.
 *
 * Files are only ever added. Deleting one from the folder does not delete it
 * from the library, and moving or renaming one in the app is not undone by the
 * next run — the library recognises a file by its contents, not its name.
 *
 * SETUP (one-time):
 *   1. Set these, either in the environment or in server/.env (the website
 *      worker already reads the first two from there):
 *        DEKKER_API             https://dekker-group.onrender.com
 *        AUTOMATION_API_KEY     the same value as the Render env var
 *        MARKETING_SYNC_DIR     the folder to upload from, e.g. the Google Drive
 *                               folder Co-Work saves into. Its contents appear at
 *                               the top of the library.
 *      Optional:
 *        MARKETING_SYNC_PREFIX  a library folder to put everything under, e.g.
 *                               "Mitsubishi"
 *        MARKETING_SYNC_INTERVAL_MIN  how often --watch checks (default 15)
 *   2. See what it would do, without uploading anything:
 *        node automation/marketing-sync.js --dry-run
 *   3. Run it:
 *        node automation/marketing-sync.js           one pass, then exits
 *        node automation/marketing-sync.js --watch   keeps running
 *
 * To run it on a schedule instead of leaving --watch open, point a Windows
 * scheduled task at the one-pass form. It exits non-zero when an upload fails,
 * so the task history shows it.
 *
 * It remembers each file's size, modified time and fingerprint in
 * ~/.dekker/marketing-sync-state.json, so an unchanged folder of thousands of
 * files is re-checked in seconds rather than re-read in full.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../server/.env') });

const { types: TYPES, maxBytes: MAX_BYTES } = require('../shared/marketingFileTypes.json');

const API = (process.env.DEKKER_API || 'https://dekker-group.onrender.com').replace(/\/$/, '');
const KEY = process.env.AUTOMATION_API_KEY || '';
const DIR = process.env.MARKETING_SYNC_DIR || '';
const PREFIX = (process.env.MARKETING_SYNC_PREFIX || '').replace(/[\\/]+/g, '/').replace(/^\/|\/$/g, '');
const INTERVAL_MIN = Number(process.env.MARKETING_SYNC_INTERVAL_MIN || 15);
const STATE_FILE = process.env.MARKETING_SYNC_STATE || path.join(os.homedir(), '.dekker', 'marketing-sync-state.json');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const WATCH = args.has('--watch');

// A file modified this recently may still be being written — a download in
// progress, or Google Drive halfway through syncing it down. It is picked up on
// the next run instead.
const SETTLE_MS = 60 * 1000;

// Browsers and sync clients write partial files under names like these before
// renaming them to the real thing.
const PARTIAL = /\.(crdownload|part|partial|download|tmp)$/i;
const JUNK = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

const log = (...a) => console.log(new Date().toLocaleTimeString('en-NZ'), ...a);

// ── Finding files ────────────────────────────────────────────────────────────

async function walk(dir, rel = '') {
  const out = [];
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    log(`  couldn't read ${dir}: ${err.message}`);
    return out;
  }
  for (const e of entries) {
    // Hidden files and folders, and Office's "~$" lock files.
    if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
    const abs = path.join(dir, e.name);
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await walk(abs, relPath));
    else if (e.isFile()) out.push({ abs, rel: relPath, name: e.name });
  }
  return out;
}

function hashFile(abs) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(abs)
      .on('data', d => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { files: {} }; }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  // Written aside and renamed, so a run killed mid-write can't leave it corrupt.
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE_FILE);
}

// The library folder a file goes in: the prefix, then its folder under DIR.
function libraryFolder(rel) {
  const dir = path.posix.dirname(rel);
  return [PREFIX, dir === '.' ? '' : dir].filter(Boolean).join('/');
}

// ── Talking to the app ───────────────────────────────────────────────────────

async function request(pathname, init = {}) {
  const res = await fetch(`${API}/api/marketing${pathname}`, {
    ...init,
    headers: { 'x-api-key': KEY, ...(init.headers || {}) },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

async function alreadyInLibrary(hashes) {
  const have = new Set();
  for (let i = 0; i < hashes.length; i += 1000) {
    const { existing } = await request('/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes: hashes.slice(i, i + 1000) }),
    });
    existing.forEach(h => have.add(h));
  }
  return have;
}

async function uploadOne(file) {
  const form = new FormData();
  form.append('path', file.folder);
  form.append('filename', file.name);
  form.append('file', await fs.openAsBlob(file.abs, { type: TYPES[path.extname(file.name).toLowerCase()] }), file.name);
  return request('/assets', { method: 'POST', body: form });
}

// One retry for the failures that are worth one: the network, or the server
// being briefly unavailable (a Render deploy restarts it).
async function uploadWithRetry(file) {
  try {
    return await uploadOne(file);
  } catch (err) {
    if (err.status && err.status < 500) throw err;
    await new Promise(r => setTimeout(r, 5000));
    return uploadOne(file);
  }
}

// ── One pass ─────────────────────────────────────────────────────────────────

async function syncOnce() {
  const started = Date.now();
  const state = loadState();
  const seen = {};
  const counts = { scanned: 0, skippedType: 0, skippedSize: 0, notSettled: 0, inLibrary: 0, uploaded: 0, failed: 0 };
  const tooBig = [];

  const files = await walk(DIR);
  const candidates = [];

  for (const f of files) {
    if (JUNK.has(f.name.toLowerCase()) || PARTIAL.test(f.name)) continue;
    counts.scanned++;
    if (!TYPES[path.extname(f.name).toLowerCase()]) { counts.skippedType++; continue; }

    let stat;
    try { stat = await fs.promises.stat(f.abs); } catch { continue; }
    if (Date.now() - stat.mtimeMs < SETTLE_MS) { counts.notSettled++; continue; }
    if (stat.size > MAX_BYTES) { counts.skippedSize++; tooBig.push(f.rel); continue; }
    if (stat.size === 0) continue;

    // Reuse the fingerprint when nothing about the file has changed.
    const prev = state.files[f.abs];
    let hash = prev && prev.size === stat.size && prev.mtimeMs === stat.mtimeMs ? prev.hash : null;
    if (!hash) {
      try { hash = await hashFile(f.abs); }
      catch (err) { log(`  couldn't read ${f.rel}: ${err.message}`); continue; }
    }
    seen[f.abs] = { size: stat.size, mtimeMs: stat.mtimeMs, hash };
    candidates.push({ ...f, hash, size: stat.size, folder: libraryFolder(f.rel) });
  }

  const have = candidates.length ? await alreadyInLibrary([...new Set(candidates.map(c => c.hash))]) : new Set();
  const uploadedHashes = new Set();
  const toUpload = [];
  // When the same file is in the folder more than once, keep the name without a
  // browser's " (1)" copy suffix. Windows lists "lounge (1).webp" before
  // "lounge.webp", so without this the copy's name would be the one kept.
  const isCopyName = name => /\s\(\d+\)(\.[^.]*)?$/.test(name);
  const ordered = [...candidates].sort((a, b) => isCopyName(a.name) - isCopyName(b.name));
  for (const c of ordered) {
    // Two identical files in the folder only need sending once.
    if (have.has(c.hash) || uploadedHashes.has(c.hash)) { counts.inLibrary++; continue; }
    uploadedHashes.add(c.hash);
    toUpload.push(c);
  }

  if (DRY_RUN) {
    for (const c of toUpload) log(`  would upload  ${c.rel}  →  ${c.folder || '(top of library)'}`);
  } else {
    for (const [i, c] of toUpload.entries()) {
      try {
        const { duplicate } = await uploadWithRetry(c);
        if (duplicate) counts.inLibrary++; else counts.uploaded++;
        log(`  ${duplicate ? 'already there' : 'uploaded'} (${i + 1}/${toUpload.length})  ${c.rel}`);
      } catch (err) {
        counts.failed++;
        log(`  FAILED (${i + 1}/${toUpload.length})  ${c.rel}: ${err.message}`);
        // Forget this file's fingerprint so a failed upload is tried again
        // rather than looking settled.
        delete seen[c.abs];
      }
    }
  }

  // Only files still in the folder are remembered, so the state file doesn't
  // grow forever as downloads are tidied away.
  if (!DRY_RUN) saveState({ dir: DIR, files: seen });

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  log(`${DRY_RUN ? 'dry run: ' : ''}${counts.scanned} files looked at in ${secs}s — ` +
    `${DRY_RUN ? `${toUpload.length} would be uploaded` : `${counts.uploaded} uploaded`}, ` +
    `${counts.inLibrary} already in the library` +
    (counts.skippedType ? `, ${counts.skippedType} not a type the library takes` : '') +
    (counts.skippedSize ? `, ${counts.skippedSize} over ${MAX_BYTES / 1024 / 1024} MB` : '') +
    (counts.notSettled ? `, ${counts.notSettled} still being written (next run)` : '') +
    (counts.failed ? `, ${counts.failed} FAILED` : ''));
  if (tooBig.length) log(`  too big to upload: ${tooBig.slice(0, 10).join(', ')}${tooBig.length > 10 ? ` and ${tooBig.length - 10} more` : ''}`);

  return counts;
}

// ── Entry point ──────────────────────────────────────────────────────────────

(async () => {
  if (!KEY) { console.error('AUTOMATION_API_KEY is not set. See the setup notes at the top of this file.'); process.exit(1); }
  if (!DIR) { console.error('MARKETING_SYNC_DIR is not set. See the setup notes at the top of this file.'); process.exit(1); }
  if (!fs.existsSync(DIR) || !fs.statSync(DIR).isDirectory()) {
    console.error(`MARKETING_SYNC_DIR is not a folder: ${DIR}`);
    process.exit(1);
  }

  log(`${DRY_RUN ? 'checking' : 'syncing'} ${DIR} → ${API} Marketing Library${PREFIX ? ` / ${PREFIX}` : ''}`);

  if (!WATCH) {
    // exitCode rather than process.exit(): on Windows, exiting while fetch still
    // has a kept-alive connection open aborts Node with a libuv assertion
    // (UV_HANDLE_CLOSING) and a crash code — so a run that uploaded everything
    // would still show as failed in a scheduled task. Setting the code and
    // returning lets the connections close and the process end on its own.
    try {
      const counts = await syncOnce();
      process.exitCode = counts.failed ? 1 : 0;
    } catch (err) {
      log('could not reach the app:', err.message);
      process.exitCode = 1;
    }
    return;
  }

  for (;;) {
    try { await syncOnce(); }
    catch (err) { log('could not reach the app:', err.message); }
    await new Promise(r => setTimeout(r, INTERVAL_MIN * 60 * 1000));
  }
})();
