import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { formatJobNumber } from '../../lib/formatJobNumber';
import JobForm from './JobForm';
import LineItemsEditor from './LineItemsEditor';
import JobCosts from './JobCosts';
import SalesPresenter from '../presenter/SalesPresenter';
import styles from './Jobs.module.css';

// ── Job Email Modal ───────────────────────────────────────────────────────────
function JobEmailModal({ job, onClose, onSent }) {
  const [subject, setSubject] = useState(`Re: Job ${formatJobNumber(job)}`);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');

  async function send(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true); setErr('');
    try {
      await api.post(`/jobs/${job.id}/email`, { subject, body });
      onSent();
      onClose();
    } catch (e) { setErr(e.response?.data?.error || 'Send failed'); setSending(false); }
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2>Email Customer</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={send} className={styles.modalBody}>
          <div className={styles.field}>
            <label>To</label>
            <input value={job.customer_email} disabled style={{ background: '#f8fafc', color: 'var(--color-text-muted)' }} />
          </div>
          <div className={styles.field}>
            <label>Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} required />
          </div>
          <div className={styles.field}>
            <label>Message</label>
            <textarea rows={8} value={body} onChange={e => setBody(e.target.value)}
              placeholder={`Hi ${job.customer_name?.split(' ')[0] || 'there'},\n\n`} required
              style={{ resize: 'vertical' }} />
          </div>
          {err && <div className={styles.errorBanner}>{err}</div>}
          <div className={styles.formActions}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={sending || !body.trim()}>
              {sending ? 'Sending…' : '✉ Send Email'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Live Timer ────────────────────────────────────────────────────────────────
function JobTimer({ jobId, onTimeSaved }) {
  const STORAGE_KEY = `timer_${jobId}`;
  const [startTs, setStartTs] = useState(() => {
    try { return parseInt(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; }
  });
  const [endTs, setEndTs] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [desc, setDesc] = useState('');
  const [showSave, setShowSave] = useState(false);

  // Clear any stale save state on mount
  useEffect(() => { setShowSave(false); setEndTs(null); }, []);
  const tickRef = useRef(null);

  useEffect(() => {
    if (!startTs) { clearInterval(tickRef.current); return; }
    setElapsed(Math.floor((Date.now() - startTs) / 1000));
    tickRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTs) / 1000)), 1000);
    return () => clearInterval(tickRef.current);
  }, [startTs]);

  function start() {
    const ts = Date.now();
    localStorage.setItem(STORAGE_KEY, String(ts));
    setStartTs(ts);
    setEndTs(null);
    setShowSave(false);
  }

  function stop() {
    clearInterval(tickRef.current);
    const now = Date.now();
    const snapped = startTs ? Math.floor((now - startTs) / 1000) : elapsed;
    setElapsed(snapped);
    setEndTs(now);
    setStartTs(null);
    localStorage.removeItem(STORAGE_KEY);
    setShowSave(true);
  }

  function discard() {
    localStorage.removeItem(STORAGE_KEY);
    setStartTs(null); setEndTs(null); setElapsed(0); setShowSave(false); setDesc('');
  }

  async function save(e) {
    e.preventDefault();
    const hours = elapsed < 60 ? 0.25 : Math.max(0.25, Math.round(elapsed / 900) * 0.25);
    const startTime = new Date(endTs - elapsed * 1000).toISOString();
    const endTime = new Date(endTs).toISOString();
    setSaving(true);
    try {
      await api.post('/timesheets', {
        job_id: jobId, hours, description: desc || 'Time tracked via timer',
        date: new Date(endTs).toISOString().slice(0, 10),
        start_time: startTime, end_time: endTime,
      });
      setStartTs(null); setEndTs(null); setElapsed(0); setShowSave(false); setDesc('');
      onTimeSaved && onTimeSaved(hours);
    } catch (err) {
      console.error('Timer save error:', err?.response?.data || err?.message || err);
      alert('Failed to save time entry: ' + (err?.response?.data?.error || err?.message || 'Unknown error'));
    }
    finally { setSaving(false); }
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtElapsed(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  const isRunning = !!startTs;

  return (
    <div className={styles.timerBar}>
      {!startTs && !showSave && (
        <button className={styles.timerBtnBig} onClick={start}>▶ Start Timer</button>
      )}
      {isRunning && (
        <>
          <div className={styles.timerRunning}>
            <span className={styles.timerDot} />
            Started at {fmtTime(startTs)} · {fmtElapsed(elapsed)} elapsed
          </div>
          <button className={styles.timerBtnBigStop} onClick={stop}>⏹ Stop Timer</button>
        </>
      )}
      {showSave && (
        <form onSubmit={save} className={styles.timerSaveForm}>
          <div className={styles.timerSummary}>
            {endTs ? `${fmtTime(endTs - elapsed * 1000)} → ${fmtTime(endTs)}` : ''}
            <span className={styles.timerRounded}> · {Math.max(0.25, Math.round(elapsed / 900) * 0.25).toFixed(2)}h</span>
          </div>
          <input placeholder="What were you working on?" value={desc} onChange={e => setDesc(e.target.value)}
            className={styles.timerDescInput} />
          <button type="submit" className={styles.timerBtnBig} disabled={saving}>
            {saving ? '…' : '✓ Save'}
          </button>
          <button type="button" className={styles.timerBtnDiscard} onClick={discard}>Discard</button>
        </form>
      )}
    </div>
  );
}

function JobAttachments({ jobId, user }) {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    api.get(`/jobs/${jobId}/attachments`)
      .then(r => setAttachments(r.data))
      .finally(() => setLoading(false));
  }, [jobId]);

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return alert('Image must be under 5MB');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setUploading(true);
      try {
        const { data } = await api.post(`/jobs/${jobId}/attachments`, {
          filename: file.name, mime_type: file.type, data_base64: ev.target.result,
        });
        setAttachments(a => [data, ...a]);
      } finally { setUploading(false); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function del(id) {
    await api.delete(`/jobs/${jobId}/attachments/${id}`);
    setAttachments(a => a.filter(x => x.id !== id));
  }

  const VITE_API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

  return (
    <div className={styles.card}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 14px', background: 'var(--color-primary)', color: 'white', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500 }}>
          {uploading ? 'Uploading…' : '📷 Upload Photo'}
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} disabled={uploading} />
        </label>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>JPG, PNG or WebP · max 5MB</span>
      </div>
      {loading ? <div className={styles.emptySmall}>Loading…</div> :
       attachments.length === 0 ? <div className={styles.emptySmall}>No photos uploaded yet.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, padding: 16 }}>
          {attachments.map(a => {
            const isImage = (a.mime_type || '').startsWith('image/');
            const fileUrl = `${VITE_API}/jobs/${jobId}/attachments/${a.id}/data`;
            return (
              <div key={a.id} style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                {isImage ? (
                  <img
                    src={fileUrl}
                    alt={a.filename}
                    style={{ width: '100%', height: 120, objectFit: 'cover', cursor: 'pointer', display: 'block' }}
                    onClick={() => setLightbox(fileUrl)}
                  />
                ) : (
                  <div
                    onClick={() => window.open(fileUrl, '_blank')}
                    style={{ width: '100%', height: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 6, cursor: 'pointer', background: '#f8fafc', textAlign: 'center', padding: '0 8px' }}
                  >
                    <span style={{ fontSize: 32 }}>📄</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', wordBreak: 'break-word' }}>{a.filename}</span>
                  </div>
                )}
                <div style={{ padding: '4px 6px', fontSize: 10, color: 'var(--color-text-muted)', background: 'white' }}>
                  {a.uploader_name} · {new Date(a.created_at).toLocaleDateString('en-NZ')}
                </div>
                <button onClick={() => del(a.id)} style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', padding: '2px 5px', fontSize: 11 }}>✕</button>
              </div>
            );
          })}
        </div>
      )}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out' }}>
          <img src={lightbox} alt="" style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} />
        </div>
      )}
    </div>
  );
}

