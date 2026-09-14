import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { loadAuthedFile } from '../../components/products/authedFile';
import fileTypes from '../../../../shared/marketingFileTypes.json';
import styles from './Marketing.module.css';

// Website → Marketing Library: the supplier brochures and photography the site
// is built from. Most of it arrives on its own — automation/marketing-sync.js
// uploads whatever Co-Work saves into a folder on the office PC — and the rest
// is added here by hand.

// Office level can add, move and delete, matching requireRole('admin', 'office')
// on the server, which lets sales and operations through as office.
const MANAGERS = ['admin', 'office', 'sales', 'operations'];

const ACCEPT = Object.keys(fileTypes.types).join(',');
const MAX_MB = fileTypes.maxBytes / 1024 / 1024;

function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function kindOf(asset) {
  if (asset.mime.startsWith('image/')) return 'image';
  if (asset.mime === 'application/pdf') return 'pdf';
  if (asset.mime.startsWith('video/')) return 'video';
  return 'file';
}

const KIND_ICON = { pdf: '📄', video: '🎬', image: '🖼', file: '📎' };

// A file from the library, fetched with the login token (an <img src> can't
// send one) and cached for the page, so scrolling back up doesn't refetch.
function useAuthedUrl(path) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    setUrl(null); setFailed(false);
    loadAuthedFile(path)
      .then(f => { if (!cancelled) setUrl(f.url); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [path]);
  return { url, failed };
}

function Thumb({ asset }) {
  const { url, failed } = useAuthedUrl(asset.has_thumb ? `/marketing/assets/${asset.id}/thumb` : null);
  if (!asset.has_thumb || failed) {
    return <div className={styles.thumbIcon}>{KIND_ICON[kindOf(asset)]}</div>;
  }
  if (!url) return <div className={styles.thumbLoading} />;
  return <img src={url} alt="" className={styles.thumbImg} loading="lazy" />;
}

function Breadcrumb({ path, onGo }) {
  const parts = path ? path.split('/') : [];
  return (
    <nav className={styles.breadcrumb} aria-label="Folder">
      <button type="button" className={styles.crumb} onClick={() => onGo('')}>Library</button>
      {parts.map((p, i) => {
        const to = parts.slice(0, i + 1).join('/');
        const last = i === parts.length - 1;
        return (
          <span key={to} className={styles.crumbWrap}>
            <span className={styles.crumbSep}>›</span>
            {last
              ? <span className={styles.crumbCurrent}>{p}</span>
              : <button type="button" className={styles.crumb} onClick={() => onGo(to)}>{p}</button>}
          </span>
        );
      })}
    </nav>
  );
}

