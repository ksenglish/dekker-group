import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import styles from './Dashboard.module.css';

const STATUS_COLOURS = {
  new: '#1e40af', quoted: '#7c3aed', scheduled: '#0891b2',
  in_progress: '#d97706', invoiced: '#9333ea', complete: '#16a34a', cancelled: '#6b7280',
};

function fmt(cents) {
  return (cents / 100).toLocaleString('en-NZ', { style: 'currency', currency: 'NZD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [recentJobs, setRecentJobs] = useState([]);
  const [upcomingJobs, setUpcomingJobs] = useState([]);
  const [overdueInvoices, setOverdueInvoices] = useState([]);
  const [pendingQuotes, setPendingQuotes] = useState([]);
  const [activity, setActivity] = useState([]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  useEffect(() => {
    Promise.all([
      api.get('/jobs', { params: { limit: 5 } }),
      api.get('/jobs', { params: { status: 'scheduled', limit: 5 } }),
      api.get('/invoices', { params: { status: 'overdue' } }),
      api.get('/quotes', { params: { status: 'sent' } }),
      api.get('/invoices', { params: { status: 'unpaid' } }),
      api.get('/reports/activity').catch(() => ({ data: [] })),
    ]).then(([recent, scheduled, overdue, quotes, unpaid, act]) => {
      setActivity(act.data || []);
      setRecentJobs(recent.data.jobs || []);
      setUpcomingJobs(scheduled.data.jobs || []);
      setOverdueInvoices(overdue.data || []);
      setPendingQuotes(quotes.data || []);
      const overdueTotal = (overdue.data || []).reduce((s, i) => s + (i.total || 0), 0);
      const unpaidTotal = (unpaid.data || []).reduce((s, i) => s + (i.total || 0), 0);
      const quotesTotal = (quotes.data || []).reduce((s, q) => s + (q.total || 0), 0);
      setStats({
        open: recent.data.total,
        scheduled: scheduled.data.total,
        overdueCount: overdue.data?.length ?? 0,
        overdueTotal,
        unpaidTotal,
        quotesCount: quotes.data?.length ?? 0,
        quotesTotal,
      });
    }).catch(() => {});
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.greeting}>{greeting()}, {user?.name?.split(' ')[0]}</h1>
          <p className={styles.date}>
            {new Date().toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      <div className={styles.statsGrid}>
        <Link to="/jobs" className={styles.statCard}>
          <div className={styles.statValue} style={{ color: '#1e40af' }}>{stats?.open ?? '…'}</div>
          <div className={styles.statLabel}>Total Jobs</div>
        </Link>
        <Link to="/jobs?status=scheduled" className={styles.statCard}>
          <div className={styles.statValue} style={{ color: '#0891b2' }}>{stats?.scheduled ?? '…'}</div>
          <div className={styles.statLabel}>Scheduled</div>
        </Link>
        <Link to="/quotes?status=sent" className={styles.statCard}>
          <div className={styles.statValue} style={{ color: '#7c3aed' }}>{stats?.quotesCount ?? '…'}</div>
          <div className={styles.statSub}>{stats ? fmt(stats.quotesTotal) : ''}</div>
          <div className={styles.statLabel}>Pending Quotes</div>
        </Link>
        <Link to="/invoices" className={styles.statCard}>
          <div className={styles.statValue} style={{ color: '#16a34a' }}>{stats ? fmt(stats.unpaidTotal) : '…'}</div>
          <div className={styles.statLabel}>Outstanding (incl. GST)</div>
        </Link>
        {(stats?.overdueCount > 0) && (
          <Link to="/invoices?status=overdue" className={`${styles.statCard} ${styles.statCardAlert}`}>
            <div className={styles.statValue} style={{ color: '#dc2626' }}>{stats.overdueCount}</div>
            <div className={styles.statSub} style={{ color: '#dc2626' }}>{fmt(stats.overdueTotal)}</div>
            <div className={styles.statLabel}>Overdue Invoices</div>
          </Link>
        )}
      </div>

      <div className={styles.dashGrid}>
        {/* Recent jobs */}
        {recentJobs.length > 0 && (
          <div className={styles.recentCard}>
            <div className={styles.recentHeader}>
              <h2>Recent Jobs</h2>
              <Link to="/jobs" className={styles.viewAll}>View all →</Link>
            </div>
            {recentJobs.map(job => (
              <Link key={job.id} to={`/jobs/${job.id}`} className={styles.recentRow}>
                <span className={styles.recentNum}>#{job.job_number}</span>
                <span className={styles.recentCustomer}>{job.customer_name || 'No customer'}</span>
                <span className={styles.recentDesc}>{job.description || job.type}</span>
                <span className={styles.statusBadge} style={{ background: STATUS_COLOURS[job.status] + '18', color: STATUS_COLOURS[job.status] }}>
                  {job.status.replace('_', ' ')}
                </span>
              </Link>
            ))}
          </div>
        )}

        {/* Upcoming scheduled */}
        {upcomingJobs.length > 0 && (
          <div className={styles.recentCard}>
            <div className={styles.recentHeader}>
              <h2>Upcoming Scheduled</h2>
              <Link to="/schedule" className={styles.viewAll}>Schedule →</Link>
            </div>
            {upcomingJobs.map(job => (
              <Link key={job.id} to={`/jobs/${job.id}`} className={styles.recentRow}>
                <span className={styles.recentNum}>#{job.job_number}</span>
                <span className={styles.recentCustomer}>{job.customer_name || 'No customer'}</span>
                <span className={styles.recentDesc}>{job.description || job.type}</span>
                <span className={styles.recentDate}>
                  {job.due_date ? new Date(job.due_date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) : ''}
                </span>
              </Link>
            ))}
          </div>
        )}

        {/* Overdue invoices detail */}
        {overdueInvoices.length > 0 && (
          <div className={styles.recentCard}>
            <div className={styles.recentHeader}>
              <h2>⚠ Overdue Invoices</h2>
              <Link to="/invoices" className={styles.viewAll}>View all →</Link>
            </div>
            {overdueInvoices.slice(0, 5).map(inv => (
              <Link key={inv.id} to={`/invoices/${inv.id}`} className={styles.recentRow}>
                <span className={styles.recentNum}>INV-{inv.id.slice(0,6).toUpperCase()}</span>
                <span className={styles.recentCustomer}>{inv.customer_name}</span>
                <span className={styles.recentDesc}>Due {inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-NZ') : 'N/A'}</span>
                <span style={{ color: '#dc2626', fontWeight: 600, fontSize: 13 }}>{fmt(inv.total)}</span>
              </Link>
            ))}
          </div>
        )}

        {/* Activity feed */}
        {activity.length > 0 && (
          <div className={styles.recentCard}>
            <div className={styles.recentHeader}>
              <h2>Recent Activity</h2>
            </div>
            {activity.map(a => (
              <div key={a.id} className={styles.activityRow}>
                <span className={styles.activityIcon}>
                  {a.type === 'invoice_paid' ? '✓' : a.type === 'quote_accepted' ? '🤝' : a.type === 'quote_sent' || a.type === 'invoice_sent' ? '✉' : '·'}
                </span>
                <span className={styles.activityMsg}>{a.message}</span>
                <span className={styles.activityTime}>{new Date(a.created_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        )}

        {/* Pending quotes */}
        {pendingQuotes.length > 0 && (
          <div className={styles.recentCard}>
            <div className={styles.recentHeader}>
              <h2>Pending Quotes</h2>
              <Link to="/quotes" className={styles.viewAll}>View all →</Link>
            </div>
            {pendingQuotes.slice(0, 5).map(q => (
              <Link key={q.id} to={`/quotes/${q.id}`} className={styles.recentRow}>
                <span className={styles.recentNum}>Q-{q.id.slice(0,6).toUpperCase()}</span>
                <span className={styles.recentCustomer}>{q.customer_name}</span>
                <span className={styles.recentDesc}>{new Date(q.created_at).toLocaleDateString('en-NZ')}</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{fmt(q.total)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
