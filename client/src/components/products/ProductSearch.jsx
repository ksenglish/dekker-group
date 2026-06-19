import { useState, useEffect, useRef } from 'react';
import api from '../../api/axios';
import styles from '../../pages/products/Products.module.css';

const fmt = cents => '$' + (cents / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ProductSearch({ value, onChange, placeholder }) {
  const [query, setQuery] = useState(value || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [timer, setTimer] = useState(null);
  const ref = useRef();

  useEffect(() => {
    function onClickOutside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function handleChange(e) {
    const q = e.target.value;
    setQuery(q);
    onChange({ description: q, unit_price: null, unit: null });
    if (timer) clearTimeout(timer);
    if (q.length < 1) { setResults([]); setOpen(false); return; }
    setTimer(setTimeout(async () => {
      const { data } = await api.get('/products', { params: { search: q } });
      setResults(data.slice(0, 10));
      setOpen(data.length > 0);
    }, 250));
  }

  function select(p) {
    setQuery(p.name);
    setOpen(false);
    onChange({ description: p.name, unit_price: p.unit_price / 100, unit: p.unit });
  }

  return (
    <div className={styles.productSearch} ref={ref}>
      <input
        value={query}
        onChange={handleChange}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={placeholder || 'Search products or type description…'}
        style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
      />
      {open && (
        <div className={styles.productDropdown}>
          {results.map(p => (
            <div key={p.id} className={styles.productOption} onMouseDown={() => select(p)}>
              <div>
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
