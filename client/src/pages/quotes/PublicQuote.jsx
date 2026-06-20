import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

function fmt(cents) {
  return (cents / 100).toLocaleString('en-NZ', { style: 'currency', currency: 'NZD' });
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

  if (loading) return <div style={styles.center}><p>Loading quote…</p></div>;
  if (error && !quote) return <div style={styles.center}><p style={{ color: '#dc2626' }}>{error}</p></div>;

  const alreadyAccepted = quote.status === 'accepted';

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.companyBlock}>
            <div style={styles.companyName}>{quote.company?.name}</div>
            {quote.company?.email && <div style={styles.companyContact}>{quote.company.email}</div>}
            {quote.company?.phone && <div style={styles.companyContact}>{quote.company.phone}</div>}
          </div>
          <div style={styles.quoteRef}>
            <div style={styles.quoteNumber}>{quote.number}</div>
            <div style={styles.quoteDate}>{new Date(quote.created_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          </div>
        </div>

        {/* Customer */}
        <div style={styles.customerBlock}>
          <div style={styles.label}>Prepared for</div>
          <div style={styles.customerName}>{quote.customer_name}</div>
          {quote.customer_company && <div style={styles.customerDetail}>{quote.customer_company}</div>}
          {quote.customer_phone && <div style={styles.customerDetail}>{quote.customer_phone}</div>}
        </div>

        {/* Line items */}
        <table style={styles.table}>
          <thead>
            <tr style={styles.tableHead}>
              <th style={{ ...styles.th, textAlign: 'left', paddingLeft: 16 }}>Description</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Qty</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Unit Price</th>
              <th style={{ ...styles.th, textAlign: 'right', paddingRight: 16 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {quote.line_items?.map((item, i) => (
              <tr key={i} style={i % 2 === 0 ? styles.rowEven : styles.rowOdd}>
                <td style={{ ...styles.td, paddingLeft: 16 }}>{item.description}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{item.quantity}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(item.unit_price)}</td>
                <td style={{ ...styles.td, textAlign: 'right', paddingRight: 16 }}>{fmt(item.unit_price * item.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={styles.totals}>
          <div style={styles.totalRow}><span>Subtotal (excl. GST)</span><span>{fmt(quote.subtotal)}</span></div>
          <div style={styles.totalRow}><span>GST (15%)</span><span>{fmt(quote.gst)}</span></div>
          <div style={{ ...styles.totalRow, ...styles.totalFinal }}><span>Total (incl. GST)</span><span>{fmt(quote.total)}</span></div>
        </div>

        {/* Notes */}
        {quote.notes && (
          <div style={styles.notes}>
            <div style={styles.label}>Notes</div>
            <p style={{ fontSize: 14, whiteSpace: 'pre-wrap', margin: 0 }}>{quote.notes}</p>
          </div>
        )}

        {/* Accept section */}
        <div style={styles.acceptSection}>
          {alreadyAccepted ? (
            <div style={styles.acceptedBanner}>
              ✓ This quote was accepted{quote.accepted_name ? ` by ${quote.accepted_name}` : ''}
              {quote.accepted_at ? ` on ${new Date(quote.accepted_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}.
            </div>
          ) : accepted ? (
            <div style={styles.acceptedBanner}>
              ✓ Thank you, {name}! Your acceptance has been recorded. We'll be in touch shortly.
            </div>
          ) : (
            <form onSubmit={handleAccept} style={styles.acceptForm}>
              <div style={styles.acceptTitle}>Accept this quote</div>
              <p style={styles.acceptHint}>By entering your name and clicking Accept, you agree to proceed with the work described above.</p>
              {error && <p style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
              <div style={styles.acceptRow}>
                <input
                  value={name} onChange={e => setName(e.target.value)}
                  placeholder="Your full name"
                  required
                  style={styles.acceptInput}
                />
                <button type="submit" disabled={accepting || !name.trim()} style={styles.acceptBtn}>
                  {accepting ? 'Accepting…' : 'Accept Quote'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#f8fafc', display: 'flex', justifyContent: 'center', padding: '32px 16px', fontFamily: 'system-ui, -apple-system, sans-serif' },
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' },
  container: { background: 'white', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', width: '100%', maxWidth: 700, overflow: 'hidden' },
  header: { background: '#000', color: 'white', padding: '24px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  companyBlock: {},
  companyName: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  companyContact: { fontSize: 12, opacity: 0.8 },
  quoteRef: { textAlign: 'right' },
  quoteNumber: { fontSize: 18, fontWeight: 700 },
  quoteDate: { fontSize: 12, opacity: 0.8, marginTop: 4 },
  customerBlock: { padding: '20px 32px', borderBottom: '1px solid #e2e8f0' },
  label: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', marginBottom: 6 },
  customerName: { fontSize: 16, fontWeight: 600 },
  customerDetail: { fontSize: 13, color: '#64748b', marginTop: 2 },
  table: { width: '100%', borderCollapse: 'collapse' },
  tableHead: { background: '#f8fafc' },
  th: { padding: '10px 8px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', borderBottom: '1px solid #e2e8f0', borderTop: '1px solid #e2e8f0' },
  td: { padding: '12px 8px', fontSize: 13, verticalAlign: 'top' },
  rowEven: { background: 'white' },
  rowOdd: { background: '#fafafa' },
  totals: { padding: '16px 32px', borderTop: '2px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 6 },
  totalRow: { display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#475569' },
  totalFinal: { fontSize: 16, fontWeight: 700, color: '#0f172a', borderTop: '1px solid #e2e8f0', paddingTop: 8, marginTop: 4 },
  notes: { padding: '16px 32px', borderTop: '1px solid #e2e8f0', color: '#475569' },
  acceptSection: { padding: '24px 32px', borderTop: '2px solid #e2e8f0', background: '#fafafa' },
  acceptedBanner: { background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', padding: '14px 20px', borderRadius: 6, fontSize: 14 },
  acceptForm: {},
  acceptTitle: { fontSize: 16, fontWeight: 600, marginBottom: 8 },
  acceptHint: { fontSize: 13, color: '#64748b', margin: '0 0 12px' },
  acceptRow: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  acceptInput: { flex: 1, minWidth: 200, padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14, fontFamily: 'inherit', outline: 'none' },
  acceptBtn: { padding: '10px 20px', background: '#000', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
};
