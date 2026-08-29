import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './Jobs.module.css';
import ProductSearch from '../../components/products/ProductSearch';

const GST_RATE = 0.15;

// Rows need a key that belongs to the row, not to its position.
//
// Keying by array index made deleting a middle row look like it deleted the
// last one: React kept the component instance sitting at that index and handed
// it the next row's data, but ProductSearch holds the description in its own
// state and only reads the prop once, so it carried on showing the deleted
// row's text. The state was right and the screen was wrong — and editing that
// row then changed a different line from the one on screen.
//
// Saved rows have an id; new ones get a counter until they are saved.
let rowSeq = 0;
const nextRowKey = () => `new-${++rowSeq}`;

const AUTOSAVE_DELAY = 1200;

// autoSave is on by default so the Jobs line items keep behaving as they
// always have. The quote editor turns it off: a quote is a document that gets
// reviewed before it goes out, so it saves when you say so, and warns if you
// leave without doing it. onDirtyChange lets that page fold unsaved line items
// into its own leave prompt.
export default function LineItemsEditor({ items: initialItems, onSave, readonly, autoSave = true, onDirtyChange }) {
  const [items, setItems] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  // Read inside callbacks that must not be re-created on every keystroke.
  const dirtyRef = useRef(false);
  const itemsRef = useRef([]);
  const timerRef = useRef(null);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  // Let the parent fold unsaved line items into its own leave prompt
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  useEffect(() => {
    // Local edits are newer than anything arriving from the server — a save
    // landing mid-typing must not overwrite what's still being typed.
    if (dirtyRef.current) return;
    setItems(initialItems.map(i => ({
      ...i,
      _key: i.id || nextRowKey(),
      // Stored excl. GST (cents) — shown/edited here incl. GST, since that's
      // the figure the team quotes customers.
      unit_price: ((i.unit_price / 100) * (1 + GST_RATE)).toFixed(2),
    })));
  }, [initialItems]);

  const toPayload = rows => rows.map(i => ({
    description: i.description,
    quantity: parseFloat(i.quantity) || 1,
    // Convert the incl.-GST figure the team edits back to excl. GST for storage.
    unit_price: (parseFloat(i.unit_price) || 0) / (1 + GST_RATE),
    product_id: i.product_id || null,
    product_name: i.product_name || null,
  }));

  const save = useCallback(async rows => {
    clearTimeout(timerRef.current);
    setSaving(true);
    try {
      await onSave(toPayload(rows));
      setDirty(false);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }, [onSave]);

  // A blank row can't be saved — the server drops line items with no
  // description, so saving mid-entry would delete the row being typed into.
  // Autosave waits until every row has something in it.
  const scheduleSave = useCallback(() => {
    if (!autoSave) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const rows = itemsRef.current;
      if (rows.some(r => !String(r.description || '').trim())) return;
      save(rows);
    }, AUTOSAVE_DELAY);
  }, [save, autoSave]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function addRow() {
    setItems(i => [...i, { _key: nextRowKey(), description: '', quantity: 1, unit_price: '0.00', product_id: null, product_name: '' }]);
    setDirty(true);
  }

  // Removing a line is unambiguous and can't be half-finished, so it saves
  // straight away rather than waiting out the debounce.
  function removeRow(idx) {
    const next = items.filter((_, j) => j !== idx);
    setItems(next);
    setDirty(true);
    itemsRef.current = next;
    if (autoSave && !next.some(r => !String(r.description || '').trim())) save(next);
  }

  function update(idx, key, val) {
    setItems(i => i.map((row, j) => j === idx ? { ...row, [key]: val } : row));
    setDirty(true);
    scheduleSave();
  }

  async function handleSave() {
    await save(itemsRef.current);
  }

  return (
    <div>
      <div className={styles.lineItemsHeader}>
        <div>Description</div>
        <div title="Supplier code for ordering — not shown on the customer's quote">Product Name</div>
        <div>Qty</div>
        <div>Unit Price (NZD, incl. GST)</div>
        <div>Line Total</div>
        {!readonly && <div />}
      </div>

      {items.length === 0 && (
        <div className={styles.emptySmall}>{readonly ? 'No line items.' : 'No items yet. Add a material or labour line below.'}</div>
      )}

      {items.map((item, idx) => (
        <div key={item._key} className={styles.lineItemRow}>
          {readonly ? (
            <>
              <span>{item.description}</span>
              <span className={styles.productCode}>{item.product_name || '—'}</span>
              <span>{item.quantity}</span>
              <span>${parseFloat(item.unit_price).toFixed(2)}</span>
              <span>${(parseFloat(item.unit_price) * parseFloat(item.quantity)).toFixed(2)}</span>
            </>
          ) : (
            <>
              <ProductSearch
                value={item.description}
                onChange={({ description, unit_price, unit, product_id, product_name }) => {
                  setItems(its => its.map((row, j) => j !== idx ? row : {
                    ...row,
                    description,
                    // unit_price from ProductSearch is the product's excl.-GST price
                    ...(unit_price !== null ? { unit_price: (unit_price * (1 + GST_RATE)).toFixed(2) } : {}),
                    product_id: product_id ?? row.product_id,
                    // Only overwrite the code when a product was actually
                    // picked — free-typing the description shouldn't wipe it.
                    ...(product_name !== null ? { product_name } : {}),
                  }));
                  setDirty(true);
                  scheduleSave();
                }}
              />
              <input
                value={item.product_name || ''}
                onChange={e => update(idx, 'product_name', e.target.value)}
                placeholder="Code"
                title="Supplier code for ordering — not shown on the customer's quote"
              />
              <input
                type="number" min="0.01" step="0.01"
                value={item.quantity}
                onChange={e => update(idx, 'quantity', e.target.value)}
              />
              <input
                type="number" min="0" step="0.01"
                value={item.unit_price}
                onChange={e => update(idx, 'unit_price', e.target.value)}
              />
              <span className={styles.lineTotal}>
                ${((parseFloat(item.unit_price) || 0) * (parseFloat(item.quantity) || 0)).toFixed(2)}
              </span>
              <button className={styles.deleteBtn} style={{ position: 'static' }} onClick={() => removeRow(idx)}>✕</button>
            </>
          )}
        </div>
      ))}

      {!readonly && (
        <div className={styles.lineItemActions}>
          <button className={styles.btnSmall} onClick={addRow}>+ Add Line</button>
          {/* With autosave on this covers a row that can't save itself yet —
              one still waiting for a description. With it off it's the only
              way items get saved, so it stays visible rather than appearing
              only once something is dirty. */}
          {(dirty || !autoSave) && (
            <button className={styles.btnPrimary} onClick={handleSave} disabled={saving || !dirty}>
              {saving ? 'Saving…' : dirty ? 'Save Items' : 'Saved'}
            </button>
          )}
          <span className={styles.autosaveHint} style={dirty && !autoSave ? { color: '#b45309', fontWeight: 600 } : undefined}>
            {saving ? 'Saving…'
              : dirty ? '● Unsaved changes'
              : savedAt ? 'Saved' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
