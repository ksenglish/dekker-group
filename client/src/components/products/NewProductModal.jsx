import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import { ImageUpload, BrochureUpload, PRODUCT_UNITS } from './MediaUpload';
import styles from '../../pages/products/Products.module.css';
import { overlayClose } from '../../lib/overlayClose';

// Adds a product to the price list from wherever you happened to notice it was
// missing — a proposal row typed by hand, most often. Same fields, same layout
// and the same stylesheet as Add Product on the Price List, so there is only
// one form to learn. It saves the product and hands it straight back, so the
// row it came from is filled in at the same time.
//
// Three things it does that the Price List form doesn't, because of where it
// is used:
//   · the cost can be entered including GST, which is how a supplier invoice
//     quotes it (the price list still stores it excluding)
//   · the supplier is picked from the ones already in use, with a button to
//     add a new one — the proposal editor is where new suppliers turn up
//   · the sell price follows the cost at the proposal's markup until typed

const GST_RATE = 0.15;
const exGst = incl => incl / (1 + GST_RATE);

export default function NewProductModal({
  initialDescription = '', initialCostDollars = '', initialChargeDollars = '', markupPct = 0,
  onCreated, onClose,
}) {
  const [form, setForm] = useState({
    name: '',
    description: initialDescription,
    quote_description: '',
    category: '',
    subcategory_1: '', subcategory_2: '', subcategory_3: '', subcategory_4: '',
    supplier: '',
    unit: 'each',
    unit_price: initialChargeDollars && parseFloat(initialChargeDollars) > 0 ? initialChargeDollars : '',
    cost_price: initialCostDollars && parseFloat(initialCostDollars) > 0 ? initialCostDollars : '',
    media_base64: '',
    brochure_base64: '',
    is_active: true,
  });
  // Whether the cost being typed includes GST. The price list is always excl.,
  // so this only governs what the number in the box means on the way in.
  const [costInclGst, setCostInclGst] = useState(false);
  // The sell price follows the cost until it is typed into. An earlier version
  // stopped as soon as the field was non-empty, which meant the first keystroke
  // of a cost ("1" of "16.61") set the sell to $1.30 and locked it there.
  const [sellTouched, setSellTouched] = useState(
    !!(initialChargeDollars && parseFloat(initialChargeDollars) > 0)
  );
  const [suppliers, setSuppliers] = useState([]);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const nameRef = useRef();
  const newSupplierRef = useRef();

  useEffect(() => {
    api.get('/products/suppliers').then(r => setSuppliers(r.data || [])).catch(() => {});
    nameRef.current?.focus();
  }, []);
  useEffect(() => { if (addingSupplier) newSupplierRef.current?.focus(); }, [addingSupplier]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // What the typed cost comes to once GST is off it — the figure that is stored.
  const costExGst = (() => {
    const n = parseFloat(form.cost_price);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return costInclGst ? exGst(n) : n;
  })();

  function recalcSell(costEx, touched = sellTouched) {
    if (touched || !markupPct || costEx <= 0) return;
    setForm(f => ({ ...f, unit_price: (costEx * (1 + markupPct / 100)).toFixed(2) }));
  }

  function setCost(v) {
    setForm(f => ({ ...f, cost_price: v }));
    const n = parseFloat(v);
    recalcSell(Number.isFinite(n) && n > 0 ? (costInclGst ? exGst(n) : n) : 0);
  }

  function toggleGst(incl) {
    setCostInclGst(incl);
    const n = parseFloat(form.cost_price);
    recalcSell(Number.isFinite(n) && n > 0 ? (incl ? exGst(n) : n) : 0);
  }

  const margin = (() => {
    const sell = parseFloat(form.unit_price) || 0;
    if (!sell || !costExGst) return null;
    return (((sell - costExGst) / sell) * 100).toFixed(1);
  })();

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) return setErr('Name is required');
    setSaving(true); setErr('');
    try {
      const { data } = await api.post('/products', {
        ...form,
        name: form.name.trim(),
        supplier: form.supplier.trim() || null,
        // Dollars, always excluding GST — the server rounds to cents.
        unit_price: parseFloat(form.unit_price) || 0,
        cost_price: Math.round(costExGst * 100) / 100,
      });
      onCreated(data);
    } catch (e2) {
      setErr(e2.response?.data?.error || 'Save failed');
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay} {...overlayClose(onClose)}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2>Add to Price List</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={save} className={styles.modalBody}>
          {err && <div className={styles.formError}>{err}</div>}

          <div className={styles.formGrid}>
            <div className={styles.formGroup} style={{ gridColumn: '1/-1' }}>
              <label>Product Name *</label>
              <input ref={nameRef} value={form.name} onChange={e => set('name', e.target.value)}
                placeholder="e.g. Supply & Install Split System 2.5kW" />
            </div>
            <div className={styles.formGroup} style={{ gridColumn: '1/-1' }}>
              <label>Description</label>
              <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)}
                placeholder="The line that appears on the quote, e.g. Paling Fence 1.8m High" />
            </div>
            <div className={styles.formGroup} style={{ gridColumn: '1/-1' }}>
              <label>Quote Description</label>
              <textarea rows={3} value={form.quote_description}
                onChange={e => set('quote_description', e.target.value)}
                placeholder="Wording added to the quote's description box when this product is added" />
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                Description goes on the line item; this goes in the description box above the lines.
              </span>
            </div>
            <div className={styles.formGroup}>
              <label>Category</label>
              <input value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Dekker Air" />
            </div>
            <div className={styles.formGroup}>
              <label>Sub Category 1</label>
              <input value={form.subcategory_1} onChange={e => set('subcategory_1', e.target.value)} placeholder="e.g. Ventilation" />
            </div>
            <div className={styles.formGroup}>
              <label>Sub Category 2</label>
              <input value={form.subcategory_2} onChange={e => set('subcategory_2', e.target.value)} placeholder="e.g. Extraction" />
            </div>
            <div className={styles.formGroup}>
              <label>Sub Category 3</label>
              <input value={form.subcategory_3} onChange={e => set('subcategory_3', e.target.value)} placeholder="e.g. Inline Fans" />
            </div>
            <div className={styles.formGroup}>
              <label>Sub Category 4</label>
              <input value={form.subcategory_4} onChange={e => set('subcategory_4', e.target.value)} placeholder="e.g. 150mm" />
            </div>

            {/* Picked from what is already in use, so the same supplier doesn't
                end up spelled two ways. A new one is typed deliberately. */}
            <div className={styles.formGroup}>
              <label>Supplier</label>
              {addingSupplier ? (
                <div className={styles.supplierRow}>
                  <input ref={newSupplierRef} value={form.supplier}
                    onChange={e => set('supplier', e.target.value)}
                    placeholder="e.g. Daikin NZ, Mitsubishi Electric" />
                  <button type="button" className={styles.supplierBtn}
                    onClick={() => { setAddingSupplier(false); set('supplier', ''); }}>Cancel</button>
                </div>
              ) : (
                <div className={styles.supplierRow}>
                  <select value={form.supplier} onChange={e => set('supplier', e.target.value)}>
                    <option value="">— None —</option>
                    {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button type="button" className={styles.supplierBtn}
                    onClick={() => { setAddingSupplier(true); set('supplier', ''); }}>+ Add Supplier</button>
                </div>
              )}
            </div>

            <div className={styles.formGroup}>
              <label>Unit</label>
              <select value={form.unit} onChange={e => set('unit', e.target.value)}>
                {PRODUCT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label>Sell Price excl. GST</label>
              <input type="number" min="0" step="0.01" value={form.unit_price}
                onChange={e => { setSellTouched(true); set('unit_price', e.target.value); }}
                placeholder="0.00" />
              {markupPct > 0 && (
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {sellTouched
                    ? <>Typed in. <button type="button" className={styles.linkBtn}
                        onClick={() => { setSellTouched(false); recalcSell(costExGst, false); }}>
                        Use cost + {markupPct}%
                      </button></>
                    : <>Follows the cost at + {markupPct}% until you type one.</>}
                </span>
              )}
            </div>

            {/* The one field that differs from the Price List form: a supplier
                invoice quotes the inclusive figure, so it can be typed either
                way and is converted on the way in. */}
            <div className={styles.formGroup}>
              <label>Cost Price</label>
              <div className={styles.gstToggle}>
                {[[false, 'Excl. GST'], [true, 'Incl. GST']].map(([incl, label]) => (
                  <button key={label} type="button"
                    className={`${styles.gstBtn} ${costInclGst === incl ? styles.gstBtnOn : ''}`}
                    onClick={() => toggleGst(incl)}>{label}</button>
                ))}
                <input type="number" min="0" step="0.01" value={form.cost_price}
                  onChange={e => setCost(e.target.value)} placeholder="0.00" />
              </div>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {costInclGst
                  ? <>Stored as <strong>${costExGst.toFixed(2)}</strong> excl. GST.</>
                  : <>Switch to Incl. GST to type the figure straight off a supplier invoice.</>}
              </span>
            </div>

            <div className={styles.formGroup} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 2 }}>
              {margin !== null && (
                <div className={styles.marginBadge}>Margin: <strong>{margin}%</strong></div>
              )}
            </div>
          </div>

          <div className={styles.formGroup}>
            <label>Product Image <span style={{ fontWeight: 400, color: '#64748b' }}>(thumbnail shown on quotes)</span></label>
            <ImageUpload value={form.media_base64} onChange={v => set('media_base64', v)} />
          </div>

          <div className={styles.formGroup}>
            <label>Product Brochure <span style={{ fontWeight: 400, color: '#64748b' }}>(full page appended to quote PDF — JPG / PNG)</span></label>
            <BrochureUpload value={form.brochure_base64} onChange={v => set('brochure_base64', v)} />
          </div>

          <div className={styles.formGroup} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="new_product_active" checked={form.is_active}
              onChange={e => set('is_active', e.target.checked)} />
            <label htmlFor="new_product_active" style={{ marginBottom: 0 }}>Active (shows in search)</label>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? 'Saving…' : 'Add & Use Here'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
