import { useState } from 'react';
import api from '../../lib/api';
import BarcodeScanner from '../../components/BarcodeScanner';
import styles from './Stock.module.css';

// Teaching the app a barcode it has never seen.
//
// This is the one place a code we do not hold is the point rather than a
// mistake, which is why it is separate and why it is admins only: a barcode
// filed against the wrong product is wrong on every scan afterwards and
// nobody thinks to doubt it.
//
// So the camera is deliberately unfiltered here, and the digits are put in
// front of somebody to check against the packet before anything is saved.
// That read is the only thing standing between a misread and permanent bad
// data, so it is the whole screen rather than a line of small print.
export default function AddBarcodeFlow({ onClose, onSaved }) {
  const [code, setCode] = useState(null);
  const [products, setProducts] = useState(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Making one from scratch, for something not on the price list at all.
  const [making, setMaking] = useState(null);

  async function take(scanned) {
    setCode(scanned);
    setError('');
    if (products) return;
    try {
      const { data } = await api.get('/products', { params: { limit: 500 } });
      setProducts(data.products || data || []);
    } catch { setProducts([]); }
  }

  async function assign(product) {
    setBusy(true); setError('');
    try {
      await api.post('/stock/barcodes', { product_id: product.id, code, source: 'supplier' });
      onSaved?.(code, product);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save that barcode');
      setBusy(false);
    }
  }

  async function createAndAssign(e) {
    e.preventDefault();
    if (!making.name.trim()) { setError('Give the product a name'); return; }
    setBusy(true); setError('');
    try {
      const { data: product } = await api.post('/products', {
        name: making.name.trim(),
        supplier: making.supplier.trim() || null,
        sku: making.sku.trim() || null,
        unit: making.unit.trim() || 'each',
        cost_price: parseFloat(making.cost) || 0,
        // Sell price is a decision with a margin in it, made on the price
        // list. Left at cost here rather than invented.
        unit_price: parseFloat(making.cost) || 0,
      });
      await api.post('/stock/barcodes', { product_id: product.id, code, source: 'supplier' });
      onSaved?.(code, product);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add that product');
      setBusy(false);
    }
  }

  if (!code) {
    return (
      <BarcodeScanner
        title="Add a new barcode"
        hint="Scan the packet. Nothing is saved until you have checked the number against it."
        onScan={take}
        onClose={onClose}
      />
    );
  }

  const term = search.trim().toLowerCase();
  const matches = (term
    ? (products || []).filter(p => p.name.toLowerCase().includes(term)
        || String(p.sku || '').toLowerCase().includes(term))
    : (products || [])).slice(0, 25);

  return (
    <div className={styles.scanOverlay}>
      <div className={styles.scanPanel}>
        <div className={styles.scanHeader}>
          <h2>Add a new barcode</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.checkCode}>
          <div className={styles.checkCodeLabel}>Read from the packet</div>
          <div className={styles.checkCodeValue}>{code}</div>
          <p className={styles.assignHelp}>
            Check this against the number printed under the bars. A camera gets it
            wrong often enough to matter, and a barcode saved against the wrong
            product stays wrong.
          </p>
          <button className={styles.btnSecondary} onClick={() => { setCode(null); setMaking(null); }}>
            That is not it — scan again
          </button>
        </div>

        {error && <div className={styles.scanError}>{error}</div>}

        {making ? (
          <form className={styles.assignBox} onSubmit={createAndAssign}>
            <div className={styles.assignTitle}>New price list product</div>
            <input className={styles.input} placeholder="Name" autoFocus
              value={making.name} onChange={e => setMaking(m => ({ ...m, name: e.target.value }))} />
            <input className={styles.input} placeholder="Supplier"
              value={making.supplier} onChange={e => setMaking(m => ({ ...m, supplier: e.target.value }))} />
            <input className={styles.input} placeholder="Supplier's code (optional)"
              value={making.sku} onChange={e => setMaking(m => ({ ...m, sku: e.target.value }))} />
            <input className={styles.input} placeholder="Unit — each, m, box"
              value={making.unit} onChange={e => setMaking(m => ({ ...m, unit: e.target.value }))} />
            <input className={styles.input} type="number" step="0.01" min="0" placeholder="Cost price, ex-GST"
              value={making.cost} onChange={e => setMaking(m => ({ ...m, cost: e.target.value }))} />
            <p className={styles.assignHelp}>
              Added at cost with no margin — set the sell price on the Price List when
              you know what it should be.
            </p>
            <div className={styles.confirmButtons}>
              <button type="submit" className={styles.btnPrimary} disabled={busy}>
                {busy ? 'Saving…' : 'Add it and save the barcode'}
              </button>
              <button type="button" className={styles.btnSecondary} onClick={() => setMaking(null)} disabled={busy}>
                Back
              </button>
            </div>
          </form>
        ) : (
          <div className={styles.assignBox}>
            <div className={styles.assignTitle}>Which product is it?</div>
            <input className={styles.input} placeholder="Search the price list…"
              value={search} onChange={e => setSearch(e.target.value)} />
            <div className={styles.assignResults}>
              {products === null && <div className={styles.muted}>Loading the price list…</div>}
              {products !== null && matches.map(p => (
                <button key={p.id} className={styles.assignResult} onClick={() => assign(p)} disabled={busy}>
                  <span>{p.name}</span>
                  <span className={styles.muted}>{[p.sku, p.category].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
              {products !== null && matches.length === 0 && (
                <div className={styles.muted}>Nothing on the price list matches.</div>
              )}
            </div>
            <button className={styles.btnSecondary}
              onClick={() => setMaking({ name: search.trim(), supplier: '', sku: '', unit: 'each', cost: '' })}>
              It is not on the price list — add it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
