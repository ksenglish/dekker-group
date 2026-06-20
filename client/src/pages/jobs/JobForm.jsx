import { useState, useEffect } from 'react';
import api from '../../lib/api';
import styles from './Jobs.module.css';

const JOB_TYPES = ['installation', 'service', 'inspection', 'repair', 'quote_only'];
const PRIORITIES = ['low', 'medium', 'high'];

export default function JobForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    customer_id: initial?.customer_id || '',
    site_id: initial?.site_id || '',
    type: initial?.type || 'installation',
    description: initial?.description || '',
    priority: initial?.priority || 'medium',
    lead_tech_id: initial?.lead_tech_id || '',
    due_date: initial?.due_date ? initial.due_date.split('T')[0] : '',
    status: initial?.status || 'new',
    is_recurring: initial?.is_recurring || false,
    recurrence_interval: initial?.recurrence_interval || 'annual',
  });
  const [customers, setCustomers] = useState([]);
  const [sites, setSites] = useState([]);
  const [techs, setTechs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/customers', { params: { limit: 200 } }).then(r => setCustomers(r.data.customers));
    api.get('/users').then(r => setTechs(r.data.filter(u => u.role !== 'office'))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.customer_id) { setSites([]); return; }
    api.get(`/customers/${form.customer_id}/sites`).then(r => setSites(r.data));
  }, [form.customer_id]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.type) { setError('Job type is required'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, customer_id: form.customer_id || null, site_id: form.site_id || null, lead_tech_id: form.lead_tech_id || null, due_date: form.due_date || null };
      const { data } = initial?.id
        ? await api.put(`/jobs/${initial.id}`, payload)
        : await api.post('/jobs', payload);
      onSave(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.card} style={{ padding: '24px' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>{initial?.id ? `Edit Job #${initial.job_number}` : 'New Job'}</h2>
      {error && <div className={styles.errorBanner}>{error}</div>}

      <div className={styles.formGrid}>
        <div className={styles.field}>
          <label>Customer</label>
          <select value={form.customer_id} onChange={e => { set('customer_id', e.target.value); set('site_id', ''); }}>
            <option value="">No customer</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label>Site Address</label>
          <select value={form.site_id} onChange={e => set('site_id', e.target.value)} disabled={!form.customer_id || sites.length === 0}>
            <option value="">No site selected</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.address}{s.label ? ` (${s.label})` : ''}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label>Job Type *</label>
          <select value={form.type} onChange={e => set('type', e.target.value)}>
            {JOB_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label>Priority</label>
          <select value={form.priority} onChange={e => set('priority', e.target.value)}>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label>Lead Technician</label>
          <select value={form.lead_tech_id} onChange={e => set('lead_tech_id', e.target.value)}>
            <option value="">Unassigned</option>
            {techs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label>Due Date</label>
          <input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
        </div>
        {initial?.id && (
          <div className={styles.field}>
            <label>Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)}>
              {['new','quoted','scheduled','in_progress','invoiced','complete','cancelled'].map(s =>
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              )}
            </select>
          </div>
        )}
        <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
          <label>Description</label>
          <textarea rows={4} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Describe the work to be done…" style={{ resize: 'vertical' }} />
        </div>
        <div className={styles.field} style={{ gridColumn: '1 / -1', flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 0 }}>
            <input type="checkbox" checked={form.is_recurring} onChange={e => set('is_recurring', e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--color-primary)', cursor: 'pointer' }} />
            Recurring maintenance job
          </label>
          {form.is_recurring && (
            <select value={form.recurrence_interval} onChange={e => set('recurrence_interval', e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 14 }}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="biannual">Every 6 months</option>
              <option value="annual">Annual</option>
            </select>
          )}
        </div>
      </div>

      <div className={styles.formActions}>
        <button type="button" className={styles.btnSecondary} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.btnPrimary} disabled={saving}>
          {saving ? 'Saving…' : initial?.id ? 'Save Changes' : 'Create Job'}
        </button>
      </div>
    </form>
  );
}
