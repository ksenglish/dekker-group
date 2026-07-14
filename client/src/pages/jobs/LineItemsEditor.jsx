import { useState, useEffect } from 'react';
import styles from './Jobs.module.css';
import ProductSearch from '../../components/products/ProductSearch';

const GST_RATE = 0.15;

export default function LineItemsEditor({ items: initialItems, onSave, readonly }) {
  const [items, setItems] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setItems(initialItems.map(i => ({
      ...i,
      // Stored excl. GST (cents) — shown/edited here incl. GST, since that's
      // the figure the team quotes customers.
      unit_price: ((i.unit_price / 100) * (1 + GST_RATE)).toFixed(2),
    })));
    setDirty(false);
  }, [initialItems]);

  function addRow() {
    setItems(i => [...i, { description: '', quantity: 1, unit_price: '0.00', product_id: null }]);
    setDirty(true);
  }

  function removeRow(idx) {
    setItems(i => i.filter((_, j) => j !== idx));
    setDirty(true);
  }

  function update(idx, key, val) {
    setItems(i => i.map((row, j) => j === idx ? { ...row, [key]: val } : row));
    setDirty(true);
  }

async function handleSave() {
    setSaving(true);
    await onSave(items.map(i => ({
      description: i.description,
      quantity: parseFloat(i.quantity) || 1,
      // Convert the incl.-GST figure the team edits back to excl. GST for storage.
      unit_price: (parseFloat(i.unit_price) || 0) / (1 + GST_RATE),
      product_id: i.product_id || null,
    })));
    setDirty(false);
    setSaving(false);
  }

  return (
    <div>
      <div className={styles.lineItemsHeader}>
        <div>Description</div>
        <div>Qty</div>
        <div>Unit Price (NZD, incl. GST)</div>
        <div>Line Total</div>
        {!readonly && <div />}
      </div>

      {items.length === 0 && (
        <div className={styles.emptySmall}>{readonly ? 'No line items.' : 'No items yet. Add a material or labour line below.'}</div>
      )}

      {items.map((item, idx) => (
        <div key={idx} className={styles.lineItemRow}>
          {readonly ? (
            <>
              <span>{item.description}</span>
              <span>{item.quantity}</span>
              <span>${parseFloat(item.unit_price).toFixed(2)}</span>
              <span>${(parseFloat(item.unit_price) * parseFloat(item.quantity)).toFixed(2)}</span>
            </>
          ) : (
            <>
              <ProductSearch
                value={item.description}
                onChange={({ description, unit_price, unit, product_id }) => {
                  setItems(its => its.map((row, j) => j !== idx ? row : {
                    ...row,
                    description,
                    // unit_price from ProductSearch is the product's excl.-GST price
                    ...(unit_price !== null ? { unit_price: (unit_price * (1 + GST_RATE)).toFixed(2) } : {}),
                    product_id: product_id ?? row.product_id,
                  }));
                  setDirty(true);
                }}
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
          {dirty && (
            <button className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Items'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
