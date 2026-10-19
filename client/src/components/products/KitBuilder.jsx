import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import styles from './KitBuilder.module.css';

// Building a product out of other products.
//
// "Supply & install bathroom extractor" is a fan, a length of duct, a grille, a
// switch and the fixings. Priced by hand it drifts the moment any one of those
// changes; priced from its parts it is right by construction, and the quote
// still shows the single line the customer wants to read.
//
// The totals here are what gets saved as the kit's cost and sell price — the
// price boxes above go read-only while this is on, because two sources for one
// number is how they end up disagreeing.

const GST_RATE = 0.15;
const fmt = cents => `$${((cents || 0) / 100).toFixed(2)}`;
const qtyLabel = n => (Number.isInteger(n) ? String(n) : String(n));

export function rollUp(lines) {
  return lines.reduce((t, l) => ({
    cost: t.cost + Math.round((l.cost_price || 0) * l.quantity),
    sell: t.sell + Math.round((l.unit_price || 0) * l.quantity),
  }), { cost: 0, sell: 0 });
}

function Search({ onPick, exclude, placeholder }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setBusy(true);
      try {
        const { data } = await api.get('/products', { params: { search: q.trim() } });
        const list = Array.isArray(data) ? data : (data.products || []);
        setResults(list.filter(p => !exclude.includes(p.id)).slice(0, 12));
      } catch { setResults([]); }
      finally { setBusy(false); }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q, exclude]);

  return (
    <div className={styles.search}>
      <input value={q} onChange={e => setQ(e.target.value)}
        placeholder={placeholder || 'Search the price list to add a part…'} />
      {busy && <span className={styles.searchBusy}>Searching…</span>}
      {results.length > 0 && (
        <div className={styles.results}>
          {results.map(p => (
            <button key={p.id} type="button" className={styles.result}
              onClick={() => { onPick(p); setQ(''); setResults([]); }}>
              <span className={styles.resultName}>{p.name}</span>
              <span className={styles.resultMeta}>
                {[p.category, p.supplier].filter(Boolean).join(' · ')}
              </span>
              <span className={styles.resultPrice}>{fmt(p.unit_price)}</span>
            </button>
          ))}
        </div>
      )}
      {q.trim().length >= 2 && !busy && results.length === 0 && (
        <div className={styles.noResults}>Nothing in the price list matches “{q.trim()}”.</div>
      )}
    </div>
  );
}

