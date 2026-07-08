import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { formatJobNumber } from '../../lib/formatJobNumber';
import EmailComposeModal from './EmailComposeModal';
import styles from './Quotes.module.css';

const STATUSES = ['draft', 'sent', 'accepted', 'declined', 'cancelled'];
const STATUS_COLOURS = { draft:'#6b7280', sent:'#0891b2', accepted:'#16a34a', declined:'#dc2626', cancelled:'#6b7280' };

export default function QuoteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [converting, setConverting] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'success'|'error', text }
  const [notes, setNotes] = useState('');

  useEffect(() => {
    api.get(`/quotes/${id}`).then(r => { setQuote(r.data); setNotes(r.data.notes || ''); }).finally(() => setLoading(false));
  }, [id]);

  function flash(type, text) { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); }

  async function handleStatus(status) {
    setSaving(true);
    try {
      const { data } = await api.put(`/quotes/${id}`, { status, notes });
      setQuote(q => ({ ...q, ...data }));
      flash('success', `Quote marked as ${status}`);
    } catch { flash('error', 'Failed to update status'); }
    finally { setSaving(false); }
  }

  async function handleSaveNotes() {
    const { data } = await api.put(`/quotes/${id}`, { status: quote.status, notes });
    setQuote(q => ({ ...q, notes: data.notes }));
    flash('success', 'Notes saved');
  }

  async function handleDownload() {
    const res = await api.get(`/quotes/${id}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a'); a.href = url; a.download = `quote-${id.slice(0,8)}.pdf`; a.click();
    URL.revokeObjectURL(url);
  }

  function handleEmailSent(customerEmail) {
    setShowEmailModal(false);
    setQuote(q => ({ ...q, status: 'sent' }));
    flash('success', `Quote emailed to ${customerEmail}`);
  }

  async function handleDelete() {
    if (!confirm('Delete this quote? This cannot be undone.')) return;
    try {
      await api.delete(`/quotes/${id}`);
      navigate('/quotes');
    } catch (err) {
      flash('error', err.response?.data?.error || 'Failed to delete quote.');
    }
  }

  async function handleConvert() {
    if (!confirm('Convert this accepted quote to an invoice?')) return;
    setConverting(true);
    try {
      const { data } = await api.post(`/quotes/${id}/convert`);
      flash('success', 'Invoice created');
      setTimeout(() => navigate(`/invoices/${data.id}`), 1200);
    } catch (err) { flash('error', err.response?.data?.error || 'Conversion failed'); }
    finally { setConverting(false); }
  }

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;
  if (!quote) return <div className={styles.page}><div className={styles.empty}>Quote not found.</div></div>;

  const items = quote.line_items || [];

  return (
    <div className={styles.page}>
      {msg && <div className={`${styles.flashMsg} ${styles[msg.type]}`}>{msg.text}</div>}

      <div className={styles.pageHeader}>
        <div className={styles.breadcrumb}>
          <Link to="/quotes">Quotes</Link><span>›</span>
          <span>{quote?.quote_number ? `QT-${String(quote.quote_number).padStart(4,'0')}` : `Q-${id.slice(0,8).toUpperCase()}`}</span>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={() => navigate(quote.job_id ? `/jobs/${quote.job_id}` : '/quotes')}>
            ← Back{quote.job_id ? ' to Job' : ''}
          </button>
          {quote.job_id && (
            <button className={styles.btnSecondary} onClick={() => navigate(`/jobs/${quote.job_id}?tab=line_items`)}>
              ✎ Edit
            </button>
          )}
          <button className={styles.btnSecondary} onClick={handleDownload}>⬇ Download PDF</button>
          {quote.public_token && (
            <button className={styles.btnSecondary} onClick={() => window.open(`${window.location.origin}/q/${quote.public_token}`, '_blank')}>
              👁 Preview
            </button>
          )}
          {quote.public_token && (
            <button className={styles.btnSecondary} onClick={() => {
              const url = `${window.location.origin}/q/${quote.public_token}`;
              navigator.clipboard.writeText(url).then(() => flash('success', 'Acceptance link copied to clipboard'));
            }}>🔗 Copy Link</button>
          )}
          {quote.customer_email && (
            <button className={styles.btnSecondary} onClick={() => setShowEmailModal(true)}>
              ✉ Email to Customer
            </button>
          )}
          {quote.status === 'accepted' && (
            <button className={styles.btnPrimary} onClick={handleConvert} disabled={converting}>
              {converting ? 'Converting…' : '→ Convert to Invoice'}
            </button>
          )}
          {user?.role === 'admin' && (
            <button className={styles.btnDanger} onClick={handleDelete}>Delete</button>
          )}
        </div>
      </div>

      {showEmailModal && (
        <EmailComposeModal
          quoteId={id}
          jobId={quote.job_id}
          customerEmail={quote.customer_email}
          onClose={() => setShowEmailModal(false)}
          onSent={handleEmailSent}
        />
      )}

      <div className={styles.detailLayout}>
        <div className={styles.detailMain}>
          {/* Status pipeline */}
          <div className={styles.pipeline}>
            {STATUSES.map(s => (
              <button key={s} onClick={() => handleStatus(s)} disabled={saving}
                className={`${styles.pipelineBtn} ${quote.status === s ? styles.pipelineBtnActive : ''}`}
                style={quote.status === s ? { borderColor: STATUS_COLOURS[s], color: STATUS_COLOURS[s], background: STATUS_COLOURS[s]+'12' } : {}}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {/* Line items */}
          <div className={styles.card}>
            <div className={styles.cardHeader}><h2>Line Items</h2></div>
            <div className={styles.lineHeader}>
              <span>Description</span><span>Qty</span><span>Unit Price</span><span>Line Total</span>
            </div>
            {items.length === 0 && <p className={styles.emptySmall}>No line items. Add them on the job first.</p>}
            {items.map((item, i) => (
              <div key={item.id} className={`${styles.lineRow} ${i % 2 === 1 ? styles.lineRowAlt : ''}`}>
                <span>{item.description}</span>
                <span>{item.quantity}</span>
                <span>${(item.unit_price/100).toFixed(2)}</span>
                <span>${(item.unit_price * item.quantity / 100).toFixed(2)}</span>
              </div>
            ))}
            <div className={styles.totalsBlock}>
              <div className={styles.totalRow}><span>Subtotal</span><span>${(quote.subtotal/100).toFixed(2)}</span></div>
              <div className={styles.totalRow}><span>GST (15%)</span><span>${(quote.gst/100).toFixed(2)}</span></div>
              <div className={`${styles.totalRow} ${styles.totalFinal}`}><span>Total (NZD)</span><span>${(quote.total/100).toFixed(2)}</span></div>
            </div>
          </div>

          {/* Notes */}
          <div className={styles.card}>
            <div className={styles.cardHeader}><h2>Notes</h2></div>
            <div className={styles.notesArea}>
              <textarea rows={4} value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Add notes to appear on the quote PDF…" />
              <button className={styles.btnSecondary} onClick={handleSaveNotes}>Save Notes</button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className={styles.sidebar}>
          <div className={styles.card}>
            <div className={styles.cardHeader}><h2>Summary</h2></div>
            <div className={styles.summaryList}>
              <div className={styles.summaryRow}><span>Quote #</span><strong>{quote?.quote_number ? `QT-${String(quote.quote_number).padStart(4,'0')}` : `Q-${id.slice(0,8).toUpperCase()}`}</strong></div>
              <div className={styles.summaryRow}><span>Status</span>
                <span className={styles.badge} style={{ background: STATUS_COLOURS[quote.status]+'18', color: STATUS_COLOURS[quote.status] }}>{quote.status}</span>
              </div>
              {quote.job_number && <div className={styles.summaryRow}><span>Job</span><Link to={`/jobs/${quote.job_id}`}>{formatJobNumber(quote)}</Link></div>}
              <div className={styles.summaryRow}><span>Created</span><strong>{new Date(quote.created_at).toLocaleDateString('en-NZ')}</strong></div>
              {quote.sent_at && <div className={styles.summaryRow}><span>Sent</span><strong>{new Date(quote.sent_at).toLocaleDateString('en-NZ')}</strong></div>}
              {quote.expires_at && (
                <div className={styles.summaryRow}>
                  <span>Expires</span>
                  <strong style={{ color: new Date(quote.expires_at) < new Date() ? '#dc2626' : 'inherit' }}>
                    {new Date(quote.expires_at).toLocaleDateString('en-NZ')}
                    {new Date(quote.expires_at) < new Date() && ' (expired)'}
                  </strong>
                </div>
              )}
              {quote.accepted_at && <div className={styles.summaryRow}><span>Accepted by</span><strong>{quote.accepted_name} · {new Date(quote.accepted_at).toLocaleDateString('en-NZ')}</strong></div>}
              <div className={styles.summaryRow}><span>Total</span><strong className={styles.totalHighlight}>${(quote.total/100).toFixed(2)}</strong></div>
            </div>
          </div>
          {quote.customer_name && (
            <div className={styles.card}>
              <div className={styles.cardHeader}><h2>Customer</h2></div>
              <div className={styles.summaryList}>
                <div className={styles.summaryRow}><span>Name</span><strong>{quote.customer_name}</strong></div>
                {quote.customer_company && <div className={styles.summaryRow}><span>Company</span><strong>{quote.customer_company}</strong></div>}
                {quote.customer_email && <div className={styles.summaryRow}><span>Email</span><a href={`mailto:${quote.customer_email}`}>{quote.customer_email}</a></div>}
                {quote.customer_phone && <div className={styles.summaryRow}><span>Phone</span><strong>{quote.customer_phone}</strong></div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
