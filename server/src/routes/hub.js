const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, requireRole, normaliseRole } = require('../middleware/auth');
const { signFileToken, verifyFileToken } = require('../utils/jwt');
const fileStore = require('../services/fileStore');

// Declared above the login check so a signed link works on its own. A request
// with no token still falls through to the usual header check, so the app's own
// fetches are unaffected.
router.get('/documents/:id/data', async (req, res, next) => {
  if (!req.query.t) return authenticate(req, res, next);
  try {
    verifyFileToken(String(req.query.t), 'hub-doc', req.params.id);
    next();
  } catch {
    res.status(401).json({ error: 'That link has expired. Open the document again from the Hub.' });
  }
}, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM hub_documents WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const doc = rows[0];
    // A signed link was only handed out after the access check on /link; a
    // plain authenticated fetch has to pass it here.
    if (!req.query.t && !(await canSeeFolder(req.user, doc.folder_id))) {
      return res.status(404).json({ error: 'Not found' });
    }
    // Either in the bucket or in the row. Documents uploaded by hand before
    // migration 117 still carry their own bytes, and go on working.
    let buf;
    try {
      buf = await fileStore.readBytes({ key: doc.storage_key, inline: doc.data_base64 });
    } catch {
      return res.status(404).json({ error: 'That document is no longer stored.' });
    }
    res.set({
      'Content-Type': doc.mime_type || 'application/pdf',
      // inline, so iOS shows it in its own viewer rather than downloading a
      // file the user then has to go and find.
      'Content-Disposition': `inline; filename="${doc.filename.replace(/"/g, '')}"`,
      // A signed link is good for minutes; caching it for longer would outlive
      // the permission it carries.
      'Cache-Control': 'private, max-age=60',
    });
    res.send(buf);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.use(authenticate);

const isAdmin = req => normaliseRole(req.user.role) === 'admin';

// ── Folder access ────────────────────────────────────────────────────────────
//
// A folder is open to everyone unless it is restricted, and a restriction
// carries down: to see a folder you have to be allowed into it and into every
// folder above it. Admins see everything — they are the ones who set it.
//
// The groups are the roles on the Users page. Office and Field Tech are the
// old names for Operations and Subcontractor and are treated as such.
const ACCESS_ROLES = ['admin', 'sales', 'operations', 'subcontractor'];
const LEGACY_ROLE = { office: 'operations', field_tech: 'subcontractor' };

function allowedInto(user, folder) {
  if (!folder.restricted) return true;
  const role = LEGACY_ROLE[user.role] || user.role;
  return (folder.access_roles || []).includes(role)
    || (folder.access_user_ids || []).includes(user.id);
}

// Which of these folders the user can see. Takes the whole tree because the
// answer for one folder depends on every folder above it.
function visibleIds(user, folders) {
  if (normaliseRole(user.role) === 'admin') return new Set(folders.map(f => f.id));
  const byId = new Map(folders.map(f => [f.id, f]));
  const memo = new Map();
  const visible = id => {
    if (memo.has(id)) return memo.get(id);
    memo.set(id, false);                 // a loop in the tree is not a hang
    const f = byId.get(id);
    const ok = !!f && allowedInto(user, f) && (!f.parent_id || visible(f.parent_id));
    memo.set(id, ok);
    return ok;
  };
  return new Set(folders.filter(f => visible(f.id)).map(f => f.id));
}

async function canSeeFolder(user, folderId) {
  if (normaliseRole(user.role) === 'admin') return true;
  const { rows } = await pool.query(
    'SELECT id, parent_id, restricted, access_roles, access_user_ids FROM hub_folders');
  return visibleIds(user, rows).has(folderId);
}

// Hands back a short-lived link to one document.
//
// An iPad will not show a PDF that arrives as a blob in a new tab, and Safari
// blocks a window opened after the fetch that produced it — so the file has to
// be a URL the browser can navigate to and get a real PDF back from. The API is
// authenticated by a header a navigation cannot send, so the permission travels
// in the link: one document, ten minutes.
router.post('/documents/:id/link', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, filename, folder_id FROM hub_documents WHERE id=$1', [req.params.id]);
    if (!rows[0] || !(await canSeeFolder(req.user, rows[0].folder_id))) {
      return res.status(404).json({ error: 'Not found' });
    }
    const token = signFileToken('hub-doc', rows[0].id);
    res.json({
      url: `/api/hub/documents/${rows[0].id}/data?t=${encodeURIComponent(token)}`,
      filename: rows[0].filename,
    });
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

// ── Documents ────────────────────────────────────────────────────────────────
// Every signed-in staff member can read the folders; only admins change them.

// Every folder, with what is in it and where it sits.
//
// The whole tree in one call: there are tens of these, not thousands, and the
// client needs the lot to draw a breadcrumb anyway.
router.get('/folders', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.name, f.parent_id, f.sort_order, f.created_at,
              f.restricted, f.access_roles, f.access_user_ids,
              COUNT(d.id)::int AS document_count
       FROM hub_folders f
       LEFT JOIN hub_documents d ON d.folder_id = f.id
       GROUP BY f.id ORDER BY f.sort_order, LOWER(f.name)`
    );
    // Only what this person may see, and a folder count that does not give
    // away the folders they may not.
    const seen = visibleIds(req.user, rows);
    const mine = rows.filter(f => seen.has(f.id));
    const admin = isAdmin(req);
    res.json(mine.map(f => {
      const out = { ...f, folder_count: mine.filter(c => c.parent_id === f.id).length };
      // Who else is on the list is admin's business.
      if (!admin) { delete out.access_roles; delete out.access_user_ids; }
      return out;
    }));
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

// Who can see a folder: everyone, or only the groups and people listed.
router.put('/folders/:id/access', requireRole('admin'), async (req, res) => {
  const restricted = !!req.body?.restricted;
  const roles = [...new Set((req.body?.roles || []).map(String))].filter(r => ACCESS_ROLES.includes(r));
  const userIds = [...new Set((req.body?.user_ids || []).map(String))];
  if (restricted && !roles.length && !userIds.length) {
    return res.status(400).json({ error: 'Pick at least one group or person, or set the folder back to Everyone.' });
  }
  try {
    if (userIds.length) {
      const { rows } = await pool.query('SELECT id FROM users WHERE id = ANY($1::uuid[])', [userIds]);
      if (rows.length !== userIds.length) return res.status(400).json({ error: 'One of those people no longer exists.' });
    }
    const { rows } = await pool.query(
      `UPDATE hub_folders SET restricted=$1, access_roles=$2, access_user_ids=$3
        WHERE id=$4 RETURNING id, restricted, access_roles, access_user_ids`,
      [restricted, restricted ? roles : [], restricted ? userIds : [], req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'That folder no longer exists' });
    res.json(rows[0]);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

// A folder cannot be put inside itself, or inside one of its own children.
// Walking up from the proposed parent is the cheap way to find out, and the
// seen-set is there because a tree that has already gone wrong should not hang
// the request that is trying to fix it.
async function wouldLoop(id, parentId) {
  let cur = parentId;
  const seen = new Set();
  while (cur) {
    if (cur === id) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    const { rows } = await pool.query('SELECT parent_id FROM hub_folders WHERE id=$1', [cur]);
    cur = rows[0]?.parent_id || null;
  }
  return false;
}

const folderName = v => String(v ?? '').trim().replace(/\s+/g, ' ');

router.post('/folders', requireRole('admin'), async (req, res) => {
  const name = folderName(req.body?.name);
  const parentId = req.body?.parent_id || null;
  if (!name) return res.status(400).json({ error: 'Give the folder a name' });
  if (name.length > 120) return res.status(400).json({ error: 'That name is too long' });
  try {
    if (parentId) {
      const { rows } = await pool.query('SELECT id FROM hub_folders WHERE id=$1', [parentId]);
      if (!rows[0]) return res.status(404).json({ error: 'That folder no longer exists' });
    }
    const { rows } = await pool.query(
      `INSERT INTO hub_folders (name, parent_id, created_by, sort_order)
       VALUES ($1,$2,$3, COALESCE((SELECT MAX(sort_order) + 1 FROM hub_folders), 1))
       RETURNING *`,
      [name, parentId, req.user.id]
    );
    res.status(201).json({ ...rows[0], document_count: 0, folder_count: 0 });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `There is already a folder called "${name}" here.` });
    }
    console.error('[hub]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Rename, or move somewhere else in the tree. Both at once is fine; it is what
// dragging a renamed folder would do.
router.put('/folders/:id', requireRole('admin'), async (req, res) => {
  const name = folderName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Give the folder a name' });
  if (name.length > 120) return res.status(400).json({ error: 'That name is too long' });
  const moving = Object.prototype.hasOwnProperty.call(req.body || {}, 'parent_id');
  const parentId = req.body?.parent_id || null;
  try {
    const { rows: [folder] } = await pool.query('SELECT * FROM hub_folders WHERE id=$1', [req.params.id]);
    if (!folder) return res.status(404).json({ error: 'That folder no longer exists' });

    if (moving && parentId && await wouldLoop(req.params.id, parentId)) {
      return res.status(400).json({ error: 'A folder cannot be moved inside itself.' });
    }

    const { rows } = await pool.query(
      `UPDATE hub_folders SET name=$1, parent_id=$2 WHERE id=$3 RETURNING *`,
      [name, moving ? parentId : folder.parent_id, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `There is already a folder called "${name}" there.` });
    }
    console.error('[hub]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Deleting a folder that has something in it takes the contents with it, so it
// is not done on one press. The first attempt comes back with what is inside
// and refuses; the client shows that and asks again.
router.delete('/folders/:id', requireRole('admin'), async (req, res) => {
  const cascade = req.query.cascade === '1' || req.body?.cascade === true;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [folder] } = await client.query(
      'SELECT id, name FROM hub_folders WHERE id=$1', [req.params.id]);
    if (!folder) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'That folder no longer exists' });
    }

    // Everything underneath, however deep.
    const { rows: tree } = await client.query(
      `WITH RECURSIVE below AS (
         SELECT id FROM hub_folders WHERE id = $1
         UNION ALL
         SELECT f.id FROM hub_folders f JOIN below b ON f.parent_id = b.id)
       SELECT id FROM below`,
      [req.params.id]
    );
    const ids = tree.map(r => r.id);
    const { rows: [counts] } = await client.query(
      `SELECT COUNT(*)::int AS documents FROM hub_documents WHERE folder_id = ANY($1::uuid[])`, [ids]);
    const subfolders = ids.length - 1;

    if (!cascade && (counts.documents > 0 || subfolders > 0)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `"${folder.name}" still has `
          + [subfolders ? `${subfolders} folder${subfolders === 1 ? '' : 's'}` : null,
            counts.documents ? `${counts.documents} document${counts.documents === 1 ? '' : 's'}` : null]
            .filter(Boolean).join(' and ')
          + ' in it.',
        needs_confirm: true,
        documents: counts.documents,
        subfolders,
      });
    }

    // The documents' bytes, where they are in the bucket rather than the row.
    const { rows: stored } = await client.query(
      `SELECT storage_key FROM hub_documents
        WHERE folder_id = ANY($1::uuid[]) AND storage_key IS NOT NULL`, [ids]);

    // Children first: the parent reference is ON DELETE RESTRICT on purpose,
    // so that a folder cannot disappear out from under its contents by
    // accident — which means tidying up is this route's job.
    await client.query('DELETE FROM hub_documents WHERE folder_id = ANY($1::uuid[])', [ids]);
    for (const id of [...ids].reverse()) {
      await client.query('DELETE FROM hub_folders WHERE id=$1', [id]);
    }
    await client.query('COMMIT');

    // After the commit, because a bucket that will not answer is not a reason
    // to leave the folder on screen.
    for (const { storage_key } of stored) {
      await fileStore.deleteObject(storage_key).catch(() => {});
    }

    res.json({ message: 'Deleted', folders: ids.length, documents: counts.documents });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[hub]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// Deliberately omits data_base64 — the payloads are large and the list only
// needs metadata. Content comes from the download route.
router.get('/folders/:id/documents', async (req, res) => {
  try {
    if (!(await canSeeFolder(req.user, req.params.id))) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    const { rows } = await pool.query(
      `SELECT d.id, d.folder_id, d.filename, d.mime_type, d.size_bytes, d.created_at,
              u.name AS uploaded_by_name
       FROM hub_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.folder_id = $1 ORDER BY d.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.post('/folders/:id/documents', requireRole('admin'), async (req, res) => {
  const { filename, mime_type, data_base64 } = req.body || {};
  if (!filename || !data_base64) return res.status(400).json({ error: 'filename and data_base64 are required' });
  if (mime_type && mime_type !== 'application/pdf') {
    return res.status(400).json({ error: 'Only PDF documents can be uploaded' });
  }
  try {
    const { rows: [folder] } = await pool.query('SELECT id FROM hub_folders WHERE id=$1', [req.params.id]);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    // Rough decoded size from the base64 payload, for display only.
    const b64 = data_base64.replace(/^data:[^;]+;base64,/, '');
    const sizeBytes = Math.round((b64.length * 3) / 4);
    // Into the bucket where there is one. A policy PDF is a megabyte and the
    // database is not where a megabyte of PDF belongs.
    const stored = await fileStore.storeDataUrl({
      prefix: `hub/${req.params.id}`, filename, dataUrl: data_base64,
    });
    const { rows } = await pool.query(
      `INSERT INTO hub_documents (folder_id, filename, mime_type, size_bytes,
                                  data_base64, storage_key, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, folder_id, filename, mime_type, size_bytes, created_at`,
      [req.params.id, filename, mime_type || 'application/pdf', stored?.size || sizeBytes,
       stored ? null : data_base64, stored?.key || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});


router.delete('/documents/:id', requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM hub_documents WHERE id=$1 RETURNING storage_key', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    // The bytes too, where they are in the bucket — otherwise deleting a
    // document from the Hub only hides it and the bill goes on.
    if (rows[0].storage_key) await fileStore.deleteObject(rows[0].storage_key).catch(() => {});
    res.json({ message: 'Deleted' });
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

// ── Moving and copying ───────────────────────────────────────────────────────
//
// Like OneDrive: pick any mix of folders and documents, pick somewhere to put
// them, and move or copy. A folder goes with everything inside it. Documents
// need a folder to live in; folders can also go to the top level (null).
//
// A copy gets its own bytes — the delete routes remove an object from the
// bucket when its row goes, so two rows sharing one key would mean deleting
// the copy deleted the original's file too.

function parseItems(body) {
  const folderIds = [...new Set((body?.folder_ids || []).map(String))];
  const documentIds = [...new Set((body?.document_ids || []).map(String))];
  const targetId = body?.target_id || null;
  return { folderIds, documentIds, targetId };
}

const lowerSet = names => new Set([...names].map(n => String(n).trim().toLowerCase()));

// "Name", then "Name (copy)", "Name (copy 2)"… whichever is free.
function freeName(name, taken) {
  const lower = lowerSet(taken);
  if (!lower.has(name.trim().toLowerCase())) return name;
  for (let i = 1; ; i++) {
    const next = `${name} (copy${i === 1 ? '' : ` ${i}`})`;
    if (!lower.has(next.toLowerCase())) return next;
  }
}

// "Policy.pdf" → "Policy (copy).pdf", for a document copied in beside itself.
function copyFilename(filename, taken) {
  const lower = lowerSet(taken);
  if (!lower.has(filename.trim().toLowerCase())) return filename;
  const m = String(filename).match(/^(.*?)(\.[^.]+)?$/);
  const base = m[1] || filename, ext = m[2] || '';
  for (let i = 1; ; i++) {
    const next = `${base} (copy${i === 1 ? '' : ` ${i}`})${ext}`;
    if (!lower.has(next.toLowerCase())) return next;
  }
}

async function checkTarget(db, targetId, hasDocuments) {
  if (!targetId) return hasDocuments ? 'Documents have to go into a folder, not the top level.' : null;
  const { rows } = await db.query('SELECT id FROM hub_folders WHERE id=$1', [targetId]);
  return rows[0] ? null : 'That folder no longer exists.';
}

// Is targetId the folder itself, or somewhere underneath it?
async function isInside(db, folderId, targetId) {
  let cur = targetId;
  const seen = new Set();
  while (cur) {
    if (cur === folderId) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    const { rows } = await db.query('SELECT parent_id FROM hub_folders WHERE id=$1', [cur]);
    cur = rows[0]?.parent_id || null;
  }
  return false;
}

async function siblingNames(db, parentId) {
  const { rows } = await db.query(
    'SELECT name FROM hub_folders WHERE parent_id IS NOT DISTINCT FROM $1::uuid', [parentId]);
  return new Set(rows.map(r => r.name));
}

router.post('/items/move', requireRole('admin'), async (req, res) => {
  const { folderIds, documentIds, targetId } = parseItems(req.body);
  if (!folderIds.length && !documentIds.length) return res.status(400).json({ error: 'Nothing selected to move.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bad = await checkTarget(client, targetId, documentIds.length > 0);
    if (bad) { await client.query('ROLLBACK'); return res.status(400).json({ error: bad }); }

    const names = await siblingNames(client, targetId);
    let folders = 0;
    for (const id of folderIds) {
      const { rows: [f] } = await client.query('SELECT id, name, parent_id FROM hub_folders WHERE id=$1', [id]);
      if (!f || (f.parent_id || null) === targetId) continue;      // gone, or already there
      if (targetId && await isInside(client, id, targetId)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `"${f.name}" cannot be moved inside itself.` });
      }
      if (lowerSet(names).has(f.name.trim().toLowerCase())) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `There is already a folder called "${f.name}" there.` });
      }
      await client.query('UPDATE hub_folders SET parent_id=$1 WHERE id=$2', [targetId, id]);
      names.add(f.name);
      folders++;
    }
    let documents = 0;
    if (documentIds.length) {
      const r = await client.query(
        'UPDATE hub_documents SET folder_id=$1 WHERE id = ANY($2::uuid[]) AND folder_id <> $1',
        [targetId, documentIds]);
      documents = r.rowCount;
    }
    await client.query('COMMIT');
    res.json({ message: 'Moved', folders, documents });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[hub]', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

router.post('/items/copy', requireRole('admin'), async (req, res) => {
  const { folderIds, documentIds, targetId } = parseItems(req.body);
  if (!folderIds.length && !documentIds.length) return res.status(400).json({ error: 'Nothing selected to copy.' });
  const client = await pool.connect();
  const written = [];       // bucket objects to tidy away if the copy fails
  try {
    await client.query('BEGIN');
    const bad = await checkTarget(client, targetId, documentIds.length > 0);
    if (bad) { await client.query('ROLLBACK'); return res.status(400).json({ error: bad }); }

    // One document, with its own copy of the bytes, into a folder.
    const copyDoc = async (doc, folderId, filename) => {
      let storageKey = null;
      if (doc.storage_key) {
        const { buffer, contentType } = await fileStore.getObject(doc.storage_key);
        storageKey = await fileStore.putObject({
          prefix: `hub/${folderId}`, filename, buffer, contentType: contentType || doc.mime_type,
        });
        written.push(storageKey);
      }
      await client.query(
        `INSERT INTO hub_documents (folder_id, filename, mime_type, size_bytes,
                                    data_base64, storage_key, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [folderId, filename, doc.mime_type, doc.size_bytes,
         storageKey ? null : doc.data_base64, storageKey, req.user.id]
      );
    };

    const names = await siblingNames(client, targetId);
    let folders = 0, documents = 0;
    for (const id of folderIds) {
      if (targetId && await isInside(client, id, targetId)) {
        const { rows: [f] } = await client.query('SELECT name FROM hub_folders WHERE id=$1', [id]);
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `"${f?.name || 'That folder'}" cannot be copied inside itself.` });
      }
      // The whole subtree, parents before children, read before anything is
      // written so the copy never finds itself.
      const { rows: tree } = await client.query(
        `WITH RECURSIVE below AS (
           SELECT f.id, f.name, f.parent_id, f.restricted, f.access_roles, f.access_user_ids, 0 AS depth
             FROM hub_folders f WHERE f.id = $1
           UNION ALL
           SELECT f.id, f.name, f.parent_id, f.restricted, f.access_roles, f.access_user_ids, b.depth + 1
             FROM hub_folders f JOIN below b ON f.parent_id = b.id)
         SELECT * FROM below ORDER BY depth`, [id]);
      const newId = new Map();
      for (const f of tree) {
        const isRoot = f.id === id;
        const name = isRoot ? freeName(f.name, names) : f.name;
        if (isRoot) names.add(name);
        // Who could see it goes with it: copying a restricted folder should
        // not be a way to publish what is inside.
        const { rows: [made] } = await client.query(
          `INSERT INTO hub_folders (name, parent_id, created_by, sort_order,
                                    restricted, access_roles, access_user_ids)
           VALUES ($1,$2,$3, COALESCE((SELECT MAX(sort_order) + 1 FROM hub_folders), 1), $4,$5,$6)
           RETURNING id`,
          [name, isRoot ? targetId : newId.get(f.parent_id), req.user.id,
           f.restricted, f.access_roles, f.access_user_ids]);
        newId.set(f.id, made.id);
        folders++;
        const { rows: docs } = await client.query(
          'SELECT * FROM hub_documents WHERE folder_id=$1 ORDER BY created_at', [f.id]);
        for (const d of docs) { await copyDoc(d, made.id, d.filename); documents++; }
      }
    }

    if (documentIds.length) {
      const { rows: existing } = await client.query(
        'SELECT filename FROM hub_documents WHERE folder_id=$1', [targetId]);
      const taken = new Set(existing.map(r => r.filename));
      const { rows: docs } = await client.query(
        'SELECT * FROM hub_documents WHERE id = ANY($1::uuid[]) ORDER BY created_at', [documentIds]);
      for (const d of docs) {
        const filename = copyFilename(d.filename, taken);
        taken.add(filename);
        await copyDoc(d, targetId, filename);
        documents++;
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Copied', folders, documents });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    for (const key of written) await fileStore.deleteObject(key).catch(() => {});
    console.error('[hub]', err.message);
    res.status(500).json({ error: 'Could not copy those — nothing was changed.' });
  } finally { client.release(); }
});

// ── Company events ───────────────────────────────────────────────────────────

router.get('/events', async (req, res) => {
  // Upcoming by default; ?past=1 for the archive.
  const past = req.query.past === '1';
  try {
    const { rows } = await pool.query(
      `SELECT e.*, u.name AS created_by_name
       FROM hub_events e LEFT JOIN users u ON u.id = e.created_by
       WHERE e.event_date ${past ? '<' : '>='} CURRENT_DATE
       ORDER BY e.event_date ${past ? 'DESC' : 'ASC'}, e.start_time NULLS LAST`
    );
    res.json(rows);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.post('/events', requireRole('admin'), async (req, res) => {
  const { title, description, event_date, start_time, location } = req.body || {};
  if (!title?.trim() || !event_date) return res.status(400).json({ error: 'Title and date are required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO hub_events (title, description, event_date, start_time, location, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [title.trim(), description || null, event_date, start_time || null, location || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.put('/events/:id', requireRole('admin'), async (req, res) => {
  const { title, description, event_date, start_time, location } = req.body || {};
  if (!title?.trim() || !event_date) return res.status(400).json({ error: 'Title and date are required' });
  try {
    const { rows } = await pool.query(
      `UPDATE hub_events SET title=$1, description=$2, event_date=$3, start_time=$4, location=$5
       WHERE id=$6 RETURNING *`,
      [title.trim(), description || null, event_date, start_time || null, location || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/events/:id', requireRole('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM hub_events WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

// ── App feedback ─────────────────────────────────────────────────────────────

router.get('/feedback', async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = '';
  if (status === 'resolved' || status === 'unresolved') {
    params.push(status);
    where = 'WHERE f.status = $1';
  }
  try {
    const { rows } = await pool.query(
      `SELECT f.*, u.name AS created_by_name, r.name AS resolved_by_name
       FROM hub_feedback f
       LEFT JOIN users u ON u.id = f.created_by
       LEFT JOIN users r ON r.id = f.resolved_by
       ${where}
       ORDER BY f.status = 'resolved', f.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.post('/feedback', async (req, res) => {
  const { message } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'Feedback message is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO hub_feedback (message, created_by) VALUES ($1,$2) RETURNING *`,
      [message.trim(), req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

router.patch('/feedback/:id/status', requireRole('admin'), async (req, res) => {
  const { status } = req.body || {};
  if (!['resolved', 'unresolved'].includes(status)) {
    return res.status(400).json({ error: 'Status must be resolved or unresolved' });
  }
  // The resolving flag is passed as its own boolean parameter — reusing $1
  // both as the stored status and inside the CASE tests leaves Postgres
  // unable to deduce a single type for it.
  const resolving = status === 'resolved';
  try {
    const { rows } = await pool.query(
      `UPDATE hub_feedback
       SET status=$1,
           resolved_at = CASE WHEN $2::boolean THEN NOW() ELSE NULL END,
           resolved_by = CASE WHEN $2::boolean THEN $3::uuid ELSE NULL END
       WHERE id=$4 RETURNING *`,
      [status, resolving, req.user.id, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

// Authors can withdraw their own feedback; admins can remove any.
router.delete('/feedback/:id', async (req, res) => {
  try {
    const { rows: [fb] } = await pool.query('SELECT created_by FROM hub_feedback WHERE id=$1', [req.params.id]);
    if (!fb) return res.status(404).json({ error: 'Not found' });
    if (!isAdmin(req) && fb.created_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete feedback you submitted' });
    }
    await pool.query('DELETE FROM hub_feedback WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { console.error('[hub]', err.message); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
