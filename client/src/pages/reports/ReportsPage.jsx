import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { toLocalDateStr } from '../../lib/date';
import styles from './Reports.module.css';

function fmt(cents) {
  return (cents / 100).toLocaleString('en-NZ', { style: 'currency', currency: 'NZD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const STATUS_COLOURS = {
  new: '#1e40af', quoted: '#7c3aed', scheduled: '#0891b2',
  in_progress: '#d97706', invoiced: '#9333ea', complete: '#16a34a', cancelled: '#6b7280',
};

function monthName(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' });
}

export default function ReportsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [revenue, setRevenue] = useState([]);
  const [jobStats, setJobStats] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [timesheets, setTimesheets] = useState([]);

  // Remember the last period/team member this admin looked at, so re-entering
  // Reports picks up where they left off rather than resetting to year-to-date.
  const prefsKey = user ? `reports_filters_${user.id}` : null;
  const savedPrefs = (() => {
    try { return prefsKey ? JSON.parse(localStorage.getItem(prefsKey)) || {} : {}; } catch { return {}; }
  })();

  // Date range for job/timesheet reports
  const now = new Date();
  const thisYearStart = `${now.getFullYear()}-01-01`;
  const [from, setFrom] = useState(savedPrefs.from || thisYearStart);
  const [to, setTo] = useState(savedPrefs.to || toLocalDateStr());

  // Per-team-member diary report + commission
  const [teamMembers, setTeamMembers] = useState([]);
  const [reportUserId, setReportUserId] = useState(savedPrefs.reportUserId || user?.id || '');
  const [userJobs, setUserJobs] = useState(null);
  const [userJobsLoading, setUserJobsLoading] = useState(false);
  const [bciBusy, setBciBusy] = useState('');   // 'preview' | 'send' | ''
  const [bciFlash, setBciFlash] = useState('');

  useEffect(() => {
    if (!prefsKey) return;
    try { localStorage.setItem(prefsKey, JSON.stringify({ from, to, reportUserId })); } catch { /* quota/private mode */ }
  }, [prefsKey, from, to, reportUserId]);

  useEffect(() => {
    const calls = [api.get('/reports/revenue')];
    if (isAdmin) calls.push(api.get('/reports/customers'));
    Promise.all(calls).then(([r, c]) => {
      setRevenue(r.data);
      if (c) setCustomers(c.data);
    });
  }, [isAdmin]);

  // useState only seeds once, so pick the default up if auth resolves late
  useEffect(() => {
    if (user?.id && !reportUserId) setReportUserId(user.id);
  }, [user?.id]);

  // Only admins can report on anyone else, so only they need the picker
  useEffect(() => {
    if (!isAdmin) return;
    api.get('/users').then(r => setTeamMembers(r.data.filter(u => u.is_active !== false))).catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    if (!reportUserId) return;
    setUserJobsLoading(true);
    api.get('/reports/user-jobs', { params: { from, to, user_id: reportUserId } })
      .then(r => setUserJobs(r.data))
      .catch(() => setUserJobs(null))
      .finally(() => setUserJobsLoading(false));
  }, [from, to, reportUserId]);

  useEffect(() => {
    Promise.all([
      api.get('/reports/jobs', { params: { from, to } }),
      api.get('/reports/timesheets', { params: { from, to } }),
    ]).then(([j, t]) => {
      setJobStats(j.data);
      setTimesheets(t.data);
    });
  }, [from, to]);

  const totalRevenue = revenue.reduce((s, r) => s + parseInt(r.total_cents || 0), 0);
  const totalPaid = revenue.reduce((s, r) => s + parseInt(r.paid_cents || 0), 0);
  const totalOutstanding = revenue.reduce((s, r) => s + parseInt(r.outstanding_cents || 0), 0);
  const maxRevenue = Math.max(...revenue.map(r => parseInt(r.total_cents || 0)), 1);
  const totalJobs = jobStats.reduce((s, j) => s + parseInt(j.count), 0);

  // The PDF endpoint needs the auth header, so fetch it as a blob through the
  // api client rather than pointing the browser straight at the URL.
  async function previewBCI() {
    setBciBusy('preview'); setBciFlash('');
    try {
      const res = await api.get('/reports/commission-bci', {
        params: { from, to, user_id: reportUserId }, responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank');
      // Give the new tab time to load before revoking
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      // An error body comes back as a blob too, so read it before showing
      let msg = 'Could not generate the report';
      try { msg = JSON.parse(await err.response?.data?.text())?.error || msg; } catch { /* keep default */ }
      setBciFlash(msg);
    } finally { setBciBusy(''); }
  }

  async function sendBCI() {
    const who = teamMembers.find(u => u.id === reportUserId)?.name || 'this team member';
    if (!confirm(`Email the Buyer Created Invoice to ${who}?`)) return;
    setBciBusy('send'); setBciFlash('');
    try {
      const { data } = await api.post('/reports/commission-bci/send', { from, to, user_id: reportUserId });
      setBciFlash(data.message || 'Report sent');
    } catch (err) {
      setBciFlash(err.response?.data?.error || 'Failed to send the report');
    } finally { setBciBusy(''); }
  }

  function exportTimesheet() {
    const headers = ['Team Member', 'Total Hours', 'Jobs'];
    const rows = timesheets.map(t => [t.name, parseFloat(t.total_hours).toFixed(1), t.job_count].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `timesheets-${from}-${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Reports</h1>
          <p className={styles.pageSubtitle}>Business overview and analytics</p>
        </div>
      </div>

      {/* Revenue summary */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>12-Month Revenue</div>
          <div className={styles.statValue}>{fmt(totalRevenue)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Collected</div>
          <div className={styles.statValue} style={{ color: '#16a34a' }}>{fmt(totalPaid)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Outstanding</div>
          <div className={styles.statValue} style={{ color: '#d97706' }}>{fmt(totalOutstanding)}</div>
        </div>
      </div>

      {/* Monthly revenue bar chart */}
      {revenue.length > 0 && (
        <div className={styles.card}>
          <div className={styles.cardHeader}><h2>Monthly Revenue (Last 12 Months)</h2></div>
          <div className={styles.barChart}>
            {revenue.map(r => {
              const total = parseInt(r.total_cents || 0);
              const paid = parseInt(r.paid_cents || 0);
              const pct = Math.round((total / maxRevenue) * 100);
              const paidPct = total > 0 ? Math.round((paid / total) * 100) : 0;
              return (
                <div key={r.month} className={styles.barGroup}>
                  <div className={styles.barWrap}>
                    <div className={styles.barBg} style={{ height: `${pct}%` }}>
                      <div className={styles.barPaid} style={{ height: `${paidPct}%` }} />
                    </div>
                  </div>
                  <div className={styles.barLabel}>{monthName(r.month)}</div>
                  <div className={styles.barValue}>{fmt(total)}</div>
                </div>
              );
            })}
          </div>
          <div className={styles.chartLegend}>
            <span><span className={styles.legendDot} style={{ background: '#16a34a' }} /> Paid</span>
            <span><span className={styles.legendDot} style={{ background: '#e2e8f0' }} /> Invoiced</span>
          </div>
        </div>
      )}

      {/* Date range selector for job + timesheet reports */}
      <div className={styles.dateRange}>
        <label>Period:</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={styles.dateInput} />
        <span>to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={styles.dateInput} />
      </div>

      {/* ── Team member diary + commission ───────────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.cardHeader} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2>Team Member Jobs</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {isAdmin && teamMembers.length > 0 && (
              <select value={reportUserId} onChange={e => setReportUserId(e.target.value)} className={styles.dateInput}>
                {teamMembers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
            <button className={styles.btnSmall} onClick={previewBCI}
              disabled={!!bciBusy || !userJobs?.commission?.qualifying_jobs}>
              {bciBusy === 'preview' ? 'Generating…' : '👁 Preview Report'}
            </button>
            {isAdmin && (
              <button className={styles.btnSmall} onClick={sendBCI}
                disabled={!!bciBusy || !userJobs?.commission?.qualifying_jobs}>
                {bciBusy === 'send' ? 'Sending…' : '✉ Send Report'}
              </button>
            )}
          </div>
        </div>
        {bciFlash && (
          <div style={{ padding: '10px 20px', fontSize: 13, background: '#f0fdf4', borderBottom: '1px solid var(--color-border)', color: '#15803d' }}>
            {bciFlash}
          </div>
        )}

        <div className={styles.statsRow} style={{ margin: 0, padding: 20, borderBottom: '1px solid var(--color-border)' }}>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Jobs in Diary</div>
            <div className={styles.statValue}>{userJobs?.jobs?.length ?? 0}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Quoted or Above</div>
            <div className={styles.statValue} style={{ color: '#16a34a' }}>
              {userJobs?.commission?.qualifying_jobs ?? 0}
            </div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Site-Visit Commission</div>
            <div className={styles.statValue} style={{ color: '#16a34a' }}>
              {fmt(userJobs?.commission?.amount_cents ?? 0)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
              excl. GST · {userJobs?.commission?.qualifying_jobs ?? 0} × {fmt(userJobs?.commission?.rate_cents ?? 0)}
            </div>
          </div>
        </div>

        {userJobsLoading ? <div className={styles.emptySmall}>Loading…</div> :
         !userJobs?.jobs?.length ? <div className={styles.emptySmall}>No jobs in this person’s diary for the selected period.</div> : (
          <>
            <div className={styles.jobsHeader}>
              <span>Job #</span><span>Customer</span><span>Site</span>
              <span>Scheduled</span><span>Current Status</span><span style={{ textAlign: 'center' }}>Commission</span>
            </div>
            {userJobs.jobs.map(j => {
              const st = userJobs.statuses.find(s => s.key === j.status);
              const colour = st?.color || '#6b7280';
              return (
                <Link key={j.id} to={`/jobs/${j.id}`} className={styles.jobsRow}>
                  <span style={{ fontWeight: 600 }}>{j.external_ref || (j.job_number ? `JB${String(j.job_number).padStart(5, '0')}` : '—')}</span>
                  <span className={styles.truncate}>{j.customer_name || '—'}</span>
                  <span className={`${styles.truncate} ${styles.muted}`}>{j.site_address || '—'}</span>
                  <span className={styles.muted}>
                    {j.first_scheduled ? new Date(String(j.first_scheduled).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) : '—'}
                  </span>
                  <span>
                    <span className={styles.statusPill} style={{ background: colour + '18', color: colour }}>
                      {st?.label || j.status}
                    </span>
                  </span>
                  <span className={j.counts_toward_commission ? styles.commissionYes : styles.commissionNo}>
                    {j.counts_toward_commission ? '✓' : '—'}
                  </span>
                </Link>
              );
            })}
          </>
        )}
      </div>

      <div className={styles.gridTwo}>
        {/* Jobs by status */}
        <div className={styles.card}>
          <div className={styles.cardHeader}><h2>Jobs by Status ({totalJobs} total)</h2></div>
          {jobStats.length === 0 ? <div className={styles.emptySmall}>No jobs in this period.</div> : jobStats.map(j => {
            const pct = Math.round((parseInt(j.count) / totalJobs) * 100);
            return (
              <div key={j.status} className={styles.statRow}>
                <span className={styles.statRowLabel} style={{ textTransform: 'capitalize' }}>{j.status.replace('_', ' ')}</span>
                <div className={styles.progressWrap}>
                  <div className={styles.progressBar} style={{ width: `${pct}%`, background: STATUS_COLOURS[j.status] || '#6b7280' }} />
                </div>
                <span className={styles.statRowCount}>{j.count}</span>
              </div>
            );
          })}
        </div>

        {/* Timesheet hours */}
        <div className={styles.card}>
          <div className={styles.cardHeader} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2>Team Hours</h2>
            <button onClick={exportTimesheet} className={styles.btnSmall}>⬇ CSV</button>
          </div>
          {timesheets.length === 0 ? <div className={styles.emptySmall}>No time logged in this period.</div> : timesheets.map(t => {
            const hours = parseFloat(t.total_hours || 0);
            const maxH = Math.max(...timesheets.map(x => parseFloat(x.total_hours || 0)), 1);
            return (
              <div key={t.id} className={styles.statRow}>
                <span className={styles.statRowLabel}>{t.name}</span>
                <div className={styles.progressWrap}>
                  <div className={styles.progressBar} style={{ width: `${(hours / maxH) * 100}%`, background: '#000' }} />
                </div>
                <span className={styles.statRowCount}>{hours.toFixed(1)}h</span>
              </div>
            );
          })}
        </div>

        {/* Top customers — admin only */}
        {isAdmin && <div className={styles.card} style={{ gridColumn: '1 / -1' }}>
          <div className={styles.cardHeader}><h2>Top 10 Customers by Revenue</h2></div>
          {customers.length === 0 ? <div className={styles.emptySmall}>No invoice data yet.</div> : (
            <div className={styles.custTable}>
              <div className={styles.custHeader}>
                <span>Customer</span><span>Invoices</span><span>Total</span><span>Paid</span><span>Outstanding</span>
              </div>
              {customers.map(c => (
                <Link key={c.id} to={`/customers/${c.id}`} className={styles.custRow}>
                  <span><strong>{c.name}</strong>{c.company ? <span className={styles.muted}> · {c.company}</span> : ''}</span>
                  <span>{c.invoice_count}</span>
                  <span>{fmt(c.total_cents)}</span>
                  <span style={{ color: '#16a34a' }}>{fmt(c.paid_cents)}</span>
                  <span style={{ color: parseInt(c.total_cents) - parseInt(c.paid_cents) > 0 ? '#d97706' : '#64748b' }}>
                    {fmt(parseInt(c.total_cents) - parseInt(c.paid_cents))}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>}
      </div>
    </div>
  );
}
