import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { formatJobNumber } from '../../lib/formatJobNumber';
import EmailComposeModal from './EmailComposeModal';
import RichTextEditor from '../../components/RichTextEditor';
import LineItemsEditor from '../jobs/LineItemsEditor';
import SalesPresenter from '../presenter/SalesPresenter';
import styles from './Quotes.module.css';

const STATUSES = ['draft', 'approved', 'sent', 'accepted', 'declined', 'cancelled'];
const STATUS_COLOURS = { draft:'#6b7280', approved:'#7c3aed', sent:'#0891b2', accepted:'#16a34a', declined:'#dc2626', cancelled:'#6b7280' };

function toDateInput(d) { return d ? new Date(d).toISOString().slice(0, 10) : ''; }

const ACTIVITY_LABELS = {
  quote_created: 'Quote created',
  quote_modified: 'Quote modified',
  quote_approved: 'Quote approved',
  quote_sent: 'Quote email sent',
  quote_email_opened: 'Quote email opened',
  quote_viewed: 'Quote viewed',
  quote_accepted: 'Quote accepted',
};
function activityLabel(type) { return ACTIVITY_LABELS[type] || type; }

export default function QuoteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [converting, setConverting] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'success'|'error', text }
  const [notes, setNotes] = useState('');
  const [themes, setThemes] = useState([]);
  const [themeId, setThemeId] = useState('');
  const [quoteDate, setQuoteDate] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [activity, setActivity] = useState([]);
  const [showPresenter, setShowPresenter] = useState(false);
  const [jobAttachments, setJobAttachments] = useState([]);
  const [attachmentIds, setAttachmentIds] = useState([]);
  const [thumbs, setThumbs] = useState({});

  function loadActivity() {
    api.get(`/quotes/${id}/activity`).then(r => setActivity(r.data)).catch(() => {});
  }

  useEffect(() => {
    api.get(`/quotes/${id}`).then(r => {
      setQuote(r.data);
      setNotes(r.data.notes || '');
      setThemeId(r.data.theme_id || '');
      setQuoteDate(toDateInput(r.data.quote_date || r.data.created_at));
      setExpiresAt(toDateInput(r.data.expires_at));
      setAttachmentIds(r.data.attachment_ids || []);
      if (r.data.job_id) {
        api.get(`/jobs/${r.data.job_id}/attachments`)
          .then(a => setJobAttachments(a.data.filter(x => (x.mime_type || '').startsWith('image/'))))
          .catch(() => {});
      }
    }).finally(() => setLoading(false));
    api.get('/settings/themes').then(r => setThemes(r.data.filter(t => !t.archived))).catch(() => {});
    loadActivity();
  }, [id]);

  // Thumbnails come through the authenticated API, so they're fetched as
  // blobs rather than pointed at with a plain <img src>.
  useEffect(() => {
    if (!quote?.job_id || !jobAttachments.length) return;
    let cancelled = false;
    const urls = [];
    (async () => {
      for (const a of jobAttachments) {
        try {
          const res = await api.get(`/jobs/${quote.job_id}/attachments/${a.id}/data`, { responseType: 'blob' });
          if (cancelled) return;
          const url = URL.createObjectURL(res.data);
          urls.push(url);
          setThumbs(t => ({ ...t, [a.id]: url }));
        } catch { /* leave the placeholder in place */ }
      }
    })();
    return () => { cancelled = true; urls.forEach(URL.revokeObjectURL); };
  }, [quote?.job_id, jobAttachments]);

  function flash(type, text) { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); }

  async function handleStatus(status) {
    setSaving(true);
    try {
      const { data } = await api.put(`/quotes/${id}`, { status, notes });
      setQuote(q => ({ ...q, ...data }));
      flash('success', `Quote marked as ${status}`);
      loadActivity();
    } catch { flash('error', 'Failed to update status'); }
    finally { setSaving(false); }
  }

  async function handleApprove() {
    setSaving(true);
    try {
      const { data } = await api.post(`/quotes/${id}/approve`);
      setQuote(q => ({ ...q, ...data }));
      flash('success', 'Quote approved');
      loadActivity();
    } catch (err) { flash('error', err.response?.data?.error || 'Failed to approve quote'); }
    finally { setSaving(false); }
  }

  async function handleSaveDetails() {
    setSavingDetails(true);
    try {
      const { data } = await api.put(`/quotes/${id}`, {
        status: quote.status, notes, theme_id: themeId || null,
        quote_date: quoteDate || null, expires_at: expiresAt || null,
        attachment_ids: attachmentIds,
      });
      setQuote(q => ({ ...q, ...data }));
      flash('success', 'Quote details saved');
      loadActivity();
    } catch { flash('error', 'Failed to save quote details'); }
    finally { setSavingDetails(false); }
  }

  // Products picked in the Sales Presenter get appended to this quote's line
  // items. Prices here are excl. GST dollars — the same units the line-items
  // endpoint expects — so no GST conversion happens on this path.
  async function handlePresenterPick(product) {
    if (!product) { setShowPresenter(false); return; }
    const unitPrice = product.unit_price != null ? product.unit_price / 100
      : product.price_from > 0 ? product.price_from / 100 : 0;
    const payload = [
      ...(quote.line_items || []).map(i => ({
        description: i.description, quantity: i.quantity,
        unit_price: i.unit_price / 100, product_id: i.product_id,
        product_name: i.product_name,
      })),
      {
        // The customer reads the product's description; its name is the
        // supplier code, kept alongside for ordering.
        description: (product.description || '').trim() || product.name,
        quantity: 1,
        unit_price: unitPrice,
        product_id: product.unit_price != null ? product.id : null,
        product_name: product.name,
      },
    ];
    const { data } = await api.put(`/quotes/${id}/line-items`, { items: payload });
    setQuote(q => ({ ...q, line_items: data.line_items, subtotal: data.subtotal, gst: data.gst, total: data.total }));
  }

  async function handleSaveLineItems(lineItems) {
    const { data } = await api.put(`/quotes/${id}/line-items`, { items: lineItems });
    setQuote(q => ({ ...q, line_items: data.line_items, subtotal: data.subtotal, gst: data.gst, total: data.total }));
    flash('success', 'Line items saved');
    loadActivity();
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
    loadActivity();
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
          {quote.status !== 'accepted' && (
            <button className={styles.btnSecondary} onClick={() => setShowPresenter(true)}>
              🎯 Sales Presenter
            </button>
          )}
          <button className={styles.btnSecondary} onClick={handleDownload}>⬇ Download PDF</button>
          {quote.public_token && (
            // ?preview=1 marks this as an internal staff look, so it isn't
            // recorded as a customer view. Copy Link and the emailed link
            // both use the clean URL, so real views still register.
            <button className={styles.btnSecondary} onClick={() => window.open(`${window.location.origin}/q/${quote.public_token}?preview=1`, '_blank')}>
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
          {(user?.role === 'admin' || quote.created_by === user?.id) && (
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

      {showPresenter && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300 }}>
          <SalesPresenter jobId={quote.job_id} onPick={handlePresenterPick} />
        </div>
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

          {/* Quote Details: theme, dates, description */}
          <div className={styles.card}>
            <div className={styles.cardHeader}><h2>Quote Details</h2></div>
            <div className={styles.notesArea}>
              <div className={styles.quoteDetailFields}>
                <div>
                  <label className={styles.fieldLabel}>Document Theme</label>
                  <select value={themeId} onChange={e => setThemeId(e.target.value)}>
                    {themes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={styles.fieldLabel}>Quote Date</label>
                  <input type="date" value={quoteDate} onChange={e => setQuoteDate(e.target.value)} />
                </div>
                <div>
                  <label className={styles.fieldLabel}>Expiry Date</label>
                  <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
                </div>
              </div>

              <label className={styles.fieldLabel}>Description</label>
              <RichTextEditor value={notes} onChange={setNotes} placeholder="Add a description to appear on the quote PDF…" />
            </div>
          </div>

          {/* Drawings & photos — chosen per quote. Nothing is attached unless
              it's ticked here, so pulling a new plan later can't change a
              quote that's already gone out. */}
          {jobAttachments.length > 0 && (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Drawings &amp; Photos</h2>
                <span className={styles.attachCount}>
                  {attachmentIds.length} of {jobAttachments.length} selected
                </span>
              </div>
              <div className={styles.attachGrid}>
                {jobAttachments.map(a => {
                  const picked = attachmentIds.includes(a.id);
                  return (
                    <label key={a.id} className={`${styles.attachItem} ${picked ? styles.attachItemPicked : ''}`}>
                      <input type="checkbox" checked={picked}
                        onChange={() => setAttachmentIds(ids =>
                          ids.includes(a.id) ? ids.filter(x => x !== a.id) : [...ids, a.id])} />
                      {thumbs[a.id]
                        ? <img src={thumbs[a.id]} alt={a.filename} />
                        : <div className={styles.attachPlaceholder}>{a.arcsite_drawing_id ? '📐' : '🖼'}</div>}
                      <span className={styles.attachName}>
                        {a.arcsite_drawing_id ? '📐 ' : '🖼 '}{a.filename}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Line items — this quote's own, independent of the job and of any
              other quote on it. Accepting the quote copies them onto the job. */}
          <div className={styles.card}>
            <div className={styles.cardHeader}><h2>Line Items</h2></div>
            <LineItemsEditor
              items={items}
              onSave={handleSaveLineItems}
              readonly={quote.status === 'accepted'}
            />
            <div className={styles.totalsBlock}>
              <div className={styles.totalRow}><span>Subtotal</span><span>${(quote.subtotal/100).toFixed(2)}</span></div>
              <div className={styles.totalRow}><span>GST (15%)</span><span>${(quote.gst/100).toFixed(2)}</span></div>
              <div className={`${styles.totalRow} ${styles.totalFinal}`}><span>Total (NZD)</span><span>${(quote.total/100).toFixed(2)}</span></div>
            </div>
          </div>

          {/* Activity Log */}
          <div className={styles.card}>
            <div className={styles.cardHeader}><h2>Activity Log</h2></div>
            {activity.length === 0 ? (
              <p className={styles.emptySmall}>No activity yet.</p>
            ) : (
              <div className={styles.activityTable}>
                <div className={styles.activityHeaderRow}>
                  <span>Event</span><span>Date</span><span>User</span>
                </div>
                {activity.map(a => (
                  <div key={a.id} className={styles.activityDataRow}>
                    <span>{activityLabel(a.type)}</span>
                    <span>{new Date(a.created_at).toLocaleString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    <span>{a.user_name || 'Customer'}</span>
                  </div>
                ))}
              </div>
            )}
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

      {/* Pinned action bar — stays put while scrolling a long quote, so Save
          and Approve are always reachable. */}
      <div className={styles.actionBar}>
        <div className={styles.actionBarInner}>
          <span className={styles.actionBarHint}>
            {savingDetails ? 'Saving…' : 'Changes to details, description and attachments save together'}
          </span>
          <div className={styles.actionBarButtons}>
            <button className={styles.btnSecondary} onClick={handleSaveDetails} disabled={savingDetails}>
              {savingDetails ? 'Saving…' : 'Save Quote Details'}
            </button>
            {quote.status === 'draft' && (
              <button className={styles.btnPrimary} onClick={handleApprove} disabled={saving}>
                {saving ? 'Approving…' : '✓ Approve Quote'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
