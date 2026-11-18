import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './Hub.module.css';
import { overlayClose } from '../../lib/overlayClose';

const TABS = ['Documents', 'Events', 'App Feedback'];

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}
function fmtDateTime(d) {
  return d ? new Date(d).toLocaleString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
}
function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  const suffix = hour >= 12 ? 'pm' : 'am';
  return `${((hour + 11) % 12) + 1}:${m}${suffix}`;
}

// What the Hub takes. The server keeps the same list (HUB_TYPES in
// routes/hub.js) and is the one that decides; this is so the file picker and
// the message say so before anything is sent.
const EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'csv', 'ppt', 'pptx', 'txt',
  'rtf', 'odt', 'ods', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'dwg', 'dxf', 'zip', 'msg', 'eml'];
const ACCEPT = EXTENSIONS.map(e => `.${e}`).join(',');
const extOf = name => String(name).split('.').pop().toLowerCase();
const acceptsFile = name => EXTENSIONS.includes(extOf(name));
// The upload goes as base64 in a JSON body the server caps at 15 MB, and
// base64 is a third bigger than the file.
const MAX_UPLOAD_MB = 10;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const showsInBrowser = doc =>
  /^(application\/pdf|image\/(jpeg|png|gif|webp)|text\/plain)$/.test(doc.mime_type || 'application/pdf');
function fileIcon(name) {
  const e = extOf(name);
  if (['doc', 'docx', 'rtf', 'odt', 'txt'].includes(e)) return '📝';
  if (['xls', 'xlsx', 'xlsm', 'csv', 'ods'].includes(e)) return '📊';
  if (['ppt', 'pptx'].includes(e)) return '📽️';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(e)) return '🖼️';
  if (['dwg', 'dxf'].includes(e)) return '📐';
  if (['msg', 'eml'].includes(e)) return '✉️';
  if (e === 'zip') return '🗜️';
  return '📄';
}

// The tab and the open folder live in the address, the way the Price List's
// folders do: each step is a history entry, so the browser's (or the phone's)
// Back goes up a folder or back a tab instead of leaving the Hub, and a reload
// or a shared link lands in the same folder.
const TAB_KEY = { Documents: null, Events: 'events', 'App Feedback': 'feedback' };

