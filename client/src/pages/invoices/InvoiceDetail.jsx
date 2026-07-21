import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../lib/api';
import { formatJobNumber } from '../../lib/formatJobNumber';
import { toLocalDateStr } from '../../lib/date';
import styles from '../quotes/Quotes.module.css';

const STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];
const STATUS_COLOURS = { draft:'#6b7280', sent:'#0891b2', paid:'#16a34a', overdue:'#dc2626', cancelled:'#6b7280' };

export default function InvoiceDetail() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [msg, setMsg] = useState(null);
  const [payments, setPayments] = useState([]);
  const [payForm, setPayForm] = useState({ amount: '', method: 'bank_transfer', reference: '', paid_at: toLocalDateStr() });
  const [addingPayment, setAddingPayment] = useState(false);
  const [showPayForm, setShowPayForm] = useState(false);
  const [pushingXero, setPushingXero] = useState(false);

  useEffect(() => {
    api.get(`/invoices/${id}`).then(r => setInvoice(r.data)).finally(() => setLoading(false));
    api.get(`/invoices/${id}/payments`).then(r => setPayments(r.data)).catch(() => {});
  }, [id]);

  async function addPayment(e) {
    e.preventDefault();
    setAddingPayment(true);
    try {
      const { data } = await api.post(`/invoices/${id}/payments`, payForm);
      setPayments(p => [data, ...p]);
      setPayForm({ amount: '', method: 'bank_transfer', reference: '', paid_at: toLocalDateStr() });
      setShowPayForm(false);
      // Refresh invoice to get updated status
      api.get(`/invoices/${id}`).then(r => setInvoice(r.data));
      flash('success', 'Payment recorded');
    } catch (e) { flash('error', e.response?.data?.error || 'Failed'); }
    finally { setAddingPayment(false); }
  }

  async function deletePayment(payId) {
    await api.delete(`/invoices/${id}/payments/${payId}`);
    setPayments(p => p.filter(x => x.id !== payId));
  }

  const totalPaid = payments.reduce((s, p) => s + parseInt(p.amount || 0), 0);

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

  async function handlePushToXero() {
    setPushingXero(true);
    try {
      const { data } = await api.post(`/invoices/${id}/push-to-xero`);
      setInvoice(i => ({ ...i, ...data }));
      flash('success', `Pushed to Xero as ${data.xero_invoice_number || 'a draft invoice'}`);
    } catch (err) { flash('error', err.response?.data?.error || 'Failed to push to Xero'); }
    finally { setPushingXero(false); }
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
          <span>{invoice?.invoice_number ? `INV-${String(invoice.invoice_number).padStart(4,'0')}` : `INV-${id.slice(0,8).toUpperCase()}`}</span>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={handleDownload}>⬇ Download PDF</button>
          {invoice.customer_email && (
            <button className={styles.btnSecondary} onClick={handleEmail} disabled={emailing}>
              {emailing ? 'Sending…' : '✉ Email to Customer'}
            </button>
          )}
          <button className={styles.btnSecondary} onClick={handlePushToXero} disabled={pushingXero}>
            {pushingXero ? 'Pushing…' : invoice.xero_invoice_id ? '🔄 Re-push to Xero' : '💳 Push to Xero'}
          </button>
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

          {/* Payments */}
          <div className={styles.card}>
            <div className={styles.cardHeader} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2>Payments {totalPaid > 0 && `— ${((invoice.total - totalPaid) / 100).toFixed(2)} remaining`}</h2>
              {invoice.status !== 'paid' && (
                <button className={styles.btnSmall} onClick={() => setShowPayForm(f => !f)}>+ Record Payment</button>
              )}
            </div>
            {showPayForm && (
              <form onSubmit={addPayment} style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 3 }}>Amount ($)</div>
                  <input type="number" step="0.01" min="0" value={payForm.amount} onChange={e => setPayForm(f => ({...f, amount: e.target.value}))}
                    placeholder={`${(invoice.total - totalPaid) / 100}`} required style={{ width: 100, padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: 'inherit' }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 3 }}>Method</div>
                  <select value={payForm.method} onChange={e => setPayForm(f => ({...f, method: e.target.value}))}
                    style={{ padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 13 }}>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cash">Cash</option>
                    <option value="credit_card">Credit Card</option>
                    <option value="cheque">Cheque</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 3 }}>Reference</div>
                  <input value={payForm.reference} onChange={e => setPayForm(f => ({...f, reference: e.target.value}))}
                    placeholder="e.g. bank ref" style={{ padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: 'inherit' }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 3 }}>Date</div>
                  <input type="date" value={payForm.paid_at} onChange={e => setPayForm(f => ({...f, paid_at: e.target.value}))}
                    style={{ padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: 'inherit' }} />
                </div>
                <button type="submit" disabled={addingPayment} className={styles.btnPrimary} style={{ height: 34 }}>
                  {addingPayment ? '…' : 'Save'}
                </button>
                <button type="button" className={styles.btnSecondary} style={{ height: 34 }} onClick={() => setShowPayForm(false)}>Cancel</button>
              </form>
            )}
            {payments.length === 0 && !showPayForm ? (
              <div className={styles.emptySmall}>No payments recorded yet.</div>
            ) : payments.map(p => (
              <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '90px 110px 1fr 100px 28px', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--color-border)', fontSize: 13, alignItems: 'center' }}>
                <strong style={{ color: '#16a34a' }}>${(parseInt(p.amount) / 100).toFixed(2)}</strong>
                <span style={{ textTransform: 'capitalize' }}>{p.method?.replace('_', ' ')}</span>
                <span style={{ color: 'var(--color-text-muted)' }}>{p.reference || '—'}</span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{new Date(p.paid_at).toLocaleDateString('en-NZ')}</span>
                <button onClick={() => deletePayment(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 14 }}>✕</button>
              </div>
            ))}
            {totalPaid > 0 && (
              <div style={{ padding: '10px 16px', fontSize: 13, display: 'flex', justifyContent: 'space-between', background: '#f8fafc', borderTop: '2px solid var(--color-border)' }}>
                <span>Total Paid</span>
                <strong style={{ color: '#16a34a' }}>${(totalPaid / 100).toFixed(2)} of ${(invoice.total / 100).toFixed(2)}</strong>
              </div>
            )}
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
              <div className={styles.summaryRow}><span>Invoice #</span><strong>{invoice?.invoice_number ? `INV-${String(invoice.invoice_number).padStart(4,'0')}` : `INV-${id.slice(0,8).toUpperCase()}`}</strong></div>
              <div className={styles.summaryRow}><span>Status</span>
                <span className={styles.badge} style={{ background: STATUS_COLOURS[invoice.status]+'18', color: STATUS_COLOURS[invoice.status] }}>{invoice.status}</span>
              </div>
              {invoice.job_number && <div className={styles.summaryRow}><span>Job</span><Link to={`/jobs/${invoice.job_id}`}>{formatJobNumber(invoice)}</Link></div>}
              <div className={styles.summaryRow}><span>Issued</span><strong>{new Date(invoice.created_at).toLocaleDateString('en-NZ')}</strong></div>
              <div className={styles.summaryRow}>
                <span>Due Date</span>
                <input type="date" value={invoice.due_date ? invoice.due_date.slice(0,10) : ''}
                  onChange={e => setInvoice(i => ({ ...i, due_date: e.target.value || null }))}
                  onBlur={async () => { await api.put(`/invoices/${id}`, { status: invoice.status, due_date: invoice.due_date }); }}
                  style={{ fontSize: 12, padding: '3px 6px', border: '1px solid var(--color-border)', borderRadius: 4, fontFamily: 'inherit', outline: 'none' }} />
              </div>
              {invoice.paid_at && <div className={styles.summaryRow}><span>Paid</span><strong>{new Date(invoice.paid_at).toLocaleDateString('en-NZ')}</strong></div>}
              {invoice.xero_synced_at && (
                <div className={styles.summaryRow}>
                  <span>Xero</span>
                  <strong style={{ color: '#16a34a' }}>✓ Synced {new Date(invoice.xero_synced_at).toLocaleDateString('en-NZ')}</strong>
                </div>
              )}
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
