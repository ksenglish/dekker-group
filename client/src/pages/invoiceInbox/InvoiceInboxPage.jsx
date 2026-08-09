import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './InvoiceInbox.module.css';

const fmtDate = d => new Date(d).toLocaleDateString('en-NZ', {
  day: 'numeric', month: 'short', year: 'numeric',
});
const fmtCurrency = cents => `$${((cents || 0) / 100).toFixed(2)}`;

// Folders nest, so the picker shows them in tree order with the depth carried
// through — a flat alphabetical list would put a subfolder nowhere near its
// parent and make "Spark → 2026" impossible to find.
function flattenFolders(folders, parentId = null, depth = 0) {
  return folders
    .filter(f => (f.parent_id || null) === parentId)
    .flatMap(f => [{ ...f, depth }, ...flattenFolders(folders, f.id, depth + 1)]);
}

// Files a PDF under operating costs. Admins can mint a folder here rather than
// having to break off and set one up under Reports first.
function FolderPicker({ scan, onClose, onFiled }) {
  const { user } = useAuth();
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadFolders = useCallback(() => {
    api.get('/costs/folders')
      .then(r => setFolders(r.data))
      .catch(() => setError('Could not load folders'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  async function createFolder(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/costs/folders', { name: newName.trim() });
      setFolders(f => [...f, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName(''); setCreating(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create the folder');
    } finally { setBusy(false); }
  }

  async function file(folder) {
    setBusy(true); setError('');
    try {
      await api.post(`/invoice-inbox/${scan.id}/file`, { folder_id: folder.id });
      onFiled();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not file that document');
      setBusy(false);
    }
  }

  return (
    <div className={styles.pickerOverlay} onClick={onClose}>
      <div className={styles.pickerPanel} onClick={e => e.stopPropagation()}>
        <div className={styles.pickerHeader}>
          <h2>Save to folder</h2>
          <button className={styles.pickerClose} onClick={onClose}>✕</button>
        </div>

        <p className={styles.pickerHint}>
          Files <strong>{scan.supplier || 'this PDF'}</strong> under operating costs,
          with its line items. It will leave PDF Check.
        </p>

        {error && <div className={styles.linkError}>{error}</div>}

        {loading ? (
          <div className={styles.pickerEmpty}>Loading…</div>
        ) : folders.length === 0 && !creating ? (
          <div className={styles.pickerEmpty}>
            No folders yet.{' '}
            {user?.role === 'admin'
              ? 'Create one below.'
              : 'An admin needs to create one under Reports → Costs first.'}
          </div>
        ) : (
          <div className={styles.pickerList}>
            {flattenFolders(folders).map(f => (
              <button
                key={f.id}
                className={styles.pickerItem}
                onClick={() => file(f)}
                disabled={busy}
                style={{ paddingLeft: 12 + f.depth * 16 }}
              >
                <span>📁 {f.name}</span>
                <span className={styles.pickerCount}>{f.document_count}</span>
              </button>
            ))}
          </div>
        )}

        {user?.role === 'admin' && (
          creating ? (
            <form className={styles.pickerNew} onSubmit={createFolder}>
              <input
                className={styles.searchInput}
                placeholder="Supplier name, e.g. Spark"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                autoFocus
              />
              <button type="submit" className={styles.btnConfirmLink} disabled={busy || !newName.trim()}>Add</button>
              <button type="button" className={styles.btnCancel} onClick={() => setCreating(false)}>Cancel</button>
            </form>
          ) : (
            <button className={styles.pickerNewBtn} onClick={() => setCreating(true)}>+ New folder</button>
          )
        )}
      </div>
    </div>
  );
}

export default function InvoiceInboxPage() {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(null); // scan id being linked
  const [jobSearch, setJobSearch] = useState('');
  const [jobResults, setJobResults] = useState([]);
  const [jobSearching, setJobSearching] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [linkError, setLinkError] = useState('');
  const [pdfPreview, setPdfPreview] = useState(null); // scan being previewed
  const [filing, setFiling] = useState(null);         // scan being filed to a folder
  const [selected, setSelected] = useState([]);       // ids ticked for bulk delete
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/invoice-inbox')
      .then(r => { setScans(r.data); setSelected([]); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const allSelected = scans.length > 0 && selected.length === scans.length;

  function toggleSelect(id) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  function toggleSelectAll() {
    setSelected(allSelected ? [] : scans.map(s => s.id));
  }

  async function handleBulkDelete() {
    const n = selected.length;
    if (!confirm(`Delete ${n} invoice${n === 1 ? '' : 's'} from the inbox? They will not be added to any job.`)) return;
    setBulkDeleting(true);
    try {
      await api.post('/invoice-inbox/bulk-delete', { ids: selected });
      load();
      window.dispatchEvent(new Event('invoice-inbox-updated'));
    } catch { alert('Bulk delete failed'); }
    finally { setBulkDeleting(false); }
  }

  useEffect(() => { load(); }, [load]);

  async function searchJobs(q) {
    if (!q.trim()) { setJobResults([]); return; }
    setJobSearching(true);
    try {
      const r = await api.get(`/jobs?search=${encodeURIComponent(q)}&limit=10`);
      setJobResults(r.data.jobs || r.data || []);
    } catch { setJobResults([]); }
    finally { setJobSearching(false); }
  }

  async function handleLink(scanId) {
    if (!selectedJob) { setLinkError('Please select a job first'); return; }
    setLinkError('');
    try {
      await api.post(`/invoice-inbox/${scanId}/link`, { job_id: selectedJob.id });
      setLinking(null);
      setSelectedJob(null);
      setJobSearch('');
      setJobResults([]);
      load();
      window.dispatchEvent(new Event('invoice-inbox-updated'));
    } catch (err) {
      setLinkError(err.response?.data?.error || 'Failed to link');
    }
  }

  async function handleDelete(scanId) {
    if (!confirm('Remove this invoice from the inbox? It will not be added to any job.')) return;
    try {
      await api.delete(`/invoice-inbox/${scanId}`);
      load();
      window.dispatchEvent(new Event('invoice-inbox-updated'));
    } catch { alert('Delete failed'); }
  }

  function openLink(scan) {
    setLinking(scan.id);
    setSelectedJob(null);
    setJobSearch('');
    setJobResults([]);
    setLinkError('');
  }

  if (loading) return <div className={styles.loading}>Loading invoice inbox…</div>;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>PDF Check</h1>
          <p className={styles.subtitle}>
            Scanned supplier PDFs that couldn't be matched to a job automatically.
            Link each one to the right job, file it under operating costs, or
            delete it if it isn't a cost at all.
          </p>
        </div>
      </div>

      {filing && (
        <FolderPicker
          scan={filing}
          onClose={() => setFiling(null)}
          onFiled={() => {
            setFiling(null);
            load();
            window.dispatchEvent(new Event('invoice-inbox-updated'));
          }}
        />
      )}

      {scans.length > 0 && (
        <div className={styles.toolbar}>
          <label className={styles.selectAll}>
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            {allSelected ? 'Deselect all' : `Select all (${scans.length})`}
          </label>
          {selected.length > 0 && (
            <div className={styles.toolbarActions}>
              <span className={styles.selectedCount}>{selected.length} selected</span>
              <button
                className={styles.btnBulkDelete}
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
              >
                {bulkDeleting ? 'Deleting…' : `Delete ${selected.length}`}
              </button>
            </div>
          )}
        </div>
      )}

      {scans.length === 0 && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>✓</div>
          <div className={styles.emptyText}>All clear — no unmatched invoices</div>
        </div>
      )}

      <div className={styles.list}>
        {scans.map(scan => {
          const items = Array.isArray(scan.parsed_items) ? scan.parsed_items : [];
          const total = items.reduce((s, i) => s + (i.unit_price || 0) * (i.quantity || 1), 0);

          return (
            <div key={scan.id} className={`${styles.card} ${selected.includes(scan.id) ? styles.cardSelected : ''}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardMeta}>
                  <input
                    type="checkbox"
                    className={styles.cardCheckbox}
                    checked={selected.includes(scan.id)}
                    onChange={() => toggleSelect(scan.id)}
                    aria-label="Select invoice"
                  />
                  <span className={styles.supplier}>{scan.supplier || 'Unknown supplier'}</span>
                  {scan.invoice_number && (
                    <span className={styles.invNum}>#{scan.invoice_number}</span>
                  )}
                  <span className={styles.date}>{fmtDate(scan.created_at)}</span>
                </div>
                <div className={styles.cardActions}>
                  {scan.document_base64 && (
                    <button
                      className={styles.btnPreview}
                      onClick={() => setPdfPreview(pdfPreview === scan.id ? null : scan.id)}
                    >
                      {pdfPreview === scan.id ? 'Hide PDF' : 'View PDF'}
                    </button>
                  )}
                  <button className={styles.btnLink} onClick={() => openLink(scan)}>
                    Link to Job
                  </button>
                  <button className={styles.btnFile} onClick={() => setFiling(scan)}>
                    Save to Folder
                  </button>
                  <button className={styles.btnDelete} onClick={() => handleDelete(scan.id)}>
                    Delete
                  </button>
                </div>
              </div>

              {scan.detected_job_number && (
                <div className={styles.detectedJob}>
                  Detected job number: <strong>{scan.detected_job_number}</strong> — not found in app
                </div>
              )}

              {items.length > 0 && (
                <table className={styles.itemsTable}>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className={styles.num}>Qty</th>
                      <th className={styles.num}>Unit Price</th>
                      <th className={styles.num}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={i}>
                        <td>{item.description}</td>
                        <td className={styles.num}>{item.quantity ?? 1}</td>
                        <td className={styles.num}>${(item.unit_price || 0).toFixed(2)}</td>
                        <td className={styles.num}>${((item.unit_price || 0) * (item.quantity || 1)).toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className={styles.totalRow}>
                      <td colSpan={3}>Total (ex GST)</td>
                      <td className={styles.num}>${total.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              {items.length === 0 && (
                <div className={styles.noItems}>No line items could be extracted from this invoice</div>
              )}

              {pdfPreview === scan.id && scan.document_base64 && (
                <div className={styles.pdfFrame}>
                  <iframe
                    src={scan.document_base64}
                    title="Invoice PDF"
                    className={styles.iframe}
                  />
                </div>
              )}

              {linking === scan.id && (
                <div className={styles.linkPanel}>
                  <div className={styles.linkTitle}>Link to Job</div>
                  <div className={styles.searchRow}>
                    <input
                      type="text"
                      className={styles.searchInput}
                      placeholder="Search by job number or customer name…"
                      value={jobSearch}
                      onChange={e => {
                        setJobSearch(e.target.value);
                        searchJobs(e.target.value);
                      }}
                      autoFocus
                    />
                    {jobSearching && <span className={styles.searching}>Searching…</span>}
                  </div>

                  {jobResults.length > 0 && !selectedJob && (
                    <div className={styles.jobResults}>
                      {jobResults.map(job => (
                        <button
                          key={job.id}
                          className={styles.jobResult}
                          onClick={() => { setSelectedJob(job); setJobResults([]); }}
                        >
                          <strong>JB{String(job.job_number).padStart(5, '0')}</strong>
                          {' — '}
                          {job.title}
                          {job.customer_name && <span className={styles.custName}> ({job.customer_name})</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {selectedJob && (
                    <div className={styles.selectedJob}>
                      Selected: <strong>JB{String(selectedJob.job_number).padStart(5, '0')} — {selectedJob.title}</strong>
                      <button className={styles.clearJob} onClick={() => setSelectedJob(null)}>✕</button>
                    </div>
                  )}

                  {linkError && <div className={styles.linkError}>{linkError}</div>}

                  <div className={styles.linkButtons}>
                    <button
                      className={styles.btnConfirmLink}
                      onClick={() => handleLink(scan.id)}
                      disabled={!selectedJob}
                    >
                      Confirm Link
                    </button>
                    <button
                      className={styles.btnCancel}
                      onClick={() => setLinking(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
