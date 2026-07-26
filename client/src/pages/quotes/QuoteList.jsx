import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { formatJobNumber } from '../../lib/formatJobNumber';
import styles from './Quotes.module.css';

const TABS = [
  { key: 'draft',               label: 'Draft' },
  { key: 'awaiting_acceptance', label: 'Awaiting Acceptance' },
  { key: 'accepted',            label: 'Accepted' },
  { key: 'declined',            label: 'Declined' },
  { key: 'cancelled',           label: 'Cancelled' },
  { key: '',                    label: 'All' },
];

const STATUS_COLOURS = {
  draft: '#6b7280', approved: '#7c3aed', sent: '#0891b2', accepted: '#16a34a',
  declined: '#dc2626', cancelled: '#6b7280',
};

function statusLabel(q) {
  if (q.is_expired) return 'Expired';
  if (q.status === 'sent') return 'Awaiting Acceptance';
  return q.status.charAt(0).toUpperCase() + q.status.slice(1);
}
function statusColour(q) {
  if (q.is_expired) return '#dc2626';
  return STATUS_COLOURS[q.status] || '#6b7280';
}
function deliveryLabel(q) {
  if (!q.delivery_status || q.delivery_status === 'unsent') return 'Unsent';
  if (q.delivery_status === 'viewed') return 'Viewed';
  if (q.delivery_status === 'opened') return 'Opened';
  return 'Sent';
}
function fmtQuoteNum(q) {
  return q.quote_number ? `QT-${String(q.quote_number).padStart(4, '0')}` : `Q-${q.id.slice(0,6).toUpperCase()}`;
}

export default function QuoteList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [quotes, setQuotes] = useState([]);
  const [activeTab, setActiveTab] = useState('awaiting_acceptance');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  // Admins can remove any quote; everyone else only their own.
  const canDelete = q => user?.role === 'admin' || q.created_by === user?.id;

  async function handleDeleteQuote(q) {
    if (!confirm(`Delete ${fmtQuoteNum(q)}? This cannot be undone.`)) return;
    setDeletingId(q.id);
    try {
      await api.delete(`/quotes/${q.id}`);
      setQuotes(qs => qs.filter(x => x.id !== q.id));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete quote.');
    } finally { setDeletingId(null); }
  }

  useEffect(() => {
    setLoading(true);
    // For awaiting_acceptance tab, fetch 'sent' status from API
    const apiStatus = activeTab === 'awaiting_acceptance' ? 'sent' : activeTab;
    api.get('/quotes', { params: apiStatus ? { status: apiStatus } : {} })
      .then(r => setQuotes(r.data))
      .finally(() => setLoading(false));
  }, [activeTab]);

  // Count all statuses for tab badges — fetch all once
  const [counts, setCounts] = useState({});
  useEffect(() => {
    api.get('/quotes').then(r => {
      const all = r.data;
      setCounts({
        draft: all.filter(q => q.status === 'draft').length,
        awaiting_acceptance: all.filter(q => q.status === 'sent').length,
        accepted: all.filter(q => q.status === 'accepted').length,
        declined: all.filter(q => q.status === 'declined').length,
        cancelled: all.filter(q => q.status === 'cancelled').length,
        '': all.length,
      });
    });
  }, []);

  const filtered = quotes.filter(q =>
    !search ||
    q.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
    fmtQuoteNum(q).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Quotes</h1>
          <p className={styles.pageSubtitle}>{counts[''] || 0} total quotes</p>
        </div>
      </div>

      {/* Status tabs */}
      <div className={styles.tabBar}>
        {TABS.map(t => (
          <button key={t.key} className={`${styles.tabBtn} ${activeTab === t.key ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab(t.key)}>
            {t.label}
            {counts[t.key] > 0 && <span className={styles.tabCount}>{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      <div className={styles.toolbar}>
        <input type="search" className={styles.searchInput} placeholder="Search by customer or quote number…"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? <div className={styles.loading}>Loading…</div> :
       filtered.length === 0 ? <div className={styles.empty}>No quotes found.</div> : (
        <div className={styles.table}>
          <div className={styles.tableHeader} style={{ gridTemplateColumns: '110px 1fr 120px 100px 80px 110px 100px 36px' }}>
            <span>Quote #</span>
            <span>Customer</span>
            <span>Job</span>
            <span>Status</span>
            <span>Delivery</span>
            <span>Expiry</span>
            <span style={{ textAlign: 'right' }}>Total</span>
            <span />
          </div>
          {filtered.map(q => (
            <Link key={q.id} to={`/quotes/${q.id}`} className={styles.tableRow}
              style={{ gridTemplateColumns: '110px 1fr 120px 100px 80px 110px 100px 36px' }}>
              <span className={styles.docNum}>{fmtQuoteNum(q)}</span>
              <span>{q.customer_name || '—'}</span>
              <span className={styles.muted}>{q.job_number ? formatJobNumber(q) : '—'}</span>
              <span>
                <span className={styles.badge} style={{ background: statusColour(q) + '18', color: statusColour(q) }}>
                  {statusLabel(q)}
                </span>
              </span>
              <span className={styles.deliveryCell}>
                <span className={`${styles.deliveryDot} ${styles['delivery_' + (q.delivery_status || 'unsent')]}`} />
                {deliveryLabel(q)}
              </span>
              <span className={q.expires_at && new Date(q.expires_at) < new Date() ? styles.expiredDate : styles.muted}>
                {q.expires_at ? new Date(q.expires_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) : '—'}
              </span>
              <span className={styles.totalCol}>${(q.total / 100).toFixed(2)}</span>
              <span style={{ textAlign: 'right' }}>
                {canDelete(q) && (
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); handleDeleteQuote(q); }}
                    disabled={deletingId === q.id}
                    title={`Delete ${fmtQuoteNum(q)}`}
                    style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}>
                    ✕
                  </button>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
