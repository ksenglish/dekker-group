import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useUnsavedChanges } from '../../context/UnsavedChangesContext';
import { formatJobNumber } from '../../lib/formatJobNumber';
import EmailComposeModal from './EmailComposeModal';
import AttachJobModal from './AttachJobModal';
import RichTextEditor from '../../components/RichTextEditor';
import { appendDescription } from '../../lib/richText';
import PriceListBrowser from '../../components/products/PriceListBrowser';
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
  quote_reset_to_draft: 'Quote reset to draft',
};
function activityLabel(type) { return ACTIVITY_LABELS[type] || type; }

// Opens and views are recorded with no logged-in user, since nobody is signed
// in when a customer reads a quote. The address responsible is written into the
// message ("Quote email opened by someone@example.com"), so pull it back out
// for the User column rather than labelling everything "Customer".
function whoFromMessage(a) {
  const m = /\b(?:opened|viewed) by (\S+@\S+)$/i.exec(a?.message || '');
  return m ? m[1] : null;
}

export default function QuoteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { setGuard } = useUnsavedChanges();
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showAttachJob, setShowAttachJob] = useState(false);
  const [converting, setConverting] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'success'|'error', text }
  const [notes, setNotes] = useState('');
  const [themes, setThemes] = useState([]);
  const [themeId, setThemeId] = useState('');
  const [quoteDate, setQuoteDate] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [activity, setActivity] = useState([]);
  const [showPresenter, setShowPresenter] = useState(false);
  const [showPriceList, setShowPriceList] = useState(false);
  const [jobAttachments, setJobAttachments] = useState([]);
  const [attachmentIds, setAttachmentIds] = useState([]);
  const [thumbs, setThumbs] = useState({});
  const [detailsSavedAt, setDetailsSavedAt] = useState(null);
  const [lineItemsDirty, setLineItemsDirty] = useState(false);

  // Details, description, theme, dates and attachments all save together, so
  // one snapshot of the lot decides whether anything is outstanding.
  const detailsSnapshot = JSON.stringify({
    notes, themeId, quoteDate, expiresAt, attachmentIds: [...attachmentIds].sort(),
  });
  // null until the quote has loaded, so the first render can't look "unsaved".
  const savedDetailsRef = useRef(null);
  const hasUnsavedDetails = savedDetailsRef.current !== null
    && savedDetailsRef.current !== detailsSnapshot;

  // Once a quote is approved it may be in front of the customer, so the editor
  // is read-only until someone deliberately resets it to draft.
  const isLocked = ['approved', 'sent', 'accepted'].includes(quote?.status);

  // Anything outstanding anywhere on the page — the details block or the line
  // items, which save separately but should warn as one.
  const hasUnsavedWork = hasUnsavedDetails || lineItemsDirty;

  // Every in-page control that leaves the quote goes through here, so none of
  // them can walk off with unsaved work. Returns false if the user backs out.
  function leaveGuard() {
    if (!hasUnsavedWork) return true;
    return confirm('This quote has unsaved changes. Leave without saving?');
  }
  function guardedNavigate(to) {
    if (leaveGuard()) navigate(to);
  }

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
      // Baseline for "has anything changed" — set from what was just loaded,
      // so arriving on the page never counts as an edit.
      savedDetailsRef.current = JSON.stringify({
        notes: r.data.notes || '',
        themeId: r.data.theme_id || '',
        quoteDate: toDateInput(r.data.quote_date || r.data.created_at),
        expiresAt: toDateInput(r.data.expires_at),
        attachmentIds: [...(r.data.attachment_ids || [])].sort(),
      });
    }).finally(() => setLoading(false));
    api.get('/settings/themes').then(r => setThemes(r.data.filter(t => !t.archived))).catch(() => {});
    loadActivity();
  }, [id]);

  // Editing is explicit now — no autosave. Two guards catch an unsaved exit:
  // beforeunload for closing or reloading the tab, and the shared unsaved-work
  // guard for navigating elsewhere inside the app.
  useEffect(() => {
    if (!hasUnsavedWork) return;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedWork]);

  useEffect(() => {
    setGuard(hasUnsavedWork
      ? () => confirm('This quote has unsaved changes. Leave without saving?')
      : null);
    return () => setGuard(null);
  }, [hasUnsavedWork, setGuard]);

  // Keyed on the job rather than loaded alongside the quote, so a quote that
  // only gets its job later picks up that job's drawings straight away.
  useEffect(() => {
    if (!quote?.job_id) { setJobAttachments([]); return; }
    api.get(`/jobs/${quote.job_id}/attachments`)
      .then(a => setJobAttachments(a.data.filter(x => (x.mime_type || '').startsWith('image/'))))
      .catch(() => {});
  }, [quote?.job_id]);

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

  // notesOverride is for the add-product path, which sets notes and saves in
  // the same tick — React state hasn't flushed by then, so the new wording has
  // to be passed in rather than read back out of state.
  async function handleSaveDetails({ silent = false, notesOverride } = {}) {
    const notesToSave = notesOverride !== undefined ? notesOverride : notes;
    setSavingDetails(true);
    try {
      const snapshot = JSON.stringify({
        notes: notesToSave, themeId, quoteDate, expiresAt, attachmentIds: [...attachmentIds].sort(),
      });
      const { data } = await api.put(`/quotes/${id}`, {
        status: quote.status, notes: notesToSave, theme_id: themeId || null,
        quote_date: quoteDate || null, expires_at: expiresAt || null,
        attachment_ids: attachmentIds,
      });
      setQuote(q => ({ ...q, ...data }));
      // Records what was actually sent, not the values as they stand now — the
      // user may have typed more while the request was in flight, and that
      // should still count as unsaved.
      savedDetailsRef.current = snapshot;
      setDetailsSavedAt(Date.now());
      if (!silent) flash('success', 'Quote details saved');
      loadActivity();
    } catch { flash('error', 'Failed to save quote details'); }
    finally { setSavingDetails(false); }
  }

  // Products picked in the Sales Presenter get appended to this quote's line
  // items. Prices here are excl. GST dollars — the same units the line-items
  // endpoint expects — so no GST conversion happens on this path.
  async function handlePresenterPick(product) {
    if (!product) { setShowPresenter(false); return; }
    // The payload below is built from the saved line items, so typing in a row
    // and then adding a product would quietly drop what was typed. Autosave
    // used to close that window; now it has to be said out loud.
    if (lineItemsDirty) {
      setShowPresenter(false);
      setShowPriceList(false);
      flash('error', 'Save the line items first — otherwise adding a product would discard the row you were editing.');
      return;
    }
    const unitPrice = product.unit_price != null ? product.unit_price / 100
      : product.price_from > 0 ? product.price_from / 100 : 0;
    const payload = [
      ...(quote.line_items || []).map(i => ({
        description: i.description, quantity: i.quantity,
        unit_price: i.unit_price / 100, product_id: i.product_id,
        product_name: i.product_name,
      })),
      {
        // Two different descriptions on a price list product: `description` is
        // the line on the quote, `quote_description` is the wording that goes
        // in the box above the lines. A presenter product's own description is
        // rich text and would print its tags here, so those keep using the name.
        description: (product.unit_price != null && product.description) || product.name,
        // Measured products (the fence calculator) hand back their own
        // quantity — metres of run — rather than a single unit.
        quantity: product.quantity > 0 ? product.quantity : 1,
        unit_price: unitPrice,
        product_id: product.unit_price != null ? product.id : null,
        product_name: product.name,
      },
    ];
    const { data } = await api.put(`/quotes/${id}/line-items`, { items: payload });
    setQuote(q => ({ ...q, line_items: data.line_items, subtotal: data.subtotal, gst: data.gst, total: data.total }));

    // The product's own wording goes onto the quote's description, one line
    // break below whatever is already there. Saved straight away rather than
    // left sitting in the box — the line items have already been written, and
    // a rep who adds three products and closes the tab shouldn't lose the
    // wording that went with them.
    // The presenter attaches the wording from the product it was showing; a
    // pick straight from the price list brings its own Quote Description. The
    // presenter's wins when it has one, since that's the curated sales copy.
    const wording = product.presenter_description || product.quote_description
    const addition = (wording || '').trim();
    // Adding a product is the one path that still saves the details block for
    // you — the line items have already been written, so leaving the wording
    // (and anything else typed) unsaved beside them would be the worst of both.
    const combined = addition ? appendDescription(notes, addition) : notes;
    if (addition) setNotes(combined);
    try {
      await handleSaveDetails({ silent: true, notesOverride: combined });
    } catch {
      flash('error', 'Product added, but the quote details could not be saved — press Save Quote Details.');
    }
  }

  async function handleResetToDraft() {
    if (!confirm(
      `This quote is ${quote.status} and may already be with the customer. `
      + 'Reset it to draft so it can be edited again?'
    )) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/quotes/${id}/reset-to-draft`);
      setQuote(q => ({ ...q, ...data }));
      flash('success', 'Quote reset to draft — it can be edited again');
      loadActivity();
    } catch (err) {
      flash('error', err.response?.data?.error || 'Failed to reset this quote');
    } finally { setSaving(false); }
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

  function handleJobAttached(updated) {
    setShowAttachJob(false);
    setQuote(q => ({ ...q, ...updated }));
    flash('success', `Quote linked to job ${formatJobNumber(updated)}`);
    loadActivity();
  }

  async function handleUnattachJob() {
    if (!confirm('Unattach this quote from its job? The quote and the job both stay — they just stop being linked.')) return;
    setSaving(true);
    try {
      const { data } = await api.delete(`/quotes/${id}/job`);
      setQuote(q => ({ ...q, ...data, job_id: null, job_number: null, external_ref: null }));
      flash('success', 'Quote unattached from its job');
      loadActivity();
    } catch (err) {
      flash('error', err.response?.data?.error || 'Failed to unattach this quote');
    } finally { setSaving(false); }
  }

  async function handleCopyQuote() {
    if (!leaveGuard()) return;
    if (!confirm('Make a copy of this quote? The copy opens as a new draft.')) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/quotes/${id}/copy`);
      flash('success', 'Quote copied');
      navigate(`/quotes/${data.id}`);
    } catch (err) {
      flash('error', err.response?.data?.error || 'Failed to copy this quote');
      setSaving(false);
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
          <Link to="/quotes" onClick={e => { if (!leaveGuard()) e.preventDefault(); }}>Quotes</Link><span>›</span>
          <span>{quote?.quote_number ? `QT-${String(quote.quote_number).padStart(4,'0')}` : `Q-${id.slice(0,8).toUpperCase()}`}</span>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={() => guardedNavigate(quote.job_id ? `/jobs/${quote.job_id}` : '/quotes')}>
            ← Back{quote.job_id ? ' to Job' : ''}
          </button>
          {isLocked && (
            <button className={styles.btnSecondary} onClick={handleResetToDraft} disabled={saving}>
              ↩ Reset to Draft
            </button>
          )}
          {!isLocked && (
            <button className={styles.btnSecondary} onClick={() => setShowPresenter(true)}>
              🎯 Sales Presenter
            </button>
          )}
          {!isLocked && (
            <button className={styles.btnSecondary} onClick={() => setShowPriceList(true)}>
              🏷 Price List
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
          {/* Copying isn't destructive, so it isn't tied to who may delete */}
          <button className={styles.btnSecondary} onClick={handleCopyQuote} disabled={saving}>⧉ Copy Quote</button>
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

      {showAttachJob && (
        <AttachJobModal
          quote={quote}
          onClose={() => setShowAttachJob(false)}
          onAttached={handleJobAttached}
        />
      )}

      {showPresenter && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300 }}>
          <SalesPresenter jobId={quote.job_id} onPick={handlePresenterPick} />
        </div>
      )}

      {showPriceList && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 300, background: 'var(--color-bg, #fff)',
          display: 'flex', flexDirection: 'column',
        }}>
          <PriceListBrowser
            title="Add from Price List"
            onPick={handlePresenterPick}
            onClose={() => setShowPriceList(false)}
          />
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
              readonly={isLocked}
              autoSave={false}
              onDirtyChange={setLineItemsDirty}
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
                    {/* Opens and views have no logged-in user — the address
                        that did it is carried in the message instead. */}
                    <span title={a.message || ''}>{a.user_name || whoFromMessage(a) || 'Customer'}</span>
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
              {quote.job_id
                ? (
                  <div className={styles.summaryRow}>
                    <span>Job</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Link to={`/jobs/${quote.job_id}`}>{formatJobNumber(quote) || 'View job'}</Link>
                      {/* An accepted quote's scope now lives on the job, so
                          unpicking the link would orphan it — the server
                          refuses, and there's no point offering it here. */}
                      {quote.status !== 'accepted' && (
                        <button onClick={handleUnattachJob} disabled={saving} title="Unattach this quote from its job"
                          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 12 }}>
                          Unattach
                        </button>
                      )}
                    </span>
                  </div>
                )
                : (
                  // Raised before any job existed. It stays that way until the
                  // work is won — then it gets a job number, either from a new
                  // job or from one that already covers this work.
                  <div className={styles.summaryRow}>
                    <span>Job</span>
                    <button onClick={() => setShowAttachJob(true)}
                      style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                      + Add a job
                    </button>
                  </div>
                )}
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
          <span className={styles.actionBarHint} style={hasUnsavedDetails ? { color: '#b45309', fontWeight: 600 } : undefined}>
            {isLocked ? `This quote is ${quote.status} — reset it to draft to make changes`
              : savingDetails ? 'Saving…'
              : hasUnsavedDetails ? '● Unsaved changes'
              : detailsSavedAt ? `Saved ${new Date(detailsSavedAt).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })}`
              : 'All changes saved'}
          </span>
          <div className={styles.actionBarButtons}>
            {!isLocked && (
              <button className={hasUnsavedDetails ? styles.btnPrimary : styles.btnSecondary}
                onClick={() => handleSaveDetails()} disabled={savingDetails || !hasUnsavedDetails}>
                {savingDetails ? 'Saving…' : hasUnsavedDetails ? 'Save Changes' : 'Saved'}
              </button>
            )}
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
