import { useState, useRef } from 'react';
import api from '../../lib/api';
import styles from './Jobs.module.css';

const GST_RATE = 0.15;

export default function JobCosts({ jobId, lineItems, onItemsAdded, readonly }) {
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [gstTreatment, setGstTreatment] = useState('exclusive');
  const [scanError, setScanError] = useState('');
  const [adding, setAdding] = useState(false);
  const fileRef = useRef();

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
          setScanError('No line items found in this document. Try a clearer image.');
        } else {
          setScanResults(data.items.map(i => ({ ...i, selected: true })));
          setGstTreatment(data.gst_treatment || 'exclusive');
        }
      } catch (err) {
        setScanError(err.response?.data?.error || 'Scan failed');
      } finally { setScanning(false); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function handleAddToJob() {
    const selected = scanResults.filter(i => i.selected);
    if (!selected.length) return;
    setAdding(true);
    try {
      const existing = lineItems.map(i => ({
        description: i.description,
        quantity: i.quantity,
        unit_price: i.unit_price / 100,
        product_id: i.product_id || null,
      }));
      const toAdd = selected.map(i => ({
        description: i.description,
        quantity: i.quantity,
        unit_price: parseFloat(i.unit_price) || 0,
        product_id: null,
      }));
      await api.put(`/jobs/${jobId}/line-items`, { items: [...existing, ...toAdd] });
      onItemsAdded();
      setScanResults(null);
    } finally { setAdding(false); }
  }

  function exGst(price) { return parseFloat(price) || 0; }
  function incGst(price) { return exGst(price) * (1 + GST_RATE); }

  const costItems = lineItems || [];
  const totalExGst = costItems.reduce((s, i) => s + (i.unit_price / 100) * i.quantity, 0);
  const totalIncGst = totalExGst * (1 + GST_RATE);

  return (
    <div>
      {/* Existing line items with GST columns */}
      {costItems.length > 0 && (
        <div className={styles.costsTable}>
          <div className={styles.costsHeader}>
            <span>Description</span>
            <span>Qty</span>
            <span>Ex-GST</span>
            <span>GST (15%)</span>
            <span>Inc-GST</span>
            <span>Total Inc-GST</span>
          </div>
          {costItems.map((item, idx) => {
            const ex = item.unit_price / 100;
            const gst = ex * GST_RATE;
            const inc = ex * (1 + GST_RATE);
            const lineTotal = inc * item.quantity;
            return (
              <div key={idx} className={styles.costsRow}>
                <span>{item.description}</span>
                <span>{item.quantity}</span>
                <span>${ex.toFixed(2)}</span>
                <span className={styles.gstCell}>${gst.toFixed(2)}</span>
                <span>${inc.toFixed(2)}</span>
                <span className={styles.costsTotalCell}>${lineTotal.toFixed(2)}</span>
              </div>
            );
          })}
          <div className={styles.costsTotalsRow}>
            <span style={{ gridColumn: '1 / 5', textAlign: 'right', fontWeight: 600 }}>Total</span>
            <span className={styles.costsTotalExGst}>${totalExGst.toFixed(2)} ex-GST</span>
            <span className={styles.costsTotalIncGst}>${totalIncGst.toFixed(2)} inc-GST</span>
          </div>
        </div>
      )}

      {costItems.length === 0 && !scanResults && (
        <div className={styles.emptySmall}>No cost items yet. Scan a supplier invoice below to add costs.</div>
      )}

      {/* Scanner */}
      {!readonly && (
        <div className={styles.costsScanner}>
          <div className={styles.costsScannerTitle}>Scan Supplier Invoice / Receipt</div>
          <label className={`${styles.btnScan} ${scanning ? styles.btnScanBusy : ''}`}>
            {scanning ? <><span className={styles.scanSpinner} /> Scanning…</> : <>✨ Upload Invoice / Receipt</>}
            <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
              onChange={handleScanFile} disabled={scanning} />
          </label>
          <span className={styles.scanHintText}>JPG, PNG, PDF · max 10MB</span>
        </div>
      )}

      {scanError && <div className={styles.scanError}>{scanError}</div>}

      {scanResults && (
        <div className={styles.scanPanel}>
          <div className={styles.scanPanelHeader}>
            <div>
              <strong>AI found {scanResults.length} item{scanResults.length !== 1 ? 's' : ''}</strong>
              <span className={styles.scanHint}>
                Prices detected as <strong>{gstTreatment === 'inclusive' ? 'GST-inclusive' : 'GST-exclusive'}</strong> — shown below as ex-GST
              </span>
            </div>
            <button className={styles.scanDiscard} onClick={() => setScanResults(null)}>Discard</button>
          </div>

          {/* Scan result rows with GST columns */}
          <div className={styles.scanResultsHeader}>
            <span />
            <span>Description</span>
            <span>Qty</span>
            <span>Ex-GST</span>
            <span>GST</span>
            <span>Inc-GST</span>
          </div>
          {scanResults.map((item, idx) => {
            const ex = parseFloat(item.unit_price) || 0;
            const gst = ex * GST_RATE;
            const inc = ex * (1 + GST_RATE);
            return (
              <div key={idx} className={styles.scanResultRow}>
                <input type="checkbox" checked={item.selected}
                  onChange={e => setScanResults(r => r.map((x, i) => i === idx ? { ...x, selected: e.target.checked } : x))} />
                <input className={styles.scanDesc} value={item.description}
                  onChange={e => setScanResults(r => r.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} />
                <input type="number" className={styles.scanQty} value={item.quantity} min="0.01" step="0.01"
                  onChange={e => setScanResults(r => r.map((x, i) => i === idx ? { ...x, quantity: parseFloat(e.target.value) || 1 } : x))} />
                <div className={styles.scanPriceField}>
                  <span>$</span>
                  <input type="number" value={ex.toFixed(2)} min="0" step="0.01"
                    onChange={e => setScanResults(r => r.map((x, i) => i === idx ? { ...x, unit_price: parseFloat(e.target.value) || 0 } : x))} />
                </div>
                <span className={styles.gstCell}>${(gst * item.quantity).toFixed(2)}</span>
                <span className={styles.scanIncGst}>${(inc * item.quantity).toFixed(2)}</span>
              </div>
            );
          })}

          <div className={styles.scanActions}>
            <span className={styles.scanHint}>{scanResults.filter(i => i.selected).length} of {scanResults.length} selected</span>
            <button className={styles.btnPrimary} onClick={handleAddToJob}
              disabled={adding || !scanResults.some(i => i.selected)}>
              {adding ? 'Adding…' : '✓ Add Selected to Job'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
