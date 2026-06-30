import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
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

  // Date range for job/timesheet reports
  const now = new Date();
  const thisYearStart = `${now.getFullYear()}-01-01`;
  const [from, setFrom] = useState(thisYearStart);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    const calls = [api.get('/reports/revenue')];
    if (isAdmin) calls.push(api.get('/reports/customers'));
    Promise.all(calls).then(([r, c]) => {
      setRevenue(r.data);
      if (c) setCustomers(c.data);
    });
  }, [isAdmin]);

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
