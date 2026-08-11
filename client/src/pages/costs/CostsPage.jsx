import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { isAdmin } from '../../lib/permissions';
import { formatJobNumber } from '../../lib/formatJobNumber';
import styles from './Costs.module.css';

const fmtMoney = cents => (Number(cents || 0) / 100).toLocaleString('en-NZ', {
  style: 'currency', currency: 'NZD', minimumFractionDigits: 2,
});

const fmtDate = d => new Date(d).toLocaleDateString('en-NZ', {
  day: 'numeric', month: 'short', year: 'numeric',
});

// Costs split two ways: what a job cost us (already attached to the job), and
// what the business costs to run (filed by supplier).
export default function CostsPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [tab, setTab] = useState('direct');

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <Link to="/reports" className={styles.backLink}>← Reports</Link>
          <h1 className={styles.title}>Costs</h1>
          <p className={styles.subtitle}>Supplier invoices, by what they were spent on.</p>
        </div>
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === 'direct' ? styles.tabActive : ''}`}
          onClick={() => setTab('direct')}
        >
          📁 Direct Costs
        </button>
        <button
          className={`${styles.tab} ${tab === 'operating' ? styles.tabActive : ''}`}
          onClick={() => setTab('operating')}
        >
          📁 Operating Costs
        </button>
      </div>

      {tab === 'direct' ? <DirectCosts /> : <OperatingCosts admin={admin} />}
    </div>
  );
}

// Everything already attached to a job. Read-only on purpose — these are filed
// by the job they belong to, so there is nothing to organise here.
function DirectCosts() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/costs/direct')
      .then(r => setRows(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const q = search.trim().toLowerCase();
  const visible = q
    ? rows.filter(r =>
        (r.supplier || '').toLowerCase().includes(q) ||
        (r.invoice_number || '').toLowerCase().includes(q) ||
        (r.customer_name || '').toLowerCase().includes(q) ||
        (formatJobNumber(r) || '').toLowerCase().includes(q))
    : rows;

  const total = visible.reduce((sum, r) => sum + Number(r.total_cents || 0), 0);

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <>
      <p className={styles.folderNote}>
        Every supplier invoice attached to a job. Filed by the job it belongs to,
        so there is nothing to organise here.
      </p>

      <input
        className={styles.search}
        placeholder="Search by supplier, invoice number, job or customer…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {visible.length === 0 ? (
        <div className={styles.empty}>
          {rows.length === 0
            ? 'No supplier invoices have been attached to a job yet.'
            : 'Nothing matches that search.'}
        </div>
      ) : (
        <>
          <div className={styles.summaryBar}>
            <span>{visible.length} invoice{visible.length === 1 ? '' : 's'}</span>
            <span><strong>{fmtMoney(total)}</strong> ex GST</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th><th>Supplier</th><th>Job</th>
                  <th className={styles.num}>Items</th><th className={styles.num}>Total</th><th />
                </tr>
              </thead>
              <tbody>
                {visible.map(r => (
                  <tr key={r.id}>
                    <td className={styles.muted}>{fmtDate(r.created_at)}</td>
                    <td>
                      <div>{r.supplier || 'Unknown supplier'}</div>
                      {r.invoice_number && <div className={styles.muted}>#{r.invoice_number}</div>}
                    </td>
                    <td>
                      <Link to={`/jobs/${r.job_id}`}>{formatJobNumber(r) || 'View job'}</Link>
                      {r.customer_name && <div className={styles.muted}>{r.customer_name}</div>}
                    </td>
                    <td className={styles.num}>{r.item_count}</td>
                    <td className={styles.num}>{fmtMoney(r.total_cents)}</td>
                    <td className={styles.num}>
                      <a
                        className={styles.viewLink}
                        href={`/api/costs/documents/${r.id}`}
                        onClick={e => { e.preventDefault(); openDocument(r.id); }}
                      >
                        PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

// The document endpoint needs the auth header, so it can't be a plain link —
// same reason the job Costs tab fetches its documents as blobs.
async function openDocument(id) {
  try {
    const res = await api.get(`/costs/documents/${id}`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    window.open(url, '_blank');
    // Revoked on a delay: revoking immediately can beat the new tab to it.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    alert('Could not open that document');
  }
}

// Folders come back flat with a parent_id; nesting them here keeps the query
// simple and the depth unbounded.
function buildTree(folders, parentId = null) {
  return folders
    .filter(f => (f.parent_id || null) === parentId)
    .map(f => ({ ...f, children: buildTree(folders, f.id) }));
}

// The move picker is a flat <select>, so the tree is flattened back out with the
// nesting shown as indentation — otherwise two subfolders called "Power" in
// different parents are indistinguishable in the list.
function flattenFolders(tree, depth = 0) {
  return tree.flatMap(f => [
    { id: f.id, label: `${'  '.repeat(depth)}${depth ? '└ ' : ''}${f.name}` },
    ...flattenFolders(f.children, depth + 1),
  ]);
}

// Files are sent as data URLs, the same shape the PDF Check scans are stored in.
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

function OperatingCosts({ admin }) {
  const [folders, setFolders] = useState([]);
  const [openIds, setOpenIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/costs/folders')
      .then(r => setFolders(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createFolder(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    try {
      await api.post('/costs/folders', { name: name.trim() });
      setName(''); setCreating(false); load();
    } catch (err) { setError(err.response?.data?.error || 'Could not create the folder'); }
  }

  async function rename(folder) {
    const next = prompt('Rename folder', folder.name);
    if (!next?.trim() || next.trim() === folder.name) return;
    try {
      await api.put(`/costs/folders/${folder.id}`, { name: next.trim() });
      load();
    } catch (err) { alert(err.response?.data?.error || 'Could not rename'); }
  }

  async function remove(folder) {
    if (!confirm(`Delete the folder "${folder.name}"?`)) return;
    try {
      await api.delete(`/costs/folders/${folder.id}`);
      setOpenIds(ids => ids.filter(id => id !== folder.id));
      load();
    } catch (err) { alert(err.response?.data?.error || 'Could not delete'); }
  }

  async function addSubfolder(parent) {
    const sub = prompt(`New subfolder inside "${parent.name}"`);
    if (!sub?.trim()) return;
    try {
      await api.post('/costs/folders', { name: sub.trim(), parent_id: parent.id });
      setOpenIds(ids => (ids.includes(parent.id) ? ids : [...ids, parent.id]));
      load();
    } catch (err) { alert(err.response?.data?.error || 'Could not create the subfolder'); }
  }

  const toggle = id => setOpenIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));
  const folderOptions = flattenFolders(buildTree(folders));

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <>
      <p className={styles.folderNote}>
        Running costs that don't belong to any one job. Scanned PDFs are filed here
        from PDF Check using <strong>Save to Folder</strong>, or added straight to a
        folder with <strong>+ Upload</strong> — a PDF or a photo of a receipt is
        scanned for its line items on the way in. Filed in the wrong place? Use{' '}
        <strong>Move</strong> on the document.
        {admin ? ' Add a folder per supplier.' : ' Only admins can add or rename folders.'}
      </p>

      {error && <div className={styles.error}>{error}</div>}

      {folders.length === 0 && !creating && (
        <div className={styles.empty}>
          No folders yet.{admin ? ' Add one below to start filing.' : ' An admin needs to add one.'}
        </div>
      )}

      <div className={styles.folderList}>
        {buildTree(folders).map(f => (
          <FolderNode
            key={f.id}
            folder={f}
            depth={0}
            admin={admin}
            allFolders={folderOptions}
            openIds={openIds}
            onToggle={toggle}
            onRename={rename}
            onRemove={remove}
            onAddSub={addSubfolder}
            onChanged={load}
          />
        ))}
      </div>

      {admin && (
        creating ? (
          <form className={styles.newFolder} onSubmit={createFolder}>
            <input
              className={styles.search}
              style={{ marginBottom: 0 }}
              placeholder="Supplier name, e.g. Spark"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
            <button type="submit" className={styles.btnPrimary} disabled={!name.trim()}>Add folder</button>
            <button type="button" className={styles.btnSecondary} onClick={() => setCreating(false)}>Cancel</button>
          </form>
        ) : (
          <button className={styles.btnPrimary} onClick={() => setCreating(true)}>+ New folder</button>
        )
      )}
    </>
  );
}

// Renders itself for its own children, so nesting has no fixed depth. Indent is
// capped so a deep tree stays readable on a phone instead of marching off-screen.
function FolderNode({ folder, depth, admin, allFolders, openIds, onToggle, onRename, onRemove, onAddSub, onChanged }) {
  const isOpen = openIds.includes(folder.id);
  const indent = Math.min(depth, 5) * 18;
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState('');
  // Bumped whenever this folder's contents change from up here, so the list
  // below refetches — it keys its own load off the folder id alone otherwise.
  const [contentsKey, setContentsKey] = useState(0);
  const fileRef = useRef(null);

  // Upload files the folder open, so the newly filed document is visible right
  // where it landed rather than hidden behind a collapsed row.
  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // Base64 inflates a file by about a third, and the server stops at 15MB.
    if (file.size > 10 * 1024 * 1024) {
      setUploadNote('That file is over 10MB. Try a smaller scan or photo.');
      return;
    }
    setUploading(true);
    setUploadNote('');
    try {
      const data_base64 = await readAsDataUrl(file);
      const { data } = await api.post('/costs/documents', {
        folder_id: folder.id, mime_type: file.type || 'application/pdf', data_base64,
      });
      const count = Array.isArray(data.parsed_items) ? data.parsed_items.length : 0;
      setUploadNote(
        data.scan_error ? `Filed, but the scan failed: ${data.scan_error}`
          : count ? `Filed — ${count} line item${count === 1 ? '' : 's'} read off it.`
          : 'Filed, but no line items could be read off it.'
      );
      if (!isOpen) onToggle(folder.id);
      setContentsKey(k => k + 1);
      onChanged();
    } catch (err) {
      setUploadNote(err.response?.data?.error || 'Could not upload that file');
    } finally { setUploading(false); }
  }

  return (
    <div className={depth === 0 ? styles.folderCard : styles.subFolder}>
      <div className={styles.folderRow} style={depth ? { paddingLeft: indent } : undefined}>
        <button className={styles.folderMain} onClick={() => onToggle(folder.id)}>
          <span className={styles.folderIcon}>{isOpen ? '📂' : '📁'}</span>
          <span className={styles.folderName}>{folder.name}</span>
          <span className={styles.folderCount}>
            {folder.document_count} doc{folder.document_count === 1 ? '' : 's'}
            {folder.children.length > 0 && ` · ${folder.children.length} folder${folder.children.length === 1 ? '' : 's'}`}
          </span>
        </button>
        <div className={styles.folderActions}>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            style={{ display: 'none' }}
            onChange={upload}
          />
          <button
            className={styles.smallBtn}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Add a PDF or a photo of a receipt — the line items are read off it"
          >
            {uploading ? 'Scanning…' : '+ Upload'}
          </button>
          {admin && (
            <>
              <button className={styles.smallBtn} onClick={() => onAddSub(folder)} title="Add a subfolder">+ Sub</button>
              <button className={styles.smallBtn} onClick={() => onRename(folder)}>Rename</button>
              <button className={styles.smallBtnDanger} onClick={() => onRemove(folder)}>Delete</button>
            </>
          )}
        </div>
      </div>

      {uploadNote && (
        <div className={styles.folderEmpty} style={{ paddingLeft: 18 + indent }}>{uploadNote}</div>
      )}

      {isOpen && (
        <>
          {folder.children.map(child => (
            <FolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              admin={admin}
              allFolders={allFolders}
              openIds={openIds}
              onToggle={onToggle}
              onRename={onRename}
              onRemove={onRemove}
              onAddSub={onAddSub}
              onChanged={onChanged}
            />
          ))}
          <FolderContents
            folderId={folder.id}
            allFolders={allFolders}
            refreshKey={contentsKey}
            onChanged={onChanged}
            indent={indent}
          />
        </>
      )}
    </div>
  );
}

function FolderContents({ folderId, allFolders = [], refreshKey = 0, onChanged, indent = 0 }) {
  const [docs, setDocs] = useState(null);
  // Which row is currently showing its folder picker — only ever one at a time.
  const [movingId, setMovingId] = useState(null);

  const load = useCallback(() => {
    api.get('/costs/operating', { params: { folder_id: folderId } })
      .then(r => setDocs(r.data))
      .catch(() => setDocs([]));
  }, [folderId, refreshKey]);

  useEffect(() => { load(); }, [load]);

  async function remove(doc) {
    if (!confirm('Delete this document?')) return;
    try {
      await api.delete(`/costs/documents/${doc.id}`);
      load(); onChanged();
    } catch (err) { alert(err.response?.data?.error || 'Could not delete'); }
  }

  // Moving is how a document filed in the wrong place gets put right. The row
  // leaves this list on success, so only the destination needs reloading — which
  // onChanged handles by refreshing the counts and remounting the open folders.
  async function move(doc, destinationId) {
    setMovingId(null);
    if (!destinationId || destinationId === folderId) return;
    try {
      await api.put(`/costs/documents/${doc.id}/folder`, { folder_id: destinationId });
      load(); onChanged();
    } catch (err) { alert(err.response?.data?.error || 'Could not move that document'); }
  }

  if (docs === null) {
    return <div className={styles.folderLoading} style={{ paddingLeft: 18 + indent }}>Loading…</div>;
  }
  if (docs.length === 0) {
    return <div className={styles.folderEmpty} style={{ paddingLeft: 18 + indent }}>Nothing filed here yet.</div>;
  }

  return (
    <div className={styles.docList} style={indent ? { paddingLeft: indent } : undefined}>
      {docs.map(d => {
        const items = Array.isArray(d.parsed_items) ? d.parsed_items : [];
        const total = items.reduce((s, i) => s + (i.unit_price || 0) * (i.quantity || 1), 0);
        return (
          <div key={d.id} className={styles.docRow}>
            <div className={styles.docMain}>
              <span className={styles.docSupplier}>{d.supplier || 'Unknown supplier'}</span>
              {d.invoice_number && <span className={styles.muted}>#{d.invoice_number}</span>}
              <span className={styles.muted}>{fmtDate(d.created_at)}</span>
              {items.length > 0 && (
                <span className={styles.muted}>
                  {items.length} item{items.length === 1 ? '' : 's'} · ${total.toFixed(2)}
                </span>
              )}
            </div>
            <div className={styles.docActions}>
              <button className={styles.smallBtn} onClick={() => openDocument(d.id)}>PDF</button>
              {movingId === d.id ? (
                <select
                  className={styles.smallBtn}
                  defaultValue=""
                  autoFocus
                  onChange={e => move(d, e.target.value)}
                  onBlur={() => setMovingId(null)}
                >
                  <option value="">Move to…</option>
                  {allFolders
                    .filter(f => f.id !== folderId)
                    .map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              ) : (
                <button
                  className={styles.smallBtn}
                  onClick={() => setMovingId(d.id)}
                  disabled={allFolders.length < 2}
                  title={allFolders.length < 2 ? 'There is nowhere else to file this yet' : 'File this in another folder'}
                >
                  Move
                </button>
              )}
              <button className={styles.smallBtnDanger} onClick={() => remove(d)}>Delete</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
