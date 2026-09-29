import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import styles from '../../pages/jobs/Jobs.module.css';
import { overlayClose } from '../../lib/overlayClose';

// Adds a product to the price list from wherever you happened to notice it was
// missing — a proposal row typed by hand, most often. Saves the product and
// hands it straight back, so the row it came from is filled in at the same time
// and nothing has to be retyped.
//
// The price list stores everything excluding GST. Supplier invoices are usually
// GST-inclusive, so the cost can be entered either way and is converted here.
// Prices go to POST /products in dollars (the server converts to cents), which
// is the opposite of the proposal editor's cents — converted at the boundary.

const GST_RATE = 0.15;
const exGst = incl => incl / (1 + GST_RATE);

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
  // Whether the cost being typed includes GST. The price list is always excl.,
  // so this only governs what the number in the box means on the way in.
  const [costInclGst, setCostInclGst] = useState(false);
  // The sell price fills itself in from the cost until it is typed into. The
  // first version stopped as soon as the field was non-empty, which meant the
  // very first keystroke of a cost ("1" of "16.61") set the sell to $1.30 and
  // locked it there. It now follows the cost the whole way.
  const [sellTouched, setSellTouched] = useState(
    !!(initialChargeDollars && parseFloat(initialChargeDollars) > 0)
  );
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const nameRef = useRef();

  useEffect(() => {
    api.get('/products/categories').then(r => setCategories(r.data || [])).catch(() => {});
    api.get('/products/suppliers').then(r => setSuppliers(r.data || [])).catch(() => {});
    nameRef.current?.focus();
  }, []);

  const set = (k, v) => setF(x => ({ ...x, [k]: v }));

  // What the typed cost comes to once GST is off it — the figure that is stored.
  const costExGst = (() => {
    const n = parseFloat(f.cost_price);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return costInclGst ? exGst(n) : n;
  })();

  function recalcSell(costEx, touched = sellTouched) {
    if (touched || !markupPct || costEx <= 0) return;
    setF(x => ({ ...x, unit_price: (costEx * (1 + markupPct / 100)).toFixed(2) }));
  }

  function setCost(v) {
    setF(x => ({ ...x, cost_price: v }));
    const n = parseFloat(v);
    recalcSell(Number.isFinite(n) && n > 0 ? (costInclGst ? exGst(n) : n) : 0);
  }

  function toggleGst(incl) {
    setCostInclGst(incl);
    const n = parseFloat(f.cost_price);
    recalcSell(Number.isFinite(n) && n > 0 ? (incl ? exGst(n) : n) : 0);
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
        // Dollars, always excluding GST — the server rounds to cents.
        unit_price: parseFloat(f.unit_price) || 0,
        cost_price: Math.round(costExGst * 100) / 100,
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

            <div className={styles.field}>
              <label>Cost Price</label>
              <div className={styles.gstToggle}>
                {[[false, 'Excl. GST'], [true, 'Incl. GST']].map(([incl, label]) => (
                  <button key={label} type="button"
                    className={`${styles.gstBtn} ${costInclGst === incl ? styles.gstBtnOn : ''}`}
                    onClick={() => toggleGst(incl)}>{label}</button>
                ))}
                <input type="number" min="0" step="0.01" value={f.cost_price}
                  onChange={e => setCost(e.target.value)} placeholder="0.00" />
              </div>
              <span className={styles.propHint}>
                {costInclGst
                  ? <>Stored as <strong>${costExGst.toFixed(2)}</strong> excl. GST — supplier invoices usually quote the inclusive figure.</>
                  : <>The price list stores costs excluding GST. Switch to Incl. GST to type the figure off a supplier invoice.</>}
              </span>
            </div>

            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label>Sell Price (excl. GST)</label>
                <input type="number" min="0" step="0.01" value={f.unit_price}
                  onChange={e => { setSellTouched(true); set('unit_price', e.target.value); }}
                  placeholder="0.00" />
                {markupPct > 0 && (
                  <span className={styles.propHint}>
                    {sellTouched
                      ? <>Typed in. <button type="button" className={styles.linkBtn}
                          onClick={() => { setSellTouched(false); recalcSell(costExGst, false); }}>
                          Use cost + {markupPct}%
                        </button></>
                      : <>Follows the cost at + {markupPct}% until you type one.</>}
                  </span>
                )}
              </div>
              <div className={styles.field}>
                <label>Unit</label>
                <input value={f.unit} onChange={e => set('unit', e.target.value)} placeholder="each" />
              </div>
            </div>

            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label>Supplier</label>
                <input list="new-product-suppliers" value={f.supplier}
                  onChange={e => set('supplier', e.target.value)}
                  placeholder={suppliers.length ? 'Pick one, or type a new one' : 'Optional'} />
                <datalist id="new-product-suppliers">
                  {suppliers.map(s => <option key={s} value={s} />)}
                </datalist>
                <span className={styles.propHint}>
                  {suppliers.length
                    ? `Pick from the ${suppliers.length} already on the price list so the name stays consistent.`
                    : 'No suppliers on the price list yet.'}
                </span>
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