function Preview({ asset, canManage, onClose, onChanged, onDeleted }) {
  const kind = kindOf(asset);
  const { url, failed } = useAuthedUrl(`/marketing/assets/${asset.id}/file`);
  const [mode, setMode] = useState(null); // 'rename' | 'move'
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function download() {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = asset.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function save() {
    setBusy(true); setError('');
    try {
      const body = mode === 'rename' ? { filename: value } : { path: value };
      const { data } = await api.patch(`/marketing/assets/${asset.id}`, body);
      setMode(null);
      onChanged(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save that');
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(`Delete "${asset.filename}" from the Marketing Library? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api.delete(`/marketing/assets/${asset.id}`);
      onDeleted(asset);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete that');
      setBusy(false);
    }
  }

  return (
    <div className={styles.previewOverlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.preview} role="dialog" aria-modal="true" aria-label={asset.filename}>
        <div className={styles.previewHeader}>
          <span className={styles.previewTitle}>{asset.filename}</span>
          <button type="button" className={styles.previewClose} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.previewBody}>
          {failed ? (
            <p className={styles.muted}>Couldn't load this file.</p>
          ) : !url ? (
            <p className={styles.muted}>Loading…</p>
          ) : kind === 'image' ? (
            <img src={url} alt={asset.filename} className={styles.previewImg} />
          ) : kind === 'pdf' ? (
            <object data={url} type="application/pdf" className={styles.previewPdf} aria-label={asset.filename}>
              <p className={styles.muted}>This browser won't show the PDF here — use Download.</p>
            </object>
          ) : kind === 'video' ? (
            <video src={url} controls className={styles.previewImg} />
          ) : (
            <p className={styles.muted}>No preview for this type — use Download.</p>
          )}
        </div>

        <div className={styles.previewFooter}>
          <div className={styles.previewMeta}>
            <span>{asset.folder_path || 'Top of library'}</span>
            <span>{fmtBytes(Number(asset.bytes))}</span>
            {asset.width && <span>{asset.width} × {asset.height}</span>}
            <span>{asset.source === 'sync' ? 'Synced' : 'Uploaded'} {new Date(asset.created_at).toLocaleDateString('en-NZ')}</span>
          </div>

          {error && <div className={styles.errorBanner}>{error}</div>}

          {mode ? (
            <div className={styles.inlineForm}>
              <input
                autoFocus value={value} onChange={e => setValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save(); }}
                placeholder={mode === 'move' ? 'Folder, e.g. Mitsubishi/AP Series' : 'File name'}
              />
              <button type="button" className={styles.btnPrimary} onClick={save} disabled={busy}>
                {mode === 'move' ? 'Move' : 'Rename'}
              </button>
              <button type="button" className={styles.btnSecondary} onClick={() => setMode(null)}>Cancel</button>
            </div>
          ) : (
            <div className={styles.previewActions}>
              <button type="button" className={styles.btnPrimary} onClick={download} disabled={!url}>⬇ Download</button>
              {canManage && <>
                <button type="button" className={styles.btnSecondary}
                  onClick={() => { setValue(asset.filename); setMode('rename'); }}>Rename</button>
                <button type="button" className={styles.btnSecondary}
                  onClick={() => { setValue(asset.folder_path); setMode('move'); }}>Move</button>
                <button type="button" className={styles.btnDanger} onClick={remove} disabled={busy}>Delete</button>
              </>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MarketingLibrary() {
  const { user } = useAuth();
  const canManage = MANAGERS.includes(user?.role);

  const [path, setPath] = useState('');
  const [listing, setListing] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [preview, setPreview] = useState(null);
  const [newFolder, setNewFolder] = useState(null); // null = closed, string = typing
  const [upload, setUpload] = useState(null);       // { done, total, added, dupes, errors[] }
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);

  const load = useCallback(async (p) => {
    setError('');
    try {
      const { data } = await api.get('/marketing/folders', { params: { path: p } });
      setListing(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load the library');
    }
  }, []);

  useEffect(() => { load(path); }, [path, load]);

  // Search runs as you type, a moment after you stop.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); return undefined; }
    const t = setTimeout(() => {
      api.get('/marketing/search', { params: { q } })
        .then(r => setResults(r.data))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  function go(p) {
    setQuery('');
    // An upload's summary belongs to the folder it happened in — leave it
    // showing only while that upload is still running.
    setUpload(u => (u && u.done < u.total ? u : null));
    setPath(p);
  }

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const status = { done: 0, total: files.length, added: 0, dupes: 0, errors: [] };
    setUpload({ ...status });
    // One at a time: these can be large, and the server holds each in memory.
    for (const f of files) {
      if (f.size > fileTypes.maxBytes) {
        status.errors.push(`${f.name} is over ${MAX_MB} MB`);
      } else {
        try {
          const form = new FormData();
          form.append('path', path);
          form.append('filename', f.name);
          form.append('file', f);
          const { data } = await api.post('/marketing/assets', form);
          if (data.duplicate) status.dupes++; else status.added++;
        } catch (err) {
          status.errors.push(`${f.name}: ${err.response?.data?.error || 'upload failed'}`);
        }
      }
      status.done++;
      setUpload({ ...status });
    }
    await load(path);
  }

  async function createFolder() {
    const name = (newFolder || '').trim();
    if (!name) { setNewFolder(null); return; }
    try {
      const { data } = await api.post('/marketing/folders', { path: path ? `${path}/${name}` : name });
      setNewFolder(null);
      go(data.path);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not make that folder');
    }
  }

  async function deleteFolder() {
    if (!confirm(`Delete the empty folder "${path.split('/').pop()}"?`)) return;
    try {
      await api.delete('/marketing/folders', { params: { path } });
      go(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete that folder');
    }
  }

  const showing = results ?? listing?.assets ?? [];
  const searching = results !== null;
  const folders = searching ? [] : (listing?.folders || []);
  const isEmpty = !searching && listing && !folders.length && !showing.length;
  const uploading = upload && upload.done < upload.total;

  return (
    <div
      className={`${styles.library} ${dragging ? styles.dragging : ''}`}
      onDragOver={canManage ? e => { e.preventDefault(); setDragging(true); } : undefined}
      onDragLeave={canManage ? e => { if (e.currentTarget === e.target) setDragging(false); } : undefined}
      onDrop={canManage ? e => { e.preventDefault(); setDragging(false); uploadFiles(e.dataTransfer.files); } : undefined}
    >
      <p className={styles.intro}>
        Supplier brochures and photography for the website. Files saved into the synced
        folder on the office PC appear here on their own; you can also add them by hand.
      </p>

      <div className={styles.toolbar}>
        <input
          type="search" className={styles.search} value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search the whole library…"
        />
        {canManage && (
          <div className={styles.toolbarActions}>
            <button type="button" className={styles.btnSecondary} onClick={() => setNewFolder('')}>+ New folder</button>
            <button type="button" className={styles.btnPrimary} onClick={() => fileInput.current?.click()} disabled={uploading}>
              ⬆ Upload files
            </button>
            <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden
              onChange={e => { uploadFiles(e.target.files); e.target.value = ''; }} />
          </div>
        )}
      </div>

      {!searching && <Breadcrumb path={path} onGo={go} />}
      {searching && <div className={styles.searchNote}>{showing.length} result{showing.length === 1 ? '' : 's'} for “{query.trim()}”</div>}

      {newFolder !== null && (
        <div className={styles.inlineForm}>
          <input autoFocus value={newFolder} onChange={e => setNewFolder(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') setNewFolder(null); }}
            placeholder={`New folder in ${path || 'the top of the library'}`} />
          <button type="button" className={styles.btnPrimary} onClick={createFolder}>Create</button>
          <button type="button" className={styles.btnSecondary} onClick={() => setNewFolder(null)}>Cancel</button>
        </div>
      )}

      {upload && (
        <div className={upload.errors.length ? styles.warnBanner : styles.infoBanner}>
          {uploading
            ? `Uploading ${upload.done + 1} of ${upload.total}…`
            : [
                upload.added && `${upload.added} added`,
                upload.dupes && `${upload.dupes} already in the library`,
                upload.errors.length && `${upload.errors.length} couldn't be added`,
              ].filter(Boolean).join(', ') || 'Nothing to add'}
          {!uploading && upload.errors.length > 0 && (
            <ul className={styles.errorList}>{upload.errors.slice(0, 5).map(e => <li key={e}>{e}</li>)}</ul>
          )}
          {!uploading && (
            <button type="button" className={styles.bannerClose} onClick={() => setUpload(null)} aria-label="Dismiss">✕</button>
          )}
        </div>
      )}

      {error && <div className={styles.errorBanner}>{error}</div>}

      {!listing && !error && <p className={styles.muted}>Loading…</p>}

      {listing && !searching && !listing.exists && (
        <p className={styles.muted}>This folder doesn't exist any more. <button type="button" className={styles.linkBtn} onClick={() => go('')}>Back to the library</button></p>
      )}

      {folders.length > 0 && (
        <div className={styles.folderGrid}>
          {folders.map(f => (
            <button key={f.path} type="button" className={styles.folderTile} onClick={() => go(f.path)}>
              <span className={styles.folderIcon}>📁</span>
              <span className={styles.folderName}>{f.name}</span>
              <span className={styles.folderCount}>
                {f.assetCount} file{f.assetCount === 1 ? '' : 's'}
                {f.folderCount ? ` · ${f.folderCount} folder${f.folderCount === 1 ? '' : 's'}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}

      {showing.length > 0 && (
        <div className={styles.assetGrid}>
          {showing.map(a => (
            <button key={a.id} type="button" className={styles.assetTile} onClick={() => setPreview(a)}>
              <div className={styles.thumb}><Thumb asset={a} /></div>
              <div className={styles.assetName} title={a.filename}>{a.filename}</div>
              <div className={styles.assetMeta}>
                {searching ? (a.folder_path || 'Top of library') : (a.width ? `${a.width} × ${a.height}` : fmtBytes(Number(a.bytes)))}
              </div>
            </button>
          ))}
        </div>
      )}

      {isEmpty && listing.exists && (
        <div className={styles.empty}>
          <p>{path ? 'This folder is empty.' : 'The library is empty.'}</p>
          {canManage && <p className={styles.muted}>Drop files anywhere on this page, or use Upload files.</p>}
          {canManage && path && (
            <button type="button" className={styles.btnDanger} onClick={deleteFolder}>Delete this folder</button>
          )}
        </div>
      )}

      {searching && showing.length === 0 && <p className={styles.muted}>Nothing matches.</p>}

      {preview && (
        <Preview
          asset={preview}
          canManage={canManage}
          onClose={() => setPreview(null)}
          onChanged={updated => {
            setPreview(updated);
            load(path);
            if (searching) setResults(rs => rs.map(r => (r.id === updated.id ? updated : r)));
          }}
          onDeleted={gone => {
            setPreview(null);
            load(path);
            if (searching) setResults(rs => rs.filter(r => r.id !== gone.id));
          }}
        />
      )}
    </div>
  );
}
