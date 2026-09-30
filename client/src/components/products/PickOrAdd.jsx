import { useState, useRef, useEffect } from 'react';
import styles from '../../pages/products/Products.module.css';

// Pick a value already in use, or type a new one on purpose.
//
// A plain text box is how one supplier ends up spelled two ways and one
// category becomes three. A plain dropdown can't take a value that doesn't
// exist yet. This is both: a select of what's already there, and a button that
// swaps it for a text box when the value genuinely is new.
//
// Used for Supplier and for Category and its four sub-categories, so they all
// behave the same way.
export default function PickOrAdd({ value, options = [], onChange, addLabel = '+ Add', placeholder }) {
  // A value that isn't on the list has to be editable, or a product carrying an
  // old category could never be saved without silently losing it.
  const [typing, setTyping] = useState(() => !!value && !options.includes(value));
  const inputRef = useRef();
  useEffect(() => { if (typing) inputRef.current?.focus(); }, [typing]);

  if (typing) {
    return (
      <div className={styles.supplierRow}>
        <input ref={inputRef} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
        <button type="button" className={styles.supplierBtn}
          onClick={() => { setTyping(false); onChange(''); }}>Cancel</button>
      </div>
    );
  }

  return (
    <div className={styles.supplierRow}>
      <select value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— None —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <button type="button" className={styles.supplierBtn}
        onClick={() => { setTyping(true); onChange(''); }}>{addLabel}</button>
    </div>
  );
}
