import { useState } from 'react';
import api from '../../lib/api';
import TeamMemberMultiSelect from '../../components/TeamMemberMultiSelect';
import styles from './Schedule.module.css';

// Build list of times 07:00–20:30 in 15-min steps
function buildTimeOptions() {
  const opts = [];
  for (let h = 7; h <= 20; h++) {
    const maxMin = h === 20 ? 30 : 45;
    for (let m = 0; m <= maxMin; m += 15) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      const value = `${hh}:${mm}`;
      const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const ampm = h >= 12 ? 'pm' : 'am';
      opts.push({ label: `${hour12}:${mm} ${ampm}`, value });
    }
  }
  return opts;
}
const TIME_OPTIONS = buildTimeOptions();

// Add an hour to a HH:MM string, clamped to the last available slot
function plusOneHour(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const target = `${String(Math.min(20, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return TIME_OPTIONS.some(o => o.value === target) ? target : TIME_OPTIONS[TIME_OPTIONS.length - 1].value;
}

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

// Pass `existing` (a calendar note object) to edit it instead of creating a new
// one. Editing always stays single-person (recurrence makes group-editing too
// fraught to be worth it); `isAdmin` only unlocks the multi-select when adding
// a brand new note, letting one Admin action put the same note on several
// team members' diaries at once.
export default function AddNoteModal({ date, time, userId, techMap, existing, onClose, onSaved, isAdmin = false }) {
  const isEdit = !!existing;
  const startTime = existing?.start_time ? existing.start_time.slice(0, 5) : (time || '09:00');
  const [form, setForm] = useState({
    user_ids: isEdit ? [existing.user_id] : (userId ? [userId] : []),
    note: existing?.note || '',
    note_date: existing ? String(existing.note_date).slice(0, 10) : date,
    start_time: startTime,
    end_time: existing?.end_time ? existing.end_time.slice(0, 5) : plusOneHour(startTime),
    recurrence: existing?.recurrence || 'none',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.user_ids.length === 0 || !form.note.trim() || !form.note_date) {
      setError('Please choose a team member and enter a note'); return;
    }
    setSaving(true); setError('');
    try {
      if (isEdit) {
        await api.put(`/calendar-notes/${existing.noteId || existing.id}`, { ...form, user_id: form.user_ids[0] });
      } else {
        await Promise.all(form.user_ids.map(user_id => api.post('/calendar-notes', { ...form, user_id })));
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save note');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.eventModal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{isEdit ? 'Edit Note' : 'Add Note to Diary'}</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.assignForm}>
            {error && <div className={styles.errorBanner}>{error}</div>}

            <div className={styles.field}>
              <label>Team Member{isAdmin && !isEdit ? '(s)' : ''} *</label>
              {isAdmin && !isEdit ? (
                <TeamMemberMultiSelect
                  options={Object.entries(techMap).map(([id, name]) => ({ id, name }))}
                  selected={form.user_ids}
                  onChange={ids => set('user_ids', ids)}
                  placeholder="Select team member(s)…"
                />
              ) : (
                <select value={form.user_ids[0] || ''} onChange={e => set('user_ids', e.target.value ? [e.target.value] : [])}>
                  <option value="">Select team member…</option>
                  {Object.entries(techMap).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              )}
            </div>

            <div className={styles.field}>
              <label>Note *</label>
              <textarea rows={3} value={form.note} onChange={e => set('note', e.target.value)}
                placeholder="e.g. Team meeting, out of office, reminder to order stock…" autoFocus />
            </div>

            <div className={styles.field}>
              <label>Date *</label>
              <input type="date" value={form.note_date} onChange={e => set('note_date', e.target.value)} />
            </div>

            <div className={styles.timeRow}>
              <div className={styles.field}>
                <label>Start Time</label>
                <select value={form.start_time} onChange={e => set('start_time', e.target.value)}>
                  {TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className={styles.field}>
                <label>End Time</label>
                <select value={form.end_time} onChange={e => set('end_time', e.target.value)}>
                  {TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            <div className={styles.field}>
              <label>Repeat</label>
              <select value={form.recurrence} onChange={e => set('recurrence', e.target.value)}>
                {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Note'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
