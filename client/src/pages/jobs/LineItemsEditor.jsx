import { useState, useEffect } from 'react';
import styles from './Jobs.module.css';
import ProductSearch from '../../components/products/ProductSearch';
import api from '../../lib/api';

export default function LineItemsEditor({ items: initialItems, onSave, readonly }) {
  const [items, setItems] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [scanError, setScanError] = useState('');

  useEffect(() => {
    setItems(initialItems.map(i => ({
      ...i,
      unit_price: (i.unit_price / 100).toFixed(2),
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

  async function handleScanFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setScanError('File must be under 10MB'); return; }
    setScanning(true); setScanError(''); setScanResults(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const { data } = await api.post('/scan/invoice', {
          filename: file.name, mime_type: file.type, data_base64: ev.target.result,
        });
        if (data.items.length === 0) {
          setScanError('No line items found in this document. Try a clearer image or a different file.');
        } else {
          setScanResults(data.items.map(i => ({ ...i, selected: true })));
        }
      } catch (err) {
        setScanError(err.response?.data?.error || 'Scan failed — check your ANTHROPIC_API_KEY');
      } finally { setScanning(false); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function applyScanResults() {
    const toAdd = scanResults
      .filter(i => i.selected)
      .map(i => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price.toFixed(2), product_id: null }));
    setItems(current => [...current, ...toAdd]);
    setDirty(true);
    setScanResults(null);
  }

  async function handleSave() {
    setSaving(true);
    await onSave(items.map(i => ({
      description: i.description,
      quantity: parseFloat(i.quantity) || 1,
      unit_price: parseFloat(i.unit_price) || 0,
      product_id: i.product_id || null,
    })));
    setDirty(false);
    setSaving(false);
  }

  const subtotal = items.reduce((s, i) => s + (parseFloat(i.unit_price) || 0) * (parseFloat(i.quantity) || 0), 0);

  return (
    <div>
      <div className={styles.lineItemsHeader}>
        <div>Description</div>
        <div>Qty</div>
        <div>Unit Price (NZD)</div>
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
                    ...(unit_price !== null ? { unit_price: unit_price.toFixed(2) } : {}),
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
          <label className={styles.btnScan} title="Upload a supplier invoice or receipt — AI will extract line items automatically">
            {scanning ? (
              <><span className={styles.scanSpinner} /> Scanning…</>
            ) : (
              <>✨ Scan Invoice / Receipt</>
            )}
            <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
              onChange={handleScanFile} disabled={scanning} />
          </label>
          {dirty && (
            <button className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Items'}
            </button>
          )}
        </div>
      )}

      {scanError && (
        <div className={styles.scanError}>{scanError}</div>
      )}

      {scanResults && (
        <div className={styles.scanPanel}>
          <div className={styles.scanPanelHeader}>
            <div>
              <strong>AI found {scanResults.length} item{scanResults.length !== 1 ? 's' : ''}</strong>
              <span className={styles.scanHint}>Tick the ones to add, adjust prices if needed</span>
            </div>
            <button className={styles.scanDiscard} onClick={() => setScanResults(null)}>Discard</button>
          </div>
          {scanResults.map((item, idx) => (
            <div key={idx} className={styles.scanRow}>
              <input type="checkbox" checked={item.selected}
                onChange={e => setScanResults(r => r.map((x, i) => i === idx ? { ...x, selected: e.target.checked } : x))} />
              <input className={styles.scanDesc} value={item.description}
                onChange={e => setScanResults(r => r.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} />
              <input type="number" className={styles.scanQty} value={item.quantity} min="0.01" step="0.01"
                onChange={e => setScanResults(r => r.map((x, i) => i === idx ? { ...x, quantity: parseFloat(e.target.value) || 1 } : x))} />
              <div className={styles.scanPrice}>
                <span>$</span>
                <input type="number" value={item.unit_price.toFixed(2)} min="0" step="0.01"
                  onChange={e => setScanResults(r => r.map((x, i) => i === idx ? { ...x, unit_price: parseFloat(e.target.value) || 0 } : x))} />
              </div>
              <span className={styles.scanTotal}>${(item.unit_price * item.quantity).toFixed(2)}</span>
            </div>
          ))}
          <div className={styles.scanActions}>
            <span className={styles.scanHint}>{scanResults.filter(i => i.selected).length} of {scanResults.length} selected</span>
            <button className={styles.btnPrimary} onClick={applyScanResults}
              disabled={!scanResults.some(i => i.selected)}>
              ✓ Add Selected to Job
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
