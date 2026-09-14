/**
 * The website worker's copy of the Marketing Library.
 *
 * Claude Code runs with no network access and no general shell (see
 * website-worker.js), so it can't fetch from the app itself. Instead the worker
 * keeps the library's images and PDFs in a local folder, refreshed before each
 * job, and hands Claude that folder to look through — its Read tool shows it an
 * image, so it can actually see which photo suits.
 *
 * Claude can't copy a binary file into the site with the tools it has either,
 * and giving it a shell to do so would undo the point of its narrow permissions.
 * So it asks: it lists the files it wants and where they go in a small JSON
 * file, and the worker checks each request and does the copy after Claude has
 * finished.
 */

const fs = require('fs');
const path = require('path');

// Worth mirroring for a website. Video is left out: large, and not something a
// change to the site's pages will be dropping in.
const MIRRORED = /^(image\/(webp|jpeg|png|gif|svg\+xml|avif)|application\/pdf)$/;

const INDEX = '.index.json';
const CATALOGUE = 'CATALOGUE.md';

// Raster images wider than this are scaled down on the way into the site — a
// supplier's 5000px original is several megabytes nobody's browser needs. The
// same width website_media uses for images uploaded through the app.
const MAX_WIDTH = 1600;

const MAX_REQUESTS = 30;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Where a file lives in the mirror: its folder, then its name. Two different
// files can end up with the same folder and name (one renamed to match another),
// so the second gets a short id added rather than overwriting the first.
function placeFor(asset, taken) {
  const rel = [asset.folder_path, asset.filename].filter(Boolean).join('/');
  if (!taken.has(rel)) return rel;
  const ext = path.posix.extname(rel);
  return `${rel.slice(0, -ext.length || undefined)} (${asset.id.slice(0, 8)})${ext}`;
}

/**
 * Bring the local folder up to date with the library: download what's new,
 * remove what's gone, and rewrite the catalogue Claude reads.
 */
async function syncMirror({ api, key, dir, log = () => {} }) {
  fs.mkdirSync(dir, { recursive: true });
  const res = await fetch(`${api}/api/marketing/catalogue`, { headers: { 'x-api-key': key } });
  if (!res.ok) throw new Error(`catalogue returned ${res.status}`);
  const assets = (await res.json()).filter(a => MIRRORED.test(a.mime));

  const index = readJson(path.join(dir, INDEX), {});   // id → { hash, rel }
  const next = {};
  const taken = new Set();
  let downloaded = 0;

  // Keep existing placements first, so a file doesn't move between runs.
  const ordered = [...assets].sort((a, b) => (index[b.id] ? 1 : 0) - (index[a.id] ? 1 : 0));

  for (const a of ordered) {
    const prev = index[a.id];
    const hash = a.content_hash.trim();
    const wantRel = placeFor(a, taken);
    // Unchanged and still where it was: nothing to do. The taken check matters —
    // if another file has just been written to this path, what's there now is
    // that one, not this.
    if (prev && prev.hash === hash && prev.rel === wantRel && fs.existsSync(path.join(dir, wantRel))) {
      taken.add(wantRel);
      next[a.id] = prev;
      continue;
    }
    // New, changed, or moved/renamed in the app: fetched fresh rather than moved
    // within the folder. Moving would be quicker, but two files swapping names
    // could leave each holding the other's contents; a download can't.
    const file = await fetch(`${api}/api/marketing/assets/${a.id}/file`, { headers: { 'x-api-key': key } });
    if (!file.ok) { log(`  couldn't download ${wantRel}: ${file.status}`); continue; }
    const abs = path.join(dir, wantRel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from(await file.arrayBuffer()));
    downloaded++;
    taken.add(wantRel);
    next[a.id] = { hash, rel: wantRel };
  }

  // Anything not in the library any more — or put there by anything other than
  // this — is removed, so the folder only ever shows what's really in the app.
  let removed = 0;
  const walk = sub => {
    for (const e of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (!sub && (e.name === INDEX || e.name === CATALOGUE)) continue;
      if (e.isDirectory()) {
        walk(rel);
        if (!fs.readdirSync(path.join(dir, rel)).length) fs.rmdirSync(path.join(dir, rel));
      } else if (!taken.has(rel)) {
        fs.rmSync(path.join(dir, rel));
        removed++;
      }
    }
  };
  walk('');

  fs.writeFileSync(path.join(dir, INDEX), JSON.stringify(next, null, 1));

  const byRel = new Map(assets.map(a => [next[a.id]?.rel, a]));
  const lines = [...taken].sort((x, y) => x.localeCompare(y)).map(rel => {
    const a = byRel.get(rel);
    const dims = a?.width ? `${a.width}×${a.height}` : a?.mime === 'application/pdf' ? 'PDF' : '';
    return `- ${rel}${dims ? ` — ${dims}` : ''}`;
  });
  fs.writeFileSync(path.join(dir, CATALOGUE), [
    '# Marketing Library',
    '',
    'Every image and PDF in the Dekker App Marketing Library, by folder. Paths are',
    'relative to this folder. Read an image to see it before choosing it.',
    '',
    ...(lines.length ? lines : ['(The library is empty.)']),
    '',
  ].join('\n'));

  return { files: taken.size, downloaded, removed };
}

