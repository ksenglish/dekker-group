import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './Timesheets.module.css';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function fmtHours(h) {
  if (!h || parseFloat(h) === 0) return '';
  const total = parseFloat(h);
  const hrs = Math.floor(total);
  const mins = Math.round((total - hrs) * 60);
  return mins > 0 ? `${hrs}:${String(mins).padStart(2, '0')}` : `${hrs}:00`;
}

function weekStart(date) {
  const d = date ? new Date(date) : new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekLabel(from) {
  const to = addDays(from, 6);
  const f = new Date(from), t = new Date(to);
  const fmt = d => d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${f.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long' })} – ${fmt(t)}`;
}

function EntryModal({ entry, prefillUser, prefillDate, jobs, users, currentUser, onSave, onClose }) {
  const isAdmin = currentUser.role !== 'field_tech';
  const [form, setForm] = useState({
    job_id: entry?.job_id || '',
    user_id: entry?.user_id || prefillUser || currentUser.id,
    date: entry?.date?.slice(0, 10) || prefillDate || new Date().toISOString().slice(0, 10),
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
    `"${e.date?.slice(0,10)}"`, `"${e.user_name || ''}"`,
    `"${e.job_title ? `#${e.job_number} ${e.job_title}` : ''}"`,
    e.hours, `"${(e.description || '').replace(/"/g, '""')}"`,
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `timesheets-${from}-${to}.csv`; a.click();
}

export default function TimesheetsPage() {
  const { user } = useAuth();
  const isAdmin = user.role !== 'field_tech';
  const [weekFrom, setWeekFrom] = useState(weekStart());
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | { entry?, prefillUser?, prefillDate? }
  const [listView, setListView] = useState(false);

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i));

  useEffect(() => {
    const init = async () => {
      const [jRes, uRes] = await Promise.all([
        api.get('/jobs'),
        isAdmin ? api.get('/users') : Promise.resolve({ data: [] }),
      ]);
      setJobs(jRes.data?.jobs || jRes.data || []);
      setUsers(uRes.data);
    };
    init();
  }, []);

  useEffect(() => { load(); }, [weekFrom]);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/timesheets', { params: { from: weekFrom, to: addDays(weekFrom, 6) } });
      setEntries(data);
    } finally { setLoading(false); }
  }

  function onSaved() { load(); setModal(null); }
  async function deleteEntry(e) {
    if (!confirm('Delete this time entry?')) return;
    await api.delete(`/timesheets/${e.id}`);
    load();
  }

  function shiftWeek(n) { setWeekFrom(w => addDays(w, n * 7)); }

  // Build grid data: per user, per day
  const staffList = isAdmin
    ? users.length > 0 ? users : [...new Map(entries.map(e => [e.user_id, { id: e.user_id, name: e.user_name }])).values()]
    : [user];

  function hoursForUserDay(userId, dateStr) {
    return entries.filter(e => e.user_id === userId && e.date?.slice(0, 10) === dateStr)
      .reduce((s, e) => s + parseFloat(e.hours || 0), 0);
  }
  function weekTotalForUser(userId) {
    return entries.filter(e => e.user_id === userId).reduce((s, e) => s + parseFloat(e.hours || 0), 0);
  }
  function billableTotalForUser(userId) {
    return entries.filter(e => e.user_id === userId && e.job_id).reduce((s, e) => s + parseFloat(e.hours || 0), 0);
  }
  function initials(name) {
    return (name || '').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  const AVATAR_COLOURS = ['#1e40af','#7c3aed','#0891b2','#d97706','#dc2626','#16a34a','#9333ea','#0f766e'];
  function avatarColour(userId) {
    const idx = staffList.findIndex(u => u.id === userId);
    return AVATAR_COLOURS[idx % AVATAR_COLOURS.length];
  }

  const grandTotal = entries.reduce((s, e) => s + parseFloat(e.hours || 0), 0);
  const billableTotal = entries.filter(e => e.job_id).reduce((s, e) => s + parseFloat(e.hours || 0), 0);

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Timesheets</h1>
          <p className={styles.pageSubtitle}>{fmtHours(grandTotal) || '0:00'} logged · {fmtHours(billableTotal) || '0:00'} billable</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={() => setListView(v => !v)}>
            {listView ? '⊞ Grid View' : '☰ List View'}
          </button>
          <button className={styles.btnSecondary} onClick={() => exportCsv(entries, weekFrom, addDays(weekFrom, 6))}>⬇ Export CSV</button>
          <button className={styles.btnPrimary} onClick={() => setModal({})}>+ Log Time</button>
        </div>
      </div>

      {/* Week navigation */}
      <div className={styles.weekNav}>
        <button className={styles.weekBtn} onClick={() => shiftWeek(-1)}>‹</button>
        <span className={styles.weekLabel}>{weekLabel(weekFrom)}</span>
        <button className={styles.weekBtn} onClick={() => shiftWeek(1)}>›</button>
        <button className={styles.todayBtn} onClick={() => setWeekFrom(weekStart())}>Today</button>
      </div>

      {loading ? <div className={styles.loading}>Loading…</div> : listView ? (
        /* ── List view ── */
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span>Date</span>
            {isAdmin && <span>Team Member</span>}
            <span>Job</span>
            <span>Description</span>
            <span style={{ textAlign: 'right' }}>Hours</span>
            <span />
          </div>
          {entries.length === 0 ? <div className={styles.empty}>No entries this week.</div> : entries.map(e => (
            <div key={e.id} className={styles.tableRow}>
              <div>{new Date(e.date).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
              {isAdmin && <div>{e.user_name}</div>}
              <div>{e.job_title ? <span className={styles.jobTag}>#{e.job_number}</span> : <span className={styles.muted}>General</span>}</div>
              <div className={styles.descCell}>{e.description || <span className={styles.muted}>—</span>}</div>
              <div style={{ textAlign: 'right', fontWeight: 600 }}>{parseFloat(e.hours).toFixed(2)}h</div>
              <div className={styles.actions}>
                <button className={styles.btnIcon} onClick={() => setModal({ entry: e })}>✏</button>
                <button className={styles.btnIcon} onClick={() => deleteEntry(e)}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ── Weekly grid view ── */
        <div className={styles.gridWrap}>
          <table className={styles.weekGrid}>
            <thead>
              <tr>
                <th className={styles.staffCol}>Staff</th>
                {weekDates.map((d, i) => (
                  <th key={d} className={styles.dayCol}>
                    <div className={styles.dayName}>{DAYS[i]}</div>
                    <div className={styles.dayDate}>{new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}</div>
                  </th>
                ))}
                <th className={styles.totalCol}>Week Total</th>
                <th className={styles.totalCol}>Billable</th>
                <th className={styles.addCol} />
              </tr>
            </thead>
            <tbody>
              {staffList.map(u => {
                const weekTotal = weekTotalForUser(u.id);
                const billable = billableTotalForUser(u.id);
                return (
                  <tr key={u.id} className={styles.staffRow}>
                    <td className={styles.staffCell}>
                      <div className={styles.avatar} style={{ background: avatarColour(u.id) }}>
                        {initials(u.name)}
                      </div>
                      <span className={styles.staffName}>{u.name}</span>
                    </td>
                    {weekDates.map(d => {
                      const hrs = hoursForUserDay(u.id, d);
                      const dayEntries = entries.filter(e => e.user_id === u.id && e.date?.slice(0,10) === d);
                      return (
                        <td key={d} className={`${styles.dayCell} ${hrs > 0 ? styles.dayCellFilled : ''}`}
                          onClick={() => hrs > 0 && setModal({ entry: dayEntries[0] })}
                          title={dayEntries.map(e => `${parseFloat(e.hours).toFixed(2)}h${e.job_number ? ` #${e.job_number}` : ''}${e.description ? ` — ${e.description}` : ''}`).join('\n')}>
                          {hrs > 0 ? fmtHours(hrs) : ''}
                        </td>
                      );
                    })}
                    <td className={styles.weekTotalCell}>{weekTotal > 0 ? fmtHours(weekTotal) : <span className={styles.muted}>0:00</span>}</td>
                    <td className={styles.billableCell}>{billable > 0 ? fmtHours(billable) : <span className={styles.muted}>0:00</span>}</td>
                    <td className={styles.addBtnCell}>
                      <button className={styles.addRowBtn}
                        onClick={() => setModal({ prefillUser: u.id, prefillDate: weekFrom })}
                        title={`Log time for ${u.name}`}>+</button>
                    </td>
                  </tr>
                );
              })}
              {staffList.length === 0 && (
                <tr><td colSpan={11} className={styles.empty}>No team members found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <EntryModal
          entry={modal.entry}
          prefillUser={modal.prefillUser}
          prefillDate={modal.prefillDate}
          jobs={jobs}
          users={isAdmin ? users : [user]}
          currentUser={user}
          onSave={onSaved}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
