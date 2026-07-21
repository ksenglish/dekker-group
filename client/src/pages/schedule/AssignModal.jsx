import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatJobNumber } from '../../lib/formatJobNumber';
import TeamMemberMultiSelect from '../../components/TeamMemberMultiSelect';
import styles from './Schedule.module.css';

// Build list of times 07:00–20:30 in 15-min steps
function buildTimeOptions() {
  const opts = [{ label: '— No time —', value: '' }];
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

function TimeSelect({ value, onChange, label }) {
  return (
    <div className={styles.field}>
      <label>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// Guess Sales vs Operations from the team member's role — always editable by the user
function guessApptType(role) {
  if (role === 'sales') return 'sales';
  if (role === 'operations' || role === 'field_tech' || role === 'subcontractor' || role === 'office') return 'operations';
  return '';
}

// Pass `existing` (an array of schedule rows sharing the same job/date/time/type —
// i.e. one logical appointment assigned to more than one person) to edit it instead
// of creating a new one. Only Admins get the multi-select checkbox list (isAdmin) —
// everyone else keeps the original single team-member dropdown.
export default function AssignModal({
  date, jobId: initialJobId, userId: initialUserId, techMap = {}, techRoles = {},
  onClose, onAssigned, lockJob = false, lockedJobLabel = '', isAdmin = false, existing,
}) {
  const isEdit = !!existing?.length;
  const [jobs, setJobs] = useState([]);
  const [jobTechs, setJobTechs] = useState([]); // team members on the selected job
  const [form, setForm] = useState({
    job_id: isEdit ? existing[0].job_id : (initialJobId || ''),
    user_ids: isEdit ? existing.map(e => e.user_id) : (initialUserId ? [initialUserId] : []),
    scheduled_date: isEdit ? String(existing[0].scheduled_date).slice(0, 10) : (date || new Date().toISOString().split('T')[0]),
    start_time: isEdit ? (existing[0].start_time || '') : '',
    end_time: isEdit ? (existing[0].end_time || '') : '',
    appointment_type: isEdit ? (existing[0].appointment_type || '') : guessApptType(techRoles[initialUserId]),
    notes: isEdit ? (existing[0].notes || '') : '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const effectiveLockJob = lockJob || isEdit;
  const effectiveLockedJobLabel = isEdit
    ? `${formatJobNumber(existing[0])}${existing[0].customer_name ? ' — ' + existing[0].customer_name : ''}`
    : lockedJobLabel;

  useEffect(() => {
    if (effectiveLockJob) return;
    api.get('/jobs', { params: { limit: 500 } }).then(r => {
      setJobs(r.data.jobs.filter(j => j.status !== 'complete' && j.status !== 'cancelled'));
    });
  }, [effectiveLockJob]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function selectUser(id) {
    setForm(f => ({ ...f, user_ids: id ? [id] : [], appointment_type: guessApptType(techRoles[id]) }));
  }

  // When job changes, load its technicians. Keep the pre-selected team member
  // (e.g. from clicking a Day-view column) if they're assigned to the job.
  useEffect(() => {
    if (!form.job_id) { setJobTechs([]); return; }
    api.get(`/jobs/${form.job_id}`).then(r => {
      const techs = r.data.technicians || [];
      setJobTechs(techs);
      if (isEdit) return; // keep the existing assignees as-is, don't reset on load
      if (techs.length === 0) {
        if (!initialUserId) selectUser('');
      } else if (techs.some(t => t.id === initialUserId)) {
        selectUser(initialUserId);
      } else if (techs.length === 1) {
        selectUser(techs[0].id);
      } else {
        selectUser('');
      }
    }).catch(() => setJobTechs([]));
  }, [form.job_id]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.job_id || form.user_ids.length === 0 || !form.scheduled_date || !form.appointment_type) {
      setError('Please select a job, at least one team member, appointment type and date'); return;
    }
    setSaving(true); setError('');
    const shared = {
      job_id: form.job_id,
      scheduled_date: form.scheduled_date,
      start_time: form.start_time,
      end_time: form.end_time,
      appointment_type: form.appointment_type,
      notes: form.notes,
    };
    try {
      if (isEdit) {
        const originalByUser = new Map(existing.map(e => [e.user_id, e]));
        const newUserIds = new Set(form.user_ids);
        const kept = existing.filter(e => newUserIds.has(e.user_id));
        const added = form.user_ids.filter(id => !originalByUser.has(id));
        const removed = existing.filter(e => !newUserIds.has(e.user_id));
        await Promise.all([
          ...kept.map(e => api.put(`/schedules/${e.id}`, shared)),
          ...added.map(user_id => api.post('/schedules', { ...shared, user_id })),
          ...removed.map(e => api.delete(`/schedules/${e.id}`)),
        ]);
      } else {
        await Promise.all(form.user_ids.map(user_id => api.post('/schedules', { ...shared, user_id })));
      }
      onAssigned();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to schedule');
    } finally {
      setSaving(false);
    }
  }

  // Which techs to show — prefer job's assigned members, fall back to all
  const techOptions = jobTechs.length > 0
    ? jobTechs
    : Object.entries(techMap).map(([id, name]) => ({ id, name }));

  const selectedJob = jobs.find(j => j.id === form.job_id);

  return (
    <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.eventModal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{isEdit ? 'Edit Appointment' : 'Schedule Job'}</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.assignForm}>
            {error && <div className={styles.errorBanner}>{error}</div>}

            {/* Job selector */}
            <div className={styles.field}>
              <label>Job *</label>
              {effectiveLockJob ? (
                <input value={effectiveLockedJobLabel} disabled style={{ background: '#f8fafc', color: 'var(--color-text-muted)' }} />
              ) : (
                <select value={form.job_id} onChange={e => { set('job_id', e.target.value); selectUser(''); }}>
                  <option value="">Select a job…</option>
                  {jobs.map(j => (
                    <option key={j.id} value={j.id}>
                      {formatJobNumber(j)}{j.customer_name ? ` — ${j.customer_name}` : ''}{j.type ? ` (${j.type})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Show job description if available */}
            {!effectiveLockJob && selectedJob?.description && (
              <p className={styles.jobHint}>{selectedJob.description}</p>
            )}

            {/* Team member(s) */}
            <div className={styles.field}>
              <label>Team Member{isAdmin ? '(s)' : ''} *</label>
              {isAdmin ? (
                <TeamMemberMultiSelect
                  options={techOptions}
                  selected={form.user_ids}
                  onChange={ids => set('user_ids', ids)}
                  placeholder="Select team member(s)…"
                />
              ) : (
                <select value={form.user_ids[0] || ''} onChange={e => selectUser(e.target.value)}>
                  <option value="">Select team member…</option>
                  {techOptions.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
              {jobTechs.length > 0 && (
                <span className={styles.fieldHint}>Showing team members assigned to this job</span>
              )}
            </div>

            {/* Appointment type */}
            <div className={styles.field}>
              <label>Appointment Type *</label>
              <select value={form.appointment_type} onChange={e => set('appointment_type', e.target.value)}>
                <option value="">Select type…</option>
                <option value="sales">Sales</option>
                <option value="operations">Operations</option>
              </select>
            </div>

            {/* Date */}
            <div className={styles.field}>
              <label>Date *</label>
              <input type="date" value={form.scheduled_date} onChange={e => set('scheduled_date', e.target.value)} />
            </div>

            {/* Time pickers */}
            <div className={styles.timeRow}>
              <TimeSelect label="Start Time" value={form.start_time} onChange={v => set('start_time', v)} />
              <TimeSelect label="End Time" value={form.end_time} onChange={v => set('end_time', v)} />
            </div>

            {/* Appointment notes */}
            <div className={styles.field}>
              <label>Appointment Notes</label>
              <textarea rows={3} value={form.notes} onChange={e => set('notes', e.target.value)}
                placeholder="Notes specific to this appointment (separate from the job's own notes)…" />
            </div>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? (isEdit ? 'Saving…' : 'Scheduling…') : (isEdit ? 'Save Changes' : 'Add to Schedule')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
