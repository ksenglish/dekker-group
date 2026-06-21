import { useState, useEffect } from 'react';
import api from '../../lib/api';
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

export default function AssignModal({ date, jobId: initialJobId, techMap, onClose, onAssigned }) {
  const [jobs, setJobs] = useState([]);
  const [jobTechs, setJobTechs] = useState([]); // team members on the selected job
  const [form, setForm] = useState({
    job_id: initialJobId || '',
    user_id: '',
    scheduled_date: date || new Date().toISOString().split('T')[0],
    start_time: '',
    end_time: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/jobs', { params: { limit: 500 } }).then(r => {
      setJobs(r.data.jobs.filter(j => j.status !== 'complete' && j.status !== 'cancelled'));
    });
  }, []);

  // When job changes, load its technicians and auto-select first one
  useEffect(() => {
    if (!form.job_id) { setJobTechs([]); return; }
    api.get(`/jobs/${form.job_id}`).then(r => {
      const techs = r.data.technicians || [];
      setJobTechs(techs);
      if (techs.length === 1) set('user_id', techs[0].id);
      else if (techs.length === 0) set('user_id', '');
    }).catch(() => setJobTechs([]));
  }, [form.job_id]);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.job_id || !form.user_id || !form.scheduled_date) {
      setError('Please select a job, team member and date'); return;
    }
    setSaving(true); setError('');
    try {
      await api.post('/schedules', form);
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
          <h2>Schedule Job</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.assignForm}>
            {error && <div className={styles.errorBanner}>{error}</div>}

            {/* Job selector */}
            <div className={styles.field}>
              <label>Job *</label>
              <select value={form.job_id} onChange={e => { set('job_id', e.target.value); set('user_id', ''); }}>
                <option value="">Select a job…</option>
                {jobs.map(j => (
                  <option key={j.id} value={j.id}>
                    #{j.job_number}{j.customer_name ? ` — ${j.customer_name}` : ''}{j.type ? ` (${j.type})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Show job description if available */}
            {selectedJob?.description && (
              <p className={styles.jobHint}>{selectedJob.description}</p>
            )}

            {/* Team member */}
            <div className={styles.field}>
              <label>Team Member *</label>
              <select value={form.user_id} onChange={e => set('user_id', e.target.value)}>
                <option value="">Select team member…</option>
                {techOptions.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {jobTechs.length > 0 && (
                <span className={styles.fieldHint}>Showing team members assigned to this job</span>
              )}
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
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? 'Scheduling…' : 'Add to Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
