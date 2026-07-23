import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

const API = '/api';

function fmt(cents) {
  return (cents / 100).toLocaleString('en-NZ', { style: 'currency', currency: 'NZD' });
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

function jobNumberDisplay(quote) {
  if (quote.job_external_ref) return quote.job_external_ref;
  if (quote.job_number != null) return 'JB' + String(quote.job_number).padStart(5, '0');
  return '';
}

export default function PublicQuote() {
  const { token } = useParams();
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get(`${API}/quotes/public/${token}`)
      .then(r => setQuote(r.data))
      .catch(() => setError('Quote not found or has expired.'))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleAccept(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setAccepting(true); setError('');
    try {
      await axios.post(`${API}/quotes/public/${token}/accept`, { name });
      setAccepted(true);
      setQuote(q => ({ ...q, status: 'accepted' }));
    } catch (e) {
      setError(e.response?.data?.error || 'Something went wrong. Please try again.');
    } finally { setAccepting(false); }
  }

  if (loading) return <div style={s.center}><p>Loading quote…</p></div>;
  if (error && !quote) return <div style={s.center}><p style={{ color: '#dc2626' }}>{error}</p></div>;

  const alreadyAccepted = quote.status === 'accepted';
  const isExpired = quote.is_expired;
  const hasThumb = quote.line_items?.some(i => i.media_base64);
  const jobNumber = jobNumberDisplay(quote);
  const brochures = (() => {
    const seen = new Set();
    return (quote.line_items || []).filter(i => {
      if (!i.brochure_base64) return false;
      const key = i.brochure_base64.slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  })();

  return (
    <div style={s.page}>
      <div style={s.container}>

        {/* Header */}
        {(() => {
          const logoSize = { small: 36, medium: 52, large: 72 }[quote.company?.logoSize || 'medium'] || 52;
          const logoOnLeft    = (quote.company?.logoPosition    || 'left')  === 'left';
          const contactOnLeft = (quote.company?.contactPosition || 'right') === 'left';
          const companyBlock = (
            <div style={{ ...s.companyBlock, order: logoOnLeft ? 1 : 2 }}>
              {quote.company?.logo
                ? <img src={quote.company.logo} alt="Logo" style={{ ...s.logo, height: logoSize, maxWidth: logoSize * 2.8 }} />
                : <div style={s.companyName}>{quote.company?.name}</div>
              }
            </div>
          );
          const contactBlock = (
            <div style={{ textAlign: contactOnLeft ? 'left' : 'right', order: contactOnLeft ? 1 : 2 }}>
              {quote.company?.email && <div style={s.companyContact}>{quote.company.email}</div>}
              {quote.company?.phone && <div style={s.companyContact}>{quote.company.phone}</div>}
            </div>
          );
          return (
            <div style={s.header}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', flexWrap: 'wrap', gap: 16 }}>
                {companyBlock}
                {contactBlock}
              </div>
            </div>
          );
        })()}

        {/* Title row — quote name + number, its own row above Bill To, matching the PDF */}
        <div style={s.titleRow}>
          <div style={s.quoteTitle}>Quote</div>
          <div style={s.quoteNumber}>{quote.number}</div>
        </div>

        {/* Bill To / Job Details / Quote Details */}
        <div style={s.detailGrid}>
          <div>
            <div style={s.label}>Bill To</div>
            <div style={s.customerName}>{quote.customer_name}</div>
            {quote.customer_company && <div style={s.customerDetail}>{quote.customer_company}</div>}
            {quote.customer_address && <div style={s.customerDetail}>{quote.customer_address}</div>}
            {quote.customer_email && <div style={s.customerDetail}>{quote.customer_email}</div>}
            {quote.customer_phone && <div style={s.customerDetail}>{quote.customer_phone}</div>}
          </div>
          <div>
            <div style={s.label}>Job Details</div>
            {jobNumber && (
              <div style={s.detailField}>
                <div style={s.detailFieldLabel}>Job Number</div>
                <div style={s.detailFieldValue}>{jobNumber}</div>
              </div>
            )}
            {quote.job_address && (
              <div style={s.detailField}>
                <div style={s.detailFieldLabel}>Job Address</div>
                <div style={s.detailFieldValue}>{quote.job_address}</div>
              </div>
            )}
          </div>
          <div>
            <div style={s.label}>Quote Details</div>
            <div style={s.detailField}>
              <div style={s.detailFieldLabel}>Issue Date</div>
              <div style={s.detailFieldValue}>{fmtDate(quote.created_at)}</div>
            </div>
            {quote.expires_at && (
              <div style={s.detailField}>
                <div style={s.detailFieldLabel}>Expiry Date</div>
                <div style={{ ...s.detailFieldValue, color: quote.is_expired ? '#dc2626' : undefined }}>{fmtDate(quote.expires_at)}</div>
              </div>
            )}
            {quote.company?.gstNumber && (
              <div style={s.detailField}>
                <div style={s.detailFieldLabel}>GST Number</div>
                <div style={s.detailFieldValue}>{quote.company.gstNumber}</div>
              </div>
            )}
          </div>
        </div>

        {/* Notes — above the line items */}
        {quote.notes && (
          <div style={s.notes}>
            <div style={s.label}>Notes</div>
            <p style={{ fontSize: 14, whiteSpace: 'pre-wrap', margin: 0 }}>{quote.notes}</p>
          </div>
        )}

        {/* Line items */}
        <table style={s.table}>
          <thead>
            <tr style={s.tableHead}>
              {hasThumb && <th style={s.th} />}
              <th style={{ ...s.th, textAlign: 'left', paddingLeft: 16 }}>Description</th>
              <th style={{ ...s.th, textAlign: 'right' }}>Qty</th>
              <th style={{ ...s.th, textAlign: 'right' }}>Unit Price</th>
              <th style={{ ...s.th, textAlign: 'right', paddingRight: 16 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {quote.line_items?.map((item, i) => (
              <tr key={i} style={i % 2 === 0 ? s.rowEven : s.rowOdd}>
                {hasThumb && (
                  <td style={{ ...s.td, width: 52, paddingLeft: 12 }}>
                    {item.media_base64
                      ? <img src={item.media_base64} alt="" style={s.thumb} />
                      : <div style={s.thumbEmpty} />}
                  </td>
                )}
                <td style={{ ...s.td, paddingLeft: 16 }}>{item.description}</td>
                <td style={{ ...s.td, textAlign: 'right' }}>{item.quantity}</td>
                <td style={{ ...s.td, textAlign: 'right' }}>{fmt(item.unit_price)}</td>
                <td style={{ ...s.td, textAlign: 'right', paddingRight: 16 }}>{fmt(item.unit_price * item.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={s.totals}>
          <div style={s.totalRow}><span>Subtotal (excl. GST)</span><span>{fmt(quote.subtotal)}</span></div>
          <div style={s.totalRow}><span>GST (15%)</span><span>{fmt(quote.gst)}</span></div>
          <div style={{ ...s.totalRow, ...s.totalFinal }}><span>Total (incl. GST)</span><span>{fmt(quote.total)}</span></div>
        </div>

        {/* Proposal (job drawing pulled from ArcSite) */}
        {quote.arcsite_drawings?.length > 0 && (
          <div style={s.brochureSection}>
            <div style={s.label}>Proposal</div>
            {quote.arcsite_drawings.map((src, i) => (
              <div key={i} style={s.brochureBlock}>
                <img src={src} alt="Proposal drawing" style={s.proposalImg} />
              </div>
            ))}
          </div>
        )}

        {/* Terms & Conditions — below the drawing */}
        {quote.terms && (
          <div style={s.notes}>
            <div style={s.label}>Terms & Conditions</div>
            <p style={{ fontSize: 13, color: '#0f172a', whiteSpace: 'pre-wrap', margin: 0 }}>{quote.terms}</p>
          </div>
        )}

        {/* Accept section */}
        <div style={s.acceptSection}>
          {isExpired && !alreadyAccepted ? (
            <div style={{ ...s.acceptedBanner, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>
              ✕ This quote expired on {fmtDate(quote.expires_at)}. Please contact us for an updated quote.
            </div>
          ) : alreadyAccepted ? (
            <div style={s.acceptedBanner}>
              ✓ This quote was accepted{quote.accepted_name ? ` by ${quote.accepted_name}` : ''}
              {quote.accepted_at ? ` on ${fmtDate(quote.accepted_at)}` : ''}.
            </div>
          ) : accepted ? (
            <div style={s.acceptedBanner}>
              ✓ Thank you, {name}! Your acceptance has been recorded. We'll be in touch shortly.
            </div>
          ) : (
            <form onSubmit={handleAccept} style={s.acceptForm}>
              <div style={s.acceptTitle}>Accept this quote</div>
              <p style={s.acceptHint}>By entering your name and clicking Accept, you agree to proceed with the work described above.</p>
              {error && <p style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
              <div style={s.acceptRow}>
                <input value={name} onChange={e => setName(e.target.value)}
                  placeholder="Your full name" required style={s.acceptInput} />
                <button type="submit" disabled={accepting || !name.trim()} style={s.acceptBtn}>
                  {accepting ? 'Accepting…' : 'Accept Quote'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Product Brochures */}
        {brochures.length > 0 && (
          <div style={s.brochureSection}>
            <div style={s.label}>Product Information</div>
            {brochures.map((item, i) => (
              <div key={i} style={s.brochureBlock}>
                <div style={s.brochureTitle}>{item.description}</div>
                {item.brochure_base64.startsWith('data:application/pdf') ? (
                  <iframe
                    src={item.brochure_base64}
                    style={s.brochurePdf}
                    title={item.description}
                  />
                ) : (
                  <img src={item.brochure_base64} alt={item.description} style={s.brochureImg} />
                )}
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

const s = {
  page: { minHeight: '100vh', background: '#f8fafc', display: 'flex', justifyContent: 'center', padding: '32px 16px', fontFamily: 'system-ui, -apple-system, sans-serif' },
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' },
  container: { background: 'white', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', width: '100%', maxWidth: 760, overflow: 'hidden' },
  header: { background: 'white', color: '#0f172a', padding: '24px 32px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  companyBlock: {},
  logo: { height: 52, maxWidth: 180, objectFit: 'contain', marginBottom: 8, display: 'block' },
  companyName: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  companyContact: { fontSize: 12, color: '#0f172a', marginTop: 2 },
  titleRow: { padding: '4px 32px 20px', display: 'flex', alignItems: 'baseline', gap: 10, borderBottom: '2px solid #e2e8f0' },
  quoteTitle: { fontSize: 22, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase' },
  quoteNumber: { fontSize: 14, fontWeight: 700, color: '#0f172a' },
  detailGrid: { padding: '20px 32px', borderBottom: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 },
  label: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0f172a', marginBottom: 8 },
  customerName: { fontSize: 15, fontWeight: 700 },
  customerDetail: { fontSize: 12, color: '#0f172a', marginTop: 3 },
  detailField: { marginBottom: 8 },
  detailFieldLabel: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#0f172a' },
  detailFieldValue: { fontSize: 12, color: '#0f172a', marginTop: 2 },
  table: { width: '100%', borderCollapse: 'collapse' },
  tableHead: { background: '#f8fafc' },
  th: { padding: '10px 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#0f172a', borderBottom: '1px solid #e2e8f0', borderTop: '1px solid #e2e8f0' },
  td: { padding: '12px 8px', fontSize: 13, verticalAlign: 'middle', color: '#0f172a' },
  rowEven: { background: 'white' },
  rowOdd: { background: '#fafafa' },
  thumb: { width: 40, height: 40, objectFit: 'contain', borderRadius: 4, display: 'block' },
  thumbEmpty: { width: 40, height: 40 },
  totals: { padding: '16px 32px', borderTop: '2px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 6 },
  totalRow: { display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#0f172a', fontWeight: 700 },
  totalFinal: { fontSize: 16, fontWeight: 700, color: '#0f172a', borderTop: '1px solid #e2e8f0', paddingTop: 8, marginTop: 4 },
  notes: { padding: '16px 32px', borderTop: '1px solid #e2e8f0', color: '#0f172a' },
  acceptSection: { padding: '24px 32px', borderTop: '2px solid #e2e8f0', background: '#fafafa' },
  acceptedBanner: { background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', padding: '14px 20px', borderRadius: 6, fontSize: 14 },
  acceptForm: {},
  acceptTitle: { fontSize: 16, fontWeight: 700, marginBottom: 8 },
  acceptHint: { fontSize: 13, color: '#0f172a', margin: '0 0 12px' },
  acceptRow: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  acceptInput: { flex: 1, minWidth: 200, padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14, fontFamily: 'inherit', outline: 'none' },
  acceptBtn: { padding: '10px 20px', background: '#0f172a', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  brochureSection: { padding: '24px 32px', borderTop: '2px solid #e2e8f0' },
  brochureBlock: { marginTop: 20 },
  brochureTitle: { fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 10 },
  brochurePdf: { width: '100%', height: 800, border: 'none', borderRadius: 6 },
  proposalImg: { width: '90%', margin: '0 auto', borderRadius: 6, display: 'block' },
  brochureImg: { width: '100%', borderRadius: 6, display: 'block' },
};
