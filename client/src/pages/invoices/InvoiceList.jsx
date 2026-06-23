import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import styles from '../quotes/Quotes.module.css';

const TABS = [
  { key: 'draft',    label: 'Draft' },
  { key: 'unpaid',   label: 'Unpaid' },
  { key: 'overdue',  label: 'Overdue' },
  { key: 'paid',     label: 'Paid' },
  { key: 'cancelled',label: 'Cancelled' },
  { key: '',         label: 'All' },
];

const STATUS_COLOURS = {
  draft: '#6b7280', sent: '#0891b2', unpaid: '#0891b2',
  paid: '#16a34a', overdue: '#dc2626', cancelled: '#6b7280',
};

function resolvedStatus(inv) {
  if (inv.is_overdue) return 'overdue';
  if (inv.status === 'sent') return 'unpaid';
  return inv.status;
}
function statusLabel(inv) {
  const s = resolvedStatus(inv);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmtInvNum(inv) {
  return inv.invoice_number ? `INV-${String(inv.invoice_number).padStart(4, '0')}` : `INV-${inv.id.slice(0,6).toUpperCase()}`;
}
function deliveryLabel(inv) {
  if (!inv.delivery_status || inv.delivery_status === 'unsent') return 'Unsent';
  return 'Sent';
}

export default function InvoiceList() {
  const [invoices, setInvoices] = useState([]);
  const [allInvoices, setAllInvoices] = useState([]);
  const [activeTab, setActiveTab] = useState('unpaid');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load all once for counts + total due
    api.get('/invoices').then(r => setAllInvoices(r.data));
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get('/invoices', { params: activeTab ? { status: activeTab } : {} })
      .then(r => setInvoices(r.data))
      .finally(() => setLoading(false));
  }, [activeTab]);

  const counts = {
    draft:    allInvoices.filter(i => i.status === 'draft').length,
    unpaid:   allInvoices.filter(i => i.status === 'sent' && !i.is_overdue).length,
    overdue:  allInvoices.filter(i => i.is_overdue).length,
    paid:     allInvoices.filter(i => i.status === 'paid').length,
    cancelled:allInvoices.filter(i => i.status === 'cancelled').length,
    '':       allInvoices.length,
  };

  const totalDue = allInvoices
    .filter(i => i.status !== 'paid' && i.status !== 'draft' && i.status !== 'cancelled')
    .reduce((s, i) => s + (i.total || 0) / 100, 0);

  const filtered = invoices.filter(inv =>
    !search ||
    inv.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
    fmtInvNum(inv).toLowerCase().includes(search.toLowerCase())
  );

  // Compute paid and due per invoice (from totals stored)
  function paidAmount(inv) { return (inv.paid_amount || 0) / 100; }
  function dueAmount(inv) { return Math.max(0, inv.total / 100 - paidAmount(inv)); }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Invoices</h1>
          <p className={styles.pageSubtitle}>{counts[''] || 0} total invoices</p>
        </div>
        {totalDue > 0 && (
          <div className={styles.totalDueBadge}>
            Total Due <strong>${totalDue.toFixed(2)}</strong>
          </div>
        )}
      </div>

      {/* Status tabs */}
      <div className={styles.tabBar}>
        {TABS.map(t => (
          <button key={t.key} className={`${styles.tabBtn} ${activeTab === t.key ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab(t.key)}>
            {t.label}
            {counts[t.key] > 0 && (
              <span className={`${styles.tabCount} ${t.key === 'overdue' ? styles.tabCountDanger : ''}`}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className={styles.toolbar}>
        <input type="search" className={styles.searchInput} placeholder="Search by customer or invoice number…"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? <div className={styles.loading}>Loading…</div> :
       filtered.length === 0 ? <div className={styles.empty}>No invoices found.</div> : (
        <div className={styles.table}>
          <div className={styles.tableHeader} style={{ gridTemplateColumns: '110px 1fr 100px 90px 70px 100px 100px 90px 90px 80px' }}>
            <span>Invoice #</span>
            <span>Customer</span>
            <span>Job</span>
            <span>Status</span>
            <span>Delivery</span>
            <span>Invoice Date</span>
            <span>Due Date</span>
            <span style={{ textAlign: 'right' }}>Total</span>
            <span style={{ textAlign: 'right' }}>Paid</span>
            <span style={{ textAlign: 'right' }}>Due</span>
          </div>
          {filtered.map(inv => {
            const s = resolvedStatus(inv);
            const colour = STATUS_COLOURS[s] || '#6b7280';
            const due = dueAmount(inv);
            return (
              <Link key={inv.id} to={`/invoices/${inv.id}`} className={styles.tableRow}
                style={{ gridTemplateColumns: '110px 1fr 100px 90px 70px 100px 100px 90px 90px 80px' }}>
                <span className={styles.docNum}>{fmtInvNum(inv)}</span>
                <span>{inv.customer_name || '—'}</span>
                <span className={styles.muted}>{inv.job_number ? `#${inv.job_number}` : '—'}</span>
                <span>
                  <span className={styles.badge} style={{ background: colour + '18', color: colour }}>
                    {statusLabel(inv)}
                  </span>
                </span>
                <span className={styles.deliveryCell}>
                  <span className={`${styles.deliveryDot} ${styles['delivery_' + (inv.delivery_status || 'unsent')]}`} />
                  {deliveryLabel(inv)}
                </span>
                <span className={styles.muted}>
                  {new Date(inv.created_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: '2-digit' })}
                </span>
                <span className={inv.is_overdue ? styles.expiredDate : styles.muted}>
                  {inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
                </span>
                <span style={{ textAlign: 'right' }}>${(inv.total / 100).toFixed(2)}</span>
                <span style={{ textAlign: 'right', color: '#16a34a' }}>
                  {paidAmount(inv) > 0 ? `$${paidAmount(inv).toFixed(2)}` : '—'}
                </span>
                <span style={{ textAlign: 'right', fontWeight: due > 0 ? 700 : 400, color: due > 0 ? (inv.is_overdue ? '#dc2626' : '#0f172a') : '#6b7280' }}>
                  {due > 0 ? `$${due.toFixed(2)}` : '—'}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