function JobTimesheets({ jobId, user }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/timesheets', { params: { job_id: jobId } })
      .then(r => setEntries(r.data))
      .finally(() => setLoading(false));
  }, [jobId]);

  async function logTime(e) {
    e.preventDefault();
    if (!hours || parseFloat(hours) <= 0) return;
    setSaving(true);
    try {
      const { data } = await api.post('/timesheets', { job_id: jobId, hours, description, date });
      setEntries(es => [data, ...es]);
      setHours(''); setDescription('');
    } finally { setSaving(false); }
  }

  async function del(id) {
    await api.delete(`/timesheets/${id}`);
    setEntries(es => es.filter(e => e.id !== id));
  }

  const total = entries.reduce((s, e) => s + parseFloat(e.hours || 0), 0);

  return (
    <div className={styles.card}>
      <form onSubmit={logTime} className={styles.timesheetForm}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className={styles.tsInput} />
        <input type="number" min="0.25" max="24" step="0.25" placeholder="Hours" value={hours}
          onChange={e => setHours(e.target.value)} className={styles.tsInput} style={{ width: 80 }} />
        <input placeholder="Description (optional)" value={description}
          onChange={e => setDescription(e.target.value)} className={styles.tsInput} style={{ flex: 1 }} />
        <button className={styles.btnPrimary} disabled={saving || !hours}>
          {saving ? '…' : 'Log'}
        </button>
      </form>
      {loading ? <div className={styles.emptySmall}>Loading…</div> :
       entries.length === 0 ? <div className={styles.emptySmall}>No time logged yet.</div> : (
        <>
          <div className={styles.tsHeader}>
            <span>Date</span>
            <span>Staff</span>
            <span>Start</span>
            <span>End</span>
            <span>Hours</span>
            <span>Description</span>
            <span />
          </div>
          {entries.map(e => (
            <div key={e.id} className={styles.tsRow}>
              <span className={styles.tsDate}>{e.date ? new Date(String(e.date).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) : '—'}</span>
              <span className={styles.tsName}>{e.user_name}</span>
              <span className={styles.tsTime}>{e.start_time ? new Date(e.start_time).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
              <span className={styles.tsTime}>{e.end_time ? new Date(e.end_time).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
              <span className={styles.tsHours}>{parseFloat(e.hours).toFixed(2)}h</span>
              <span className={styles.tsDesc}>{e.description || '—'}</span>
              {(user.role !== 'field_tech' || e.user_id === user.id) && (
                <button className={styles.deleteBtn} style={{ position: 'static' }} onClick={() => del(e.id)}>✕</button>
              )}
            </div>
          ))}
          <div className={styles.tsTotal}>Total: <strong>{total.toFixed(2)}h</strong></div>
        </>
      )}
    </div>
  );
}

const PIPELINE = ['new', 'quoted', 'scheduled', 'in_progress', 'invoiced', 'complete'];
const STATUS_COLOURS = {
  new: '#1e40af', quoted: '#7c3aed', scheduled: '#0891b2',
  in_progress: '#d97706', invoiced: '#9333ea', complete: '#16a34a', cancelled: '#6b7280',
};
const PRIORITY_COLOURS = { low: '#6b7280', medium: '#d97706', high: '#dc2626' };

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const isNew = id === 'new';

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [editMode, setEditMode] = useState(isNew);
  const [noteText, setNoteText] = useState('');
  // Supports deep-linking to a tab, e.g. /jobs/:id?tab=line_items from the "Edit" button on a quote
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'details');
  const [creatingQuote, setCreatingQuote] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailFlash, setEmailFlash] = useState('');
  const [showPresenter, setShowPresenter] = useState(false);
  const [syncingArcSite, setSyncingArcSite] = useState(false);
  const [pullingDrawings, setPullingDrawings] = useState(false);
  const [attachmentsRefreshKey, setAttachmentsRefreshKey] = useState(0);

  useEffect(() => {
    if (isNew) return;
    api.get(`/jobs/${id}`).then(r => { setJob(r.data); setLoading(false); });
  }, [id]);

  async function handleStatusChange(status) {
    const { data } = await api.patch(`/jobs/${id}/status`, { status });
    setJob(j => ({ ...j, status: data.status }));
    // Prompt to create a quote if job has line items and no existing quote
    if (status === 'complete' && job?.line_items?.length > 0 && job?.status !== 'invoiced') {
      if (confirm('Job marked complete. Would you like to create a quote from this job\'s line items?')) {
        try {
          const { data: q } = await api.post('/quotes', { job_id: id, customer_id: job.customer_id });
          navigate(`/quotes/${q.id}`);
        } catch { /* user can create manually */ }
      }
    }
  }

  async function handleAddNote() {
    if (!noteText.trim()) return;
    const { data } = await api.post(`/jobs/${id}/notes`, { content: noteText });
    setJob(j => ({ ...j, notes: [data, ...(j.notes || [])] }));
    setNoteText('');
  }

  async function handleDeleteNote(noteId) {
    await api.delete(`/jobs/${id}/notes/${noteId}`);
    setJob(j => ({ ...j, notes: j.notes.filter(n => n.id !== noteId) }));
  }

  async function handleSaveLineItems(items) {
    const { data } = await api.put(`/jobs/${id}/line-items`, { items });
    setJob(j => ({ ...j, line_items: data }));
  }

  async function handleDelete() {
    if (!confirm(`Delete job ${formatJobNumber(job)}? This cannot be undone.`)) return;
    try {
      await api.delete(`/jobs/${id}`);
      navigate('/jobs');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete job. Please try again.');
    }
  }

  async function handleArcSiteSync() {
    setSyncingArcSite(true);
    try {
      const { data } = await api.post(`/jobs/${id}/arcsite-sync`);
      setJob(j => ({ ...j, arcsite_project_id: data.arcsite_project_id }));
      setEmailFlash(`Synced to ArcSite as "${data.name}"`);
    } catch (err) {
      setEmailFlash(err.response?.data?.error || 'Failed to sync with ArcSite');
    } finally { setSyncingArcSite(false); }
  }

  async function handlePullDrawings() {
    setPullingDrawings(true);
    try {
      const { data } = await api.post(`/jobs/${id}/arcsite-pull-drawings`);
      if (data.pulled.length === 0 && data.skipped.length === 0) {
        setEmailFlash('No drawings found on this ArcSite project yet.');
      } else {
        const parts = [];
        if (data.pulled.length) parts.push(`Pulled ${data.pulled.length} drawing${data.pulled.length === 1 ? '' : 's'}`);
        if (data.skipped.length) parts.push(`Skipped: ${data.skipped.join('; ')}`);
        setEmailFlash(parts.join(' · '));
        if (data.pulled.length) setAttachmentsRefreshKey(k => k + 1);
      }
    } catch (err) {
      setEmailFlash(err.response?.data?.error || 'Failed to pull drawings from ArcSite');
    } finally { setPullingDrawings(false); }
  }

  function handleSaved(savedJob) {
    if (isNew) {
      navigate(`/jobs/${savedJob.id}`, { replace: true });
    } else {
      setJob(j => ({ ...j, ...savedJob }));
      setEditMode(false);
    }
  }

  const canEdit = user?.role !== 'field_tech';
  const subtotal = (job?.line_items || []).reduce((s, i) => s + (i.unit_price * i.quantity), 0);
  const gst = Math.round(subtotal * 0.15);
  const total = subtotal + gst;

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  if (isNew || editMode) {
    return (
      <div className={styles.page}>
        <div className={styles.breadcrumb}>
          <Link to="/jobs">Jobs</Link><span>›</span>
          <span>{isNew ? 'New Job' : `Edit Job ${formatJobNumber(job)}`}</span>
        </div>
        <JobForm
          initial={job}
          onSave={handleSaved}
          onCancel={isNew ? () => navigate('/jobs') : () => setEditMode(false)}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div className={styles.breadcrumb} style={{ marginBottom: 0 }}>
          <Link to="/jobs">Jobs</Link><span>›</span>
          <span>Job {formatJobNumber(job)}</span>
        </div>
        <div className={styles.headerActions}>
          {job.customer_email && user?.role !== 'field_tech' && (
            <button className={styles.btnSecondary} onClick={() => setShowEmailModal(true)}>✉ Email Customer</button>
          )}
          <button className={styles.btnSecondary} onClick={() => navigate(`/schedule?job=${id}`)}>📅 Schedule</button>
          <button className={styles.btnPresenter} onClick={() => setShowPresenter(true)}>🎯 Sales Presenter</button>
          {user?.role !== 'field_tech' && (
            <button className={styles.btnSecondary} onClick={handleArcSiteSync} disabled={syncingArcSite}>
              {syncingArcSite ? 'Syncing…' : job.arcsite_project_id ? '🔄 Re-sync ArcSite' : '📐 Send to ArcSite'}
            </button>
          )}
          {user?.role !== 'field_tech' && job.arcsite_project_id && (
            <button className={styles.btnSecondary} onClick={handlePullDrawings} disabled={pullingDrawings}>
              {pullingDrawings ? 'Pulling…' : '📥 Pull Drawing'}
            </button>
          )}
          {user?.role !== 'field_tech' && (
            <button className={styles.btnSecondary} onClick={() => setEditMode(true)}>Edit</button>
          )}
          {user?.role !== 'field_tech' && (
            <button className={styles.btnDanger} onClick={handleDelete}>Delete Job</button>
          )}
        </div>
      </div>

      {/* Status pipeline */}
      {job.status !== 'cancelled' ? (
        <div className={styles.pipeline}>
          {PIPELINE.map((s, i) => {
            const idx = PIPELINE.indexOf(job.status);
            const done = i < idx;
            const active = i === idx;
            return (
              <button
                key={s}
                className={`${styles.pipelineStep} ${done ? styles.pipelineDone : ''} ${active ? styles.pipelineActive : ''}`}
                onClick={() => user?.role !== 'field_tech' && handleStatusChange(s)}
                style={active ? { borderColor: STATUS_COLOURS[s], color: STATUS_COLOURS[s] } : {}}
                title={`Move to ${s.replace('_', ' ')}`}
              >
                <span className={styles.pipelineDot} style={active ? { background: STATUS_COLOURS[s] } : done ? { background: '#16a34a' } : {}} />
                {s.replace('_', ' ')}
              </button>
            );
          })}
          {user?.role !== 'field_tech' && (
            <button
              className={`${styles.pipelineStep} ${job.status === 'cancelled' ? styles.pipelineActive : ''}`}
              onClick={() => handleStatusChange('cancelled')}
              style={{ marginLeft: 'auto', color: '#6b7280' }}
            >
              Cancel job
            </button>
          )}
        </div>
      ) : (
        <div className={styles.cancelledBanner}>
          This job is cancelled.
          {user?.role !== 'field_tech' && (
            <button onClick={() => handleStatusChange('new')} className={styles.reopenBtn}>Reopen as New</button>
          )}
        </div>
      )}

      {/* Timer bar */}
      {job.status !== 'cancelled' && job.status !== 'complete' && (
        <JobTimer jobId={id} onTimeSaved={() => setEmailFlash('Time entry saved!')} />
      )}
      {emailFlash && (
        <div className={styles.flashBanner} onAnimationEnd={() => setEmailFlash('')}>{emailFlash}</div>
      )}

      {/* Email modal */}
      {showEmailModal && (
        <JobEmailModal
          job={{ ...job, id, customer_email: job.customer_email, customer_name: job.customer_name }}
          onClose={() => setShowEmailModal(false)}
          onSent={() => setEmailFlash(`Email sent to ${job.customer_name}`)}
        />
      )}

      {/* Sales Presenter picker */}
      {showPresenter && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300 }}>
          <SalesPresenter onPick={async (product) => {
            setShowPresenter(false);
            if (!product) return;
            try {
              const existing = job.line_items || [];
              // price list products use `unit_price` (cents); presenter products use `price_from`
              const unitPrice = product.unit_price != null ? product.unit_price / 100
                : product.price_from > 0 ? product.price_from / 100 : 0;
              const newItem = {
                description: product.name,
                quantity: 1,
                unit_price: unitPrice,
                product_id: product.unit_price != null ? product.id : null,
              };
              const items = [
                ...existing.map(i => ({ ...i, unit_price: i.unit_price / 100 })),
                newItem,
              ];
              await api.put(`/jobs/${id}/line-items`, { items });
              setActiveTab('line_items');
              setEmailFlash(`${product.name} added to job`);
              const { data: updated } = await api.get(`/jobs/${id}`);
              setJob(updated);
            } catch {
              setEmailFlash('Failed to add product');
            }
          }} />
        </div>
      )}

      {/* Main layout */}
      <div className={styles.detailLayout}>
        <div className={styles.detailMain}>
          {/* Tabs */}
          <div className={styles.tabs}>
            {['details', 'line_items', 'costs', 'timesheets', 'photos', 'notes'].map(t => (
              <button key={t} className={`${styles.tab} ${activeTab === t ? styles.tabActive : ''}`} onClick={() => setActiveTab(t)}>
                {t === 'line_items' ? 'Line Items' : t.charAt(0).toUpperCase() + t.slice(1)}
                {t === 'notes' && job.notes?.length > 0 && <span className={styles.tabCount}>{job.notes.length}</span>}
              </button>
            ))}
          </div>

          {activeTab === 'details' && (
            <div className={styles.card}>
              <div className={styles.detailGrid}>
                <div className={styles.detailItem}><span>Customer</span>
                  <strong>{job.customer_id ? <Link to={`/customers/${job.customer_id}`}>{job.customer_name}</Link> : '—'}</strong>
                </div>
                <div className={styles.detailItem}>
                  <span>Site</span>
                  <strong>
                    {job.site_address || '—'}{job.site_label ? ` (${job.site_label})` : ''}
                    {job.site_address && (
                      <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.site_address)}`}
                        target="_blank" rel="noreferrer"
                        style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-primary)' }}>
                        📍 Map
                      </a>
                    )}
                  </strong>
                </div>
                <div className={styles.detailItem}><span>Type</span><strong style={{ textTransform: 'capitalize' }}>{job.type.replace('_', ' ')}</strong></div>
                <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}>
                  <span>Team Members</span>
                  <strong>{job.technicians?.length ? job.technicians.map(t => t.name).join(', ') : (job.tech_name || '—')}</strong>
                </div>
                {job.is_recurring && (
                  <div className={styles.detailItem}><span>Recurrence</span>
                    <strong style={{ color: '#0891b2' }}>🔁 {job.recurrence_interval} · Next: {job.recurrence_next_date ? new Date(job.recurrence_next_date).toLocaleDateString('en-NZ') : '—'}</strong>
                  </div>
                )}
                <div className={styles.detailItem}>
                  <span>Schedule Date</span>
                  <strong>{job.scheduled_date ? new Date(job.scheduled_date).toLocaleDateString('en-NZ') : '—'}</strong>
                </div>
                {job.description && (
                  <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}>
                    <span>Description</span><strong style={{ fontWeight: 400, whiteSpace: 'pre-wrap' }}>{job.description}</strong>
                  </div>
                )}

                {/* Data imported from Tradify */}
                {job.source === 'tradify' && (
                  <>
                    <div className={styles.detailItem} style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--color-border)', paddingTop: 12, marginTop: 4 }}>
                      <span>📦 Imported from Tradify</span>
                      <strong style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: 12 }}>
                        Tradify Job {job.external_ref}
                        {job.external_status ? ` · originally "${job.external_status}"` : ''}
                      </strong>
                    </div>
                    {job.job_contact && (
                      <div className={styles.detailItem}><span>Job Contact</span><strong>{job.job_contact}</strong></div>
                    )}
                    {(job.job_contact_mobile || job.job_contact_phone) && (
                      <div className={styles.detailItem}>
                        <span>Contact Phone</span>
                        <strong>{job.job_contact_mobile || job.job_contact_phone}</strong>
                      </div>
                    )}
                    {job.materials && (
                      <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}>
                        <span>Materials</span><strong style={{ fontWeight: 400, whiteSpace: 'pre-wrap' }}>{job.materials}</strong>
                      </div>
                    )}
                    {job.time_log && (
                      <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}>
                        <span>Time (from Tradify)</span><strong style={{ fontWeight: 400, whiteSpace: 'pre-wrap' }}>{job.time_log}</strong>
                      </div>
                    )}
                    {(job.entered_by || job.entered_on) && (
                      <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}>
                        <span>Originally entered</span>
                        <strong style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: 12 }}>
                          {job.entered_by || '—'}{job.entered_on ? ` · ${new Date(job.entered_on).toLocaleString('en-NZ')}` : ''}
                        </strong>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {activeTab === 'line_items' && (
            <div className={styles.card}>
              <LineItemsEditor
                items={job.line_items || []}
                onSave={handleSaveLineItems}
                readonly={user?.role === 'field_tech'}
              />
              {job.line_items?.length > 0 && (
                <div className={styles.totals}>
                  <div className={styles.totalRow}><span>Subtotal</span><span>${(subtotal / 100).toFixed(2)}</span></div>
                  <div className={styles.totalRow}><span>GST (15%)</span><span>${(gst / 100).toFixed(2)}</span></div>
                  <div className={`${styles.totalRow} ${styles.totalFinal}`}><span>Total</span><span>${(total / 100).toFixed(2)}</span></div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'costs' && (
            <div className={styles.card}>
              <JobCosts jobId={id} readonly={user?.role === 'field_tech'} />
            </div>
          )}

          {activeTab === 'timesheets' && <JobTimesheets jobId={id} user={user} />}
          {activeTab === 'photos' && <JobAttachments key={attachmentsRefreshKey} jobId={id} user={user} />}

          {activeTab === 'notes' && (
            <div className={styles.card}>
              <div className={styles.noteInput}>
                <textarea rows={3} placeholder="Add a note…" value={noteText} onChange={e => setNoteText(e.target.value)} />
                <button className={styles.btnPrimary} onClick={handleAddNote} disabled={!noteText.trim()}>Add Note</button>
              </div>
              {(!job.notes || job.notes.length === 0) && <p className={styles.emptySmall}>No notes yet.</p>}
              {job.notes?.map(note => (
                <div key={note.id} className={styles.noteRow}>
                  <div className={styles.noteMeta}>
                    <strong>{note.author_name}</strong>
                    <span>{new Date(note.created_at).toLocaleString('en-NZ')}</span>
                  </div>
                  <p className={styles.noteContent}>{note.content}</p>
                  {user?.role !== 'field_tech' && (
                    <button className={styles.deleteBtn} onClick={() => handleDeleteNote(note.id)}>✕</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className={styles.detailSidebar}>
          <div className={styles.card}>
            <div className={styles.cardHeader}><h2>Job Summary</h2></div>
            <div className={styles.summaryList}>
              <div className={styles.summaryItem}>
                <span>Job #</span><strong>{formatJobNumber(job)}</strong>
              </div>
              <div className={styles.summaryItem}>
                <span>Status</span>
                <span className={styles.statusBadge} style={{ background: STATUS_COLOURS[job.status] + '18', color: STATUS_COLOURS[job.status] }}>
                  {job.status.replace('_', ' ')}
                </span>
              </div>
              <div className={styles.summaryItem}>
                <span>Created</span><strong>{new Date(job.created_at).toLocaleDateString('en-NZ')}</strong>
              </div>
              {job.line_items?.length > 0 && (
                <div className={styles.summaryItem}>
                  <span>Total (incl. GST)</span><strong>${(total / 100).toFixed(2)}</strong>
                </div>
              )}
            </div>
            {canEdit && job.line_items?.length > 0 && (
              <div className={styles.cardFooter}>
                <button className={styles.btnPrimary} style={{ width: '100%' }} disabled={creatingQuote}
                  onClick={async () => {
                    setCreatingQuote(true);
                    try {
                      const { data } = await api.post('/quotes', { job_id: job.id, customer_id: job.customer_id });
                      navigate(`/quotes/${data.id}`);
                    } catch (err) {
                      alert(err.response?.data?.error || 'Failed to create quote');
                      setCreatingQuote(false);
                    }
                  }}>
                  {creatingQuote ? 'Creating…' : 'Create Quote'}
                </button>
              </div>
            )}
            {job.customer_email && (
              <div className={styles.cardFooter}>
                <a href={`mailto:${job.customer_email}`} className={styles.contactLink}>✉ {job.customer_email}</a>
              </div>
            )}
            {job.customer_phone && (
              <div className={styles.cardFooter} style={{ borderTop: 'none', paddingTop: 0 }}>
                <a href={`tel:${job.customer_phone}`} className={styles.contactLink}>📞 {job.customer_phone}</a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
