import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { isAdmin, canAct } from '../../lib/permissions';
import { formatJobNumber } from '../../lib/formatJobNumber';
import { toLocalDateStr } from '../../lib/date';
import { isBillable } from '../../lib/billing';
import JobForm from './JobForm';
import LineItemsEditor from './LineItemsEditor';
import JobCosts from './JobCosts';
import SalesPresenter from '../presenter/SalesPresenter';
import AssignModal from '../schedule/AssignModal';
import JobFormsTab from './JobFormsTab';
import styles from './Jobs.module.css';

const TAB_LABELS = {
  photos: 'Pre-Install Forms',
  forms: 'Post Install Forms',
  line_items: 'Line Items',
  timesheets: 'Time',
};

// ── Live Timer ────────────────────────────────────────────────────────────────
function JobTimer({ jobId, onTimeSaved, user }) {
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

function JobAttachments({ jobId, user }) {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [fileUrls, setFileUrls] = useState({}); // attachment id -> blob object URL

  useEffect(() => {
    api.get(`/jobs/${jobId}/attachments`)
      .then(r => setAttachments(r.data))
      .finally(() => setLoading(false));
  }, [jobId]);

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
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
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
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  function load() {
    setLoading(true);
    api.get('/schedules', { params: { job: jobId } }).then(r => setEntries(r.data)).finally(() => setLoading(false));
  }
  useEffect(load, [jobId]);

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
          <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--color-border)' }}>
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
const QUOTE_STATUS_COLOURS = { draft: '#6b7280', sent: '#0891b2', accepted: '#16a34a', declined: '#dc2626', cancelled: '#6b7280' };
function fmtQuoteNum(q) { return q.quote_number ? `QT-${String(q.quote_number).padStart(4, '0')}` : `Q-${q.id.slice(0, 6).toUpperCase()}`; }

function JobQuotesTab({ job, user }) {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/quotes', { params: { job: job.id } }).then(r => setQuotes(r.data)).finally(() => setLoading(false));
  }, [job.id]);

  async function handleCreate() {
    setCreating(true);
    try {
      const { data } = await api.post('/quotes', { job_id: job.id, customer_id: job.customer_id });
      navigate(`/quotes/${data.id}`);
    } catch {
      setCreating(false);
    }
  }

  return (
    <div className={styles.card}>
      {user?.role !== 'field_tech' && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
          <button className={styles.btnPrimary} onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating…' : '+ Create Quote'}
          </button>
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
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>${(q.total / 100).toFixed(2)}</div>
              <span className={styles.statusBadge} style={{ background: (QUOTE_STATUS_COLOURS[q.status] || '#6b7280') + '18', color: QUOTE_STATUS_COLOURS[q.status] || '#6b7280' }}>
                {q.status}
              </span>
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
  // Supports deep-linking to a tab, e.g. /jobs/:id?tab=line_items from the "Edit" button on a quote
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'details');
  const [emailFlash, setEmailFlash] = useState('');
  const [showPresenter, setShowPresenter] = useState(false);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [syncingArcSite, setSyncingArcSite] = useState(false);
  const [pullingDrawings, setPullingDrawings] = useState(false);
  const [attachmentsRefreshKey, setAttachmentsRefreshKey] = useState(0);
  const [jobStatuses, setJobStatuses] = useState([]);

  useEffect(() => {
    if (isNew) return;
    api.get(`/jobs/${id}`).then(r => { setJob(r.data); setLoading(false); });
  }, [id]);

  useEffect(() => {
    api.get('/settings/job-statuses').then(r => setJobStatuses(r.data)).catch(() => {});
  }, []);

  // Admin-configurable, ordered — excludes 'cancelled', which gets its own
  // separate trailing button and banner treatment below.
  const pipelineStatuses = jobStatuses.filter(s => s.key !== 'cancelled');
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

  const subtotal = (job?.line_items || []).reduce((s, i) => s + (i.unit_price * i.quantity), 0);
  const gst = Math.round(subtotal * 0.15);
  const total = subtotal + gst;
  const hasPhotos = parseInt(job?.attachment_count) > 0;
  const hasOpForm = !!job?.has_op_form;

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
              {user?.role !== 'operations' && (
                <button className={styles.btnPresenter} onClick={() => setShowPresenter(true)}>🎯 Sales Presenter</button>
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

          {/* Status pipeline */}
          {job.status !== 'cancelled' ? (
            <div className={styles.pipeline}>
              {pipelineStatuses.map((s, i) => {
                const idx = pipelineStatuses.findIndex(p => p.key === job.status);
                const done = i < idx;
                const active = i === idx;
                return (
                  <button
                    key={s.key}
                    className={`${styles.pipelineStep} ${done ? styles.pipelineDone : ''} ${active ? styles.pipelineActive : ''}`}
                    onClick={() => canAct(user?.role) && handleStatusChange(s.key)}
                    style={active ? { borderColor: s.color, color: s.color } : {}}
                    title={`Move to ${s.label}`}
                  >
                    <span className={styles.pipelineDot} style={active ? { background: s.color } : done ? { background: '#16a34a' } : {}} />
                    {s.label}
                  </button>
                );
              })}
              {isAdmin(user?.role) && (
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
              {canAct(user?.role) && (
                <button onClick={() => handleStatusChange('new')} className={styles.reopenBtn}>Reopen as New</button>
              )}
            </div>
          )}

          {/* Timer bar */}
          {job.status !== 'cancelled' && job.status !== 'complete' && (
            <JobTimer jobId={id} user={user} onTimeSaved={() => setEmailFlash('Time entry saved!')} />
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
          {activeTab === 'forms' && <JobFormsTab jobId={id} job={job} user={user} />}
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
                <span className={styles.statusBadge} style={{ background: statusColor(job.status) + '18', color: statusColor(job.status) }}>
                  {statusLabel(job.status)}
                </span>
              </div>
              <div className={styles.summaryItem}>
                <span>Total Revenue (incl. GST)</span><strong>${(total / 100).toFixed(2)}</strong>
              </div>
              <div className={styles.summaryItem}>
                <span>Photos</span>
                <strong style={{ color: hasPhotos ? '#16a34a' : '#dc2626' }}>
                  {hasPhotos ? 'Photos Attached' : 'No Photos Attached'}
                </strong>
              </div>
              <div className={styles.summaryItem}>
                <span>Op Forms</span>
                <strong style={{ color: hasOpForm ? '#16a34a' : '#dc2626' }}>
                  {hasOpForm ? 'Op Forms Completed' : 'Op Forms Not Completed'}
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

      {/* Sales Presenter picker */}
      {showPresenter && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300 }}>
          <SalesPresenter jobId={id} onPick={async (product) => {
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
    </div>
  );
}
