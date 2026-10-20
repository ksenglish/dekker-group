import { useState } from 'react';
import api from '../../lib/api';
import styles from '../../pages/products/Products.module.css';

// Building the price list out of the supplier invoices already scanned onto
// jobs.
//
// Shown before it is done, because this writes hundreds of rows. The preview
// is the same calculation the import runs, so what is on screen is what will
// happen rather than an estimate of it.

const fmt = c => '$' + ((c || 0) / 100).toFixed(2);

export default function FromInvoicesTab({ onDone }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [markup, setMarkup] = useState(30);
  const [supplier, setSupplier] = useState('');
  const [since, setSince] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);

  const params = () => {
    const p = new URLSearchParams();
    p.set('markup', String(markup));
    if (supplier.trim()) p.set('supplier', supplier.trim());
    if (since) p.set('since', since);
    return p.toString();
  };

  async function preview() {
    setLoading(true); setError(''); setResult(null);
    try {
      const { data } = await api.get(`/products/from-costs/preview?${params()}`);
      setPlan(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not read the invoice history.');
    }
    setLoading(false);
  }

  async function run() {
    setImporting(true); setError('');
    try {
      const { data } = await api.post('/products/from-costs', {
        markup, supplier: supplier.trim() || null, since: since || null, only_new: onlyNew,
      });
      setResult(data);
      if (data.created > 0 || data.updated > 0) onDone();
    } catch (e) {
      setError(e.response?.data?.error || 'The import failed.');
    }
    setImporting(false);
  }

  return (
    <>
      <div className={styles.importNote}>
        <p>
          Builds price-list products from the supplier invoices already scanned onto jobs —
          the trade price actually paid, not a catalogue price.
        </p>
        <ul style={{ marginTop: 6, paddingLeft: 20, lineHeight: 1.8 }}>
          <li>The most recent price for each product wins.</li>
          <li>Credit notes are left out — money back is not a price.</li>
          <li>
            The same product bought under two spellings becomes one row, matched on the
            supplier&rsquo;s code where there is one and on the name where there is not.
          </li>
          <li>No photographs: invoices do not carry them.</li>
        </ul>
      </div>

      <div className={styles.formGrid} style={{ marginTop: 14 }}>
        <div className={styles.formGroup}>
          <label>Markup on cost</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="number" min="0" max="500" step="1" value={markup}
              onChange={e => setMarkup(e.target.value)} style={{ width: 90 }} />
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              % — $100 cost sells at {fmt(Math.round(10000 * (1 + (Number(markup) || 0) / 100)))}
            </span>
          </div>
        </div>
        <div className={styles.formGroup}>
          <label>Supplier <span style={{ fontWeight: 400, color: '#64748b' }}>(all if blank)</span></label>
          <input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="e.g. Bunnings" />
        </div>
        <div className={styles.formGroup}>
          <label>Only invoices since <span style={{ fontWeight: 400, color: '#64748b' }}>(optional)</span></label>
          <input type="date" value={since} onChange={e => setSince(e.target.value)} />
        </div>
        <div className={styles.formGroup} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'end', paddingBottom: 9 }}>
          <input type="checkbox" id="only_new" checked={onlyNew} onChange={e => setOnlyNew(e.target.checked)} />
          <label htmlFor="only_new" style={{ marginBottom: 0 }}>
            Only add what is missing — leave prices already in the list alone
          </label>
        </div>
      </div>

      {error && <div className={styles.formError} style={{ marginTop: 12 }}>{error}</div>}

      <div style={{ marginTop: 14 }}>
        <button className={styles.btnSecondary} onClick={preview} disabled={loading}>
          {loading ? 'Reading the invoices…' : 'Show me what this would do'}
        </button>
      </div>

      {plan && !result && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 14, marginBottom: 10 }}>
            <strong>{plan.products.length}</strong> product{plan.products.length === 1 ? '' : 's'} from{' '}
            <strong>{plan.lines_read}</strong> invoice lines —{' '}
            <strong>{plan.creating}</strong> new, <strong>{plan.updating}</strong> already on the price list.
            {plan.suppliers.length > 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 4 }}>
                Suppliers: {plan.suppliers.join(', ')}
              </div>
            )}
          </div>

          {plan.products.length > 0 && (
            <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', position: 'sticky', top: 0 }}>
                    <th style={{ textAlign: 'left', padding: '7px 10px' }}>Product</th>
                    <th style={{ textAlign: 'left', padding: '7px 10px' }}>Code</th>
                    <th style={{ textAlign: 'right', padding: '7px 10px' }}>Cost</th>
                    <th style={{ textAlign: 'right', padding: '7px 10px' }}>Sell</th>
                    <th style={{ textAlign: 'left', padding: '7px 10px' }}>What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.products.slice(0, 200).map((p, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '6px 10px' }}>
                        {p.name}
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          {p.supplier || 'no supplier'} · bought {p.times_bought}×
                        </div>
                      </td>
                      <td style={{ padding: '6px 10px', color: 'var(--color-text-muted)' }}>{p.sku || '—'}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                        {fmt(p.cost_cents)}
                        {p.previous_cost_cents != null && (
                          <div style={{ fontSize: 11, color: p.cost_cents > p.previous_cost_cents ? '#b91c1c' : '#15803d' }}>
                            was {fmt(p.previous_cost_cents)}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{fmt(p.sell_cents)}</td>
                      <td style={{ padding: '6px 10px' }}>
                        {p.action === 'create'
                          ? <span style={{ color: '#15803d' }}>new</span>
                          : <span style={{ color: '#b45309' }}>
                              updates existing{p.matched_on ? ` (matched on ${p.matched_on})` : ''}
                            </span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.products.length > 200 && (
                <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                  …and {plan.products.length - 200} more. All of them are imported.
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <button className={styles.btnPrimary} onClick={run} disabled={importing || plan.products.length === 0}>
              {importing ? 'Importing…' : `Import ${plan.products.length} product${plan.products.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className={styles.importResult} style={{ marginTop: 16 }}>
          <p><strong>{result.created}</strong> added, <strong>{result.updated}</strong> updated
            {result.skipped > 0 && <>, <strong>{result.skipped}</strong> left alone</>} —
            at {result.markup_pct}% markup, from {result.lines_read} invoice lines.</p>
          {result.errors?.length > 0 && (
            <ul style={{ marginTop: 8, paddingLeft: 20, color: 'var(--color-error)' }}>
              {result.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
