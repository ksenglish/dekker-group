import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './Hub.module.css';

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

export default function DekkerHub() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState('Documents');

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
  const [openFolder, setOpenFolder] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef();

  function loadFolders() {
    return api.get('/hub/folders').then(r => setFolders(r.data)).catch(() => {});
  }
  useEffect(() => { loadFolders().finally(() => setLoading(false)); }, []);

  async function openIt(folder) {
    setOpenFolder(folder);
    setDocuments([]);
    const { data } = await api.get(`/hub/folders/${folder.id}/documents`);
    setDocuments(data);
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') { setErr('Only PDF files can be uploaded.'); return; }
    setUploading(true); setErr('');
    try {
      const data_base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = ev => res(ev.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      await api.post(`/hub/folders/${openFolder.id}/documents`, {
        filename: file.name, mime_type: file.type, data_base64,
      });
      await openIt(openFolder);
      loadFolders();
    } catch (e2) {
      setErr(e2.response?.data?.error || 'Upload failed — the file may be too large.');
    } finally { setUploading(false); }
  }

  async function handleDelete(doc) {
    if (!confirm(`Delete "${doc.filename}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/hub/documents/${doc.id}`);
      setDocuments(ds => ds.filter(d => d.id !== doc.id));
      loadFolders();
    } catch { alert('Failed to delete document.'); }
  }

  function openDoc(doc) {
    // Streams through the API so the browser gets a real PDF response with
    // auth applied, rather than a giant base64 URL.
    api.get(`/hub/documents/${doc.id}/data`, { responseType: 'blob' })
      .then(res => window.open(URL.createObjectURL(res.data), '_blank'))
      .catch(() => alert('Could not open that document.'));
  }

  if (loading) return <div className={styles.loading}>Loading…</div>;

  if (openFolder) {
    return (
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <button className={styles.backLink} onClick={() => { setOpenFolder(null); setErr(''); }}>← All folders</button>
          <h2>{openFolder.name}</h2>
          {isAdmin && (
            <>
              <input ref={fileRef} type="file" accept="application/pdf" style={{ display: 'none' }} onChange={handleUpload} />
              <button className={styles.btnPrimary} onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? 'Uploading…' : '+ Add PDF'}
              </button>
            </>
          )}
        </div>
        {err && <div className={styles.errorMsg}>{err}</div>}
        {documents.length === 0 ? (
          <p className={styles.emptySmall}>No documents in this folder yet.</p>
        ) : (
          <div className={styles.docTable}>
            <div className={styles.docHeaderRow}>
              <span>Document</span><span>Size</span><span>Added</span><span>Added by</span><span />
            </div>
            {documents.map(d => (
              <div key={d.id} className={styles.docRow}>
                <button className={styles.docName} onClick={() => openDoc(d)}>📄 {d.filename}</button>
                <span className={styles.muted}>{fmtSize(d.size_bytes)}</span>
                <span className={styles.muted}>{fmtDate(d.created_at)}</span>
                <span className={styles.muted}>{d.uploaded_by_name || '—'}</span>
                <span style={{ textAlign: 'right' }}>
                  {isAdmin && <button className={styles.deleteX} onClick={() => handleDelete(d)} title="Delete">✕</button>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.folderGrid}>
      {folders.map(f => (
        <button key={f.id} className={styles.folderCard} onClick={() => openIt(f)}>
          <div className={styles.folderIcon}>📁</div>
          <div className={styles.folderName}>{f.name}</div>
          <div className={styles.folderCount}>
            {f.document_count} {f.document_count === 1 ? 'document' : 'documents'}
          </div>
        </button>
      ))}
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
