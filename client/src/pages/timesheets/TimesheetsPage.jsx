import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './Timesheets.module.css';

function fmt(h) { return `${parseFloat(h).toFixed(1)}h`; }

function weekStart() {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Mon
  return new Date(d.setDate(diff)).toISOString().slice(0, 10);
}
function weekEnd(start) {
  const d = new Date(start);
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

function EntryModal({ entry, jobs, users, currentUser, onSave, onClose }) {
  const isAdmin = currentUser.role !== 'field_tech';
  const [form, setForm] = useState({
    job_id: entry?.job_id || '',
    user_id: entry?.user_id || currentUser.id,
    date: entry?.date?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    hours: entry?.hours || '',
    description: entry?.description || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save(e) {
    e.preventDefault();
    if (!form.hours || parseFloat(form.hours) <= 0) return setErr('Hours must be greater than 0');
    setSaving(true); setErr('');
    try {
      const { data } = entry
        ? await api.put(`/timesheets/${entry.id}`, form)
        : await api.post('/timesheets', form);
      onSave(data);
    } catch (e) { setErr(e.response?.data?.error || 'Save failed'); setSaving(false); }
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2>{entry ? 'Edit Time Entry' : 'Log Time'}</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={save} className={styles.modalBody}>
          {err && <div className={styles.error}>{err}</div>}
          <div className={styles.formGrid}>
            {isAdmin && (
              <div className={styles.field}>
                <label>Team Member</label>
                <select value={form.user_id} onChange={e => set('user_id', e.target.value)}>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
            <div className={styles.field}>
              <label>Date</label>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} />
            </div>
            <div className={styles.field}>
              <label>Hours</label>
              <input type="number" min="0.25" max="24" step="0.25" value={form.hours}
                onChange={e => set('hours', e.target.value)} placeholder="e.g. 4.5" />
            </div>
            <div className={styles.field} style={{ gridColumn: '1/-1' }}>
              <label>Job (optional)</label>
              <select value={form.job_id} onChange={e => set('job_id', e.target.value)}>
                <option value="">No job / general</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number ? `#${j.job_number} — ` : ''}{j.title}</option>)}
              </select>
            </div>
            <div className={styles.field} style={{ gridColumn: '1/-1' }}>
              <label>Description</label>
              <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)}
                placeholder="What work was done?" />
            </div>
          </div>
          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? 'Saving…' : 'Save Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function exportCsv(entries, from, to) {
  const headers = ['Date', 'Team Member', 'Job', 'Hours', 'Description'];
  const rows = entries.map(e => [
    `"${e.date?.slice(0,10)}"`,
    `"${e.user_name || ''}"`,
    `"${e.job_title ? `#${e.job_number} ${e.job_title}` : ''}"`,
    e.hours,
    `"${(e.description || '').replace(/"/g, '""')}"`,
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `timesheets-${from}-${to}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export default function TimesheetsPage() {
  const { user } = useAuth();
  const isAdmin = user.role !== 'field_tech';
  const start = weekStart();

  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(weekEnd(start));
  const [filterUser, setFilterUser] = useState('');
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const params = { from, to };
      if (filterUser) params.user_id = filterUser;
      const [eRes, sRes] = await Promise.all([
        api.get('/timesheets', { params }),
        api.get('/timesheets/summary', { params }),
      ]);
      setEntries(eRes.data);
      setSummary(sRes.data);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    const init = async () => {
      const [jRes, uRes] = await Promise.all([
        api.get('/jobs', { params: { limit: 200 } }),
        isAdmin ? api.get('/users') : Promise.resolve({ data: [] }),
      ]);
      setJobs(jRes.data?.jobs || jRes.data || []);
      setUsers(uRes.data);
    };
    init();
  }, []);

  useEffect(() => { load(); }, [from, to, filterUser]);

  function onSaved(e) {
    setEntries(es => {
      const idx = es.findIndex(x => x.id === e.id);
      if (idx > -1) { const n = [...es]; n[idx] = e; return n; }
      return [e, ...es];
    });
    load(); // refresh summary
    setAdding(false); setEditing(null);
  }

  async function deleteEntry(e) {
    if (!confirm('Delete this time entry?')) return;
    await api.delete(`/timesheets/${e.id}`);
    setEntries(es => es.filter(x => x.id !== e.id));
    load();
  }

  function setWeek(offset) {
    const d = new Date(from);
    d.setDate(d.getDate() + offset * 7);
    const newFrom = d.toISOString().slice(0, 10);
    setFrom(newFrom);
    setTo(weekEnd(newFrom));
  }

  const totalHours = entries.reduce((s, e) => s + parseFloat(e.hours || 0), 0);

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Timesheets</h1>
          <p className={styles.pageSubtitle}>{fmt(totalHours)} logged · {entries.length} entr{entries.length !== 1 ? 'ies' : 'y'}</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={() => exportCsv(entries, from, to)}>⬇ Export CSV</button>
          <button className={styles.btnPrimary} onClick={() => setAdding(true)}>+ Log Time</button>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <button className={styles.weekBtn} onClick={() => setWeek(-1)}>‹</button>
        <div className={styles.dateRange}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          <span>to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <button className={styles.weekBtn} onClick={() => setWeek(1)}>›</button>
        {isAdmin && (
          <select className={styles.filterSelect} value={filterUser} onChange={e => setFilterUser(e.target.value)}>
            <option value="">All team members</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>

      {/* Summary cards */}
      {isAdmin && summary.length > 0 && (
        <div className={styles.summaryGrid}>
          {summary.map(s => (
            <div key={s.user_id} className={styles.summaryCard}>
              <div className={styles.summaryAvatar}>{s.user_name?.charAt(0).toUpperCase()}</div>
              <div>
                <div className={styles.summaryName}>{s.user_name}</div>
                <div className={styles.summaryHours}>{fmt(s.total_hours)} · {s.job_count} job{s.job_count !== 1 ? 's' : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Entries table */}
      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : entries.length === 0 ? (
        <div className={styles.empty}>No time entries for this period.</div>
      ) : (
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span>Date</span>
            {isAdmin && <span>Team Member</span>}
            <span>Job</span>
            <span>Description</span>
            <span style={{ textAlign: 'right' }}>Hours</span>
            <span></span>
          </div>
          {entries.map(e => (
            <div key={e.id} className={styles.tableRow}>
              <div className={styles.dateCell}>{new Date(e.date).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
              {isAdmin && <div className={styles.nameCell}>{e.user_name}</div>}
              <div className={styles.jobCell}>{e.job_title ? <span className={styles.jobTag}>#{e.job_number} {e.job_title}</span> : <span className={styles.muted}>General</span>}</div>
              <div className={styles.descCell}>{e.description || <span className={styles.muted}>—</span>}</div>
              <div style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(e.hours)}</div>
              <div className={styles.actions}>
                <button className={styles.btnIcon} onClick={() => setEditing(e)} title="Edit">✏</button>
                <button className={styles.btnIcon} onClick={() => deleteEntry(e)} title="Delete">🗑</button>
              </div>
            </div>
          ))}
          <div className={styles.totalRow}>
            <span style={{ gridColumn: isAdmin ? '1/5' : '1/4' }}>Total</span>
            <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(totalHours)}</span>
            <span></span>
          </div>
        </div>
      )}

      {(adding || editing) && (
        <EntryModal
          entry={editing}
          jobs={jobs}
          users={users}
          currentUser={user}
          onSave={onSaved}
          onClose={() => { setAdding(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
