import { useState } from 'react';
import api from '../../lib/api';
import { code128Svg } from '../../lib/code128';
import styles from './Stock.module.css';

// Printable labels for stock that has no barcode of its own — offcuts, loose
// fittings, anything that didn't come in a branded box. Products that already
// carry a maker's barcode don't need one, so they're offered separately rather
// than mixed in.
export default function LabelSheet({ rows, onClose }) {
  const [items, setItems] = useState(rows);
  const [busyId, setBusyId] = useState(null);

  const withInternal = items.filter(r => (r.barcodes || []).some(b => b.source === 'internal'));
  const withoutAny = items.filter(r => (r.barcodes || []).length === 0);

  async function generate(row) {
    setBusyId(row.id);
    try {
      const { data } = await api.post('/stock/barcodes/generate', { product_id: row.id });
      setItems(list => list.map(r => (
        r.id === row.id ? { ...r, barcodes: [...(r.barcodes || []), { code: data.code, source: 'internal' }] } : r
      )));
    } catch (err) {
      alert(err.response?.data?.error || 'Could not create a label code');
    } finally { setBusyId(null); }
  }

  return (
    <div className={styles.scanOverlay}>
      <div className={`${styles.scanPanel} ${styles.labelPanel}`}>
        <div className={styles.scanHeader}>
          <h2>Stock labels</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.labelBody}>
          {withoutAny.length > 0 && (
            <>
              <div className={styles.labelSectionTitle}>Needs a label</div>
              <p className={styles.assignHelp}>
                These have no barcode at all. Create one to print and stick on.
              </p>
              {withoutAny.map(row => (
                <div key={row.id} className={styles.labelNeedRow}>
                  <span>{row.name}</span>
                  <button
                    className={styles.btnSecondary}
                    onClick={() => generate(row)}
                    disabled={busyId === row.id}
                  >
                    {busyId === row.id ? 'Creating…' : 'Create label'}
                  </button>
                </div>
              ))}
            </>
          )}

          {withInternal.length > 0 && (
            <>
              <div className={styles.labelSectionTitle}>Ready to print</div>
              <div className={styles.labelGrid}>
                {withInternal.map(row => {
                  const code = row.barcodes.find(b => b.source === 'internal').code;
                  const svg = code128Svg(code, { moduleWidth: 2, height: 52 });
                  return (
                    <div key={row.id} className={styles.label}>
                      <div className={styles.labelName}>{row.name}</div>
                      {svg
                        ? <div className={styles.labelBarcode} dangerouslySetInnerHTML={{ __html: svg }} />
                        : <div className={styles.muted}>Could not render</div>}
                      <div className={styles.labelCode}>{code}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {withoutAny.length === 0 && withInternal.length === 0 && (
            <div className={styles.empty}>
              Everything tracked already has a barcode. Labels are only needed for stock
              that doesn't come with one.
            </div>
          )}
        </div>

        <div className={styles.labelFooter}>
          <button className={styles.btnPrimary} onClick={() => window.print()} disabled={withInternal.length === 0}>
            Print
          </button>
          <button className={styles.btnSecondary} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
