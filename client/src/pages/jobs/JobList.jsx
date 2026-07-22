import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { canAct, isAdmin as isAdminRole } from '../../lib/permissions';
import { formatJobNumber } from '../../lib/formatJobNumber';
import styles from './Jobs.module.css';

const STATUSES = ['new', 'quoted', 'scheduled', 'in_progress', 'invoiced', 'complete', 'cancelled'];
const PRIORITIES = ['low', 'medium', 'high'];
const STATUS_COLOURS = {
  new: '#1e40af', quoted: '#7c3aed', scheduled: '#0891b2',
  in_progress: '#d97706', invoiced: '#9333ea', complete: '#16a34a', cancelled: '#6b7280',
};
const PRIORITY_COLOURS = { low: '#6b7280', medium: '#d97706', high: '#dc2626' };

function pad2(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function startOfWeek(d) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday-based
  return new Date(d.getFullYear(), d.getMonth(), diff);
}
function fmtTime(hhmmss) {
  if (!hhmmss) return '';
  const [h, m] = hhmmss.split(':').map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad2(m)} ${h >= 12 ? 'pm' : 'am'}`;
}

// Start/end date strings + a human label for the given period anchored on `date`
function periodInfo(period, dateStr) {
  const anchor = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  if (period === 'day') {
    const d = toDateStr(anchor);
    return { from: d, to: d, label: anchor.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) };
  }
  if (period === 'week') {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    const fmt = d => d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long' });
    return { from: toDateStr(start), to: toDateStr(end), label: `${fmt(start)} – ${end.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}` };
  }
  // month
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { from: toDateStr(start), to: toDateStr(end), label: anchor.toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' }) };
}

export default function JobList() {
  const navigate = useNavigate();
  const { user } = useAuth();
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
    period:   searchParams.get('period') || '', // '' | 'day' | 'week' | 'month'
    date:     searchParams.get('date') || '',
  };

  // Remember the last-selected period/date per user, same pattern as the
  // Schedule page — restored once on mount below (unless the URL already
  // specifies one, e.g. a deep link), and saved whenever the user changes it.
  const periodStorageKey = user ? `jobs_period_${user.id}` : 'jobs_period';
  const dateStorageKey   = user ? `jobs_date_${user.id}`   : 'jobs_date';
  const restoredViewRef = useRef(false);

  useEffect(() => {
    if (restoredViewRef.current || !user) return;
    restoredViewRef.current = true;
    if (searchParams.has('period') || searchParams.has('date')) return;
    const savedPeriod = localStorage.getItem(periodStorageKey);
    if (!savedPeriod) return;
    const savedDate = localStorage.getItem(dateStorageKey);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('period', savedPeriod);
      if (savedDate) next.set('date', savedDate);
      if (!next.get('tech')) next.set('tech', user.id);
      return next;
    }, { replace: true });
  }, [user]);

  function setFilter(key, val) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (val) next.set(key, val); else next.delete(key);
      return next;
    });
  }

  // Switching into a Day/Week/Month view defaults "Team Member" to the
  // logged-in user (a personal "my jobs" view) without clobbering an
  // Admin's own choice if they've already picked someone else.
  function setPeriod(period) {
    if (user) localStorage.setItem(periodStorageKey, period);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (period) {
        next.set('period', period);
        if (!next.get('date')) next.set('date', toDateStr(new Date()));
        if (!next.get('tech') && user?.id) next.set('tech', user.id);
      } else {
        next.delete('period');
        next.delete('date');
      }
      return next;
    });
  }

  function setDate(dateStr) {
    if (user) localStorage.setItem(dateStorageKey, dateStr);
    setFilter('date', dateStr);
  }

  function shiftPeriod(dir) {
    const anchor = filters.date ? new Date(`${filters.date}T00:00:00`) : new Date();
    let next;
    if (filters.period === 'day') next = addDays(anchor, dir);
    else if (filters.period === 'week') next = addDays(anchor, dir * 7);
    else next = new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
    setDate(toDateStr(next));
  }

  const period = filters.period ? periodInfo(filters.period, filters.date) : null;
  const isAdmin = isAdminRole(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.search)   params.search   = filters.search;
      if (filters.status)   params.status   = filters.status;
      if (filters.tech)     params.tech     = filters.tech;
      if (filters.priority) params.priority = filters.priority;
      if (period) { params.from = period.from; params.to = period.to; params.sort = 'scheduled'; }
      const { data } = await api.get('/jobs', { params });
      setJobs(data.jobs);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!isAdmin) return;
    api.get('/users').then(r => setTechs(r.data)).catch(() => {});
  }, [isAdmin]);

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
          {user?.role === 'admin' && (
            <button className={styles.btnSecondary} onClick={() => navigate('/jobs/import')}>⬆ Import from Tradify</button>
          )}
          {canAct(user?.role) && (
            <>
              <button className={styles.btnSecondary} onClick={openTemplates}>New Job from Template</button>
              <button className={styles.btnPrimary} onClick={() => navigate('/jobs/new')}>+ New Job</button>
            </>
          )}
        </div>
      </div>

      <div className={styles.periodBar}>
        <div className={styles.periodToggle}>
          <button className={`${styles.periodBtn} ${!filters.period ? styles.periodBtnActive : ''}`}
            onClick={() => setPeriod('')}>All Jobs</button>
          <button className={`${styles.periodBtn} ${filters.period === 'day' ? styles.periodBtnActive : ''}`}
            onClick={() => setPeriod('day')}>Day</button>
          <button className={`${styles.periodBtn} ${filters.period === 'week' ? styles.periodBtnActive : ''}`}
            onClick={() => setPeriod('week')}>Week</button>
          <button className={`${styles.periodBtn} ${filters.period === 'month' ? styles.periodBtnActive : ''}`}
            onClick={() => setPeriod('month')}>Month</button>
        </div>
        {period && (
          <div className={styles.periodNav}>
            <button className={styles.periodNavBtn} onClick={() => shiftPeriod(-1)}>‹</button>
            <span className={styles.periodLabel}>{period.label}</span>
            <button className={styles.periodNavBtn} onClick={() => shiftPeriod(1)}>›</button>
            <button className={styles.periodTodayBtn} onClick={() => setDate(toDateStr(new Date()))}>Today</button>
          </div>
        )}
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
        {isAdmin && (
          <select className={styles.filterSelect} value={filters.tech} onChange={e => setFilter('tech', e.target.value)}>
            <option value="">All technicians</option>
            {techs.filter(t => t.role !== 'office').map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {activeFilters > 0 && (
          <button className={styles.clearBtn} onClick={() => {
            if (user) { localStorage.setItem(periodStorageKey, ''); localStorage.removeItem(dateStorageKey); }
            setSearchParams({});
          }}>Clear filters ({activeFilters})</button>
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
            <span>Status</span>
            <span>Team Member</span>
            <span>Schedule Date</span>
          </div>
          {jobs.map(job => (
            <Link key={job.id} to={`/jobs/${job.id}`} className={styles.tableRow}>
              <span className={styles.jobNumber}>{formatJobNumber(job)}</span>
              <span>{job.customer_name || <span className={styles.muted}>No customer</span>}</span>
              <span className={styles.jobDesc}>{job.description || <span className={styles.muted}>—</span>}</span>
              <span className={styles.typeTag}>{job.type?.replace('_', ' ')}</span>
              <span>
                <span className={styles.statusBadge} style={{ background: STATUS_COLOURS[job.status] + '18', color: STATUS_COLOURS[job.status] }}>
                  {job.status.replace('_', ' ')}
                </span>
              </span>
              <span>{job.tech_name || <span className={styles.muted}>Unassigned</span>}</span>
              <span>
                {job.scheduled_date
                  ? `${new Date(job.scheduled_date).toLocaleDateString('en-NZ')}${job.scheduled_time ? ` · ${fmtTime(job.scheduled_time)}` : ''}`
                  : <span className={styles.muted}>Not scheduled</span>}
              </span>
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
