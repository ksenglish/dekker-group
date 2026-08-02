import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import styles from './InvoiceInbox.module.css';

const fmtDate = d => new Date(d).toLocaleDateString('en-NZ', {
  day: 'numeric', month: 'short', year: 'numeric',
});
const fmtCurrency = cents => `$${((cents || 0) / 100).toFixed(2)}`;

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

  const load = useCallback(() => {
    setLoading(true);
    api.get('/invoice-inbox')
      .then(r => setScans(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
          <h1 className={styles.title}>Invoice Inbox</h1>
          <p className={styles.subtitle}>
            Supplier invoices that couldn't be automatically matched to a job.
            Link each one to the correct job or delete it if it's not a cost.
          </p>
        </div>
      </div>

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
            <div key={scan.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardMeta}>
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