export default function DekkerHub() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.find(t => TAB_KEY[t] === searchParams.get('tab')) || 'Documents';
  const setTab = t => {
    if (t === tab) return;
    const params = new URLSearchParams();
    if (TAB_KEY[t]) params.set('tab', TAB_KEY[t]);
    setSearchParams(params);
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Dekker Hub</h1>
          <p className={styles.pageSubtitle}>Company documents, upcoming events and app feedback</p>
        </div>
      </div>

      <div className={styles.tabBar}>
        {TABS.map(t => (
          <button key={t} className={`${styles.tabBtn} ${tab === t ? styles.tabBtnActive : ''}`}
            onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Documents' && <DocumentsTab isAdmin={isAdmin} />}
      {tab === 'Events' && <EventsTab isAdmin={isAdmin} />}
      {tab === 'App Feedback' && <FeedbackTab isAdmin={isAdmin} user={user} />}
    </div>
  );
}

// ── Documents ────────────────────────────────────────────────────────────────
function DocumentsTab({ isAdmin }) {
  const [folders, setFolders] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get('f');
  // Looked up from the list rather than held, so a rename shows straight away
  // and Back/Forward just change which one this is.
  const openFolder = openId ? folders.find(f => f.id === openId) || null : null;
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);     // typing a new folder's name
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(null);  // folder being renamed
  const [busy, setBusy] = useState(false);
  // What is ticked, for Move to / Copy to. Cleared on leaving the folder.
  const [selFolders, setSelFolders] = useState(() => new Set());
  const [selDocs, setSelDocs] = useState(() => new Set());
  const [picking, setPicking] = useState(null);     // 'move' | 'copy' | null
  const [accessFor, setAccessFor] = useState(null); // folder whose access is being set
  const [notice, setNotice] = useState('');
  const fileRef = useRef();

  function loadFolders() {
    return api.get('/hub/folders').then(r => setFolders(r.data)).catch(() => {});
  }
  useEffect(() => { loadFolders().finally(() => setLoading(false)); }, []);

  function clearSelection() { setSelFolders(new Set()); setSelDocs(new Set()); }
  const toggle = (set, setter, id) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  function loadDocuments(id) {
    return api.get(`/hub/folders/${id}/documents`).then(r => setDocuments(r.data));
  }

  // Whatever the address says is open — by a click here, Back, Forward or a
  // link — is what gets shown.
  useEffect(() => {
    setErr(''); setNotice('');
    clearSelection();
    setDocuments([]);
    if (!openId) return;
    let live = true;
    api.get(`/hub/folders/${openId}/documents`)
      .then(r => { if (live) setDocuments(r.data); })
      .catch(() => {});
    return () => { live = false; };
  }, [openId]);

  // Pushed, not replaced: each folder opened is a step Back can undo.
  function openIt(folder) {
    if (folder.id === openId) return;
    const params = new URLSearchParams(searchParams);
    params.set('f', folder.id);
    setSearchParams(params);
  }

  function goTop() {
    if (!openId) return;
    const params = new URLSearchParams(searchParams);
    params.delete('f');
    setSearchParams(params);
  }

  // Move or copy whatever is ticked into the folder picked (null = top level).
  async function moveOrCopy(mode, targetId) {
    setBusy(true); setErr(''); setNotice('');
    try {
      const { data } = await api.post(`/hub/items/${mode}`, {
        folder_ids: [...selFolders], document_ids: [...selDocs], target_id: targetId,
      });
      const where = targetId ? folders.find(f => f.id === targetId)?.name : 'the top level';
      const what = [
        data.folders ? `${data.folders} folder${data.folders === 1 ? '' : 's'}` : null,
        data.documents ? `${data.documents} document${data.documents === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' and ') || 'Nothing';
      setNotice(`${what} ${mode === 'move' ? 'moved' : 'copied'} to ${where}.`);
      setPicking(null);
      clearSelection();
      await loadFolders();
      if (openId) await loadDocuments(openId);
    } catch (e2) {
      setErr(e2.response?.data?.error || `Could not ${mode} those.`);
      setPicking(null);
    } finally { setBusy(false); }
  }

  async function saveAccess(folder, access) {
    await api.put(`/hub/folders/${folder.id}/access`, access);
    setAccessFor(null);
    await loadFolders();
  }

  // Where we are, and what is in it. Folders nest now, so "the folders" is
  // whatever sits under the one being looked at rather than all of them.
  const here = openFolder ? openFolder.id : null;
  const children = folders.filter(f => (f.parent_id || null) === here);

  // The trail back to the top, for the breadcrumb.
  const trail = [];
  for (let cur = openFolder; cur; cur = folders.find(f => f.id === cur.parent_id)) {
    trail.unshift(cur);
    if (trail.length > 20) break;   // a tree that has gone wrong is not a hang
  }

  async function createFolder(e) {
    e?.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true); setErr('');
    try {
      await api.post('/hub/folders', { name, parent_id: here });
      setNewName(''); setAdding(false);
      await loadFolders();
    } catch (e2) {
      setErr(e2.response?.data?.error || 'Could not make that folder');
    } finally { setBusy(false); }
  }

  async function renameFolder(folder, name) {
    if (!name.trim() || name.trim() === folder.name) { setRenaming(null); return; }
    setBusy(true); setErr('');
    try {
      await api.put(`/hub/folders/${folder.id}`, { name: name.trim() });
      setRenaming(null);
      await loadFolders();
    } catch (e2) {
      setErr(e2.response?.data?.error || 'Could not rename that folder');
    } finally { setBusy(false); }
  }

  async function deleteFolder(folder) {
    setErr('');
    const go = async cascade => api.delete(
      `/hub/folders/${folder.id}${cascade ? '?cascade=1' : ''}`);
    try {
      if (!confirm(`Delete the folder "${folder.name}"?`)) return;
      setBusy(true);
      await go(false);
      await loadFolders();
    } catch (e2) {
      // Not empty. The server says what is inside rather than refusing
      // blankly, so the second question is one somebody can answer.
      if (e2.response?.data?.needs_confirm) {
        const { error } = e2.response.data;
        if (confirm(`${error}\n\nDelete it and everything in it? This cannot be undone.`)) {
          try { await go(true); await loadFolders(); }
          catch (e3) { setErr(e3.response?.data?.error || 'Could not delete that folder'); }
        }
      } else {
        setErr(e2.response?.data?.error || 'Could not delete that folder');
      }
    } finally { setBusy(false); }
  }

  // Several at once, one after another, so one that is refused does not stop
  // the rest — and the message says which ones did not go.
  async function handleUpload(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    const folderId = openId;
    setErr(''); setNotice('');
    const failed = [];
    let done = 0;
    for (const file of files) {
      if (!acceptsFile(file.name)) { failed.push(`${file.name} (not a supported type)`); continue; }
      if (file.size > MAX_UPLOAD_BYTES) { failed.push(`${file.name} (over ${MAX_UPLOAD_MB} MB)`); continue; }
      setUploading(files.length > 1 ? `Uploading ${done + 1} of ${files.length}…` : 'Uploading…');
      try {
        const data_base64 = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = ev => res(ev.target.result);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        await api.post(`/hub/folders/${folderId}/documents`, {
          filename: file.name, mime_type: file.type, data_base64,
        });
        done++;
      } catch (e2) {
        failed.push(`${file.name} (${e2.response?.data?.error || 'upload failed'})`);
      }
    }
    setUploading(false);
    if (done) setNotice(`${done} file${done === 1 ? '' : 's'} added.`);
    if (failed.length) setErr(`Not added: ${failed.join('; ')}`);
    if (folderId === openId) await loadDocuments(folderId).catch(() => {});
    loadFolders();
  }

  async function handleDelete(doc) {
    if (!confirm(`Delete "${doc.filename}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/hub/documents/${doc.id}`);
      setDocuments(ds => ds.filter(d => d.id !== doc.id));
      loadFolders();
    } catch { alert('Failed to delete document.'); }
  }

  // Opening a PDF, in a way an iPad will actually do.
  //
  // This used to fetch the file as a blob and then window.open it. Safari on
  // iOS breaks that twice over: a window opened after an await is no longer
  // part of the tap that asked for it, so it is blocked outright; and even
  // allowed through, iOS will not render a blob: PDF in a new tab.
  //
  // So the tab is opened on the tap itself — synchronously, while the gesture
  // still counts — and pointed at a short-lived signed URL once there is one.
  // The browser then gets a plain application/pdf response and shows it in its
  // own viewer, where it can be shared, printed or saved as usual.
  //
  // Word, Excel and the rest are not something a browser tab can show, so
  // those are not given a tab at all: the link comes back as a download and
  // following it here opens the file in Word or Excel (or the iPad's preview)
  // without leaving the Hub or an empty tab behind.
  async function openDoc(doc) {
    if (!showsInBrowser(doc)) {
      try {
        const { data } = await api.post(`/hub/documents/${doc.id}/link`);
        window.location.href = `${import.meta.env.VITE_API_BASE_URL || ''}${data.url}`;
      } catch { alert('Could not open that document.'); }
      return;
    }
    const tab = window.open('', '_blank');
    try {
      const { data } = await api.post(`/hub/documents/${doc.id}/link`);
      // The link comes back rooted at /api. In production the API is on another
      // host, so it needs that origin in front of it; locally it is served from
      // this one and the path is already right. Read from the environment the
      // same way lib/api does, rather than reaching into axios's internals.
      const url = `${import.meta.env.VITE_API_BASE_URL || ''}${data.url}`;
      if (tab) {
        tab.location.href = url;
      } else {
        // Popups blocked entirely: go there in this tab rather than failing.
        // The Hub is a list, so coming back is one tap.
        window.location.href = url;
      }
    } catch {
      if (tab) tab.close();
      alert('Could not open that document.');
    }
  }

  if (loading) return <div className={styles.loading}>Loading…</div>;

  const selCount = selFolders.size + selDocs.size;

  // Ticked items, and what to do with them.
  const selectionBar = isAdmin && selCount > 0 && (
    <div className={styles.selBar}>
      <strong>{selCount} selected</strong>
      <button className={styles.btnSecondary} disabled={busy} onClick={() => setPicking('move')}>Move to…</button>
      <button className={styles.btnSecondary} disabled={busy} onClick={() => setPicking('copy')}>Copy to…</button>
      <button className={styles.backLink} onClick={clearSelection}>Clear</button>
    </div>
  );

  const modals = (
    <>
      {picking && (
        <FolderPicker
          mode={picking}
          folders={folders}
          movingFolderIds={selFolders}
          hasDocuments={selDocs.size > 0}
          currentId={here}
          busy={busy}
          onPick={(mode, targetId) => moveOrCopy(mode, targetId)}
          onClose={() => setPicking(null)}
        />
      )}
      {accessFor && (
        <AccessModal
          folder={accessFor}
          folders={folders}
          onSave={access => saveAccess(accessFor, access)}
          onClose={() => setAccessFor(null)}
        />
      )}
    </>
  );

  const flash = (
    <>
      {err && <div className={styles.errorMsg}>{err}</div>}
      {notice && <div className={styles.noticeMsg}>{notice}</div>}
    </>
  );

  // The folder tiles for wherever we are, with the admin controls on each.
  const folderTiles = (
    <>
      {children.map(f => (
        <div key={f.id}
          className={`${styles.folderCard} ${selFolders.has(f.id) ? styles.folderSelected : ''}`}>
          {renaming === f.id ? (
            <form
              onSubmit={e => { e.preventDefault(); renameFolder(f, e.target.elements.n.value); }}
              onClick={e => e.stopPropagation()}
            >
              <input name="n" defaultValue={f.name} autoFocus disabled={busy}
                className={styles.folderRename}
                onBlur={e => renameFolder(f, e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setRenaming(null); }} />
            </form>
          ) : (
            <>
              {isAdmin && (
                <input type="checkbox" className={styles.folderCheck}
                  title="Select" aria-label={`Select ${f.name}`}
                  checked={selFolders.has(f.id)}
                  onChange={() => toggle(selFolders, setSelFolders, f.id)} />
              )}
              <button className={styles.folderOpen} onClick={() => openIt(f)}>
                <div className={styles.folderIcon}>📁</div>
                <div className={styles.folderName}>{f.name}</div>
                <div className={styles.folderCount}>
                  {[
                    f.folder_count ? `${f.folder_count} folder${f.folder_count === 1 ? '' : 's'}` : null,
                    `${f.document_count} ${f.document_count === 1 ? 'document' : 'documents'}`,
                  ].filter(Boolean).join(' · ')}
                </div>
                {f.restricted && (
                  <div className={styles.accessBadge}>
                    🔒 {isAdmin ? accessSummary(f, folders) : 'Restricted'}
                  </div>
                )}
              </button>
              {isAdmin && (
                <div className={styles.folderActions}>
                  <button title="Rename" disabled={busy}
                    onClick={() => { setErr(''); setRenaming(f.id); }}>✎</button>
                  <button title="Who can see this" disabled={busy}
                    onClick={() => { setErr(''); setAccessFor(f); }}>🔒</button>
                  <button title="Move or copy" disabled={busy}
                    onClick={() => { setErr(''); setSelFolders(new Set([f.id])); setSelDocs(new Set()); setPicking('move'); }}>⇄</button>
                  <button title="Delete" disabled={busy}
                    onClick={() => deleteFolder(f)}>✕</button>
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {isAdmin && (adding ? (
        <form className={styles.folderCard} onSubmit={createFolder}>
          <div className={styles.folderIcon}>📁</div>
          <input autoFocus value={newName} disabled={busy} placeholder="Folder name"
            className={styles.folderRename}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setAdding(false); setNewName(''); } }} />
          <div className={styles.folderCount}>Enter to save · Esc to cancel</div>
        </form>
      ) : (
        <button className={`${styles.folderCard} ${styles.folderNew}`}
          onClick={() => { setErr(''); setAdding(true); }}>
          <div className={styles.folderIcon}>＋</div>
          <div className={styles.folderName}>New folder</div>
          <div className={styles.folderCount}>{openFolder ? `inside ${openFolder.name}` : 'at the top level'}</div>
        </button>
      ))}
    </>
  );

  if (openFolder) {
    return (
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          {/* Where you are, and every step back out of it. */}
          <nav className={styles.crumbs}>
            <button className={styles.backLink} onClick={goTop}>
              Dekker Hub
            </button>
            {trail.map((f, i) => (
              <span key={f.id}>
                <span className={styles.crumbSep}>›</span>
                {i === trail.length - 1
                  ? <strong>{f.name}</strong>
                  : <button className={styles.backLink} onClick={() => openIt(f)}>{f.name}</button>}
              </span>
            ))}
          </nav>
          {/* In the header rather than a row of its own, so ticking a box
              never shifts the list under the next click. */}
          {selectionBar}
          {isAdmin && (
            <>
              <button className={styles.btnSecondary} style={{ marginLeft: selCount ? 0 : 'auto' }}
                onClick={() => setAccessFor(openFolder)}
                title="Who can see this folder">
                🔒 {folders.find(f => f.id === openFolder.id)?.restricted ? 'Restricted'
                  : restrictedAbove(openFolder, folders) ? 'Limited by parent' : 'Everyone'}
              </button>
              <input ref={fileRef} type="file" multiple accept={ACCEPT} style={{ display: 'none' }} onChange={handleUpload} />
              <button className={styles.btnPrimary} style={{ marginLeft: 0 }}
                title="PDF, Word, Excel, PowerPoint, CSV, text, images, drawings, zip or email"
                onClick={() => fileRef.current?.click()} disabled={!!uploading}>
                {uploading || '+ Add files'}
              </button>
            </>
          )}
        </div>
        {flash}

        {(children.length > 0 || isAdmin) && (
          <div className={styles.folderGrid} style={{ margin: '16px 20px 18px' }}>{folderTiles}</div>
        )}

        {documents.length === 0 ? (
          <p className={styles.emptySmall}>No documents in this folder yet.</p>
        ) : (
          <div className={styles.docTable}>
            <div className={`${styles.docHeaderRow} ${isAdmin ? styles.docRowAdmin : ''}`}>
              {isAdmin && (
                <input type="checkbox" aria-label="Select all documents"
                  checked={documents.length > 0 && documents.every(d => selDocs.has(d.id))}
                  onChange={e => setSelDocs(e.target.checked ? new Set(documents.map(d => d.id)) : new Set())} />
              )}
              <span>Document</span><span>Size</span><span>Added</span><span>Added by</span><span />
            </div>
            {documents.map(d => (
              <div key={d.id}
                className={`${styles.docRow} ${isAdmin ? styles.docRowAdmin : ''} ${selDocs.has(d.id) ? styles.docRowSelected : ''}`}>
                {isAdmin && (
                  <input type="checkbox" aria-label={`Select ${d.filename}`}
                    checked={selDocs.has(d.id)}
                    onChange={() => toggle(selDocs, setSelDocs, d.id)} />
                )}
                <button className={styles.docName} onClick={() => openDoc(d)}
                  title={showsInBrowser(d) ? 'Open' : 'Download to open'}>
                  {fileIcon(d.filename)} {d.filename}
                </button>
                <span className={styles.muted}>{fmtSize(d.size_bytes)}</span>
                <span className={styles.muted}>{fmtDate(d.created_at)}</span>
                <span className={styles.muted}>{d.uploaded_by_name || '—'}</span>
                <span className={styles.docActions}>
                  {isAdmin && (
                    <>
                      <button className={styles.iconBtn} title="Move or copy"
                        onClick={() => { setErr(''); setSelDocs(new Set([d.id])); setSelFolders(new Set()); setPicking('move'); }}>⇄</button>
                      <button className={styles.deleteX} onClick={() => handleDelete(d)} title="Delete">✕</button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        {modals}
      </div>
    );
  }

  return (
    <>
      {flash}
      {selectionBar}
      <div className={styles.folderGrid} style={{ marginTop: (err || notice || selCount) ? 12 : 0 }}>{folderTiles}</div>
      {modals}
    </>
  );
}

// ── Folder access ────────────────────────────────────────────────────────────
// The groups are the roles on the Users page. Admin is always in.
const ACCESS_GROUPS = [
  { value: 'admin', label: 'Admin' },
  { value: 'sales', label: 'Sales' },
  { value: 'operations', label: 'Operations' },
  { value: 'subcontractor', label: 'Subcontractor' },
];
const GROUP_LABEL = Object.fromEntries(ACCESS_GROUPS.map(g => [g.value, g.label]));

// "Admin & Sales", "Admin, Sales + 2 people" — short enough for a tile.
function accessSummary(f) {
  const groups = ['admin', ...(f.access_roles || []).filter(r => r !== 'admin')].map(r => GROUP_LABEL[r] || r);
  const people = (f.access_user_ids || []).length;
  const g = groups.length <= 2 ? groups.join(' & ') : `${groups.slice(0, -1).join(', ')} & ${groups.at(-1)}`;
  return people ? `${g} + ${people} ${people === 1 ? 'person' : 'people'}` : `${g} only`;
}

// The nearest folder above this one that is restricted, if any — because a
// restriction up there limits this folder too, whatever is set here.
function restrictedAbove(folder, folders) {
  for (let cur = folders.find(f => f.id === folder.parent_id), n = 0; cur && n < 30;
       cur = folders.find(f => f.id === cur.parent_id), n++) {
    if (cur.restricted) return cur;
  }
  return null;
}

function AccessModal({ folder, folders, onSave, onClose }) {
  const live = folders.find(f => f.id === folder.id) || folder;
  const [restricted, setRestricted] = useState(!!live.restricted);
  const [roles, setRoles] = useState(() => new Set(['admin', ...(live.access_roles || [])]));
  const [people, setPeople] = useState(() => new Set(live.access_user_ids || []));
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const above = restrictedAbove(live, folders);

  useEffect(() => {
    api.get('/users').then(r => setUsers(r.data.filter(u => u.is_active !== false))).catch(() => {});
  }, []);

  const flip = (set, setter, v) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); setter(n); };
  const shown = users.filter(u => !q.trim() || `${u.name} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase()));
  // A person whose whole group is already ticked is in anyway; say so rather
  // than leave the box looking like it matters.
  const viaGroup = u => roles.has(({ office: 'operations', field_tech: 'subcontractor' })[u.role] || u.role);

  async function save() {
    setSaving(true); setErr('');
    try {
      await onSave({
        restricted,
        roles: [...roles].filter(r => r !== 'admin'),
        user_ids: [...people],
      });
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not save that.');
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} {...overlayClose(onClose)}>
      <div className={styles.modal} role="dialog" aria-label={`Who can see ${live.name}`}>
        <div className={styles.modalHeader}>
          <h2>Who can see “{live.name}”</h2>
          <button className={styles.backLink} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className={styles.modalBody}>
          {above && (
            <p className={styles.inheritNote}>
              🔒 This folder is inside “{above.name}”, which is limited to {accessSummary(above).replace(/ only$/, '')}.
              Only those people can reach it, whatever is set here.
            </p>
          )}
          <label className={styles.radioRow}>
            <input type="radio" checked={!restricted} onChange={() => setRestricted(false)} />
            <span><strong>Everyone</strong><br /><span className={styles.muted}>Every signed-in staff member</span></span>
          </label>
          <label className={styles.radioRow}>
            <input type="radio" checked={restricted} onChange={() => setRestricted(true)} />
            <span><strong>Only these groups and people</strong><br />
              <span className={styles.muted}>Subfolders and documents inside are limited too</span></span>
          </label>

          {restricted && (
            <>
              <div className={styles.pickLabel}>User groups</div>
              <div className={styles.chipRow}>
                {ACCESS_GROUPS.map(g => (
                  <label key={g.value}
                    className={`${styles.chip} ${roles.has(g.value) ? styles.chipOn : ''}`}
                    title={g.value === 'admin' ? 'Admins can always see every folder' : undefined}>
                    <input type="checkbox" checked={roles.has(g.value)} disabled={g.value === 'admin'}
                      onChange={() => flip(roles, setRoles, g.value)} />
                    {g.label}
                  </label>
                ))}
              </div>

              <div className={styles.pickLabel}>Individual people</div>
              <input className={styles.searchInput} placeholder="Search people…" value={q}
                onChange={e => setQ(e.target.value)} />
              <div className={styles.peopleList}>
                {shown.map(u => (
                  <label key={u.id} className={styles.personRow}>
                    <input type="checkbox"
                      checked={viaGroup(u) || people.has(u.id)}
                      disabled={viaGroup(u)}
                      onChange={() => flip(people, setPeople, u.id)} />
                    <span>{u.name}</span>
                    <span className={styles.muted}>
                      {viaGroup(u) ? `via ${GROUP_LABEL[({ office: 'operations', field_tech: 'subcontractor' })[u.role] || u.role]}` : (GROUP_LABEL[u.role] || u.role)}
                    </span>
                  </label>
                ))}
                {shown.length === 0 && <div className={styles.muted} style={{ padding: 8 }}>No one matches.</div>}
              </div>
            </>
          )}
          {err && <div className={styles.errorMsg} style={{ margin: '12px 0 0' }}>{err}</div>}
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnSecondary} onClick={onClose}>Cancel</button>
          <button className={styles.btnPrimary} style={{ marginLeft: 0 }} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Move / copy destination ──────────────────────────────────────────────────
// The whole tree, OneDrive-style. A folder cannot go inside itself, so the
// folders being moved (and everything under them) are greyed out.
function FolderPicker({ mode: initialMode, folders, movingFolderIds, hasDocuments, currentId, busy, onPick, onClose }) {
  const [mode, setMode] = useState(initialMode);
  const [target, setTarget] = useState(undefined);   // undefined = nothing picked, null = top level
  const [open, setOpen] = useState(() => {
    // Start with the way to the current folder unfolded.
    const s = new Set();
    for (let cur = folders.find(f => f.id === currentId), n = 0; cur && n < 30;
         cur = folders.find(f => f.id === cur.parent_id), n++) s.add(cur.id);
    return s;
  });

  const blocked = new Set();
  const block = id => { blocked.add(id); folders.filter(f => f.parent_id === id).forEach(f => block(f.id)); };
  movingFolderIds.forEach(block);

  const kids = id => folders.filter(f => (f.parent_id || null) === id);
  const pickable = id => id === null ? !hasDocuments : !blocked.has(id);

  function row(f, depth) {
    const sub = kids(f.id);
    const isOpen = open.has(f.id);
    const disabled = !pickable(f.id);
    return (
      <div key={f.id}>
        <div
          className={`${styles.treeRow} ${target === f.id ? styles.treeRowOn : ''} ${disabled ? styles.treeRowOff : ''}`}
          style={{ paddingLeft: 10 + depth * 18 }}
          onClick={() => !disabled && setTarget(f.id)}
          onDoubleClick={() => !disabled && !busy && onPick(mode, f.id)}
        >
          <button className={styles.treeToggle} disabled={!sub.length}
            onClick={e => { e.stopPropagation(); const n = new Set(open); if (isOpen) n.delete(f.id); else n.add(f.id); setOpen(n); }}>
            {sub.length ? (isOpen ? '▾' : '▸') : ''}
          </button>
          <span>📁 {f.name}</span>
          {f.restricted && <span className={styles.muted} title="Restricted">🔒</span>}
          {f.id === currentId && <span className={styles.muted}>(current)</span>}
        </div>
        {isOpen && sub.map(c => row(c, depth + 1))}
      </div>
    );
  }

  const n = movingFolderIds.size;
  const targetName = target === null ? 'Dekker Hub (top level)' : folders.find(f => f.id === target)?.name;
  const restrictedTarget = target && (folders.find(f => f.id === target)?.restricted
    || restrictedAbove(folders.find(f => f.id === target) || {}, folders));

  return (
    <div className={styles.overlay} {...overlayClose(onClose)}>
      <div className={styles.modal} role="dialog" aria-label={mode === 'move' ? 'Move to' : 'Copy to'}>
        <div className={styles.modalHeader}>
          <div className={styles.filterGroup} style={{ marginLeft: 0 }}>
            {['move', 'copy'].map(m => (
              <button key={m} className={`${styles.filterBtn} ${mode === m ? styles.filterBtnActive : ''}`}
                onClick={() => setMode(m)}>{m === 'move' ? 'Move' : 'Copy'}</button>
            ))}
          </div>
          <h2 style={{ marginLeft: 8 }}>to…</h2>
          <button className={styles.backLink} style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className={styles.modalBody} style={{ padding: 0 }}>
          <div className={styles.tree}>
            <div
              className={`${styles.treeRow} ${target === null ? styles.treeRowOn : ''} ${!pickable(null) ? styles.treeRowOff : ''}`}
              style={{ paddingLeft: 10 }}
              title={!pickable(null) ? 'Documents need to go inside a folder' : undefined}
              onClick={() => pickable(null) && setTarget(null)}
            >
              <span className={styles.treeToggle} />
              <span>🏠 Dekker Hub (top level)</span>
            </div>
            {kids(null).map(f => row(f, 1))}
          </div>
        </div>
        <div className={styles.modalFooter}>
          <span className={styles.muted} style={{ marginRight: 'auto' }}>
            {target === undefined ? 'Pick a folder' :
              restrictedTarget ? `🔒 ${targetName} — restricted access` : targetName}
          </span>
          <button className={styles.btnSecondary} onClick={onClose}>Cancel</button>
          <button className={styles.btnPrimary} style={{ marginLeft: 0 }}
            disabled={busy || target === undefined}
            onClick={() => onPick(mode, target)}>
            {busy ? (mode === 'move' ? 'Moving…' : 'Copying…') : (mode === 'move' ? 'Move here' : 'Copy here')}
          </button>
        </div>
        {n > 0 && mode === 'copy' && (
          <div className={styles.muted} style={{ padding: '0 20px 14px' }}>
            Folders are copied with everything inside them, and keep their access settings.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Company events ───────────────────────────────────────────────────────────
const EMPTY_EVENT = { title: '', description: '', event_date: '', start_time: '', location: '' };

function EventsTab({ isAdmin }) {
  const [events, setEvents] = useState([]);
  const [showPast, setShowPast] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | event
  const [form, setForm] = useState(EMPTY_EVENT);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function load() {
    setLoading(true);
    api.get('/hub/events', { params: showPast ? { past: '1' } : {} })
      .then(r => setEvents(r.data)).finally(() => setLoading(false));
  }
  useEffect(load, [showPast]);

  function startNew() { setForm(EMPTY_EVENT); setEditing('new'); setErr(''); }
  function startEdit(ev) {
    setForm({
      title: ev.title, description: ev.description || '',
      event_date: ev.event_date ? ev.event_date.slice(0, 10) : '',
      start_time: ev.start_time ? ev.start_time.slice(0, 5) : '',
      location: ev.location || '',
    });
    setEditing(ev); setErr('');
  }

  async function save() {
    if (!form.title.trim() || !form.event_date) { setErr('Title and date are required.'); return; }
    setSaving(true); setErr('');
    try {
      if (editing === 'new') await api.post('/hub/events', form);
      else await api.put(`/hub/events/${editing.id}`, form);
      setEditing(null);
      load();
    } catch (e) { setErr(e.response?.data?.error || 'Failed to save event.'); }
    finally { setSaving(false); }
  }

  async function remove(ev) {
    if (!confirm(`Delete "${ev.title}"?`)) return;
    try { await api.delete(`/hub/events/${ev.id}`); load(); }
    catch { alert('Failed to delete event.'); }
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h2>{showPast ? 'Past Events' : 'Upcoming Events'}</h2>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className={styles.btnSecondary} onClick={() => setShowPast(p => !p)}>
            {showPast ? 'Show upcoming' : 'Show past'}
          </button>
          {isAdmin && <button className={styles.btnPrimary} onClick={startNew}>+ Add Event</button>}
        </div>
      </div>

      {editing && (
        <div className={styles.eventForm}>
          {err && <div className={styles.errorMsg}>{err}</div>}
          <div className={styles.formGrid}>
            <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
              <label>Title</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Team meeting" />
            </div>
            <div className={styles.field}>
              <label>Date</label>
              <input type="date" value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} />
            </div>
            <div className={styles.field}>
              <label>Start Time</label>
              <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
            </div>
            <div className={styles.field}>
              <label>Location</label>
              <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="e.g. Tauranga office" />
            </div>
            <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
              <label>Details</label>
              <textarea rows={3} value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className={styles.btnPrimary} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing === 'new' ? 'Add Event' : 'Save Changes'}
            </button>
            <button className={styles.btnSecondary} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <div className={styles.loading}>Loading…</div> :
       events.length === 0 ? <p className={styles.emptySmall}>No {showPast ? 'past' : 'upcoming'} events.</p> : (
        events.map(ev => (
          <div key={ev.id} className={styles.eventRow}>
            <div className={styles.eventDate}>
              <div className={styles.eventDay}>{new Date(ev.event_date).getDate()}</div>
              <div className={styles.eventMonth}>
                {new Date(ev.event_date).toLocaleDateString('en-NZ', { month: 'short' })}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div className={styles.eventTitle}>{ev.title}</div>
              <div className={styles.eventMeta}>
                {fmtDate(ev.event_date)}
                {ev.start_time && ` · ${fmtTime(ev.start_time)}`}
                {ev.location && ` · ${ev.location}`}
              </div>
              {ev.description && <div className={styles.eventDesc}>{ev.description}</div>}
            </div>
            {isAdmin && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className={styles.btnSecondary} onClick={() => startEdit(ev)}>Edit</button>
                <button className={styles.deleteX} onClick={() => remove(ev)} title="Delete">✕</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ── App feedback ─────────────────────────────────────────────────────────────
const FILTERS = [
  { key: '', label: 'All' },
  { key: 'unresolved', label: 'Unresolved' },
  { key: 'resolved', label: 'Resolved' },
];

function FeedbackTab({ isAdmin, user }) {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('unresolved');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    api.get('/hub/feedback', { params: filter ? { status: filter } : {} })
      .then(r => setItems(r.data)).finally(() => setLoading(false));
  }
  useEffect(load, [filter]);

  async function submit(e) {
    e.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      await api.post('/hub/feedback', { message });
      setMessage('');
      // New feedback lands as unresolved — make sure it's visible straight away.
      if (filter === 'resolved') setFilter('unresolved'); else load();
    } catch { alert('Failed to submit feedback.'); }
    finally { setSubmitting(false); }
  }

  async function toggleStatus(fb) {
    const next = fb.status === 'resolved' ? 'unresolved' : 'resolved';
    try {
      await api.patch(`/hub/feedback/${fb.id}/status`, { status: next });
      load();
    } catch { alert('Failed to update status.'); }
  }

  async function remove(fb) {
    if (!confirm('Delete this feedback?')) return;
    try { await api.delete(`/hub/feedback/${fb.id}`); load(); }
    catch (e) { alert(e.response?.data?.error || 'Failed to delete.'); }
  }

  return (
    <>
      <div className={styles.card} style={{ marginBottom: 16 }}>
        <div className={styles.cardHeader}><h2>Share your feedback</h2></div>
        <form onSubmit={submit} className={styles.feedbackForm}>
          <textarea rows={3} value={message} onChange={e => setMessage(e.target.value)}
            placeholder="What's working well, what isn't, or what you'd like added…" />
          <button className={styles.btnPrimary} type="submit" disabled={submitting || !message.trim()}>
            {submitting ? 'Submitting…' : 'Submit Feedback'}
          </button>
        </form>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2>Feedback</h2>
          <div className={styles.filterGroup}>
            {FILTERS.map(f => (
              <button key={f.key}
                className={`${styles.filterBtn} ${filter === f.key ? styles.filterBtnActive : ''}`}
                onClick={() => setFilter(f.key)}>{f.label}</button>
            ))}
          </div>
        </div>

        {loading ? <div className={styles.loading}>Loading…</div> :
         items.length === 0 ? <p className={styles.emptySmall}>No {filter || ''} feedback yet.</p> : (
          <div className={styles.fbTable}>
            <div className={styles.fbHeaderRow}>
              <span>Feedback</span><span>From</span><span>Submitted</span><span>Status</span><span />
            </div>
            {items.map(fb => (
              <div key={fb.id} className={styles.fbRow}>
                <span className={styles.fbMessage}>{fb.message}</span>
                <span className={styles.muted}>{fb.created_by_name || '—'}</span>
                <span className={styles.muted}>{fmtDateTime(fb.created_at)}</span>
                <span>
                  <span className={fb.status === 'resolved' ? styles.badgeResolved : styles.badgeUnresolved}>
                    {fb.status === 'resolved' ? 'Resolved' : 'Unresolved'}
                  </span>
                  {fb.status === 'resolved' && fb.resolved_by_name && (
                    <div className={styles.resolvedMeta}>by {fb.resolved_by_name} · {fmtDate(fb.resolved_at)}</div>
                  )}
                </span>
                <span className={styles.fbActions}>
                  {isAdmin && (
                    <button className={styles.btnSecondary} onClick={() => toggleStatus(fb)}>
                      {fb.status === 'resolved' ? 'Reopen' : 'Mark Resolved'}
                    </button>
                  )}
                  {(isAdmin || fb.created_by === user?.id) && (
                    <button className={styles.deleteX} onClick={() => remove(fb)} title="Delete">✕</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
