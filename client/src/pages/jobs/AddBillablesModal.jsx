import { useState, useEffect, useMemo } from 'react';
import api from '../../lib/api';
import styles from './Jobs.module.css';
import { overlayClose } from '../../lib/overlayClose';

// Picks costs and hours off a job and turns them into billable line items.
//
// Everything here is excl. GST, matching the line items table and the billing
// rates — the editor converts to incl. GST for display, and this hands it the
// same shape the server already stores.
const money = c => `$${((c || 0) / 100).toFixed(2)}`;
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) : '');

export default function AddBillablesModal({ jobId, tab: initialTab = 'costs', onAdded, onClose }) {
  const [tab, setTab] = useState(initialTab);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // id -> { on, mode, markup_pct, unit_price }
  const [costSel, setCostSel] = useState({});
  const [timeSel, setTimeSel] = useState({});
  const [markupAll, setMarkupAll] = useState('20');
  const [groupTime, setGroupTime] = useState(true);

  useEffect(() => {
    api.get(`/jobs/${jobId}/billable`)
      .then(r => {
        setData(r.data);
        // Anything already billed starts unticked — adding it again is allowed,
        // but it has to be a decision rather than the default.
        setCostSel(Object.fromEntries(r.data.costs.map(c => [c.id, { on: !c.billed_at, mode: 'markup' }])));
        setTimeSel(Object.fromEntries(r.data.time.map(t => [t.id, { on: !t.billed_at && t.hourly_rate > 0 }])));
      })
      .catch(() => setErr('Could not load this job’s costs and time'))
      .finally(() => setLoading(false));
  }, [jobId]);

  const costs = data?.costs || [];
  const time = data?.time || [];
  const rates = data?.billing_rates || [];

  // Sell price for one cost line, in cents excl. GST. Mirrors the server's
  // sellPriceFromCost — shown here so the total is known before committing.
  function sellOf(c) {
    const s = costSel[c.id] || {};
    if (s.mode === 'price') return Math.max(0, Math.round((parseFloat(s.unit_price) || 0) * 100));
    const pct = s.markup_pct != null && s.markup_pct !== '' ? parseFloat(s.markup_pct) : parseFloat(markupAll);
    return Math.max(0, Math.round(c.unit_cost * (1 + (Number.isFinite(pct) ? pct : 0) / 100)));
  }
  function rateOf(t) {
    const s = timeSel[t.id] || {};
    if (s.billing_rate_id) {
      const r = rates.find(x => x.id === s.billing_rate_id);
      return r ? Math.round(r.rate * 100) : 0;
    }
    return t.hourly_rate;
  }

  const chosenCosts = costs.filter(c => costSel[c.id]?.on);
  const chosenTime = time.filter(t => timeSel[t.id]?.on);
  const totals = useMemo(() => {
    const costSell = chosenCosts.reduce((s, c) => s + sellOf(c) * c.quantity, 0);
    const costBase = chosenCosts.reduce((s, c) => s + c.total_cost, 0);
    const timeSell = chosenTime.reduce((s, t) => s + rateOf(t) * t.hours, 0);
    return { costSell, costBase, timeSell, total: costSell + timeSell };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenCosts, chosenTime, costSel, timeSel, markupAll]);

  const setCost = (id, patch) => setCostSel(s => ({ ...s, [id]: { ...s[id], ...patch } }));
  const setTime = (id, patch) => setTimeSel(s => ({ ...s, [id]: { ...s[id], ...patch } }));
  const toggleAllCosts = on => setCostSel(s => Object.fromEntries(costs.map(c => [c.id, { ...s[c.id], on }])));
  const toggleAllTime = on => setTimeSel(s => Object.fromEntries(time.map(t => [t.id, { ...s[t.id], on }])));

  const unrated = chosenTime.filter(t => rateOf(t) <= 0);

  async function submit() {
    setSaving(true); setErr('');
    try {
      const { data: res } = await api.post(`/jobs/${jobId}/line-items/from-costs-and-time`, {
        group_time: groupTime,
        costs: chosenCosts.map(c => {
          const s = costSel[c.id] || {};
          return s.mode === 'price'
            ? { id: c.id, mode: 'price', unit_price: parseFloat(s.unit_price) || 0 }
            : { id: c.id, mode: 'markup', markup_pct: s.markup_pct != null && s.markup_pct !== '' ? parseFloat(s.markup_pct) : parseFloat(markupAll) || 0 };
        }),
        time: chosenTime.map(t => ({
          id: t.id,
          billing_rate_id: timeSel[t.id]?.billing_rate_id || t.billing_rate_id || null,
          unit_price: rateOf(t) / 100,
        })),
      });
      onAdded(res);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not add these');
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} {...overlayClose(onClose)}>
      <div className={styles.modal} style={{ maxWidth: 860 }} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>Add to Line Items</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>

        <div className={styles.billTabs}>
          <button className={`${styles.billTab} ${tab === 'costs' ? styles.billTabActive : ''}`} onClick={() => setTab('costs')}>
            Costs {costs.length > 0 && <span className={styles.billTabCount}>{chosenCosts.length}/{costs.length}</span>}
          </button>
          <button className={`${styles.billTab} ${tab === 'time' ? styles.billTabActive : ''}`} onClick={() => setTab('time')}>
            Time {time.length > 0 && <span className={styles.billTabCount}>{chosenTime.length}/{time.length}</span>}
          </button>
        </div>

        <div className={styles.modalBody} style={{ maxHeight: '52vh', overflowY: 'auto' }}>
          {err && <div className={styles.errorBanner}>{err}</div>}
          {loading ? <div className={styles.emptySmall}>Loading…</div> : tab === 'costs' ? (
            costs.length === 0 ? <div className={styles.emptySmall}>No costs on this job yet.</div> : (
              <>
                <div className={styles.billBulkRow}>
                  <label className={styles.billBulkMarkup}>
                    <span>Mark up all by</span>
                    <input type="number" step="1" value={markupAll} onChange={e => setMarkupAll(e.target.value)} />
                    <span>%</span>
                  </label>
                  <button className={styles.btnSmall} onClick={() => toggleAllCosts(true)}>Select all</button>
                  <button className={styles.btnSmall} onClick={() => toggleAllCosts(false)}>Select none</button>
                </div>
                <div className={styles.billHeader}>
                  <span />
                  <span>Description</span>
                  <span>Qty</span>
                  <span>Unit Cost</span>
                  <span>Markup / Sell</span>
                  <span>Line Total</span>
                </div>
                {costs.map(c => {
                  const s = costSel[c.id] || {};
                  const sell = sellOf(c);
                  return (
                    <div key={c.id} className={`${styles.billRow} ${s.on ? '' : styles.billRowOff}`}>
                      <input type="checkbox" checked={!!s.on} onChange={e => setCost(c.id, { on: e.target.checked })} />
                      <span className={styles.billDesc}>
                        {c.description}
                        <em className={styles.billMeta}>
                          {[c.supplier, c.invoice_number].filter(Boolean).join(' · ')}
                          {c.billed_at && <b className={styles.billAlready}>already added {fmtDate(c.billed_at)}</b>}
                        </em>
                      </span>
                      <span className={styles.billNum}>{c.quantity}</span>
                      <span className={styles.billNum}>{money(c.unit_cost)}</span>
                      <span className={styles.billPricing}>
                        <select value={s.mode || 'markup'} onChange={e => setCost(c.id, { mode: e.target.value })}>
                          <option value="markup">Markup %</option>
                          <option value="price">Sell price</option>
                        </select>
                        {(s.mode || 'markup') === 'markup' ? (
                          <input type="number" step="1" placeholder={markupAll}
                            value={s.markup_pct ?? ''} onChange={e => setCost(c.id, { markup_pct: e.target.value })} />
                        ) : (
                          <input type="number" min="0" step="0.01" placeholder={(c.unit_cost / 100).toFixed(2)}
                            value={s.unit_price ?? ''} onChange={e => setCost(c.id, { unit_price: e.target.value })} />
                        )}
                      </span>
                      <span className={styles.billNum}>
                        <strong>{money(sell * c.quantity)}</strong>
                        <em className={styles.billMeta}>{money(sell)} ea</em>
                      </span>
                    </div>
                  );
                })}
              </>
            )
          ) : (
            time.length === 0 ? <div className={styles.emptySmall}>No time logged on this job yet.</div> : (
              <>
                <div className={styles.billBulkRow}>
                  <label className={styles.billBulkCheck}>
                    <input type="checkbox" checked={groupTime} onChange={e => setGroupTime(e.target.checked)} />
                    <span>Combine into one line per rate</span>
                  </label>
                  <button className={styles.btnSmall} onClick={() => toggleAllTime(true)}>Select all</button>
                  <button className={styles.btnSmall} onClick={() => toggleAllTime(false)}>Select none</button>
                </div>
                <div className={styles.billHeader}>
                  <span />
                  <span>Date · Who</span>
                  <span>Hours</span>
                  <span>Rate</span>
                  <span>Billing Rate</span>
                  <span>Line Total</span>
                </div>
                {time.map(t => {
                  const s = timeSel[t.id] || {};
                  const rate = rateOf(t);
                  return (
                    <div key={t.id} className={`${styles.billRow} ${s.on ? '' : styles.billRowOff}`}>
                      <input type="checkbox" checked={!!s.on} onChange={e => setTime(t.id, { on: e.target.checked })} />
                      <span className={styles.billDesc}>
                        {fmtDate(t.date)} · {t.user_name || 'Unknown'}
                        <em className={styles.billMeta}>
                          {t.description || 'No note'}
                          {t.rate_source === 'user_default' && <b className={styles.billDefaulted}>their default rate</b>}
                          {t.billed_at && <b className={styles.billAlready}>already added {fmtDate(t.billed_at)}</b>}
                        </em>
                      </span>
                      <span className={styles.billNum}>{t.hours.toFixed(2)}h</span>
                      <span className={styles.billNum}>{rate > 0 ? `${money(rate)}/h` : <em className={styles.billNoRate}>no rate</em>}</span>
                      <span className={styles.billPricing}>
                        <select value={s.billing_rate_id || t.billing_rate_id || ''}
                          onChange={e => setTime(t.id, { billing_rate_id: e.target.value })}>
                          <option value="">— none —</option>
                          {rates.map(r => <option key={r.id} value={r.id}>{r.label} (${r.rate.toFixed(2)})</option>)}
                        </select>
                      </span>
                      <span className={styles.billNum}><strong>{money(rate * t.hours)}</strong></span>
                    </div>
                  );
                })}
              </>
            )
          )}
        </div>

        <div className={styles.billFooter}>
          <div className={styles.billTotals}>
            <span>
              {chosenCosts.length} cost{chosenCosts.length === 1 ? '' : 's'} · {chosenTime.length} time entr{chosenTime.length === 1 ? 'y' : 'ies'}
            </span>
            <strong>{money(totals.total)} excl. GST</strong>
            {totals.costBase > 0 && (
              <em className={styles.billMargin}>
                costs {money(totals.costBase)} → {money(totals.costSell)}
                {' '}({totals.costBase > 0 ? `${Math.round(((totals.costSell - totals.costBase) / totals.costBase) * 100)}%` : ''} markup)
              </em>
            )}
          </div>
          {unrated.length > 0 && (
            // Adding these would put a $0 line on the customer's bill, which is
            // worse than not adding them — say so before it happens.
            <div className={styles.billWarn}>
              {unrated.length} selected time {unrated.length === 1 ? 'entry has' : 'entries have'} no billing rate and would
              add at $0. Pick a rate for them, or untick them.
            </div>
          )}
          <div className={styles.billActions}>
            <button className={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button className={styles.btnPrimary} onClick={submit}
              disabled={saving || (!chosenCosts.length && !chosenTime.length)}>
              {saving ? 'Adding…' : `Add ${chosenCosts.length + chosenTime.length} to Line Items`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
