import { useState, useEffect } from 'react';
import api from '../../lib/api';
import styles from './Schedule.module.css';

export default function AssignModal({ date, jobId: initialJobId, techMap, onClose, onAssigned }) {
  const [jobs, setJobs] = useState([]);
  const [form, setForm] = useState({
    job_id: initialJobId || '',
    user_id: '',
    scheduled_date: date || '',
    start_time: '',
    end_time: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/jobs', { params: { limit: 200 } }).then(r => {
      setJobs(r.data.jobs.filter(j => j.status !== 'complete' && j.status !== 'cancelled'));
    });
  }, []);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.job_id || !form.user_id || !form.scheduled_date) {
      setError('Job, technician and date are all required'); return;
    }
    setSaving(true); setError('');
    try {
      await api.post('/schedules', form);
      onAssigned();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to assign');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.eventModal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>Assign Job to Technician</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.assignForm}>
            {error && <div className={styles.errorBanner}>{error}</div>}
            <div className={styles.field}>
              <label>Job *</label>
              <select value={form.job_id} onChange={e => set('job_id', e.target.value)}>
                <option value="">Select a job…</option>
                {jobs.map(j => (
                  <option key={j.id} value={j.id}>
                    #{j.job_number} — {j.customer_name || 'No customer'} ({j.status.replace('_', ' ')})
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label>Technician *</label>
              <select value={form.user_id} onChange={e => set('user_id', e.target.value)}>
                <option value="">Select technician…</option>
                {Object.entries(techMap).map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label>Date *</label>
              <input type="date" value={form.scheduled_date} onChange={e => set('scheduled_date', e.target.value)} />
            </div>
            <div className={styles.timeRow}>
              <div className={styles.field}>
                <label>Start Time (optional)</label>
                <input type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label>End Time (optional)</label>
                <input type="time" value={form.end_time} onChange={e => set('end_time', e.target.value)} />
              </div>
            </div>
          </div>
          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? 'Assigning…' : 'Assign Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