// ── Putting requested files into the site ───────────────────────────────────

let sharp = null;
try { sharp = require('sharp'); } catch { /* copied at full size instead */ }

const inside = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * Read Claude's requests and copy each file into the website checkout. Every
 * request is checked: the source must be a file in the mirror, the destination
 * must be under public/, and the extension mustn't change (so a reference to
 * /images/x.webp is never quietly given a PNG). Returns what went where and what
 * was turned down, and why.
 */
async function applyRequests({ requestsFile, mirrorDir, repoDir }) {
  const placed = [];
  const rejected = [];
  if (!fs.existsSync(requestsFile)) return { placed, rejected };

  let requests;
  try {
    requests = JSON.parse(fs.readFileSync(requestsFile, 'utf8'));
  } catch {
    return { placed, rejected: [{ request: null, reason: 'the list of files to add was not valid JSON' }] };
  }
  if (!Array.isArray(requests)) {
    return { placed, rejected: [{ request: null, reason: 'the list of files to add was not a list' }] };
  }

  const publicDir = path.join(repoDir, 'public');
  for (const [i, r] of requests.entries()) {
    if (i >= MAX_REQUESTS) { rejected.push({ request: r, reason: `only ${MAX_REQUESTS} files can be added in one change` }); continue; }
    const from = typeof r?.from === 'string' ? r.from.replace(/\\/g, '/') : '';
    const to = typeof r?.to === 'string' ? r.to.replace(/\\/g, '/').replace(/^\/+/, '') : '';
    if (!from || !to) { rejected.push({ request: r, reason: 'needs both "from" and "to"' }); continue; }

    const src = path.resolve(mirrorDir, from);
    const dest = path.resolve(repoDir, to);
    if (!inside(mirrorDir, src) || [INDEX, CATALOGUE].includes(path.basename(src))) {
      rejected.push({ request: r, reason: `"${from}" is not a file in the Marketing Library` }); continue;
    }
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
      rejected.push({ request: r, reason: `"${from}" is not a file in the Marketing Library` }); continue;
    }
    if (!inside(publicDir, dest)) {
      rejected.push({ request: r, reason: `"${to}" is not inside public/` }); continue;
    }
    if (path.extname(src).toLowerCase() !== path.extname(dest).toLowerCase()) {
      rejected.push({ request: r, reason: `"${to}" has a different file type from "${from}"` }); continue;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let resized = false;
    const ext = path.extname(src).toLowerCase();
    if (sharp && ['.webp', '.jpg', '.jpeg', '.png'].includes(ext)) {
      try {
        // Read into memory first. Given a path, sharp keeps the file open in its
        // cache, and on Windows an open file can't be deleted — so the next
        // refresh of the mirror would fail on any image used here.
        const img = sharp(fs.readFileSync(src), { failOn: 'none' });
        const meta = await img.metadata();
        if (meta.width > MAX_WIDTH) {
          let pipeline = img.rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true });
          pipeline = ext === '.png' ? pipeline.png() : ext === '.webp' ? pipeline.webp({ quality: 82 }) : pipeline.jpeg({ quality: 82 });
          await pipeline.toFile(dest);
          resized = true;
        }
      } catch { /* fall through to a plain copy */ }
    }
    if (!resized) fs.copyFileSync(src, dest);
    placed.push({ from, to: path.relative(repoDir, dest).split(path.sep).join('/'), resized });
  }
  return { placed, rejected };
}

// What Claude is told about the library, appended to the worker's rules.
function rulesFor({ mirrorDir, requestsFile }) {
  return `

Marketing Library. The company's supplier brochures and product photography are in this folder, which you have been given: ${mirrorDir}
Its CATALOGUE.md lists every file. Use Glob and Read to look through it; reading an image shows it to you, so look at a photo before choosing it. Do not change anything in that folder.

You cannot copy an image into the site yourself. To use one, add an entry to this JSON file, which starts as an empty list: ${requestsFile}
Each entry is {"from": "<path relative to the library folder>", "to": "public/<where it goes in this site>"}. For example {"from": "Mitsubishi/AP Series/Lifestyle/lounge.webp", "to": "public/images/heating/ap-series-lounge.webp"}. Keep the same file extension, and put it under public/ with the site's existing image folders. In the code, refer to it by its path without "public", e.g. "/images/heating/ap-series-lounge.webp". Do not import it in JavaScript — reference it as a path string, the way the site's other images are. The file is added to the site for you after you finish, in its own commit, and large photos are scaled down on the way. Only use the library when the change calls for an image or a brochure.`;
}

module.exports = { syncMirror, applyRequests, rulesFor, MAX_WIDTH, MAX_REQUESTS, INDEX, CATALOGUE };
