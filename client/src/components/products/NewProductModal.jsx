import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import styles from '../../pages/jobs/Jobs.module.css';
import { overlayClose } from '../../lib/overlayClose';

// Adds a product to the price list from wherever you happened to notice it was
// missing — a proposal row typed by hand, most often. Saves the product and
// hands it straight back, so the row it came from is filled in at the same time
// and nothing has to be retyped.
//
// Prices are in dollars here and on POST /products (the server converts), which
// is the opposite of the proposal editor's cents. Converted at the boundary.
export default function NewProductModal({
  initialDescription = '', initialCostDollars = '', initialChargeDollars = '', markupPct = 0,
  onCreated, onClose,
}) {
  const [f, setF] = useState({
    name: '',
    description: initialDescription,
    category: '',
    unit: 'each',
    cost_price: initialCostDollars && parseFloat(initialCostDollars) > 0 ? initialCostDollars : '',
    unit_price: initialChargeDollars && parseFloat(initialChargeDollars) > 0 ? initialChargeDollars : '',
    supplier: '',
  });
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const nameRef = useRef();

  useEffect(() => {
    api.get('/products/categories').then(r => setCategories(r.data || [])).catch(() => {});
    nameRef.current?.focus();
  }, []);

  const set = (k, v) => setF(x => ({ ...x, [k]: v }));

  // The sell price usually is the cost plus whatever the proposal is marking up
  // by, so it fills itself in — but only while it is still empty, or it would
  // fight whoever is typing into it.
  function setCost(v) {
    setF(x => {
      const next = { ...x, cost_price: v };
      const cost = parseFloat(v);
      if (!x.unit_price && Number.isFinite(cost) && cost > 0 && markupPct) {
        next.unit_price = (cost * (1 + markupPct / 100)).toFixed(2);
      }
      return next;
    });
  }

  async function save(e) {
    e.preventDefault();
    if (!f.name.trim()) return setErr('Give it a product code — that is what the price list is keyed on');
    setSaving(true); setErr('');
    try {
      const { data } = await api.post('/products', {
        name: f.name.trim(),
        description: f.description.trim() || null,
        category: f.category.trim() || null,
        unit: f.unit.trim() || 'each',
        // Dollars — the server rounds to cents.
        unit_price: parseFloat(f.unit_price) || 0,
        cost_price: parseFloat(f.cost_price) || 0,
        supplier: f.supplier.trim() || null,
      });
      onCreated(data);
    } catch (e2) {
      setErr(e2.response?.data?.error || 'Could not add this to the price list');
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} {...overlayClose(onClose)}>
      <div className={styles.modal} style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>Add to Price List</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={save}>
          <div className={styles.modalBody}>
            {err && <div className={styles.errorBanner}>{err}</div>}

            <div className={styles.field}>
              <label>Product Code</label>
              <input ref={nameRef} value={f.name} onChange={e => set('name', e.target.value)}
                placeholder="e.g. WS-600300 — the supplier's code" />
              <span className={styles.propHint}>
                How you order it. The customer never sees this — they read the description below.
              </span>
            </div>

            <div className={styles.field}>
              <label>Description</label>
              <input value={f.description} onChange={e => set('description', e.target.value)}
                placeholder="What the customer reads on the quote" />
            </div>

            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label>Cost Price (excl. GST)</label>
                <input type="number" min="0" step="0.01" value={f.cost_price}
                  onChange={e => setCost(e.target.value)} placeholder="0.00" />
              </div>
              <div className={styles.field}>
                <label>Sell Price (excl. GST)</label>
                <input type="number" min="0" step="0.01" value={f.unit_price}
                  onChange={e => set('unit_price', e.target.value)} placeholder="0.00" />
                {markupPct > 0 && (
                  <span className={styles.propHint}>Fills itself in at cost + {markupPct}% until you type one.</span>
                )}
              </div>
              <div className={styles.field}>
                <label>Unit</label>
                <input value={f.unit} onChange={e => set('unit', e.target.value)} placeholder="each" />
              </div>
              <div className={styles.field}>
                <label>Supplier</label>
                <input value={f.supplier} onChange={e => set('supplier', e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div className={styles.field}>
              <label>Category</label>
              <input list="new-product-categories" value={f.category}
                onChange={e => set('category', e.target.value)} placeholder="Optional" />
              <datalist id="new-product-categories">
                {categories.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>
          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? 'Adding…' : 'Add & Use Here'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