export default function KitBuilder({ productId, value, onChange, isAdmin }) {
  // value: [{ component_id, name, unit, quantity, cost_price, unit_price }]
  const lines = value || [];
  const [loading, setLoading] = useState(!!productId);
  // Which line, if any, is having its part replaced.
  const [swapping, setSwapping] = useState(null);
  const loaded = useRef(false);

  // An existing kit loads its parts once, when the form opens.
  useEffect(() => {
    if (!productId || loaded.current) { setLoading(false); return; }
    loaded.current = true;
    api.get(`/products/${productId}/components`)
      .then(r => { if (r.data.length) onChange(r.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [productId, onChange]);

  function add(p) {
    onChange([...lines, {
      component_id: p.id, name: p.name, unit: p.unit,
      quantity: 1, cost_price: p.cost_price || 0, unit_price: p.unit_price || 0,
    }]);
  }
  // Putting a different part in an existing line, keeping its quantity and its
  // place in the list.
  //
  // This is what copying a kit is usually for: the same job, the same labour,
  // the same fixings, a different unit in the middle of it. Taking the old
  // line out and adding a new one loses both the quantity and the order, and
  // then has to be retyped from the one that was just deleted.
  function swap(oldId, p) {
    onChange(lines.map(l => (l.component_id === oldId
      ? { ...l, component_id: p.id, name: p.name, unit: p.unit,
          cost_price: p.cost_price || 0, unit_price: p.unit_price || 0 }
      : l)));
    setSwapping(null);
  }
  function setQty(id, q) {
    onChange(lines.map(l => (l.component_id === id ? { ...l, quantity: q } : l)));
  }
  function drop(id) {
    onChange(lines.filter(l => l.component_id !== id));
    setSwapping(s => (s === id ? null : s));
  }

  const totals = rollUp(lines.map(l => ({ ...l, quantity: parseFloat(l.quantity) || 0 })));
  const margin = totals.sell > 0 && totals.cost > 0
    ? (((totals.sell - totals.cost) / totals.sell) * 100).toFixed(1)
    : null;

  if (loading) return <div className={styles.loading}>Loading the kit…</div>;

  return (
    <div className={styles.kit}>
      <Search onPick={add} exclude={lines.map(l => l.component_id)} />

      {lines.length === 0 ? (
        <p className={styles.empty}>
          Nothing in the kit yet. Search above to add the parts it is made of —
          the cost and sell price are added up from them.
        </p>
      ) : (
        <div className={styles.table}>
          <div className={styles.head}>
            <span>Part</span>
            <span className={styles.num}>Qty</span>
            {isAdmin && <span className={styles.num}>Cost</span>}
            <span className={styles.num}>Sell</span>
            <span className={styles.num}>Line</span>
            <span />
            <span />
          </div>
          {lines.map(l => {
            const q = parseFloat(l.quantity) || 0;
            return (
              <div key={l.component_id} className={styles.rowWrap}>
              <div className={styles.row}>
                <span className={styles.partName}>
                  {l.name}
                  {l.is_active === false && <em className={styles.inactive}>archived</em>}
                  {l.unit && <em className={styles.unit}>per {l.unit}</em>}
                </span>
                <span className={styles.num}>
                  <input type="number" min="0.001" step="0.001" value={l.quantity}
                    onChange={e => setQty(l.component_id, e.target.value)} />
                </span>
                {isAdmin && <span className={styles.num}>{fmt(l.cost_price)}</span>}
                <span className={styles.num}>{fmt(l.unit_price)}</span>
                <span className={`${styles.num} ${styles.lineTotal}`}>{fmt(Math.round(l.unit_price * q))}</span>
                <button type="button"
                  className={`${styles.swap} ${swapping === l.component_id ? styles.swapOn : ''}`}
                  title={`Put a different part in place of ${l.name}, keeping the quantity`}
                  onClick={() => setSwapping(s => (s === l.component_id ? null : l.component_id))}>⇄</button>
                <button type="button" className={styles.remove} title={`Take ${l.name} out of the kit`}
                  onClick={() => drop(l.component_id)}>✕</button>
              </div>
              {swapping === l.component_id && (
                <div className={styles.swapRow}>
                  <span className={styles.swapLabel}>Replace {l.name} with:</span>
                  <Search onPick={p => swap(l.component_id, p)}
                    exclude={lines.filter(o => o.component_id !== l.component_id).map(o => o.component_id)}
                    placeholder="Search the price list for the part to use instead…" />
                </div>
              )}
              </div>
            );
          })}
          <div className={styles.totals}>
            <span>{lines.length} part{lines.length === 1 ? '' : 's'}</span>
            {isAdmin && <span className={styles.num}>Cost {fmt(totals.cost)}</span>}
            <span className={styles.num}>
              Sell <strong>{fmt(totals.sell)}</strong> excl. GST
            </span>
            <span className={styles.num}>{fmt(Math.round(totals.sell * (1 + GST_RATE)))} inc. GST</span>
            {margin !== null && <span className={styles.margin}>Margin {margin}%</span>}
          </div>
        </div>
      )}

      {lines.length > 0 && (
        <p className={styles.note}>
          Saving stores <strong>{fmt(totals.cost)}</strong> cost and <strong>{fmt(totals.sell)}</strong> sell
          on this product. If a part's price changes later, open this kit and save it again to pick that up —
          a quote already raised keeps the price it was raised at.
        </p>
      )}
    </div>
  );
}

export { qtyLabel };
