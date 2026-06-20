import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import styles from '../quotes/Quotes.module.css';

const STATUS_COLOURS = { draft:'#6b7280', sent:'#0891b2', paid:'#16a34a', overdue:'#dc2626' };

export default function InvoiceList() {
  const [invoices, setInvoices] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/invoices', { params: filterStatus ? { status: filterStatus } : {} })
      .then(r => setInvoices(r.data))
      .finally(() => setLoading(false));
  }, [filterStatus]);

  const totals = {
    draft: invoices.filter(i => i.status === 'draft').length,
    sent: invoices.filter(i => i.status === 'sent').length,
    paid: invoices.filter(i => i.status === 'paid').length,
    overdue: invoices.filter(i => i.status === 'overdue').length,
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Invoices</h1>
          <p className={styles.pageSubtitle}>{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

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
        invoices.length === 0 ? <div className={styles.empty}>No invoices yet. Convert an accepted quote to create one.</div> : (
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span>Invoice #</span><span>Job</span><span>Customer</span>
            <span>Status</span><span>Subtotal</span><span>GST</span><span>Total</span><span>Due Date</span>
          </div>
          {invoices.map(inv => (
            <Link key={inv.id} to={`/invoices/${inv.id}`} className={styles.tableRow}>
              <span className={styles.docNum}>INV-{inv.id.slice(0,8).toUpperCase()}</span>
              <span>{inv.job_number ? `#${inv.job_number}` : '—'}</span>
              <span>{inv.customer_name || '—'}</span>
              <span>
                <span className={styles.badge} style={{ background: STATUS_COLOURS[inv.status]+'18', color: STATUS_COLOURS[inv.status] }}>{inv.status}</span>
                {inv.is_overdue && <span className={styles.badge} style={{ background: '#fee2e2', color: '#dc2626', marginLeft: 4 }}>overdue</span>}
              </span>
              <span>${(inv.subtotal/100).toFixed(2)}</span>
              <span>${(inv.gst/100).toFixed(2)}</span>
              <span className={styles.totalCol}>${(inv.total/100).toFixed(2)}</span>
              <span>{inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-NZ') : '—'}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
