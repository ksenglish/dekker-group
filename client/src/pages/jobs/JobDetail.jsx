import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { isAdmin, canAct } from '../../lib/permissions';
import { formatJobNumber } from '../../lib/formatJobNumber';
import { toLocalDateStr } from '../../lib/date';
import { isHtml, safeHtml } from '../../lib/richText';
import { compressImage } from '../../lib/image';
import { isBillable } from '../../lib/billing';
import JobForm from './JobForm';
import LineItemsEditor from './LineItemsEditor';
import JobCosts from './JobCosts';
import AssignModal from '../schedule/AssignModal';
import JobFormsTab from './JobFormsTab';
import styles from './Jobs.module.css';
import { overlayClose } from '../../lib/overlayClose';

const TAB_LABELS = {
  photos: 'Pre-Install Forms',
  forms: 'Post Install Forms',
  line_items: 'Line Items',
  timesheets: 'Time',
};

// ── Live Timer ────────────────────────────────────────────────────────────────
// Statuses are site-configurable, so these are matched on their labels rather
// than fixed keys — 'complete' for instance is relabelled "Paid" here, and the
// two "Scheduled" steps mean very different things to the workflow.
function findStatus(jobStatuses, test) {
  return (jobStatuses || []).find(s => test((s.label || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim()));
}
const isSiteVisit       = l => l.includes('site visit');
const isScheduledInstall = l => l.includes('scheduled') && l.includes('install');
const isAwaitingQuote   = l => l.includes('awaiting') && l.includes('quote');

// The Job Summary card sets overflow:hidden to clip its rounded corners, which
// also clipped the status dropdown nested inside it — the list was cut off at
// the card's edge, so the statuses at the bottom (Paid) could not be reached.
// The menu is portalled to <body> and positioned fixed against the button to
// escape that, and capped to the room actually available so it always scrolls
// within the viewport rather than running off the end of it.
const STATUS_MENU_WIDTH = 210;
const STATUS_MENU_MAX_HEIGHT = 320;

function statusMenuPosition(rect) {
  const GAP = 6;
  const MARGIN = 8;
  const spaceBelow = window.innerHeight - rect.bottom - GAP - MARGIN;
  const spaceAbove = rect.top - GAP - MARGIN;

  // Right-align to the button, but never let it run off either edge
  const left = Math.max(
    MARGIN,
    Math.min(rect.right - STATUS_MENU_WIDTH, window.innerWidth - STATUS_MENU_WIDTH - MARGIN)
  );

  // Prefer dropping down; flip up only when below is genuinely cramped
  if (spaceBelow < 180 && spaceAbove > spaceBelow) {
    return {
      left,
      bottom: window.innerHeight - rect.top + GAP,
      maxHeight: Math.min(STATUS_MENU_MAX_HEIGHT, spaceAbove),
    };
  }
  return {
    left,
    top: rect.bottom + GAP,
    maxHeight: Math.min(STATUS_MENU_MAX_HEIGHT, spaceBelow),
  };
}

function JobTimer({ jobId, onTimeSaved, user, jobStatus, jobStatuses, onStatusChange }) {
  const [prompt, setPrompt] = useState(null); // 'complete' | 'quote-sent' | null
  const [checkingQuote, setCheckingQuote] = useState(false);
  const [quoteWarning, setQuoteWarning] = useState('');

  // Cancelled sits outside the pipeline, so it's never a step to advance into.
  const pipeline = (jobStatuses || []).filter(s => s.key !== 'cancelled');
  const inProgressIdx = pipeline.findIndex(s => s.key === 'in_progress');

  const siteVisitStatus = findStatus(pipeline, isSiteVisit);
  const scheduledInstallStatus = findStatus(pipeline, isScheduledInstall);
  const awaitingQuoteStatus = findStatus(pipeline, isAwaitingQuote);
  const quotedStatus = pipeline.find(s => s.key === 'quoted');

  // The step straight after In Progress — "Job Complete" here. Not the
  // protected 'complete' key, which is relabelable and sits further on.
  const completionStatus = inProgressIdx >= 0 ? pipeline[inProgressIdx + 1] : null;

  const onSiteVisit = !!siteVisitStatus && jobStatus === siteVisitStatus.key;
  const onScheduledInstall = !!scheduledInstallStatus && jobStatus === scheduledInstallStatus.key;
  const onInProgress = jobStatus === 'in_progress';

  const STORAGE_KEY = `timer_${jobId}`;
  const RATE_STORAGE_KEY = `timer_rate_${jobId}`;
  const [startTs, setStartTs] = useState(() => {
    try { return parseInt(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; }
  });
  const [endTs, setEndTs] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [desc, setDesc] = useState('');
  const [showSave, setShowSave] = useState(false);
  const [billingRates, setBillingRates] = useState([]);
  const [billingRateId, setBillingRateId] = useState(() => {
    try { return localStorage.getItem(RATE_STORAGE_KEY) || ''; } catch { return ''; }
  });

  useEffect(() => {
    api.get('/settings/billing-rates').then(r => {
      setBillingRates(r.data);
      setBillingRateId(cur => cur || user?.default_billing_rate_id || r.data[0]?.id || '');
    }).catch(() => {});
  }, []);

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
    localStorage.setItem(RATE_STORAGE_KEY, billingRateId);
    setStartTs(ts);
    setEndTs(null);
    setShowSave(false);
    // Only a job sitting on Scheduled - Installation starts running. Timers get
    // used on site visits, callbacks and warranty work too, and none of those
    // should quietly reclassify the job.
    if (onScheduledInstall) onStatusChange?.('in_progress');
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
    setQuoteWarning('');
    // Each stop prompt belongs to exactly one stage of the job.
    if (onInProgress && completionStatus) setPrompt('complete');
    else if (onSiteVisit && awaitingQuoteStatus) setPrompt('quote-sent');
    else setPrompt(null);
  }

  // "Yes, I sent a quote" is taken on trust only as far as the record allows —
  // if nothing was actually emailed the job still goes to Awaiting Quote, and
  // the rep is told why.
  async function confirmQuoteSent() {
    setCheckingQuote(true);
    try {
      const { data } = await api.get(`/jobs/${jobId}/quote-delivery`);
      if (data.delivered) {
        setPrompt(null);
        onStatusChange?.(quotedStatus?.key || 'quoted');
      } else {
        setPrompt(null);
        setQuoteWarning(
          data.quote_count
            ? `No quote on this job has been emailed to the customer yet — ${data.quote_count === 1 ? 'it is' : 'they are'} still a draft. Moved to ${awaitingQuoteStatus.label}.`
            : `There's no quote on this job yet. Moved to ${awaitingQuoteStatus.label}.`
        );
        onStatusChange?.(awaitingQuoteStatus.key);
      }
    } catch {
      setPrompt(null);
      setQuoteWarning(`Couldn't check whether the quote was sent — moved to ${awaitingQuoteStatus.label} to be safe.`);
      onStatusChange?.(awaitingQuoteStatus.key);
    } finally { setCheckingQuote(false); }
  }

  function discard() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(RATE_STORAGE_KEY);
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
        date: toLocalDateStr(new Date(endTs)),
        start_time: startTime, end_time: endTime,
        source: 'timer', billing_rate_id: billingRateId || null,
      });
      localStorage.removeItem(RATE_STORAGE_KEY);
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
      {prompt === 'complete' && completionStatus && (
        <div className={styles.completePrompt}>
          <span className={styles.completePromptText}>Has this job been completed?</span>
          <button className={styles.timerBtnBig}
            onClick={() => { setPrompt(null); onStatusChange?.(completionStatus.key); }}>
            Yes — mark {completionStatus.label}
          </button>
          <button className={styles.completePromptNo} onClick={() => setPrompt(null)}>
            Not yet
          </button>
        </div>
      )}

      {prompt === 'quote-sent' && awaitingQuoteStatus && (
        <div className={styles.completePrompt}>
          <span className={styles.completePromptText}>Have you sent a quote to the customer?</span>
          <button className={styles.timerBtnBig} onClick={confirmQuoteSent} disabled={checkingQuote}>
            {checkingQuote ? 'Checking…' : 'Yes — quote sent'}
          </button>
          <button className={styles.completePromptNo} disabled={checkingQuote}
            onClick={() => { setPrompt(null); onStatusChange?.(awaitingQuoteStatus.key); }}>
            No — mark {awaitingQuoteStatus.label}
          </button>
        </div>
      )}

      {quoteWarning && (
        <div className={styles.quoteWarning}>
          ⚠ {quoteWarning}
          <button className={styles.completePromptNo} onClick={() => setQuoteWarning('')}>Dismiss</button>
        </div>
      )}
      {!startTs && !showSave && (
        <>
          {billingRates.length > 0 && (
            <select value={billingRateId} onChange={e => setBillingRateId(e.target.value)} className={styles.timerRateSelect}>
              {billingRates.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          )}
          <button className={styles.timerBtnBig} onClick={start}>▶ Start Timer</button>
        </>
      )}
      {isRunning && (
        <>
          <div className={styles.timerRunning}>
            <span className={styles.timerDot} />
            Started at {fmtTime(startTs)} · {fmtElapsed(elapsed)} elapsed
            {billingRates.find(r => r.id === billingRateId) && (
              <span className={styles.manualBadge}>{billingRates.find(r => r.id === billingRateId).label}</span>
            )}
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

// Applies to the stored payload, after downscaling — not the file on disk.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function JobAttachments({ jobId, user, category = 'pre_install' }) {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [fileUrls, setFileUrls] = useState({}); // attachment id -> blob object URL
  const [uploadProgress, setUploadProgress] = useState(null); // { done, total }

  useEffect(() => {
    api.get(`/jobs/${jobId}/attachments`, { params: { category } })
      .then(r => setAttachments(r.data))
      .finally(() => setLoading(false));
  }, [jobId, category]);

  // The /data endpoint requires a Bearer token, which a plain <img src> or
  // window.open() can't supply — fetch each file through the authenticated
  // api client instead and open/display it as a local blob URL.
  useEffect(() => {
    const urls = [];
    attachments.forEach(a => {
      if (fileUrls[a.id]) return;
      api.get(`/jobs/${jobId}/attachments/${a.id}/data`, { responseType: 'blob' }).then(res => {
        const url = URL.createObjectURL(res.data);
        urls.push(url);
        setFileUrls(u => ({ ...u, [a.id]: url }));
      }).catch(() => {});
    });
    return () => { urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [attachments, jobId]);

  // Uploads run one at a time rather than all at once — a handful of phone
  // photos in parallel would blow past the server's request limit.
  async function handleFile(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;

    setUploading(true);
    setUploadProgress({ done: 0, total: files.length });
    const failed = [];
    const tooBig = [];
    try {
      for (const [i, file] of files.entries()) {
        try {
          // Downscale first, then check the size. A 12MB phone photo comes out
          // a few hundred KB, so the limit applies to what's actually stored
          // rather than rejecting photos that would have fit comfortably.
          const { dataUrl, mimeType, bytes } = await compressImage(file);
          if (bytes > MAX_ATTACHMENT_BYTES) {
            tooBig.push(file.name);
          } else {
            const { data } = await api.post(`/jobs/${jobId}/attachments`, {
              filename: file.name, mime_type: mimeType || file.type, data_base64: dataUrl, category,
            });
            setAttachments(a => [data, ...a]);
          }
        } catch {
          failed.push(file.name);
        }
        setUploadProgress({ done: i + 1, total: files.length });
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
    if (tooBig.length) {
      alert(`Skipped ${tooBig.length} file${tooBig.length === 1 ? '' : 's'} still over 5MB after compression:\n${tooBig.join('\n')}`);
    }
    if (failed.length) alert(`Failed to upload:\n${failed.join('\n')}`);
  }

  async function del(id) {
    await api.delete(`/jobs/${jobId}/attachments/${id}`);
    setAttachments(a => a.filter(x => x.id !== id));
  }

  return (
    <div className={styles.card}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 14px', background: 'var(--color-primary)', color: 'white', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500 }}>
          {uploading
            ? (uploadProgress ? `Uploading ${uploadProgress.done + 1} of ${uploadProgress.total}…` : 'Uploading…')
            : '📷 Upload Photos'}
          <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFile} disabled={uploading} />
        </label>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>JPG, PNG or WebP · max 5MB each · select several at once</span>
      </div>
      {loading ? <div className={styles.emptySmall}>Loading…</div> :
       attachments.length === 0 ? <div className={styles.emptySmall}>No photos uploaded yet.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, padding: 16 }}>
          {attachments.map(a => {
            const isImage = (a.mime_type || '').startsWith('image/');
            const fileUrl = fileUrls[a.id];
            return (
              <div key={a.id} style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                {isImage ? (
                  fileUrl ? (
                    <img
                      src={fileUrl}
                      alt={a.filename}
                      style={{ width: '100%', height: 120, objectFit: 'cover', cursor: 'pointer', display: 'block' }}
                      onClick={() => setLightbox(fileUrl)}
                    />
                  ) : (
                    <div style={{ width: '100%', height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Loading…</span>
                    </div>
                  )
                ) : (
                  <div
                    onClick={() => fileUrl && window.open(fileUrl, '_blank')}
                    style={{ width: '100%', height: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 6, cursor: fileUrl ? 'pointer' : 'default', background: '#f8fafc', textAlign: 'center', padding: '0 8px' }}
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

// ISO timestamp -> local "HH:MM" for a <input type="time">
function toHHMM(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtTimeAmPm(iso) {
  return new Date(iso).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' });
}
const HOUR_MARKS = Array.from({ length: 24 }, (_, i) => i);
function fmtHourMark(h) {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${h < 12 ? 'am' : 'pm'}`;
}

// Add/edit popup for a single timesheet entry — click a bar in the timeline to edit
function TimeEntryModal({ jobId, entry, billingRates, currentUser, onSave, onDelete, onClose }) {
  const isNew = !entry;
  const [form, setForm] = useState({
    date: entry?.date ? entry.date.slice(0, 10) : toLocalDateStr(),
    start_time: toHHMM(entry?.start_time),
    end_time: toHHMM(entry?.end_time),
    hours: entry?.hours != null ? String(entry.hours) : '',
    billing_rate_id: entry?.billing_rate_id || '',
    description: entry?.description || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const mountedRef = useRef(false);

  // Auto-fill Hours from Start/Finish once both are set — skips the very
  // first render so opening the modal doesn't clobber a prefilled value.
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    if (!form.start_time || !form.end_time) return;
    const [sh, sm] = form.start_time.split(':').map(Number);
    const [eh, em] = form.end_time.split(':').map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) return;
    set('hours', String(Math.max(0.25, Math.round(mins / 15) * 0.25)));
  }, [form.start_time, form.end_time]);

  async function submit(e) {
    e.preventDefault();
    if (!form.hours || parseFloat(form.hours) <= 0) return setErr('Hours must be greater than 0');
    setSaving(true); setErr('');
    try {
      const payload = {
        job_id: jobId,
        hours: parseFloat(form.hours),
        description: form.description,
        date: form.date,
        start_time: form.start_time ? new Date(`${form.date}T${form.start_time}:00`).toISOString() : null,
        end_time: form.end_time ? new Date(`${form.date}T${form.end_time}:00`).toISOString() : null,
        billing_rate_id: form.billing_rate_id || null,
      };
      const { data } = isNew
        ? await api.post('/timesheets', { ...payload, source: 'manual' })
        : await api.put(`/timesheets/${entry.id}`, payload);
      onSave(data);
    } catch (err) { setErr(err.response?.data?.error || 'Save failed'); setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm('Delete this time entry? This cannot be undone.')) return;
    setSaving(true); setErr('');
    try {
      await api.delete(`/timesheets/${entry.id}`);
      onDelete(entry.id);
    } catch (err) { setErr(err.response?.data?.error || 'Delete failed'); setSaving(false); }
  }

  return (
    <div className={styles.overlay} {...overlayClose(onClose)}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{isNew ? 'New Timesheet Entry' : 'Edit Timesheet Entry'}</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className={styles.modalBody}>
            {err && <div className={styles.errorBanner}>{err}</div>}
            <div className={styles.field}>
              <label>Staff Member</label>
              <input value={entry ? entry.user_name : currentUser?.name || ''} disabled
                style={{ background: '#f8fafc', color: 'var(--color-text-muted)' }} />
            </div>
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label>Date</label>
                <input type="date" value={form.date} onChange={e => set('date', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>Hours</label>
                <input type="number" min="0.25" step="0.25" value={form.hours} onChange={e => set('hours', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>Start Time</label>
                <input type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>Finish Time</label>
                <input type="time" value={form.end_time} onChange={e => set('end_time', e.target.value)} />
              </div>
            </div>
            <div className={styles.field}>
              <label>Billing Rate</label>
              <select value={form.billing_rate_id} onChange={e => set('billing_rate_id', e.target.value)}>
                <option value="">— Select —</option>
                {billingRates.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label>Notes</label>
              <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)}
                placeholder="What work was done?" />
            </div>
          </div>
          <div className={styles.modalFooter}>
            {!isNew && (
              <button type="button" className={styles.btnDanger} onClick={handleDelete} disabled={saving}
                style={{ marginRight: 'auto' }}>Delete</button>
            )}
            <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>{saving ? 'Saving…' : 'OK'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// One day's worth of entries laid out as bars along a 24-hour axis, Tradify-style
function TimeDayGroup({ dateKey, entries, billingRates, currentUser, onEntryClick }) {
  const dateLabel = new Date(`${dateKey}T12:00:00`).toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const sorted = [...entries].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  return (
    <div className={styles.timeDayGroup}>
      <div className={styles.timeDayHeader}>{dateLabel}</div>
      <div className={styles.timeDayRows}>
        {sorted.map(e => {
          const billable = isBillable(e, billingRates);
          const colourClass = billable ? styles.timeBarBillable : styles.timeBarNonBillable;
          const canModify = isAdmin(currentUser.role) || e.user_id === currentUser.id;
          const hasTimes = e.start_time && e.end_time;
          if (!hasTimes) {
            return (
              <div key={e.id} className={styles.timeDayRowAuto}>
                <div className={`${styles.timeBarNoTime} ${colourClass}`}
                  style={{ cursor: canModify ? 'pointer' : 'default' }}
                  onClick={() => canModify && onEntryClick(e)}>
                  {e.user_name} · {parseFloat(e.hours).toFixed(2)}h{e.description ? ` — ${e.description}` : ''}
                </div>
              </div>
            );
          }
          const s = new Date(e.start_time), en = new Date(e.end_time);
          const sMin = s.getHours() * 60 + s.getMinutes();
          const eMin = Math.max(en.getHours() * 60 + en.getMinutes(), sMin + 15);
          const leftPct = (sMin / 1440) * 100;
          const widthPct = Math.min(((eMin - sMin) / 1440) * 100, 100 - leftPct);
          return (
            <div key={e.id} className={styles.timeDayRow}>
              <div
                className={`${styles.timeBar} ${colourClass}`}
                style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 3)}%`, cursor: canModify ? 'pointer' : 'default' }}
                onClick={() => canModify && onEntryClick(e)}
                title={`${fmtTimeAmPm(e.start_time)} – ${fmtTimeAmPm(e.end_time)}\n${e.user_name}${e.description ? ' — ' + e.description : ''}`}
              >
                <span className={styles.timeBarRange}>{fmtTimeAmPm(e.start_time)} - {fmtTimeAmPm(e.end_time)}</span>
                <span className={styles.timeBarStaff}>{e.user_name}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles.timeHourAxis}>
        {HOUR_MARKS.map(h => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{fmtHourMark(h)}</span>
        ))}
      </div>
    </div>
  );
}

function JobTimesheets({ jobId, user }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [billingRates, setBillingRates] = useState([]);
  const [modalEntry, setModalEntry] = useState(undefined); // undefined = closed, null = new entry

  useEffect(() => {
    api.get('/timesheets', { params: { job_id: jobId } })
      .then(r => setEntries(r.data))
      .finally(() => setLoading(false));
  }, [jobId]);

  useEffect(() => {
    api.get('/settings/billing-rates').then(r => setBillingRates(r.data)).catch(() => {});
  }, []);

  function handleSaved(saved) {
    setEntries(es => es.some(x => x.id === saved.id) ? es.map(x => x.id === saved.id ? saved : x) : [saved, ...es]);
    setModalEntry(undefined);
  }

  function handleDeleted(id) {
    setEntries(es => es.filter(e => e.id !== id));
    setModalEntry(undefined);
  }

  const total = entries.reduce((s, e) => s + parseFloat(e.hours || 0), 0);

  const byDate = {};
  entries.forEach(e => {
    const key = e.date ? e.date.slice(0, 10) : 'unknown';
    (byDate[key] ||= []).push(e);
  });
  const dateKeys = Object.keys(byDate).sort();

  return (
    <div className={styles.card}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
        <button className={styles.btnPrimary} onClick={() => setModalEntry(null)}>+ New Timesheet Entry</button>
      </div>
      {loading ? <div className={styles.emptySmall}>Loading…</div> :
       entries.length === 0 ? <div className={styles.emptySmall}>No time logged yet.</div> : (
        <>
          {dateKeys.map(dk => (
            <TimeDayGroup key={dk} dateKey={dk} entries={byDate[dk]} billingRates={billingRates}
              currentUser={user} onEntryClick={setModalEntry} />
          ))}
          <div className={styles.tsTotal}>Total: <strong>{total.toFixed(2)}h</strong></div>
        </>
      )}
      {modalEntry !== undefined && (
        <TimeEntryModal jobId={jobId} entry={modalEntry} billingRates={billingRates} currentUser={user}
          onSave={handleSaved} onDelete={handleDeleted} onClose={() => setModalEntry(undefined)} />
      )}
    </div>
  );
}

// ── Schedule tab ──────────────────────────────────────────────────────────────
function JobScheduleTab({ jobId, job, user }) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  function load() {
    setLoading(true);
    api.get('/schedules', { params: { job: jobId } }).then(r => setEntries(r.data)).finally(() => setLoading(false));
  }
  useEffect(load, [jobId]);

  // Open the calendar on the day this appointment is booked for.
  function openDay(e) {
    navigate(`/schedule?date=${String(e.scheduled_date).slice(0, 10)}`);
  }

  async function removeAppointment(e) {
    if (!confirm(`Delete the appointment for ${e.tech_name} on ${new Date(e.scheduled_date).toLocaleDateString('en-NZ')}?`)) return;
    setDeletingId(e.id);
    try {
      await api.delete(`/schedules/${e.id}`);
      setEntries(list => list.filter(x => x.id !== e.id));
    } catch {
      alert('Failed to delete the appointment');
    } finally { setDeletingId(null); }
  }

  function fmtTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
  }

  return (
    <div className={styles.card}>
      {canAct(user?.role) && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
          <button className={styles.btnPrimary} onClick={() => setShowModal(true)}>+ New Appointment</button>
        </div>
      )}
      {loading ? <div className={styles.emptySmall}>Loading…</div> :
       entries.length === 0 ? <div className={styles.emptySmall}>No appointments scheduled yet.</div> : (
        entries.map(e => (
          <div key={e.id} className={styles.apptRow}>
            <button type="button" className={styles.apptMain} onClick={() => openDay(e)}
              title="Open the calendar on this day">
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {new Date(e.scheduled_date).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })}
                  {e.start_time ? ` · ${fmtTime(e.start_time)}` : ''}{e.end_time ? `–${fmtTime(e.end_time)}` : ''}
                </div>
                {e.notes && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{e.notes}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{e.tech_name}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>{e.appointment_type || '—'}</div>
              </div>
            </button>
            {isAdmin(user?.role) && (
              <button type="button" className={styles.apptDelete} disabled={deletingId === e.id}
                onClick={() => removeAppointment(e)} title="Delete this appointment">
                {deletingId === e.id ? '…' : '✕'}
              </button>
            )}
          </div>
        ))
      )}
      {showModal && (
        <AssignModal
          jobId={jobId}
          lockJob
          lockedJobLabel={`${formatJobNumber(job)}${job.customer_name ? ' — ' + job.customer_name : ''}`}
          isAdmin={isAdmin(user?.role)}
          onClose={() => setShowModal(false)}
          onAssigned={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
}

// ── Quotes tab ────────────────────────────────────────────────────────────────
const QUOTE_STATUS_COLOURS = { draft: '#6b7280', approved: '#7c3aed', sent: '#0891b2', accepted: '#16a34a', declined: '#dc2626', cancelled: '#6b7280' };
function fmtQuoteNum(q) { return q.quote_number ? `QT-${String(q.quote_number).padStart(4, '0')}` : `Q-${q.id.slice(0, 6).toUpperCase()}`; }

function JobQuotesTab({ job, user }) {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [themes, setThemes] = useState([]);
  const [themeId, setThemeId] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const navigate = useNavigate();

  // Admins can remove any quote; everyone else only their own.
  const canDelete = q => user?.role === 'admin' || q.created_by === user?.id;

  async function handleDeleteQuote(q) {
    if (!confirm(`Delete ${fmtQuoteNum(q)}? This cannot be undone.`)) return;
    setDeletingId(q.id);
    try {
      await api.delete(`/quotes/${q.id}`);
      setQuotes(qs => qs.filter(x => x.id !== q.id));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete quote.');
    } finally { setDeletingId(null); }
  }

  useEffect(() => {
    api.get('/quotes', { params: { job: job.id } }).then(r => setQuotes(r.data)).finally(() => setLoading(false));
    api.get('/settings/themes').then(r => {
      const active = r.data.filter(t => !t.archived);
      setThemes(active);
      setThemeId(active.find(t => t.isDefault)?.id || active[0]?.id || '');
    }).catch(() => {});
  }, [job.id]);

  async function handleCreate() {
    setCreating(true);
    try {
      const { data } = await api.post('/quotes', { job_id: job.id, customer_id: job.customer_id, theme_id: themeId || undefined });
      navigate(`/quotes/${data.id}`);
    } catch {
      setCreating(false);
    }
  }

  return (
    <div className={styles.card}>
      {user?.role !== 'field_tech' && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className={styles.btnPrimary} onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating…' : '+ Create Quote'}
          </button>
          {themes.length > 1 && (
            <select value={themeId} onChange={e => setThemeId(e.target.value)}
              style={{ padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: 'inherit' }}
              title="Which branding this quote will use">
              {themes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </div>
      )}
      {loading ? <div className={styles.emptySmall}>Loading…</div> :
       quotes.length === 0 ? <div className={styles.emptySmall}>No quotes for this job yet.</div> : (
        quotes.map(q => (
          <Link key={q.id} to={`/quotes/${q.id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--color-border)', textDecoration: 'none', color: 'inherit' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{fmtQuoteNum(q)}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{new Date(q.created_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>${(q.total / 100).toFixed(2)}</div>
                <span className={styles.statusBadge} style={{ background: (QUOTE_STATUS_COLOURS[q.status] || '#6b7280') + '18', color: QUOTE_STATUS_COLOURS[q.status] || '#6b7280' }}>
                  {q.status}
                </span>
              </div>
              {canDelete(q) && (
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); handleDeleteQuote(q); }}
                  disabled={deletingId === q.id}
                  title={`Delete ${fmtQuoteNum(q)}`}
                  style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}>
                  ✕
                </button>
              )}
            </div>
          </Link>
        ))
      )}
    </div>
  );
}

// ── Invoices tab ──────────────────────────────────────────────────────────────
const INVOICE_STATUS_COLOURS = { draft: '#6b7280', sent: '#0891b2', paid: '#16a34a', overdue: '#dc2626', cancelled: '#6b7280' };
function fmtInvNum(inv) { return inv.invoice_number ? `INV-${String(inv.invoice_number).padStart(4, '0')}` : `INV-${inv.id.slice(0, 6).toUpperCase()}`; }

function JobInvoicesTab({ jobId }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/invoices', { params: { job: jobId } }).then(r => setInvoices(r.data)).finally(() => setLoading(false));
  }, [jobId]);

  return (
    <div className={styles.card}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', fontSize: 12, color: 'var(--color-text-muted)' }}>
        Invoices are created by converting an accepted quote on the Quotes tab.
      </div>
      {loading ? <div className={styles.emptySmall}>Loading…</div> :
       invoices.length === 0 ? <div className={styles.emptySmall}>No invoices for this job yet.</div> : (
        invoices.map(inv => {
          const status = inv.is_overdue ? 'overdue' : inv.status;
          return (
            <Link key={inv.id} to={`/invoices/${inv.id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--color-border)', textDecoration: 'none', color: 'inherit' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{fmtInvNum(inv)}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{new Date(inv.created_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>${(inv.total / 100).toFixed(2)}</div>
                <span className={styles.statusBadge} style={{ background: (INVOICE_STATUS_COLOURS[status] || '#6b7280') + '18', color: INVOICE_STATUS_COLOURS[status] || '#6b7280' }}>
                  {status}
                </span>
              </div>
            </Link>
          );
        })
      )}
    </div>
  );
}


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
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [editNoteError, setEditNoteError] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  // Supports deep-linking to a tab, e.g. /jobs/:id?tab=line_items from the "Edit" button on a quote
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'details');
  const [emailFlash, setEmailFlash] = useState('');
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [syncingArcSite, setSyncingArcSite] = useState(false);
  const [pullingDrawings, setPullingDrawings] = useState(false);
  const [attachmentsRefreshKey, setAttachmentsRefreshKey] = useState(0);
  const [jobStatuses, setJobStatuses] = useState([]);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [statusMenuPos, setStatusMenuPos] = useState(null);
  const statusMenuRef = useRef(null);
  const statusBtnRef = useRef(null);
  const statusMenuElRef = useRef(null);

  const positionStatusMenu = useCallback(() => {
    if (!statusBtnRef.current) return;
    setStatusMenuPos(statusMenuPosition(statusBtnRef.current.getBoundingClientRect()));
  }, []);

  function toggleStatusMenu() {
    if (statusMenuOpen) { setStatusMenuOpen(false); return; }
    positionStatusMenu();
    setStatusMenuOpen(true);
  }

  useEffect(() => {
    if (!statusMenuOpen) return;
    function onDown(e) {
      // The menu is portalled to <body>, so it is no longer inside the picker —
      // both nodes have to be treated as "inside" or clicking an item closes
      // the menu before its own click handler runs.
      const inPicker = statusMenuRef.current?.contains(e.target);
      const inMenu = statusMenuElRef.current?.contains(e.target);
      if (!inPicker && !inMenu) setStatusMenuOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setStatusMenuOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Fixed positioning does not follow the page, so track it while open
    window.addEventListener('scroll', positionStatusMenu, true);
    window.addEventListener('resize', positionStatusMenu);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', positionStatusMenu, true);
      window.removeEventListener('resize', positionStatusMenu);
    };
  }, [statusMenuOpen, positionStatusMenu]);

  useEffect(() => {
    if (isNew) return;
    api.get(`/jobs/${id}`).then(r => { setJob(r.data); setLoading(false); });
  }, [id]);

  useEffect(() => {
    api.get('/settings/job-statuses').then(r => setJobStatuses(r.data)).catch(() => {});
  }, []);

  // Admin-configurable, ordered — excludes 'cancelled', which gets its own
  // separate trailing button and banner treatment below.
  const statusColor = key => jobStatuses.find(s => s.key === key)?.color || '#6b7280';
  const statusLabel = key => jobStatuses.find(s => s.key === key)?.label || key.replace('_', ' ');

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

  // Status moves driven by the timer rather than the pipeline buttons. Kept
  // separate from handleStatusChange so completing a job this way doesn't
  // also fire the "create a quote from this job?" prompt mid-timer.
  async function handleTimerStatusChange(status) {
    try {
      const { data } = await api.patch(`/jobs/${id}/status`, { status });
      setJob(j => ({ ...j, status: data.status }));
      setEmailFlash(`Job moved to ${statusLabel(data.status)}`);
    } catch {
      setEmailFlash('Could not update the job status');
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

  function handleStartEditNote(note) {
    setEditingNoteId(note.id);
    setEditNoteText(note.content);
    setEditNoteError('');
  }

  function handleCancelEditNote() {
    setEditingNoteId(null);
    setEditNoteText('');
    setEditNoteError('');
  }

  async function handleSaveNote(noteId) {
    if (!editNoteText.trim()) return;
    setSavingNote(true);
    setEditNoteError('');
    try {
      const { data } = await api.put(`/jobs/${id}/notes/${noteId}`, { content: editNoteText });
      setJob(j => ({ ...j, notes: j.notes.map(n => (n.id === noteId ? data : n)) }));
      handleCancelEditNote();
    } catch (err) {
      setEditNoteError(err.response?.data?.error || 'Could not save the note');
    } finally {
      setSavingNote(false);
    }
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
    // Must clear editMode on the new-job path too. Navigating to the real id
    // flips isNew to false but leaves editMode true, so `isNew || editMode`
    // kept the form mounted — with its "Saving…" state frozen, since the
    // component never unmounts on a same-route id change.
    setEditMode(false);
    if (isNew) {
      navigate(`/jobs/${savedJob.id}`, { replace: true });
      setEmailFlash(`Job ${formatJobNumber(savedJob)} created`);
    } else {
      setJob(j => ({ ...j, ...savedJob }));
      setEmailFlash('Changes saved');
    }
  }

  const subtotal = (job?.line_items || []).reduce((s, i) => s + (i.unit_price * i.quantity), 0);
  const gst = Math.round(subtotal * 0.15);
  const total = subtotal + gst;
  // Prefer the mobile for calling — it's the number most likely to be answered on site
  const callNumber = job?.customer_mobile || job?.customer_phone;
  const hasPhotos = parseInt(job?.attachment_count) > 0;
  const hasOpForm = !!job?.has_completed_forms;

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

  // Just after creating a job the url switches from /jobs/new to the real id,
  // so `loading` is already false (it starts false for a new job) while the
  // detail fetch for that id is still in flight — job is briefly null here.
  // Everything below dereferences it, so bail out until it arrives.
  if (!job) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  return (
    <div className={styles.page}>
      {/* Main layout */}
      <div className={styles.detailLayout}>
        <div className={styles.detailMain}>
          {/* Header */}
          <div className={`${styles.pageHeader} ${styles.detailHeaderLeft}`}>
            <div className={styles.breadcrumb} style={{ marginBottom: 0 }}>
              <Link to="/jobs">Jobs</Link><span>›</span>
              <span>Job {formatJobNumber(job)}</span>
            </div>
            <div className={styles.headerActions}>
              {canAct(user?.role) && (
                <button className={styles.btnSecondary} onClick={() => setShowAppointmentModal(true)}>📅 New Appointment</button>
              )}
              {user?.role !== 'field_tech' && user?.role !== 'operations' && (
                <button className={styles.btnSecondary} onClick={handleArcSiteSync} disabled={syncingArcSite}>
                  {syncingArcSite ? 'Syncing…' : job.arcsite_project_id ? '🔄 Re-sync ArcSite' : '📐 Send to ArcSite'}
                </button>
              )}
              {user?.role !== 'field_tech' && user?.role !== 'operations' && job.arcsite_project_id && (
                <button className={styles.btnSecondary} onClick={handlePullDrawings} disabled={pullingDrawings}>
                  {pullingDrawings ? 'Pulling…' : '📥 Pull Drawing'}
                </button>
              )}
              {isAdmin(user?.role) && (
                <button className={styles.btnSecondary} onClick={() => setEditMode(true)}>Edit</button>
              )}
              {isAdmin(user?.role) && (
                <button className={styles.btnDanger} onClick={handleDelete}>Delete Job</button>
              )}
            </div>
          </div>

          {/* Mobile quick actions — CSS hides these above 768px */}
          <div className={styles.quickActions}>
            {job.site_address && (
              <a className={styles.quickAction} target="_blank" rel="noreferrer"
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.site_address)}`}>
                <span className={styles.quickActionIcon}>➤</span>
                <span className={styles.quickActionLabel}>Navigate</span>
              </a>
            )}
            {job.customer_email && (
              <a className={styles.quickAction} href={`mailto:${job.customer_email}`}>
                <span className={styles.quickActionIcon}>✉</span>
                <span className={styles.quickActionLabel}>Email</span>
              </a>
            )}
            {callNumber && (
              <a className={styles.quickAction} href={`tel:${callNumber.replace(/\s+/g, '')}`}>
                <span className={styles.quickActionIcon}>✆</span>
                <span className={styles.quickActionLabel}>Call</span>
              </a>
            )}
            {/* Texting only makes sense for a mobile number, so this falls away
                when we only hold a landline. */}
            {job.customer_mobile && (
              <a className={styles.quickAction} href={`sms:${job.customer_mobile.replace(/\s+/g, '')}`}>
                <span className={styles.quickActionIcon}>💬</span>
                <span className={styles.quickActionLabel}>Message</span>
              </a>
            )}
          </div>

          {/* Status is driven by the workflow now — quoting, the timer, and
              invoicing move it. It's shown in the Job Summary, where an admin
              can override it if something needs correcting. */}

          {/* Timer bar */}
          {job.status !== 'cancelled' && job.status !== 'complete' && (
            <JobTimer
              jobId={id}
              user={user}
              onTimeSaved={() => setEmailFlash('Time entry saved!')}
              jobStatus={job.status}
              jobStatuses={jobStatuses}
              onStatusChange={handleTimerStatusChange}
            />
          )}
          {emailFlash && (
            <div className={styles.flashBanner} onAnimationEnd={() => setEmailFlash('')}>{emailFlash}</div>
          )}

          {/* Tabs */}
          <div className={styles.tabs}>
            {['details', 'photos', 'forms', 'notes', 'timesheets', 'schedule', 'line_items', 'costs', 'quotes', 'invoices'].map(t => (
              <button key={t} className={`${styles.tab} ${activeTab === t ? styles.tabActive : ''}`} onClick={() => setActiveTab(t)}>
                {TAB_LABELS[t] || t.charAt(0).toUpperCase() + t.slice(1)}
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
                    <span>Description</span>
                    {isHtml(job.description) ? (
                      <div className={styles.richText}
                        dangerouslySetInnerHTML={{ __html: safeHtml(job.description) }} />
                    ) : (
                      <strong style={{ fontWeight: 400, whiteSpace: 'pre-wrap' }}>{job.description}</strong>
                    )}
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
                readonly={!canAct(user?.role)}
              />
              {job.line_items?.length > 0 && (
                <div className={styles.totals}>
                  <div className={styles.totalRow}><span>Subtotal Excl. GST</span><span>${(subtotal / 100).toFixed(2)}</span></div>
                  <div className={styles.totalRow}><span>GST (15%)</span><span>${(gst / 100).toFixed(2)}</span></div>
                  <div className={`${styles.totalRow} ${styles.totalFinal}`}><span>Total</span><span>${(total / 100).toFixed(2)}</span></div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'costs' && (
            <div className={styles.card}>
              <JobCosts jobId={id} readonly={!canAct(user?.role)} />
            </div>
          )}

          {activeTab === 'timesheets' && <JobTimesheets jobId={id} user={user} />}
          {activeTab === 'photos' && <JobAttachments key={attachmentsRefreshKey} jobId={id} user={user} />}
          {activeTab === 'forms' && (
            <>
              <JobFormsTab jobId={id} job={job} user={user} />
              <div style={{ marginTop: 16 }}>
                <JobAttachments jobId={id} user={user} category="post_install" />
              </div>
            </>
          )}
          {activeTab === 'schedule' && <JobScheduleTab jobId={id} job={job} user={user} />}
          {activeTab === 'quotes' && <JobQuotesTab job={job} user={user} />}
          {activeTab === 'invoices' && <JobInvoicesTab jobId={id} />}

          {activeTab === 'notes' && (
            <div className={styles.card}>
              <div className={styles.noteInput}>
                <textarea rows={3} placeholder="Add a note…" value={noteText} onChange={e => setNoteText(e.target.value)} />
                <button className={styles.btnPrimary} onClick={handleAddNote} disabled={!noteText.trim()}>Add Note</button>
              </div>
              {(!job.notes || job.notes.length === 0) && <p className={styles.emptySmall}>No notes yet.</p>}
              {job.notes?.map(note => {
                const isEditing = editingNoteId === note.id;
                // Only the author can edit — the note carries their name
                const canEdit = note.user_id === user?.id;
                return (
                  <div key={note.id} className={styles.noteRow}>
                    <div className={styles.noteMeta}>
                      <strong>{note.author_name}</strong>
                      <span>{new Date(note.created_at).toLocaleString('en-NZ')}</span>
                      {note.updated_at && (
                        <span
                          className={styles.noteEdited}
                          title={`Edited ${new Date(note.updated_at).toLocaleString('en-NZ')}`}
                        >
                          edited
                        </span>
                      )}
                    </div>

                    {isEditing ? (
                      <div className={styles.noteEdit}>
                        <textarea
                          rows={4}
                          value={editNoteText}
                          onChange={e => setEditNoteText(e.target.value)}
                          autoFocus
                        />
                        {editNoteError && <div className={styles.noteEditError}>{editNoteError}</div>}
                        <div className={styles.noteEditButtons}>
                          <button
                            className={styles.btnPrimary}
                            onClick={() => handleSaveNote(note.id)}
                            disabled={!editNoteText.trim() || savingNote}
                          >
                            {savingNote ? 'Saving…' : 'Save'}
                          </button>
                          <button className={styles.btnSecondary} onClick={handleCancelEditNote}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className={styles.noteContent}>{note.content}</p>
                    )}

                    {!isEditing && (
                      <div className={styles.noteActions}>
                        {canEdit && (
                          <button
                            className={styles.noteEditBtn}
                            onClick={() => handleStartEditNote(note)}
                          >
                            Edit
                          </button>
                        )}
                        {user?.role !== 'field_tech' && (
                          <button className={styles.noteDeleteBtn} onClick={() => handleDeleteNote(note.id)}>✕</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
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
                {isAdmin(user?.role) ? (
                  <div className={styles.statusPicker} ref={statusMenuRef}>
                    <button
                      ref={statusBtnRef}
                      className={styles.statusBadgeBtn}
                      style={{ background: statusColor(job.status) + '18', color: statusColor(job.status) }}
                      onClick={toggleStatusMenu}
                      title="Change job status"
                    >
                      {statusLabel(job.status)} <span className={styles.statusCaret}>▾</span>
                    </button>
                    {statusMenuOpen && statusMenuPos && createPortal(
                      <div
                        ref={statusMenuElRef}
                        className={styles.statusMenu}
                        style={{
                          left: statusMenuPos.left,
                          top: statusMenuPos.top,
                          bottom: statusMenuPos.bottom,
                          maxHeight: statusMenuPos.maxHeight,
                        }}
                      >
                        {jobStatuses.map(s => (
                          <button
                            key={s.key}
                            className={`${styles.statusMenuItem} ${s.key === job.status ? styles.statusMenuItemActive : ''}`}
                            onClick={() => { setStatusMenuOpen(false); if (s.key !== job.status) handleStatusChange(s.key); }}
                          >
                            <span className={styles.statusMenuDot} style={{ background: s.color || '#6b7280' }} />
                            {s.label}
                          </button>
                        ))}
                      </div>,
                      document.body
                    )}
                  </div>
                ) : (
                  <span className={styles.statusBadge} style={{ background: statusColor(job.status) + '18', color: statusColor(job.status) }}>
                    {statusLabel(job.status)}
                  </span>
                )}
              </div>
              <div className={styles.summaryItem}>
                <span>Total Revenue (incl. GST)</span><strong>${(total / 100).toFixed(2)}</strong>
              </div>
              <div className={styles.summaryItem}>
                <span>Pre-Install Forms</span>
                <strong style={{ color: hasPhotos ? '#16a34a' : '#dc2626' }}>
                  {hasPhotos ? 'Forms Attached' : 'Forms Not Completed'}
                </strong>
              </div>
              <div className={styles.summaryItem}>
                <span>Post-Install Forms</span>
                <strong style={{ color: hasOpForm ? '#16a34a' : '#dc2626' }}>
                  {hasOpForm ? 'Forms Attached' : 'Forms Not Completed'}
                </strong>
              </div>
            </div>
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

      {/* New Appointment modal */}
      {showAppointmentModal && (
        <AssignModal
          jobId={id}
          lockJob
          lockedJobLabel={`${formatJobNumber(job)}${job.customer_name ? ' — ' + job.customer_name : ''}`}
          isAdmin={isAdmin(user?.role)}
          onClose={() => setShowAppointmentModal(false)}
          onAssigned={async () => {
            setShowAppointmentModal(false);
            setEmailFlash('Appointment added to schedule');
            const { data: updated } = await api.get(`/jobs/${id}`);
            setJob(updated);
          }}
        />
      )}

    </div>
  );
}
