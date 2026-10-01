import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import ScanFlow from '../stock/ScanFlow';
import CostDocuments from './CostDocuments';
import { isAdmin } from '../../lib/permissions';
import styles from './Jobs.module.css';

const GST_RATE = 0.15;

export default function JobCosts({ jobId, user, readonly, onBillCosts }) {
  const [costs, setCosts] = useState([]);
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [scanMeta, setScanMeta] = useState(null);   // supplier/date/type read off the document
  const [scanImageUrl, setScanImageUrl] = useState(null);
  const [gstTreatment, setGstTreatment] = useState('exclusive');
  const [scanError, setScanError] = useState('');
  const [adding, setAdding] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [scanningStock, setScanningStock] = useState(false);
  const [stockLocations, setStockLocations] = useState([]);
  const fileRef = useRef();
  // Blob URLs have to be revoked by hand or they leak for the life of the tab
  const docUrls = useRef({});

  // Correcting a cost line changes what the job's margin is worked out from, so
  // it stays with admin — the same rule the server enforces.
  const canEdit = !readonly && isAdmin(user?.role);

  useEffect(() => { load(); }, [jobId]);

  useEffect(() => () => {
    Object.values(docUrls.current).forEach(URL.revokeObjectURL);
    docUrls.current = {};
  }, []);

  // The document endpoint needs the auth header, so it can't be used as a plain
  // <img>/<iframe> src — fetch through the API client and hand over a blob URL.
  // Fetched once per document and kept, so hiding and showing it again is free.
  async function fetchDoc(scanId) {
    if (docUrls.current[scanId]) return docUrls.current[scanId];
    const res = await api.get(`/jobs/${jobId}/cost-scans/${scanId}/document`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    docUrls.current[scanId] = url;
    return url;
  }

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

  function onScanDeleted(scanId) {
    const url = docUrls.current[scanId];
    if (url) { URL.revokeObjectURL(url); delete docUrls.current[scanId]; }
    setScans(s => s.filter(x => x.id !== scanId));
    setCosts(c => c.filter(x => x.scan_id !== scanId));
  }

  // Locations are only needed once someone actually scans, so they're fetched
  // on demand rather than on every visit to the Costs tab.
  async function openStockScan() {
    try {
      const { data } = await api.get('/stock/locations');
      const vans = data.filter(l => l.type === 'van');
      if (vans.length === 0) {
        alert('No vans have been set up yet. Add one under Reports → Stock first.');
        return;
      }
      setStockLocations(data);
      setScanningStock(true);
    } catch {
      alert('Could not load stock locations');
    }
  }

  async function handleScanFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setScanError('File must be under 10MB'); return; }
    setScanning(true); setScanError(''); setScanResults(null); setScanMeta(null); setScanImageUrl(null);
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
          setScanMeta({
            supplier: data.supplier || '',
            invoice_number: data.invoice_number || '',
            invoice_date: data.invoice_date || '',
            document_type: data.document_type === 'credit_note' ? 'credit_note' : 'invoice',
            is_credit_note: !!data.is_credit_note,
            sign_corrected: !!data.sign_corrected,
          });
        }
      } catch (err) {
        setScanError(err.response?.data?.error || 'Scan failed');
      } finally { setScanning(false); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function discardScan() {
    setScanResults(null); setScanMeta(null); setScanImageUrl(null);
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
        // Stored against the document so the Costs tab can group by invoice and
        // say which supplier and which date each cost came from.
        supplier: scanMeta?.supplier || null,
        invoice_number: scanMeta?.invoice_number || null,
        invoice_date: scanMeta?.invoice_date || null,
        document_type: scanMeta?.document_type || 'invoice',
      });
      await load();
      discardScan();
    } finally { setAdding(false); }
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
      {/* Costs grouped under the supplier document each line came off */}
      {costs.length > 0 && (
        <>
          <CostDocuments
            jobId={jobId}
            costs={costs}
            scans={scans}
            canEdit={canEdit}
            onChanged={load}
            onScanDeleted={onScanDeleted}
            fetchDoc={fetchDoc}
          />
          <div className={styles.costsGrandTotal}>
            <span>Total costs on this job</span>
            <span className={styles.costsTotalExGst}>${totalExGst.toFixed(2)} ex-GST</span>
            <span className={styles.costsTotalIncGst}>${totalIncGst.toFixed(2)} inc-GST</span>
          </div>
        </>
      )}

      {/* These are what the job COST. Charging them on is a separate decision,
          made in the picker where a markup or a sell price gets set. */}
      {costs.length > 0 && onBillCosts && (
        <div className={styles.costsBillRow}>
          <button className={styles.btnPrimary} onClick={onBillCosts}>→ Add to Line Items</button>
          <span className={styles.scanHintText}>
            Pick which costs to charge on, and at what markup or sell price.
          </span>
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
            <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" style={{ display: 'none' }}
              onChange={handleScanFile} disabled={scanning} />
          </label>
          <span className={styles.scanHintText}>Photo or PDF · max 10MB · invoice or credit note</span>
        </div>
      )}

      {/* Stock fitted on site — comes off the van and lands here as a cost */}
      {!readonly && !scanResults && (
        <div className={styles.costsScanner}>
          <div className={styles.costsScannerTitle}>Stock used on this job</div>
          <button className={styles.btnScan} onClick={openStockScan}>📦 Scan from van</button>
          <span className={styles.scanHintText}>Takes it off the van and adds it here</span>
        </div>
      )}

      {scanningStock && (
        <ScanFlow
          mode="use"
          jobId={jobId}
          locations={stockLocations}
          onClose={() => { setScanningStock(false); load(); }}
          onUsed={() => load()}
        />
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
              <button className={styles.scanDiscard} onClick={discardScan}>Discard</button>
            </div>

            {/* A credit note has to announce itself. Every line coming through
                negative is correct but looks like a mistake unless it's said. */}
            {scanMeta?.is_credit_note && (
              <div className={styles.scanCreditBanner}>
                Read as a <strong>credit note</strong> — every line comes off this job&apos;s costs.
                {scanMeta.sign_corrected && ' The amounts have been made negative to match.'}
              </div>
            )}

            {/* The supplier and date are editable here because they are what the
                Costs tab groups and sorts by once this is saved. */}
            {scanMeta && (
              <div className={styles.scanMetaRow}>
                <label>
                  Supplier
                  <input value={scanMeta.supplier} placeholder="Not read"
                    onChange={e => setScanMeta(m => ({ ...m, supplier: e.target.value }))} />
                </label>
                <label>
                  Invoice no.
                  <input value={scanMeta.invoice_number} placeholder="Not read"
                    onChange={e => setScanMeta(m => ({ ...m, invoice_number: e.target.value }))} />
                </label>
                <label>
                  Date
                  <input type="date" value={scanMeta.invoice_date}
                    onChange={e => setScanMeta(m => ({ ...m, invoice_date: e.target.value }))} />
                </label>
                <label>
                  Type
                  <select value={scanMeta.document_type}
                    onChange={e => setScanMeta(m => ({ ...m, document_type: e.target.value }))}>
                    <option value="invoice">Invoice</option>
                    <option value="credit_note">Credit note</option>
                  </select>
                </label>
              </div>
            )}

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
                    {/* No min — a credit or return is a negative line, and it
                        should stay negative through the review step */}
                    <input type="number" value={ex.toFixed(2)} step="0.01"
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
              {scanImageUrl.startsWith('data:application/pdf') ? (
                // A PDF can't go in an <img>; embed it the way the quote page
                // shows attached PDFs, with a link for browsers that won't.
                <object data={scanImageUrl} type="application/pdf" className={styles.scanDocImg} aria-label="Scanned invoice">
                  <a href={scanImageUrl} target="_blank" rel="noreferrer">Open the uploaded PDF</a>
                </object>
              ) : (
                <>
                  <img src={scanImageUrl} alt="Scanned document" className={styles.scanDocImg}
                    onClick={() => setLightbox(scanImageUrl)} title="Click to zoom" />
                  <div className={styles.scanDocHint}>Click to zoom</div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Lightbox for the freshly-scanned (not yet saved) document */}
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
