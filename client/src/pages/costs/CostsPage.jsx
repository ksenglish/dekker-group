import { useState, useEffect, useCallback } from 'react';
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

function OperatingCosts({ admin }) {
  const [folders, setFolders] = useState([]);
  const [open, setOpen] = useState(null);
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
      if (open === folder.id) setOpen(null);
      load();
    } catch (err) { alert(err.response?.data?.error || 'Could not delete'); }
  }

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <>
      <p className={styles.folderNote}>
        Running costs that don't belong to any one job. Scanned PDFs are filed here
        from PDF Check using <strong>Save to Folder</strong>.
        {admin ? ' Add a folder per supplier.' : ' Only admins can add or rename folders.'}
      </p>

      {error && <div className={styles.error}>{error}</div>}

      {folders.length === 0 && !creating && (
        <div className={styles.empty}>
          No folders yet.{admin ? ' Add one below to start filing.' : ' An admin needs to add one.'}
        </div>
      )}

      <div className={styles.folderList}>
        {folders.map(f => (
          <div key={f.id} className={styles.folderCard}>
            <div className={styles.folderRow}>
              <button
                className={styles.folderMain}
                onClick={() => setOpen(o => (o === f.id ? null : f.id))}
              >
                <span className={styles.folderIcon}>{open === f.id ? '📂' : '📁'}</span>
                <span className={styles.folderName}>{f.name}</span>
                <span className={styles.folderCount}>
                  {f.document_count} document{f.document_count === 1 ? '' : 's'}
                </span>
              </button>
              {admin && (
                <div className={styles.folderActions}>
                  <button className={styles.smallBtn} onClick={() => rename(f)}>Rename</button>
                  <button className={styles.smallBtnDanger} onClick={() => remove(f)}>Delete</button>
                </div>
              )}
            </div>
            {open === f.id && <FolderContents folderId={f.id} onChanged={load} />}
          </div>
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

function FolderContents({ folderId, onChanged }) {
  const [docs, setDocs] = useState(null);

  const load = useCallback(() => {
    api.get('/costs/operating', { params: { folder_id: folderId } })
      .then(r => setDocs(r.data))
      .catch(() => setDocs([]));
  }, [folderId]);

  useEffect(() => { load(); }, [load]);

  async function remove(doc) {
    if (!confirm('Delete this document?')) return;
    try {
      await api.delete(`/costs/documents/${doc.id}`);
      load(); onChanged();
    } catch (err) { alert(err.response?.data?.error || 'Could not delete'); }
  }

  if (docs === null) return <div className={styles.folderLoading}>Loading…</div>;
  if (docs.length === 0) return <div className={styles.folderEmpty}>Nothing filed here yet.</div>;

  return (
    <div className={styles.docList}>
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
              <button className={styles.smallBtnDanger} onClick={() => remove(d)}>Delete</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
