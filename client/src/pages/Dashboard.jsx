import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import styles from './Dashboard.module.css';

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [recentJobs, setRecentJobs] = useState([]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  useEffect(() => {
    Promise.all([
      api.get('/jobs', { params: { status: 'new', limit: 1 } }),
      api.get('/jobs', { params: { status: 'scheduled', limit: 1 } }),
      api.get('/quotes', { params: { status: 'sent' } }),
      api.get('/invoices', { params: { status: 'overdue' } }),
      api.get('/jobs', { params: { limit: 5 } }),
    ]).then(([open, scheduled, quotes, overdueInv, recent]) => {
      setStats({
        open: open.data.total,
        scheduled: scheduled.data.total,
        pendingQuotes: quotes.data.length,
        overdueInvoices: overdueInv.data.length,
      });
      setRecentJobs(recent.data.jobs);
    }).catch(() => {});
  }, []);

  const STATUS_COLOURS = {
    new: '#1e40af', quoted: '#7c3aed', scheduled: '#0891b2',
    in_progress: '#d97706', invoiced: '#9333ea', complete: '#16a34a', cancelled: '#6b7280',
  };

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
        <Link to="/jobs?status=new" className={styles.statCard}>
          <div className={styles.statValue} style={{ color: '#1e40af' }}>{stats?.open ?? '…'}</div>
          <div className={styles.statLabel}>Open Jobs</div>
        </Link>
        <Link to="/jobs?status=scheduled" className={styles.statCard}>
          <div className={styles.statValue} style={{ color: '#0891b2' }}>{stats?.scheduled ?? '…'}</div>
          <div className={styles.statLabel}>Scheduled Jobs</div>
        </Link>
        <Link to="/quotes?status=sent" className={styles.statCard}>
          <div className={styles.statValue} style={{ color: '#d97706' }}>{stats?.pendingQuotes ?? '…'}</div>
          <div className={styles.statLabel}>Pending Quotes</div>
        </Link>
        <Link to="/invoices?status=overdue" className={styles.statCard}>
          <div className={styles.statValue} style={{ color: '#dc2626' }}>{stats?.overdueInvoices ?? '…'}</div>
          <div className={styles.statLabel}>Overdue Invoices</div>
        </Link>
      </div>

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
              <span className={styles.recentDate}>
                {job.due_date ? new Date(job.due_date).toLocaleDateString('en-NZ') : ''}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
