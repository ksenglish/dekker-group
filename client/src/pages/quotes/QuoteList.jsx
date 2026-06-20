import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import styles from './Quotes.module.css';

const STATUS_COLOURS = { draft:'#6b7280', sent:'#0891b2', accepted:'#16a34a', declined:'#dc2626' };

export default function QuoteList() {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/quotes', { params: filterStatus ? { status: filterStatus } : {} })
      .then(r => setQuotes(r.data))
      .finally(() => setLoading(false));
  }, [filterStatus]);

  const totals = {
    draft: quotes.filter(q => q.status === 'draft').length,
    sent: quotes.filter(q => q.status === 'sent').length,
    accepted: quotes.filter(q => q.status === 'accepted').length,
    declined: quotes.filter(q => q.status === 'declined').length,
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Quotes</h1>
          <p className={styles.pageSubtitle}>{quotes.length} quote{quotes.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className={styles.toolbar || ''} style={{ marginBottom: 16 }}>
        <input type="search" placeholder="Search by customer or quote number…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 14, width: '100%', maxWidth: 400, outline: 'none', fontFamily: 'inherit' }} />
      </div>

      {/* Summary cards */}
      <div className={styles.summaryGrid}>
        {Object.entries(totals).map(([s, count]) => (
          <button key={s} className={`${styles.summaryCard} ${filterStatus === s ? styles.summaryCardActive : ''}`}
            onClick={() => setFilterStatus(f => f === s ? '' : s)}>
            <span className={styles.summaryCount} style={{ color: STATUS_COLOURS[s] }}>{count}</span>
            <span className={styles.summaryLabel} style={{ textTransform: 'capitalize' }}>{s}</span>
          </button>
        ))}
      </div>

      {loading ? <div className={styles.loading}>Loading…</div> :
        quotes.length === 0 ? <div className={styles.empty}>No quotes yet. Create one from a job's detail page.</div> : (
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span>Quote #</span><span>Job</span><span>Customer</span>
            <span>Status</span><span>Subtotal</span><span>GST</span><span>Total</span><span>Created</span>
          </div>
          {quotes.filter(q => !search || q.customer_name?.toLowerCase().includes(search.toLowerCase()) || q.id.includes(search.toLowerCase())).map(q => (
            <Link key={q.id} to={`/quotes/${q.id}`} className={styles.tableRow}>
              <span className={styles.docNum}>Q-{q.id.slice(0,8).toUpperCase()}</span>
              <span>{q.job_number ? `#${q.job_number}` : '—'}</span>
              <span>{q.customer_name || '—'}</span>
              <span><span className={styles.badge} style={{ background: STATUS_COLOURS[q.status]+'18', color: STATUS_COLOURS[q.status] }}>{q.status}</span></span>
              <span>${(q.subtotal/100).toFixed(2)}</span>
              <span>${(q.gst/100).toFixed(2)}</span>
              <span className={styles.totalCol}>${(q.total/100).toFixed(2)}</span>
              <span>{new Date(q.created_at).toLocaleDateString('en-NZ')}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
