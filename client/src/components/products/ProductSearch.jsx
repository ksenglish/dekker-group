import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import styles from '../../pages/products/Products.module.css';

const fmt = cents => '$' + (cents / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DROPDOWN_MAX_H = 280;

export default function ProductSearch({ value, onChange, placeholder }) {
  const [query, setQuery] = useState(value || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [timer, setTimer] = useState(null);
  const [anchor, setAnchor] = useState(null);
  const ref = useRef();
  const inputRef = useRef();

  useEffect(() => {
    function onClickOutside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // The line-items card sets overflow:hidden, which clips an absolutely
  // positioned dropdown at the card's bottom edge — the last result gets cut
  // off with no way to reach it. Position against the viewport instead and
  // track the input, so the list can overhang the card.
  useEffect(() => {
    if (!open) return;
    function place() {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      // Drop upwards when there isn't a sensible amount of room underneath.
      const flip = below < 180 && above > below;
      setAnchor({
        left: r.left,
        width: r.width,
        top: flip ? undefined : r.bottom + 2,
        bottom: flip ? window.innerHeight - r.top + 2 : undefined,
        maxHeight: Math.min(DROPDOWN_MAX_H, Math.max(120, flip ? above : below)),
      });
    }
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, results.length]);

  function handleChange(e) {
    const q = e.target.value;
    setQuery(q);
    onChange({ description: q, unit_price: null, unit: null, product_id: null, product_name: null });
    if (timer) clearTimeout(timer);
    if (q.length < 1) { setResults([]); setOpen(false); return; }
    setTimer(setTimeout(async () => {
      const { data } = await api.get('/products', { params: { search: q } });
      setResults(data.slice(0, 10));
      setOpen(data.length > 0);
    }, 250));
  }

  function select(p) {
    // The customer reads the product's description; the name is the supplier's
    // ordering code, kept alongside it for the job/quote editors only.
    const customerText = (p.description || '').trim() || p.name;
    setQuery(customerText);
    setOpen(false);
    onChange({ description: customerText, unit_price: p.unit_price / 100, unit: p.unit, product_id: p.id, product_name: p.name });
  }

  return (
    <div className={styles.productSearch} ref={ref}>
      <input
        ref={inputRef}
        value={query}
        onChange={handleChange}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={placeholder || 'Search products or type description…'}
        style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
      />
      {open && anchor && (
        <div className={styles.productDropdown} style={{
          position: 'fixed',
          left: anchor.left,
          width: anchor.width,
          ...(anchor.top != null ? { top: anchor.top } : { bottom: anchor.bottom }),
          maxHeight: anchor.maxHeight,
        }}>
          {results.map(p => (
            <div key={p.id} className={styles.productOption} onMouseDown={() => select(p)}>
              <div className={styles.productOptionThumb}>
                {p.media_base64
                  ? <img src={p.media_base64} alt="" className={styles.productOptionImg} />
                  : <div className={styles.productOptionImgPlaceholder}>📦</div>
                }
              </div>
              <div style={{ flex: 1 }}>
                <div className={styles.productOptionName}>{p.name}</div>
                {p.category && <div className={styles.productOptionMeta}>{p.category} · {p.unit}</div>}
              </div>
              <div className={styles.productOptionPrice}>{fmt(p.unit_price)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
