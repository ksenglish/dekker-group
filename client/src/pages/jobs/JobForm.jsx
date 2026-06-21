import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import styles from './Jobs.module.css';

const PRIORITIES = ['low', 'medium', 'high'];

export default function JobForm({ initial, onSave, onCancel }) {
  const [searchParams] = useSearchParams();
  const presetCustomerId = searchParams.get('customer') || '';

  const [form, setForm] = useState({
    customer_id:         initial?.customer_id || presetCustomerId || '',
    site_id:             initial?.site_id || '',
    type:                initial?.type || searchParams.get('template_type') || '',
    description:         initial?.description || searchParams.get('template_description') || '',
    priority:            initial?.priority || searchParams.get('template_priority') || 'medium',
    lead_tech_id:        initial?.lead_tech_id || '',
    due_date:            initial?.due_date ? initial.due_date.split('T')[0] : '',
    status:              initial?.status || 'new',
    is_recurring:        initial?.is_recurring || searchParams.get('template_recurring') === '1',
    recurrence_interval: initial?.recurrence_interval || searchParams.get('template_interval') || 'annual',
  });
  const [customers, setCustomers] = useState([]);
  const [sites, setSites] = useState([]);
  const [techs, setTechs] = useState([]);
  const [jobTypes, setJobTypes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/customers', { params: { limit: 500 } }).then(r => setCustomers(r.data.customers));
    api.get('/users').then(r => setTechs(r.data.filter(u => u.role !== 'office'))).catch(() => {});
    api.get('/settings/job-types').then(r => {
      setJobTypes(r.data);
      if (!initial?.type && r.data.length > 0) setForm(f => ({ ...f, type: f.type || r.data[0] }));
    }).catch(() => setJobTypes(['Installation', 'Service', 'Inspection', 'Repair', 'Quote Only']));
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
      const payload = {
        ...form,
        customer_id: form.customer_id || null,
        site_id: form.site_id || null,
        lead_tech_id: form.lead_tech_id || null,
        due_date: form.due_date || null,
      };
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
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 24 }}>
        {initial?.id ? `Edit Job #${initial.job_number}` : 'New Job'}
      </h2>
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
            <option value="">— Select type —</option>
            {jobTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label>Priority</label>
          <select value={form.priority} onChange={e => set('priority', e.target.value)}>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label>Team Member</label>
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
          <textarea rows={4} value={form.description} onChange={e => set('description', e.target.value)}
            placeholder="Describe the work to be done…" style={{ resize: 'vertical' }} />
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
