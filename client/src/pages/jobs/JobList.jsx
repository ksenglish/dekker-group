import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import styles from './Jobs.module.css';

const STATUSES = ['new', 'quoted', 'scheduled', 'in_progress', 'invoiced', 'complete', 'cancelled'];
const PRIORITIES = ['low', 'medium', 'high'];
const STATUS_COLOURS = {
  new: '#1e40af', quoted: '#7c3aed', scheduled: '#0891b2',
  in_progress: '#d97706', invoiced: '#9333ea', complete: '#16a34a', cancelled: '#6b7280',
};
const PRIORITY_COLOURS = { low: '#6b7280', medium: '#d97706', high: '#dc2626' };

export default function JobList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [techs, setTechs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState([]);

  const filters = {
    search:   searchParams.get('search') || '',
    status:   searchParams.get('status') || '',
    tech:     searchParams.get('tech') || '',
    priority: searchParams.get('priority') || '',
  };

  function setFilter(key, val) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (val) next.set(key, val); else next.delete(key);
      return next;
    });
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.search)   params.search   = filters.search;
      if (filters.status)   params.status   = filters.status;
      if (filters.tech)     params.tech     = filters.tech;
      if (filters.priority) params.priority = filters.priority;
      const { data } = await api.get('/jobs', { params });
      setJobs(data.jobs);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/users').then(r => setTechs(r.data)).catch(() => {}); }, []);

  async function openTemplates() {
    const { data } = await api.get('/settings/job-templates');
    setTemplates(data);
    setShowTemplates(true);
  }

  function useTemplate(tpl) {
    const params = new URLSearchParams({
      template_type:        tpl.type || '',
      template_description: tpl.description || '',
      template_priority:    tpl.priority || 'medium',
      template_recurring:   tpl.is_recurring ? '1' : '0',
      template_interval:    tpl.recurrence_interval || 'annual',
    });
    navigate(`/jobs/new?${params}`);
  }

  const activeFilters = [filters.status, filters.tech, filters.priority].filter(Boolean).length;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Jobs</h1>
          <p className={styles.pageSubtitle}>{total} job{total !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={styles.btnSecondary} onClick={openTemplates}>New Job from Template</button>
          <button className={styles.btnPrimary} onClick={() => navigate('/jobs/new')}>+ New Job</button>
        </div>
      </div>

      <div className={styles.toolbar}>
        <input className={styles.searchInput} type="search"
          placeholder="Search by job #, description, or customer…"
          value={filters.search} onChange={e => setFilter('search', e.target.value)} />
        <select className={styles.filterSelect} value={filters.status} onChange={e => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select className={styles.filterSelect} value={filters.priority} onChange={e => setFilter('priority', e.target.value)}>
          <option value="">All priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className={styles.filterSelect} value={filters.tech} onChange={e => setFilter('tech', e.target.value)}>
          <option value="">All technicians</option>
          {techs.filter(t => t.role !== 'office').map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {activeFilters > 0 && (
          <button className={styles.clearBtn} onClick={() => setSearchParams({})}>Clear filters ({activeFilters})</button>
        )}
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : jobs.length === 0 ? (
        <div className={styles.empty}>No jobs found. {!activeFilters && 'Create your first job to get started.'}</div>
      ) : (
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span>Job #</span>
            <span>Customer</span>
            <span>Description</span>
            <span>Type</span>
            <span>Priority</span>
            <span>Status</span>
            <span>Technician</span>
            <span>Due Date</span>
          </div>
          {jobs.map(job => (
            <Link key={job.id} to={`/jobs/${job.id}`} className={styles.tableRow}>
              <span className={styles.jobNumber}>#{job.job_number}</span>
              <span>{job.customer_name || <span className={styles.muted}>No customer</span>}</span>
              <span className={styles.jobDesc}>{job.description || <span className={styles.muted}>—</span>}</span>
              <span className={styles.typeTag}>{job.type?.replace('_', ' ')}</span>
              <span>
                <span className={styles.priorityBadge} style={{ color: PRIORITY_COLOURS[job.priority] }}>
                  {job.priority === 'high' ? '▲' : job.priority === 'low' ? '▼' : '●'} {job.priority}
                </span>
              </span>
              <span>
                <span className={styles.statusBadge} style={{ background: STATUS_COLOURS[job.status] + '18', color: STATUS_COLOURS[job.status] }}>
                  {job.status.replace('_', ' ')}
                </span>
              </span>
              <span>{job.tech_name || <span className={styles.muted}>Unassigned</span>}</span>
              <span>{job.due_date ? new Date(job.due_date).toLocaleDateString('en-NZ') : <span className={styles.muted}>—</span>}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Template picker modal */}
      {showTemplates && (
        <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && setShowTemplates(false)}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>New Job from Template</h2>
              <button className={styles.modalClose} onClick={() => setShowTemplates(false)}>✕</button>
            </div>
            <div className={styles.modalBody}>
              {templates.length === 0 ? (
                <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '24px 0' }}>
                  No templates yet. Create them in <strong>Settings → Job Types & Templates</strong>.
                </p>
              ) : (
                <div className={styles.templateList}>
                  {templates.map(tpl => (
                    <button key={tpl.id} className={styles.templateCard} onClick={() => { setShowTemplates(false); useTemplate(tpl); }}>
                      <div className={styles.templateName}>{tpl.name}</div>
                      {tpl.type && <div className={styles.templateMeta}>{tpl.type}</div>}
                      {tpl.description && <div className={styles.templateDesc}>{tpl.description}</div>}
                      <div className={styles.templateMeta}>
                        Priority: {tpl.priority}
                        {tpl.is_recurring && ` · Recurring ${tpl.recurrence_interval}`}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
