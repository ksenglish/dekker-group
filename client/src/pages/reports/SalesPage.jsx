import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { isAdmin as isAdminRole } from '../../lib/permissions';
import { toLocalDateStr } from '../../lib/date';
import styles from './Reports.module.css';

function fmt(cents) {
  return (cents / 100).toLocaleString('en-NZ', {
    style: 'currency', currency: 'NZD', minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}

const PERIODS = [
  { value: 'day',   label: 'Today' },
  { value: 'week',  label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'all',   label: 'All time' },
  { value: 'range', label: 'Date range' },
];

// Per-team-member diary and site-visit commission, with the Buyer Created
// Invoice. Lifted out of the main Reports page so sales sits on its own.
export default function SalesPage() {
  const { user } = useAuth();
  const isAdmin = isAdminRole(user?.role);

  const thisYearStart = `${new Date().getFullYear()}-01-01`;
  const prefsKey = user ? `sales_filters_${user.id}` : null;
  let savedPrefs = {};
  try { savedPrefs = prefsKey ? JSON.parse(localStorage.getItem(prefsKey) || '{}') : {}; } catch { savedPrefs = {}; }

  const [period, setPeriod] = useState(savedPrefs.period || 'month');
  const [from, setFrom] = useState(savedPrefs.from || thisYearStart);
  const [to, setTo] = useState(savedPrefs.to || toLocalDateStr());
  const [team, setTeam] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [reportUserId, setReportUserId] = useState(savedPrefs.reportUserId || user?.id || '');
  const [userJobs, setUserJobs] = useState(null);
  const [loading, setLoading] = useState(false);
  const [bciBusy, setBciBusy] = useState('');   // 'preview' | 'send' | ''
  const [bciFlash, setBciFlash] = useState('');

  useEffect(() => {
    if (!prefsKey) return;
    try { localStorage.setItem(prefsKey, JSON.stringify({ period, from, to, reportUserId })); } catch { /* quota/private mode */ }
  }, [prefsKey, period, from, to, reportUserId]);

  // The quick periods resolve to real dates here, so the server stays a plain
  // from/to filter. 'range' hands over to the two date inputs.
  const window_ = (() => {
    if (period === 'range') return { from, to };
    if (period === 'all') return { from: null, to: null };
    const now = new Date();
    const end = toLocalDateStr(now);
    if (period === 'day') return { from: end, to: end };
    const start = new Date(now);
    start.setDate(start.getDate() - (period === 'week' ? 6 : 29));
    return { from: toLocalDateStr(start), to: end };
  })();

  useEffect(() => {
    const params = {};
    if (window_.from) params.from = window_.from;
    if (window_.to) params.to = window_.to;
    api.get('/reports/sales', { params }).then(r => setTeam(r.data)).catch(() => setTeam(null));
  }, [period, window_.from, window_.to]);

  useEffect(() => { if (user?.id && !reportUserId) setReportUserId(user.id); }, [user?.id, reportUserId]);

  useEffect(() => {
    api.get('/users').then(r => setTeamMembers(r.data.filter(u => u.is_active !== false))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!reportUserId) return;
    setLoading(true);
    // This endpoint requires both bounds, so "All time" gets a floor rather
    // than sending nothing and getting a 400.
    const params = {
      from: window_.from || '2000-01-01',
      to: window_.to || toLocalDateStr(),
      user_id: reportUserId,
    };
    api.get('/reports/user-jobs', { params })
      .then(r => setUserJobs(r.data))
      .catch(() => setUserJobs(null))
      .finally(() => setLoading(false));
  }, [window_.from, window_.to, reportUserId]);

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

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <Link to="/reports" className={styles.backLink}>← Reports</Link>
          <h1 className={styles.pageTitle}>Sales</h1>
          <p className={styles.pageSubtitle}>Team member diary and site-visit commission</p>
        </div>
      </div>

      <div className={styles.dateRange}>
        <label>Period:</label>
        <div className={styles.periodToggle}>
          {PERIODS.map(p => (
            <button key={p.value}
              className={`${styles.periodBtn} ${period === p.value ? styles.periodBtnActive : ''}`}
              onClick={() => setPeriod(p.value)}>
              {p.label}
            </button>
          ))}
        </div>
        {period === 'range' && (
          <>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={styles.dateInput} />
            <span>to</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className={styles.dateInput} />
          </>
        )}
      </div>

      {/* Team performance across the whole sales diary for the period. */}
      <div className={styles.card} style={{ marginBottom: 20 }}>
        <div className={styles.cardHeader}><h2>Sales Team Performance</h2></div>

        <div className={styles.statsRow} style={{ margin: 0, padding: 20, borderBottom: '1px solid var(--color-border)' }}>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Sales Appointments</div>
            <div className={styles.statValue}>{team?.totals?.appointments ?? 0}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Converted to Sale</div>
            <div className={styles.statValue} style={{ color: '#16a34a' }}>{team?.totals?.won ?? 0}</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Conversion Rate</div>
            <div className={styles.statValue}>
              {team?.totals?.conversion_rate == null ? '—' : `${Math.round(team.totals.conversion_rate * 100)}%`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
              Sale or beyond vs Awaiting Quote + Quoted
            </div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Awaiting Quote Now</div>
            <div className={styles.statValue} style={{ color: '#d97706' }}>{team?.totals?.awaiting_now ?? 0}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
              Current backlog, all dates
            </div>
          </div>
        </div>

        {!team ? <div className={styles.emptySmall}>Loading…</div> :
         team.users.length === 0 ? <div className={styles.emptySmall}>No sales appointments in this period.</div> : (
          <>
            <div className={styles.salesHeader}>
              <span>Team Member</span>
              <span style={{ textAlign: 'center' }}>Booked in Diary</span>
              <span style={{ textAlign: 'center' }}>Awaiting Quote</span>
              <span style={{ textAlign: 'center' }}>Quoted</span>
              <span style={{ textAlign: 'center' }}>Sale +</span>
              <span>Conversion</span>
            </div>
            {team.users.map(u => (
              <div key={u.user_id} className={styles.salesRow}>
                <span className={styles.truncate} style={{ fontWeight: 600 }}>{u.name}</span>
                <span style={{ textAlign: 'center' }}>
                  {u.appointments}
                  {u.jobs !== u.appointments && (
                    <span className={styles.muted}> · {u.jobs} job{u.jobs === 1 ? '' : 's'}</span>
                  )}
                </span>
                <span style={{ textAlign: 'center', color: '#d97706', fontWeight: 600 }}>
                  {u.awaiting_quote}
                  {u.awaiting_now !== u.awaiting_quote && (
                    <span className={styles.muted} title="Current backlog across all dates"> ({u.awaiting_now} now)</span>
                  )}
                </span>
                <span style={{ textAlign: 'center' }}>{u.quoted}</span>
                <span style={{ textAlign: 'center', color: '#16a34a', fontWeight: 600 }}>{u.won}</span>
                <span className={styles.convCell}>
                  {u.conversion_rate == null ? (
                    <span className={styles.muted}>No decisions yet</span>
                  ) : (
                    <>
                      <span className={styles.convBar}>
                        <span className={styles.convFill} style={{ width: `${Math.round(u.conversion_rate * 100)}%` }} />
                      </span>
                      <strong>{Math.round(u.conversion_rate * 100)}%</strong>
                    </>
                  )}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

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

        {loading ? <div className={styles.emptySmall}>Loading…</div> :
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
    </div>
  );
}
