import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../lib/api';
import styles from '../quotes/Quotes.module.css';

const STATUSES = ['draft', 'sent', 'paid', 'overdue'];
const STATUS_COLOURS = { draft:'#6b7280', sent:'#0891b2', paid:'#16a34a', overdue:'#dc2626' };

export default function InvoiceDetail() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    api.get(`/invoices/${id}`).then(r => setInvoice(r.data)).finally(() => setLoading(false));
  }, [id]);

  function flash(type, text) { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); }

  async function handleStatus(status) {
    setSaving(true);
    try {
      const { data } = await api.put(`/invoices/${id}`, { status, due_date: invoice.due_date });
      setInvoice(i => ({ ...i, ...data }));
      flash('success', status === 'paid' ? 'Invoice marked as paid — job marked complete!' : `Status updated to ${status}`);
    } catch { flash('error', 'Failed to update'); }
    finally { setSaving(false); }
  }

  async function handleMarkPaid() {
    if (!confirm('Mark this invoice as paid? The job will be marked complete.')) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/invoices/${id}/paid`);
      setInvoice(i => ({ ...i, ...data }));
      flash('success', 'Invoice paid — job marked complete!');
    } catch { flash('error', 'Failed'); }
    finally { setSaving(false); }
  }

  async function handleDownload() {
    const res = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a'); a.href = url; a.download = `invoice-${id.slice(0,8)}.pdf`; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleEmail() {
    setEmailing(true);
    try {
      await api.post(`/invoices/${id}/email`);
      setInvoice(i => ({ ...i, status: 'sent' }));
      flash('success', `Invoice emailed to ${invoice.customer_email}`);
    } catch (err) { flash('error', err.response?.data?.error || 'Email failed'); }
    finally { setEmailing(false); }
  }

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;
  if (!invoice) return <div className={styles.page}><div className={styles.empty}>Invoice not found.</div></div>;

  const items = invoice.line_items || [];

  return (
    <div className={styles.page}>
      {msg && <div className={`${styles.flashMsg} ${styles[msg.type]}`}>{msg.text}</div>}

      <div className={styles.pageHeader}>
        <div className={styles.breadcrumb}>
          <Link to="/invoices">Invoices</Link><span>›</span>
          <span>INV-{id.slice(0,8).toUpperCase()}</span>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={handleDownload}>⬇ Download PDF</button>
          {invoice.customer_email && (
            <button className={styles.btnSecondary} onClick={handleEmail} disabled={emailing}>
              {emailing ? 'Sending…' : '✉ Email to Customer'}
            </button>
          )}
          {invoice.status !== 'paid' && (
            <button className={styles.btnPrimary} onClick={handleMarkPaid} disabled={saving}>✓ Mark as Paid</button>
          )}
        </div>
      </div>

      <div className={styles.detailLayout}>
        <div className={styles.detailMain}>
          <div className={styles.pipeline}>
            {STATUSES.map(s => (
              <button key={s} onClick={() => handleStatus(s)} disabled={saving}
                className={`${styles.pipelineBtn} ${invoice.status === s ? styles.pipelineBtnActive : ''}`}
                style={invoice.status === s ? { borderColor: STATUS_COLOURS[s], color: STATUS_COLOURS[s], background: STATUS_COLOURS[s]+'12' } : {}}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}><h2>Notes</h2></div>
            <div className={styles.notesArea}>
              <textarea rows={3} value={invoice.notes || ''}
                onChange={e => setInvoice(i => ({ ...i, notes: e.target.value }))}
                placeholder="Add notes to appear on the invoice PDF…" />
              <button className={styles.btnSecondary} onClick={async () => {
                await api.put(`/invoices/${id}`, { status: invoice.status, due_date: invoice.due_date, notes: invoice.notes });
                flash('success', 'Notes saved');
              }}>Save Notes</button>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}><h2>Line Items</h2></div>
            <div className={styles.lineHeader}>
              <span>Description</span><span>Qty</span><span>Unit Price</span><span>Line Total</span>
            </div>
            {items.length === 0 && <p className={styles.emptySmall}>No line items.</p>}
            {items.map((item, i) => (
              <div key={item.id} className={`${styles.lineRow} ${i % 2 === 1 ? styles.lineRowAlt : ''}`}>
                <span>{item.description}</span>
                <span>{item.quantity}</span>
                <span>${(item.unit_price/100).toFixed(2)}</span>
                <span>${(item.unit_price * item.quantity / 100).toFixed(2)}</span>
              </div>
            ))}
            <div className={styles.totalsBlock}>
              <div className={styles.totalRow}><span>Subtotal</span><span>${(invoice.subtotal/100).toFixed(2)}</span></div>
              <div className={styles.totalRow}><span>GST (15%)</span><span>${(invoice.gst/100).toFixed(2)}</span></div>
              <div className={`${styles.totalRow} ${styles.totalFinal}`}><span>Total (NZD)</span><span>${(invoice.total/100).toFixed(2)}</span></div>
            </div>
          </div>
        </div>

        <div className={styles.sidebar}>
          <div className={styles.card}>
            <div className={styles.cardHeader}><h2>Summary</h2></div>
            <div className={styles.summaryList}>
              <div className={styles.summaryRow}><span>Invoice #</span><strong>INV-{id.slice(0,8).toUpperCase()}</strong></div>
              <div className={styles.summaryRow}><span>Status</span>
                <span className={styles.badge} style={{ background: STATUS_COLOURS[invoice.status]+'18', color: STATUS_COLOURS[invoice.status] }}>{invoice.status}</span>
              </div>
              {invoice.job_number && <div className={styles.summaryRow}><span>Job</span><Link to={`/jobs/${invoice.job_id}`}>#{invoice.job_number}</Link></div>}
              <div className={styles.summaryRow}><span>Issued</span><strong>{new Date(invoice.created_at).toLocaleDateString('en-NZ')}</strong></div>
              <div className={styles.summaryRow}>
                <span>Due Date</span>
                <input type="date" value={invoice.due_date ? invoice.due_date.slice(0,10) : ''}
                  onChange={e => setInvoice(i => ({ ...i, due_date: e.target.value || null }))}
                  onBlur={async () => { await api.put(`/invoices/${id}`, { status: invoice.status, due_date: invoice.due_date }); }}
                  style={{ fontSize: 12, padding: '3px 6px', border: '1px solid var(--color-border)', borderRadius: 4, fontFamily: 'inherit', outline: 'none' }} />
              </div>
              {invoice.paid_at && <div className={styles.summaryRow}><span>Paid</span><strong>{new Date(invoice.paid_at).toLocaleDateString('en-NZ')}</strong></div>}
              <div className={styles.summaryRow}><span>Total</span><strong className={styles.totalHighlight}>${(invoice.total/100).toFixed(2)}</strong></div>
            </div>
          </div>
          {invoice.customer_name && (
            <div className={styles.card}>
              <div className={styles.cardHeader}><h2>Customer</h2></div>
              <div className={styles.summaryList}>
                <div className={styles.summaryRow}><span>Name</span><strong>{invoice.customer_name}</strong></div>
                {invoice.customer_company && <div className={styles.summaryRow}><span>Company</span><strong>{invoice.customer_company}</strong></div>}
                {invoice.customer_email && <div className={styles.summaryRow}><span>Email</span><a href={`mailto:${invoice.customer_email}`}>{invoice.customer_email}</a></div>}
                {invoice.customer_phone && <div className={styles.summaryRow}><span>Phone</span><strong>{invoice.customer_phone}</strong></div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
