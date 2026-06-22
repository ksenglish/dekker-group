import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import styles from './Jobs.module.css';

const GST_RATE = 0.15;
const VITE_API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export default function JobCosts({ jobId, readonly }) {
  const [costs, setCosts] = useState([]);
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [scanImageUrl, setScanImageUrl] = useState(null);
  const [gstTreatment, setGstTreatment] = useState('exclusive');
  const [scanError, setScanError] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const fileRef = useRef();

  useEffect(() => { load(); }, [jobId]);

  async function load() {
    setLoading(true);
    try {
      const [costsRes, scansRes] = await Promise.all([
        api.get(`/jobs/${jobId}/costs`),
        api.get(`/jobs/${jobId}/cost-scans`),
      ]);
      setCosts(costsRes.data);
      setScans(scansRes.data);
    } finally { setLoading(false); }
  }

  async function handleScanFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setScanError('File must be under 10MB'); return; }
    setScanning(true); setScanError(''); setScanResults(null); setScanImageUrl(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result;
      setScanImageUrl(dataUrl);
      try {
        const { data } = await api.post('/scan/invoice', {
          filename: file.name, mime_type: file.type, data_base64: dataUrl,
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
      await api.post(`/jobs/${jobId}/costs`, {
        items: selected.map(i => ({
          description: i.description,
          quantity: i.quantity,
          unit_price: parseFloat(i.unit_price) || 0,
        })),
        document_base64: scanImageUrl,
        mime_type: scanImageUrl?.match(/^data:([^;]+)/)?.[1] || 'image/jpeg',
        gst_treatment: gstTreatment,
      });
      await load();
      setScanResults(null);
      setScanImageUrl(null);
    } finally { setAdding(false); }
  }

  async function handleDelete(id) {
    setDeleting(id);
    try {
      await api.delete(`/jobs/${jobId}/costs/${id}`);
      setCosts(c => c.filter(x => x.id !== id));
    } finally { setDeleting(null); }
  }

  const totalExGst = costs.reduce((s, i) => s + (i.unit_price / 100) * i.quantity, 0);
  const totalIncGst = totalExGst * (1 + GST_RATE);

  const scanPreviewExGst = scanResults
    ? scanResults.filter(i => i.selected).reduce((s, i) => s + (parseFloat(i.unit_price) || 0) * (i.quantity || 1), 0)
    : 0;
  const scanPreviewIncGst = scanPreviewExGst * (1 + GST_RATE);

  if (loading) return <div className={styles.emptySmall}>Loading…</div>;

  return (
    <div>
      {/* Existing costs table */}
      {costs.length > 0 && (
        <div className={styles.costsTable}>
          <div className={styles.costsHeader}>
            <span>Description</span>
            <span>Qty</span>
            <span>Ex-GST</span>
            <span>GST (15%)</span>
            <span>Inc-GST</span>
            <span>Total Inc-GST</span>
            {!readonly && <span />}
          </div>
          {costs.map((item) => {
            const ex = item.unit_price / 100;
            const gst = ex * GST_RATE;
            const inc = ex * (1 + GST_RATE);
            const lineTotal = inc * item.quantity;
            return (
              <div key={item.id} className={styles.costsRow}>
                <span>{item.description}</span>
                <span>{item.quantity}</span>
                <span>${ex.toFixed(2)}</span>
                <span className={styles.gstCell}>${gst.toFixed(2)}</span>
                <span>${inc.toFixed(2)}</span>
                <span className={styles.costsTotalCell}>${lineTotal.toFixed(2)}</span>
                {!readonly && (
                  <button className={styles.deleteBtn} style={{ position: 'static' }}
                    disabled={deleting === item.id} onClick={() => handleDelete(item.id)}>
                    {deleting === item.id ? '…' : '✕'}
                  </button>
                )}
              </div>
            );
          })}
          <div className={styles.costsTotalsRow}>
            <span style={{ gridColumn: `1 / ${readonly ? 5 : 6}`, textAlign: 'right', fontWeight: 600 }}>Total</span>
            <span className={styles.costsTotalExGst}>${totalExGst.toFixed(2)} ex-GST</span>
            <span className={styles.costsTotalIncGst}>${totalIncGst.toFixed(2)} inc-GST</span>
            {!readonly && <span />}
          </div>
        </div>
      )}

      {costs.length === 0 && !scanResults && (
        <div className={styles.emptySmall}>No cost items yet. Scan a supplier invoice below to add costs.</div>
      )}

      {/* Scanner upload button */}
      {!readonly && !scanResults && (
        <div className={styles.costsScanner}>
          <div className={styles.costsScannerTitle}>Scan Supplier Invoice / Receipt</div>
          <label className={`${styles.btnScan} ${scanning ? styles.btnScanBusy : ''}`}>
            {scanning ? <><span className={styles.scanSpinner} /> Scanning…</> : <>✨ Upload Invoice / Receipt</>}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={handleScanFile} disabled={scanning} />
          </label>
          <span className={styles.scanHintText}>JPG, PNG or WebP · max 10MB</span>
        </div>
      )}

      {scanError && <div className={styles.scanError}>{scanError}</div>}

      {/* Scan preview: line items + document image side by side */}
      {scanResults && (
        <div className={styles.scanPreviewLayout}>
          {/* Left: line items */}
          <div className={styles.scanPanel} style={{ flex: 1, minWidth: 0 }}>
            <div className={styles.scanPanelHeader}>
              <div>
                <strong>AI found {scanResults.length} item{scanResults.length !== 1 ? 's' : ''}</strong>
                <span className={styles.scanHint}>
                  Prices detected as <strong>{gstTreatment === 'inclusive' ? 'GST-inclusive' : 'GST-exclusive'}</strong> — stored as ex-GST
                </span>
              </div>
              <button className={styles.scanDiscard} onClick={() => { setScanResults(null); setScanImageUrl(null); }}>Discard</button>
            </div>

            <div className={styles.scanResultsHeader}>
              <span />
              <span>Description</span>
              <span>Qty</span>
              <span>Ex-GST</span>
              <span>GST</span>
              <span>Inc-GST</span>
              <span />
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
                  <button className={styles.deleteBtn} style={{ position: 'static' }}
                    onClick={() => setScanResults(r => r.filter((_, i) => i !== idx))}>✕</button>
                </div>
              );
            })}

            {/* Total row */}
            <div className={styles.scanPreviewTotal}>
              <span>Total (selected) including GST</span>
              <span className={styles.scanPreviewTotalAmount}>${scanPreviewIncGst.toFixed(2)}</span>
            </div>

            <div className={styles.scanActions}>
              <span className={styles.scanHint}>{scanResults.filter(i => i.selected).length} of {scanResults.length} selected</span>
              <button className={styles.btnPrimary} onClick={handleAddToJob}
                disabled={adding || !scanResults.some(i => i.selected)}>
                {adding ? 'Adding…' : '✓ Add Selected to Costs'}
              </button>
            </div>
          </div>

          {/* Right: document image */}
          {scanImageUrl && (
            <div className={styles.scanDocPreview}>
              <div className={styles.scanDocTitle}>Scanned Document</div>
              <img src={scanImageUrl} alt="Scanned document" className={styles.scanDocImg}
                onClick={() => setLightbox(scanImageUrl)} title="Click to zoom" />
              <div className={styles.scanDocHint}>Click to zoom</div>
            </div>
          )}
        </div>
      )}

      {/* Documents section */}
      {scans.length > 0 && (
        <div className={styles.costsDocSection}>
          <div className={styles.costsDocTitle}>Documents</div>
          <div className={styles.costsDocGrid}>
            {scans.map(scan => (
              <div key={scan.id} className={styles.costsDocCard}
                onClick={() => setLightbox(`${VITE_API}/jobs/${jobId}/cost-scans/${scan.id}/document`)}>
                <img
                  src={`${VITE_API}/jobs/${jobId}/cost-scans/${scan.id}/document`}
                  alt="Cost document"
                  className={styles.costsDocThumb}
                />
                <div className={styles.costsDocMeta}>
                  {new Date(scan.created_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className={styles.lightboxOverlay} onClick={() => setLightbox(null)}>
          <button className={styles.lightboxClose} onClick={() => setLightbox(null)}>✕</button>
          <img src={lightbox} alt="Document" className={styles.lightboxImg} onClick={e => e.stopPropagation()} />
          <div className={styles.lightboxHint}>Click outside to close</div>
        </div>
      )}
    </div>
  );
}
