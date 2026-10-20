import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import styles from './Reports.module.css';

// Products whose cost on a recent invoice is not what the price list says.
//
// A supplier puts a price up and nothing announces it. The invoice is scanned
// onto a job, that job's costs come out right, and the price list carries on
// saying what the thing used to cost — so every quote raised from it is costed
// at the old price and the margin goes quietly. This is the page that says so.
//
// Sorted by how far the price moved rather than by date: a 40% rise matters
// more than last week's cent.

const fmt = c => '$' + ((c || 0) / 100).toFixed(2);

function Pill({ children, tone }) {
  const tones = {
    up: { bg: '#fef2f2', fg: '#b91c1c', bd: '#fecaca' },
    down: { bg: '#f0fdf4', fg: '#15803d', bd: '#bbf7d0' },
    loss: { bg: '#b91c1c', fg: '#ffffff', bd: '#b91c1c' },
  }[tone] || { bg: '#f1f5f9', fg: '#334155', bd: '#e2e8f0' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      background: tones.bg, color: tones.fg, border: `1px solid ${tones.bd}`,
      fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function Stat({ label, value, tone, alarm }) {
  return (
    <div className={styles.statCard}
      style={alarm ? { borderColor: '#fecaca', background: '#fef2f2' } : undefined}>
      <div className={styles.statValue} style={tone ? { color: tone } : undefined}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

export default function PriceChangesPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [threshold, setThreshold] = useState(5);
  const [since, setSince] = useState('');
  const [accepting, setAccepting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams();
      p.set('threshold_pct', String(Number(threshold) || 0));
      if (since) p.set('since', since);
      const { data: d } = await api.get(`/products/price-changes?${p.toString()}`);
      setData(d);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load the report.');
    }
    setLoading(false);
  }, [threshold, since]);

  useEffect(() => { load(); }, [load]);

  // Takes the invoiced cost onto the price list and moves the sell price with
  // it, holding whatever markup that product actually had rather than
  // assuming the standard one.
  async function accept(row) {
    setAccepting(row.product_id);
    try {
      await api.post(`/products/${row.product_id}/accept-price`, { cost_price: row.invoiced_cost });
      await load();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not update that price.');
    }
    setAccepting(null);
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.pageTitle}>Price Red Flags</div>
          <div className={styles.pageSubtitle}>
            Products costing something different on a recent supplier invoice than the price
            list says. Until the list is updated, every quote using one is costed at the old price.
          </div>
        </div>
        <Link to="/reports" className={styles.backLink}>← Reports</Link>
      </div>

      <div className={styles.dateRange} style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 12.5 }}>
          Ignore changes under{' '}
          <input type="number" min="0" max="100" value={threshold}
            onChange={e => setThreshold(e.target.value)}
            className={styles.dateInput} style={{ width: 70 }} /> %
        </label>
        <label style={{ fontSize: 12.5 }}>
          Invoices since{' '}
          <input type="date" value={since} onChange={e => setSince(e.target.value)}
            className={styles.dateInput} />
        </label>
      </div>

      {error && <div className={styles.emptySmall} style={{ color: 'var(--color-error)' }}>{error}</div>}
      {loading && <div className={styles.emptySmall}>Checking the invoices…</div>}

      {!loading && data && (
        <>
          <div className={styles.statsRow}>
            <Stat label="Prices moved" value={data.total} />
            <Stat label="Went up" value={data.went_up} tone="#b91c1c" />
            <Stat label="Went down" value={data.went_down} tone="#15803d" />
            <Stat label="Now selling below cost" value={data.selling_at_a_loss}
              tone="#b91c1c" alarm={data.selling_at_a_loss > 0} />
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2>
                {data.changes.length} product{data.changes.length === 1 ? '' : 's'} to look at
              </h2>
            </div>

            {data.changes.length === 0 ? (
              <div className={styles.emptySmall}>
                Nothing has moved by {data.threshold_pct}% or more. Every product on the price
                list still costs what it says it costs.
              </div>
            ) : (
              <>
                <div className={styles.flagHeader}>
                  <span>Product</span>
                  <span className={styles.tRight}>List cost</span>
                  <span className={styles.tRight}>Invoiced</span>
                  <span className={styles.tRight}>Change</span>
                  <span className={styles.tRight}>Margin now</span>
                  <span className={styles.tRight}>Hold markup at</span>
                  <span>Seen on</span>
                  <span />
                </div>
                {data.changes.map(row => (
                  <div key={row.product_id} className={styles.flagRow}>
                    <div>
                      <div className={styles.flagName}>{row.name}</div>
                      <div className={styles.flagMeta}>
                        {[row.supplier, row.sku].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                    <div className={`${styles.tRight} ${styles.flagCell}`} data-label="List cost">
                      {fmt(row.price_list_cost)}
                    </div>
                    <div className={`${styles.tRight} ${styles.flagCell}`} data-label="Invoiced"
                      style={{ fontWeight: 600 }}>
                      {fmt(row.invoiced_cost)}
                    </div>
                    <div className={`${styles.tRight} ${styles.flagCell}`} data-label="Change">
                      <Pill tone={row.direction}>
                        {row.change_pct > 0 ? '+' : ''}{row.change_pct}%
                      </Pill>
                    </div>
                    <div className={`${styles.tRight} ${styles.flagCell}`} data-label="Margin now">
                      {row.margin_now_pct === null ? '—'
                        : row.margin_now_pct < 0
                          ? <Pill tone="loss">{row.margin_now_pct}%</Pill>
                          : `${row.margin_now_pct}%`}
                    </div>
                    <div className={`${styles.tRight} ${styles.flagCell}`} data-label="Hold markup at">
                      {row.sell_to_hold_markup ? fmt(row.sell_to_hold_markup) : '—'}
                      {row.sell_now > 0 && (
                        <div className={styles.flagMeta}>now {fmt(row.sell_now)}</div>
                      )}
                    </div>
                    <div className={styles.flagCell} data-label="Seen on">
                      <div style={{ fontSize: 12 }}>{row.last_invoice || '—'}</div>
                      <div className={styles.flagMeta}>
                        {row.last_seen}
                        {row.job_id && <> · <Link to={`/jobs/${row.job_id}`}>job</Link></>}
                      </div>
                    </div>
                    <div>
                      <button className={styles.btnSmall} onClick={() => accept(row)}
                        disabled={accepting === row.product_id}
                        title="Put the invoiced cost on the price list and move the sell price with it">
                        {accepting === row.product_id ? 'Updating…' : 'Use new price'}
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
