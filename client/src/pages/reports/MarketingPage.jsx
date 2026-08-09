import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { toLocalDateStr } from '../../lib/date';
import styles from './Reports.module.css';

const money = cents => (Number(cents || 0) / 100).toLocaleString('en-NZ', {
  style: 'currency', currency: 'NZD', minimumFractionDigits: 0, maximumFractionDigits: 0,
});

const fmtDate = d => new Date(String(d).slice(0, 10) + 'T12:00:00')
  .toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });

// What each lead source produced, against what it cost.
export default function MarketingPage() {
  const { user } = useAuth();
  const thisYearStart = `${new Date().getFullYear()}-01-01`;

  const [from, setFrom] = useState(thisYearStart);
  const [to, setTo] = useState(toLocalDateStr());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSpend, setShowSpend] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/reports/marketing', { params: { from, to } })
      .then(r => setRows(r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const totals = rows.reduce((acc, r) => ({
    jobs: acc.jobs + Number(r.job_count || 0),
    revenue: acc.revenue + Number(r.revenue_cents || 0),
    cost: acc.cost + Number(r.cost_cents || 0),
  }), { jobs: 0, revenue: 0, cost: 0 });

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <Link to="/reports" className={styles.backLink}>← Reports</Link>
          <h1 className={styles.pageTitle}>Marketing</h1>
          <p className={styles.pageSubtitle}>What each lead source brought in, against what it cost</p>
        </div>
        <button className={styles.btnSmall} onClick={() => setShowSpend(true)}>Record spend</button>
      </div>

      <div className={styles.dateRange}>
        <label>Period:</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={styles.dateInput} />
        <span>to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={styles.dateInput} />
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Jobs from Leads</div>
          <div className={styles.statValue}>{totals.jobs}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Revenue</div>
          <div className={styles.statValue} style={{ color: '#16a34a' }}>{money(totals.revenue)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Marketing Spend</div>
          <div className={styles.statValue} style={{ color: '#d97706' }}>{money(totals.cost)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Cost per Job</div>
          <div className={styles.statValue}>
            {totals.jobs > 0 ? money(totals.cost / totals.jobs) : '—'}
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}><h2>By Lead Source</h2></div>

        {loading ? (
          <div className={styles.emptySmall}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className={styles.emptySmall}>
            Nothing to report yet. Lead sources come from the customer record.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className={styles.marketingTable}>
              <thead>
                <tr>
                  <th>Lead Source</th>
                  <th className={styles.tRight}>Jobs</th>
                  <th className={styles.tRight}>Revenue</th>
                  <th className={styles.tRight}>Spend</th>
                  <th className={styles.tRight}>Cost / Job</th>
                  <th className={styles.tRight}>Return</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const jobs = Number(r.job_count || 0);
                  const revenue = Number(r.revenue_cents || 0);
                  const cost = Number(r.cost_cents || 0);
                  // Only meaningful once there is spend to measure against
                  const roi = cost > 0 ? revenue / cost : null;
                  return (
                    <tr key={r.source}>
                      <td>{r.source}</td>
                      <td className={styles.tRight}>{jobs}</td>
                      <td className={styles.tRight}>{money(revenue)}</td>
                      <td className={styles.tRight}>{cost > 0 ? money(cost) : '—'}</td>
                      <td className={styles.tRight}>
                        {cost > 0 && jobs > 0 ? money(cost / jobs) : '—'}
                      </td>
                      <td className={styles.tRight}>
                        {roi === null ? '—' : (
                          <span style={{ color: roi >= 1 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                            {roi.toFixed(1)}×
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.emptySmall} style={{ borderTop: '1px solid var(--color-border)' }}>
          Jobs and revenue are attributed through the customer’s lead source, so repeat
          work from a customer still counts to the source that first brought them in.
          Draft invoices are excluded. Spend is counted in full regardless of the period
          above, since it is usually recorded monthly while the work lands later.
        </div>
      </div>

      {showSpend && (
        <SpendManager
          onClose={() => setShowSpend(false)}
          onChanged={load}
          canEdit={user?.role === 'admin'}
        />
      )}
    </div>
  );
}

function SpendManager({ onClose, onChanged, canEdit }) {
  const [costs, setCosts] = useState([]);
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('');
  const [incurredOn, setIncurredOn] = useState(toLocalDateStr());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/reports/marketing/costs').then(r => setCosts(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    api.get('/customers/lead-sources').then(r => {
      setSources(r.data || []);
      setSource(s => s || r.data?.[0] || '');
    }).catch(() => {});
  }, [load]);

  async function add(e) {
    e.preventDefault();
    if (!source || !amount) return;
    setBusy(true); setError('');
    try {
      await api.post('/reports/marketing/costs', {
        source, amount, incurred_on: incurredOn, notes,
      });
      setAmount(''); setNotes('');
      load(); onChanged();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record that');
    } finally { setBusy(false); }
  }

  async function remove(id) {
    if (!confirm('Delete this spend entry?')) return;
    try { await api.delete(`/reports/marketing/costs/${id}`); load(); onChanged(); }
    catch { alert('Could not delete'); }
  }

  return (
    <div className={styles.spendOverlay} onClick={onClose}>
      <div className={styles.spendPanel} onClick={e => e.stopPropagation()}>
        <div className={styles.cardHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Marketing spend</h2>
          <button className={styles.btnSmall} onClick={onClose}>✕</button>
        </div>

        {canEdit && (
          <form className={styles.spendForm} onSubmit={add}>
            <select className={styles.dateInput} value={source} onChange={e => setSource(e.target.value)}>
              {sources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              className={styles.dateInput}
              type="number" step="0.01" min="0"
              placeholder="Amount $"
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
            <input
              className={styles.dateInput}
              type="date"
              value={incurredOn}
              onChange={e => setIncurredOn(e.target.value)}
            />
            <input
              className={styles.dateInput}
              placeholder="Notes (optional)"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
            <button className={styles.btnSmall} type="submit" disabled={busy || !source || !amount}>
              {busy ? 'Saving…' : 'Add'}
            </button>
          </form>
        )}

        {error && <div className={styles.emptySmall} style={{ color: '#dc2626' }}>{error}</div>}

        {costs.length === 0 ? (
          <div className={styles.emptySmall}>No spend recorded yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className={styles.marketingTable}>
              <thead>
                <tr>
                  <th>Date</th><th>Source</th><th className={styles.tRight}>Amount</th>
                  <th>Notes</th>{canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {costs.map(c => (
                  <tr key={c.id}>
                    <td className={styles.muted}>{fmtDate(c.incurred_on)}</td>
                    <td>{c.source}</td>
                    <td className={styles.tRight}>{money(c.amount_cents)}</td>
                    <td className={styles.muted}>{c.notes || '—'}</td>
                    {canEdit && (
                      <td className={styles.tRight}>
                        <button className={styles.btnSmall} onClick={() => remove(c.id)}>Delete</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
