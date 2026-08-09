import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatJobNumber } from '../../lib/formatJobNumber';
import styles from './Quotes.module.css';
import { overlayClose } from '../../lib/overlayClose';

const fieldStyle = { padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 14 };

// Gives a job-less quote its job number. Two ways in, because a quote raised
// ahead of any job can go either way once it's won: the work is new (open a
// job for it) or it turns out to belong to a job that already exists (link it).
export default function AttachJobModal({ quote, onClose, onAttached }) {
  const [mode, setMode] = useState('create'); // 'create' | 'link'
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Create-a-job fields
  const [jobTypes, setJobTypes] = useState([]);
  const [type, setType] = useState('');
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');

  // Link-an-existing-job fields
  const [search, setSearch] = useState('');
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    api.get('/settings/job-types')
      .then(r => { setJobTypes(r.data); setType(t => t || r.data[0] || ''); })
      .catch(() => setJobTypes(['Installation', 'Service', 'Inspection', 'Repair', 'Quote Only']));
    if (quote.customer_id) {
      api.get(`/customers/${quote.customer_id}/sites`).then(r => setSites(r.data)).catch(() => {});
    }
  }, [quote.customer_id]);

  // The customer's own jobs are the likely match, so they're what's listed
  // before anything is typed; typing widens the search to every job.
  useEffect(() => {
    if (mode !== 'link') return;
    setSearching(true);
    const params = search.trim()
      ? { search: search.trim(), limit: 50 }
      : { customer: quote.customer_id || undefined, limit: 50 };
    const timer = setTimeout(() => {
      api.get('/jobs', { params })
        .then(r => setJobs(r.data.jobs || []))
        .catch(() => setJobs([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [mode, search, quote.customer_id]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const body = mode === 'link'
        ? { job_id: selectedJobId }
        : { type, site_id: siteId || null, description: quote.notes || null };
      const { data } = await api.post(`/quotes/${quote.id}/job`, body);
      onAttached(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to attach a job');
      setSaving(false);
    }
  }

  const canSubmit = mode === 'link' ? !!selectedJobId : !!type;

  return (
    <div className={styles.overlay} {...overlayClose(onClose)}>
      <div className={styles.modal} style={{ maxWidth: 520 }}>
        <div className={styles.modalHeader}>
          <h2>Add a Job to this Quote</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 14px', borderRadius: 'var(--radius)', fontSize: 13 }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setMode('create')}
                className={mode === 'create' ? styles.btnPrimary : styles.btnSecondary} style={{ flex: 1 }}>
                Create a new job
              </button>
              <button type="button" onClick={() => setMode('link')}
                className={mode === 'link' ? styles.btnPrimary : styles.btnSecondary} style={{ flex: 1 }}>
                Link an existing job
              </button>
            </div>

            {mode === 'create' ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 500 }}>Job Type *</label>
                  <select value={type} onChange={e => setType(e.target.value)} required style={fieldStyle}>
                    <option value="">— Select type —</option>
                    {jobTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 500 }}>Site Address</label>
                  <select value={siteId} onChange={e => setSiteId(e.target.value)}
                    disabled={sites.length === 0} style={fieldStyle}>
                    <option value="">No site selected</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.address}{s.label ? ` (${s.label})` : ''}</option>)}
                  </select>
                </div>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  The job is raised for {quote.customer_name || 'this quote’s customer'} and takes this
                  quote’s description. It gets the next job number.
                </span>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 500 }}>Find a job</label>
                  <input type="search" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search by job number, customer or description…" style={fieldStyle} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto',
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '8px 12px' }}>
                  {searching ? (
                    <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Searching…</span>
                  ) : jobs.length === 0 ? (
                    <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No jobs found.</span>
                  ) : jobs.map(j => (
                    <label key={j.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer', padding: '4px 0' }}>
                      <input type="radio" name="job" value={j.id} checked={selectedJobId === j.id}
                        onChange={() => setSelectedJobId(j.id)} style={{ marginTop: 3 }} />
                      <span>
                        <strong>{formatJobNumber(j) || 'No number'}</strong>
                        {j.customer_name ? ` · ${j.customer_name}` : ''}
                        <span style={{ display: 'block', color: 'var(--color-text-muted)' }}>
                          {j.type}{j.site_address ? ` · ${j.site_address}` : ''}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className={styles.modalFooter} style={{ marginTop: 20 }}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={saving || !canSubmit}>
              {saving ? 'Saving…' : mode === 'link' ? 'Link Job' : 'Create Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
