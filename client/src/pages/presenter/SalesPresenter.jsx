import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import api from '../../lib/api';
import styles from './SalesPresenter.module.css';

// Use CDN worker so Vite doesn't need to bundle it
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

// ── Calculators ───────────────────────────────────────────────────────────────

// Shared "Scan Plan" panel — upload/photograph/pick-from-job an image, send it
// to the AI scanner, show the result. `mode` decides what's being measured:
// 'area' returns m² for decks and floors, 'linear' returns metres of run for
// fences. The measurement is handed back through onResult.
function PlanScanner({ jobId, mode = 'area', hint, onResult }) {
  const [scanMode, setScanMode] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [showJobPicker, setShowJobPicker] = useState(false);
  const [jobAttachments, setJobAttachments] = useState([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [thumbUrls, setThumbUrls] = useState({});
  const fileRef = useRef();

  const isLinear = mode === 'linear';
  const resultKey = isLinear ? 'length_m' : 'area_m2';
  const unit = isLinear ? 'm' : 'm²';

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setPreviewUrl(ev.target.result); setScanResult(null); setScanError(''); };
    reader.readAsDataURL(file);
  }

  async function handleScan() {
    if (!previewUrl) return;
    setScanning(true); setScanError(''); setScanResult(null);
    try {
      const mimeMatch = previewUrl.match(/^data:([^;]+);base64,/);
      const mime_type = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const { data } = await api.post('/scan/plan', { data_base64: previewUrl, mime_type, mode });
      setScanResult(data);
      setScanMode(false);
      setPreviewUrl('');
      onResult(data[resultKey]);
    } catch (err) {
      setScanError(err.response?.data?.error || 'Scan failed — please try a clearer image');
    } finally { setScanning(false); }
  }

  function handleClear() {
    setScanResult(null); setScanError(''); setPreviewUrl('');
    onResult(null);
  }

  async function openJobPicker() {
    setShowJobPicker(true);
    setLoadingAttachments(true);
    try {
      const { data } = await api.get(`/jobs/${jobId}/attachments`);
      setJobAttachments(data
        .filter(a => (a.mime_type || '').startsWith('image/'))
        .sort((a, b) => (b.arcsite_drawing_id ? 1 : 0) - (a.arcsite_drawing_id ? 1 : 0)));
    } catch {
      setJobAttachments([]);
    } finally { setLoadingAttachments(false); }
  }

  useEffect(() => {
    if (!showJobPicker || !jobAttachments.length) return;
    const urls = [];
    jobAttachments.forEach(a => {
      if (thumbUrls[a.id]) return;
      api.get(`/jobs/${jobId}/attachments/${a.id}/data`, { responseType: 'blob' }).then(res => {
        const url = URL.createObjectURL(res.data);
        urls.push(url);
        setThumbUrls(u => ({ ...u, [a.id]: url }));
      }).catch(() => {});
    });
    return () => { urls.forEach(u => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobAttachments, showJobPicker]);

  async function selectJobAttachment(a) {
    try {
      const res = await api.get(`/jobs/${jobId}/attachments/${a.id}/data`, { responseType: 'blob' });
      const reader = new FileReader();
      reader.onload = ev => { setPreviewUrl(ev.target.result); setScanResult(null); setScanError(''); };
      reader.readAsDataURL(res.data);
      setShowJobPicker(false);
    } catch {
      setScanError('Failed to load image from job');
      setShowJobPicker(false);
    }
  }

  return (
    <>
      {!scanMode && !scanResult && (
        <button className={styles.scanPlanBtn} onClick={() => { setScanMode(true); setScanError(''); }}>
          📐 Scan Plan
        </button>
      )}

      {scanMode && (
        <div className={styles.scanPanel}>
          <p className={styles.scanHint}>{hint}</p>
          <div className={styles.scanUploadRow}>
            <button className={styles.scanUploadBtn} onClick={() => { fileRef.current.removeAttribute('capture'); fileRef.current.click(); }}>
              📁 Upload Image
            </button>
            <button className={styles.scanUploadBtn} onClick={() => { fileRef.current.setAttribute('capture', 'environment'); fileRef.current.click(); }}>
              📷 Take Photo
            </button>
            {jobId && (
              <button className={styles.scanUploadBtn} onClick={openJobPicker}>📥 From Job</button>
            )}
            <button className={styles.scanCancelBtn} onClick={() => { setScanMode(false); setPreviewUrl(''); setScanError(''); }}>
              Cancel
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />

          {previewUrl && (
            <div className={styles.scanPreview}>
              <img src={previewUrl} alt="Plan preview" className={styles.scanPreviewImg} />
              <button className={styles.scanAnalyseBtn} onClick={handleScan} disabled={scanning}>
                {scanning ? '🔍 Analysing…' : '🔍 Analyse Plan'}
              </button>
            </div>
          )}
          {scanError && <div className={styles.scanError}>{scanError}</div>}
        </div>
      )}

      {showJobPicker && (
        <div className={styles.jobPickerOverlay} onClick={e => e.target === e.currentTarget && setShowJobPicker(false)}>
          <div className={styles.jobPickerModal}>
            <div className={styles.jobPickerHeader}>
              <span>Select an image from this job</span>
              <button className={styles.brochureClose} onClick={() => setShowJobPicker(false)}>✕</button>
            </div>
            {loadingAttachments ? (
              <p className={styles.scanHint}>Loading…</p>
            ) : jobAttachments.length === 0 ? (
              <p className={styles.scanHint}>No images on this job yet.</p>
            ) : (
              <div className={styles.jobPickerGrid}>
                {jobAttachments.map(a => (
                  <button key={a.id} className={styles.jobPickerItem} onClick={() => selectJobAttachment(a)}>
                    {thumbUrls[a.id] ? <img src={thumbUrls[a.id]} alt={a.filename} />
                      : <div className={styles.jobPickerLoading}>…</div>}
                    <span className={styles.jobPickerName}>
                      {a.arcsite_drawing_id && <span className={styles.jobPickerBadge}>ArcSite</span>}
                      {a.filename}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {scanResult && (
        <div className={styles.scanResultBanner}>
          <div className={styles.scanResultTop}>
            <span>📐 AI Scan Result: <strong>{scanResult[resultKey]} {unit}</strong></span>
            <span className={styles.scanConfidence} data-level={scanResult.confidence}>
              {scanResult.confidence === 'high' ? '✓ High confidence' : scanResult.confidence === 'medium' ? '~ Medium confidence' : '⚠ Low confidence'}
            </span>
          </div>
          {scanResult.notes && <p className={styles.scanNotes}>{scanResult.notes}</p>}
          {scanResult.dimensions_found?.length > 0 && (
            <p className={styles.scanDims}>Dimensions found: {scanResult.dimensions_found.join(', ')}</p>
          )}
          <button className={styles.scanClearBtn} onClick={handleClear}>✕ Clear scan — enter manually</button>
        </div>
      )}
    </>
  );
}

function AreaCalculator({ product, jobId }) {
  const cfg = product.calculator_config || {};
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [scannedArea, setScannedArea] = useState(null); // m² from AI scan
  const [qty, setQty] = useState(1);
  const pricePerM2 = (product.price_from / 100) || cfg.price_per_m2 || 0;

  // Area: use scanned if available, else length × width
  const manualArea = (parseFloat(length) || 0) * (parseFloat(width) || 0);
  const area = scannedArea != null ? scannedArea : manualArea;
  const total = area * pricePerM2 * qty;

  return (
    <div className={styles.calc}>
      <h3 className={styles.calcTitle}>Area Calculator</h3>

      <PlanScanner
        jobId={jobId}
        mode="area"
        hint="Upload or photograph a floor plan with dimensions marked — AI will calculate the m²."
        onResult={setScannedArea}
      />

      {/* Manual entry (shown when no scan active) */}
      {scannedArea == null && (
        <div className={styles.calcGrid}>
          <div className={styles.calcField}>
            <label>Length (m)</label>
            <input type="number" value={length} onChange={e => setLength(e.target.value)} placeholder="0" />
          </div>
          <div className={styles.calcField}>
            <label>Width (m)</label>
            <input type="number" value={width} onChange={e => setWidth(e.target.value)} placeholder="0" />
          </div>
        </div>
      )}

      <div className={styles.calcGrid}>
        <div className={styles.calcField}>
          <label>Quantity</label>
          <input type="number" value={qty} min="1" onChange={e => setQty(parseInt(e.target.value) || 1)} />
        </div>
        <div className={styles.calcField}>
          <label>Price per m²</label>
          <input type="number" value={pricePerM2} readOnly style={{ background: '#f8fafc' }} />
        </div>
      </div>

      {area > 0 && (
        <div className={styles.calcResult}>
          <div className={styles.calcResultRow}><span>Area</span><strong>{area.toFixed(2)} m²</strong></div>
          {pricePerM2 > 0 && <div className={styles.calcResultRow}><span>Estimate (ex GST)</span><strong>${total.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>}
          {pricePerM2 > 0 && <div className={styles.calcResultRow}><span>Total (inc GST)</span><strong className={styles.calcTotal}>${(total * 1.15).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>}
        </div>
      )}
    </div>
  );
}

// ── Timber paling fence pricing ───────────────────────────────────────────────
// Priced by the metre run. Heights and top-cap options come straight from the
// supplied table; `fallbackPerM` is only used when the matching product isn't
// in the Price List yet.
const FENCE_HEIGHTS = [
  { key: '1.8m', label: '1.8m High' },
  { key: '1.5m', label: '1.5m High' },
  { key: '1.2m', label: '1.2m High' },
];
const FENCE_TOPS = [
  { key: 'standard', label: 'Standard' },
  { key: '65x35',    label: '65 x 35mm Top Cap' },
  { key: '100x50',   label: '100 x 50mm Top Cap' },
];
const PALING_FENCE_TABLE = [
  { height: '1.8m', top: 'standard', name: 'Paling Fence - 1.8m High - Standard',             fallbackPerM: 195 },
  { height: '1.8m', top: '65x35',    name: 'Paling Fence - 1.8m High - 65 x 35mm Top Cap',    fallbackPerM: 205 },
  { height: '1.8m', top: '100x50',   name: 'Paling Fence - 1.8m High - 100 x 50mm Top Cap',   fallbackPerM: 205 },
  { height: '1.5m', top: 'standard', name: 'Paling Fence - 1.5m High - Standard',             fallbackPerM: 175 },
  { height: '1.5m', top: '65x35',    name: 'Paling Fence - 1.5m High - 65 x 35mm Top Cap',    fallbackPerM: 185 },
  { height: '1.5m', top: '100x50',   name: 'Paling Fence - 1.5m High - 100 x 50mm Top Cap',   fallbackPerM: 185 },
  { height: '1.2m', top: 'standard', name: 'Paling Fence - 1.2m High - Standard',             fallbackPerM: 170 },
  { height: '1.2m', top: '65x35',    name: 'Paling Fence - 1.2m High - 65 x 35mm Top Cap',    fallbackPerM: 180 },
  { height: '1.2m', top: '100x50',   name: 'Paling Fence - 1.2m High - 100 x 50mm Top Cap',   fallbackPerM: 180 },
];

// Product names come from a mix of the spreadsheet (ASCII "100 x 50mm") and
// whatever's typed into the Price List or Presenter (often "100 × 50mm" with a
// real multiplication sign). Fold them together so matching doesn't silently
// miss and fall back to the table rate.
function normFenceName(s) {
  return (s || '')
    .replace(/[×✕✖]/g, 'x')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Work out which height/top-cap the product being viewed represents, so the
// dropdowns open on the variant the customer is actually looking at.
function parseFenceVariant(productName) {
  const n = normFenceName(productName);
  const row = PALING_FENCE_TABLE.find(r => normFenceName(r.name) === n);
  if (row) return { height: row.height, top: row.top };
  // Fall back to reading the parts out, so a slightly differently worded
  // product still opens on the right options.
  const height = FENCE_HEIGHTS.find(h => n.includes(normFenceName(h.label)))?.key;
  const top = n.includes('100 x 50') ? '100x50' : n.includes('65 x 35') ? '65x35' : height ? 'standard' : undefined;
  return { height: height || '1.8m', top: top || 'standard' };
}

function PalingFenceCalculator({ onPick, jobId, product, onSelectVariant }) {
  // Initial-only, so switching variant doesn't fight the user's own choice.
  const initial = useState(() => parseFenceVariant(product?.name))[0];
  const [height, setHeight] = useState(initial.height);
  const [top, setTop] = useState(initial.top);
  const [metres, setMetres] = useState('');
  const [scannedLength, setScannedLength] = useState(null);
  const [priceListProducts, setPriceListProducts] = useState([]);
  const [showBrochure, setShowBrochure] = useState(false);
  const [fullPriceProduct, setFullPriceProduct] = useState(null);

  useEffect(() => {
    api.get('/products').then(r => setPriceListProducts(r.data)).catch(() => {});
  }, []);

  const tableMatch = PALING_FENCE_TABLE.find(r => r.height === height && r.top === top);

  const priceProduct = tableMatch
    ? priceListProducts.find(p =>
        [normFenceName(p.name), normFenceName(p.description)].includes(normFenceName(tableMatch.name)))
    : null;

  // Swapping a dropdown swaps the product shown at the top of the panel — name,
  // image and price — so the customer sees the option being discussed.
  function chooseVariant(nextHeight, nextTop) {
    setHeight(nextHeight);
    setTop(nextTop);
    const row = PALING_FENCE_TABLE.find(r => r.height === nextHeight && r.top === nextTop);
    if (row) onSelectVariant?.(row.name);
  }

  // Live Price List price wins; the table price is only a stand-in until the
  // product is loaded into the Price List.
  const perMetre = priceProduct ? priceProduct.unit_price / 100 : (tableMatch?.fallbackPerM ?? 0);
  const runLength = scannedLength != null ? scannedLength : (parseFloat(metres) || 0);
  const total = runLength * perMetre;

  return (
    <div className={styles.calc}>
      <h3 className={styles.calcTitle}>Paling Fence Calculator</h3>

      <PlanScanner
        jobId={jobId}
        mode="linear"
        hint="Upload or photograph a site or boundary plan with dimensions marked — AI will add up the fence run in metres."
        onResult={setScannedLength}
      />

      <div className={styles.calcGrid}>
        <div className={styles.calcField}>
          <label>Fence Height</label>
          <select value={height} onChange={e => chooseVariant(e.target.value, top)}>
            {FENCE_HEIGHTS.map(h => <option key={h.key} value={h.key}>{h.label}</option>)}
          </select>
        </div>
        <div className={styles.calcField}>
          <label>Top Cap</label>
          <select value={top} onChange={e => chooseVariant(height, e.target.value)}>
            {FENCE_TOPS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        {scannedLength == null && (
          <div className={styles.calcField}>
            <label>Fence Length (m)</label>
            <input type="number" min="0" step="0.1" value={metres}
              onChange={e => setMetres(e.target.value)} placeholder="e.g. 24.5" />
          </div>
        )}
        <div className={styles.calcField}>
          <label>Price per metre (ex GST)</label>
          <input type="number" value={perMetre} readOnly style={{ background: '#f8fafc' }} />
        </div>
      </div>

      {runLength > 0 && tableMatch && (
        <div className={styles.calcResult}>
          <div className={styles.calcResultRow}><span>Fence</span><strong>{tableMatch.name}</strong></div>
          <div className={styles.calcResultRow}><span>Run length</span><strong>{runLength.toFixed(2)} m</strong></div>
          <div className={styles.calcResultRow}><span>Total (ex GST)</span><strong>${total.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>
          <div className={styles.calcResultRow}><span>Total (inc GST)</span><strong className={styles.calcTotal}>${(total * 1.15).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>

          {!priceProduct && (
            <div className={styles.calcNote} style={{ marginTop: 10 }}>
              Add "{tableMatch.name}" to your Price List to enable live pricing and quote line items.
              Showing the table rate of ${tableMatch.fallbackPerM}/m in the meantime.
            </div>
          )}
          {priceProduct && onPick && (
            <button className={styles.addToJobBtn}
              onClick={() => onPick({ ...priceProduct, quantity: Math.round(runLength * 100) / 100 })}>
              + Add {runLength.toFixed(2)}m to Quote
            </button>
          )}
          {priceProduct && (
            <button className={styles.brochureBtn} onClick={() => {
              if (fullPriceProduct) { setShowBrochure(true); return; }
              api.get(`/products/${priceProduct.id}`).then(r => {
                setFullPriceProduct(r.data);
                if (r.data.brochure_base64) setShowBrochure(true);
                else alert('No brochure uploaded for this product.');
              }).catch(() => {});
            }}>
              📄 View Product Brochure
            </button>
          )}
        </div>
      )}

      {showBrochure && fullPriceProduct?.brochure_base64 && (
        <BrochureModal src={fullPriceProduct.brochure_base64} name={tableMatch?.name} onClose={() => setShowBrochure(false)} />
      )}
    </div>
  );
}

function LinearCalculator({ product }) {
  const cfg = product.calculator_config || {};
  const [meters, setMeters] = useState('');
  const [qty, setQty] = useState(1);
  const pricePerM = (product.price_from / 100) || cfg.price_per_m || 0;
  const total = (parseFloat(meters) || 0) * pricePerM * qty;

  return (
    <div className={styles.calc}>
      <h3 className={styles.calcTitle}>Linear Calculator</h3>
      <div className={styles.calcGrid}>
        <div className={styles.calcField}>
          <label>Length (m)</label>
          <input type="number" value={meters} onChange={e => setMeters(e.target.value)} placeholder="0" />
        </div>
        <div className={styles.calcField}>
          <label>Quantity</label>
          <input type="number" value={qty} min="1" onChange={e => setQty(parseInt(e.target.value) || 1)} />
        </div>
        <div className={styles.calcField}>
          <label>Price per m</label>
          <input type="number" value={pricePerM} readOnly style={{ background: '#f8fafc' }} />
        </div>
      </div>
      {parseFloat(meters) > 0 && (
        <div className={styles.calcResult}>
          {pricePerM > 0 && <div className={styles.calcResultRow}><span>Estimate (ex GST)</span><strong>${total.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>}
          {pricePerM > 0 && <div className={styles.calcResultRow}><span>Total (inc GST)</span><strong className={styles.calcTotal}>${(total * 1.15).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>}
        </div>
      )}
    </div>
  );
}

// ── Rinnai highwall heat pump sizing table ────────────────────────────────────
// Bands are the heating kW each model covers; the calculator's recommended
// capacity picks the first band it falls inside.
const RINNAI_HEATPUMP_TABLE = [
  { kwMin: 0,    kwMax: 2.8, model: 'HSNRTX25', description: 'Rinnai 2.5COOL/2.8HEAT WIFI' },
  { kwMin: 2.81, kwMax: 4,   model: 'HSNRTX35', description: 'Rinnai 3.5COOL/4.0HEAT WIFI' },
  { kwMin: 4.01, kwMax: 5.5, model: 'HSNRTX50', description: 'Rinnai 5.0COOL/5.5HEAT WIFI' },
  { kwMin: 5.51, kwMax: 6.5, model: 'HSNRTX60', description: 'Rinnai 6.0COOL/6.5HEAT WIFI' },
  { kwMin: 6.51, kwMax: 7.5, model: 'HSNRTX70', description: 'Rinnai 7.0COOL/7.5HEAT WIFI' },
  { kwMin: 7.51, kwMax: 8.2, model: 'HSNRTX80', description: 'Rinnai 7.65COOL/8.2HEAT WIFI' },
  { kwMin: 8.21, kwMax: 9.5, model: 'HSNRTX90', description: 'Rinnai 9.0COOL/9.5HEAT WIFI' },
];
const HEATPUMP_MAX_KW = RINNAI_HEATPUMP_TABLE[RINNAI_HEATPUMP_TABLE.length - 1].kwMax;

function HeatpumpCalculator({ onPick }) {
  const [length, setLength] = useState(0);
  const [width, setWidth] = useState(0);
  const [m2, setM2] = useState('0');
  const [ceilingHeight, setCeilingHeight] = useState('2.4');
  const [customHeight, setCustomHeight] = useState('');
  const [insulation, setInsulation] = useState('average');
  const [priceListProducts, setPriceListProducts] = useState([]);
  const [showBrochure, setShowBrochure] = useState(false);
  const [fullPriceProduct, setFullPriceProduct] = useState(null);

  useEffect(() => {
    api.get('/products').then(r => setPriceListProducts(r.data)).catch(() => {});
  }, []);

  function handleLength(v) { setLength(v); setM2((v * width).toFixed(1)); }
  function handleWidth(v)  { setWidth(v);  setM2((length * v).toFixed(1)); }
  function handleM2(v)     { setM2(v); } // manual override — sliders stay where they are

  const kwMultiplier = { good: 0.05, average: 0.055, poor: 0.06 }[insulation];
  const effectiveHeight = ceilingHeight === 'other'
    ? (parseFloat(customHeight) || 0)
    : (parseFloat(ceilingHeight) || 0);
  const m3 = (parseFloat(m2) || 0) * effectiveHeight;
  const kwValue = m3 > 0 ? m3 * kwMultiplier : 0;
  const kw = kwValue > 0 ? kwValue.toFixed(2) : null;

  const tableMatch = kwValue > 0
    ? RINNAI_HEATPUMP_TABLE.find(r => kwValue >= r.kwMin && kwValue <= r.kwMax)
    : null;
  const overCapacity = kwValue > HEATPUMP_MAX_KW;

  // The price list may carry either the model code or the full description as
  // the product name, so match on both.
  const norm = s => (s || '').trim().toLowerCase();
  const priceProduct = tableMatch
    ? priceListProducts.find(p => {
        const fields = [norm(p.name), norm(p.description)];
        return fields.includes(norm(tableMatch.model)) || fields.includes(norm(tableMatch.description));
      })
    : null;

  const exGst  = priceProduct ? priceProduct.unit_price / 100 : null;
  const incGst = priceProduct ? Math.round((priceProduct.unit_price / 100) * 1.15 * 100) / 100 : null;

  return (
    <div className={styles.calc}>
      <h3 className={styles.calcTitle}>Heat Pump Sizing Calculator</h3>

      {/* Sliders */}
      <div className={styles.sliderSection}>
        <div className={styles.sliderRow}>
          <span className={styles.sliderLabel}>Length</span>
          <input type="range" min="0" max="15" step="0.1" value={length}
            onChange={e => handleLength(parseFloat(e.target.value))} className={styles.slider} />
          <span className={styles.sliderVal}>{length} m</span>
        </div>
        <div className={styles.sliderRow}>
          <span className={styles.sliderLabel}>Width</span>
          <input type="range" min="0" max="10" step="0.1" value={width}
            onChange={e => handleWidth(parseFloat(e.target.value))} className={styles.slider} />
          <span className={styles.sliderVal}>{width} m</span>
        </div>
      </div>

      <div className={styles.calcGrid}>
        <div className={styles.calcField}>
          <label>Floor Area (m²)</label>
          <input type="number" value={m2} min="0"
            onChange={e => handleM2(e.target.value)}
            placeholder="or type directly" />
        </div>
        <div className={styles.calcField}>
          <label>Ceiling Height (m)</label>
          <select value={ceilingHeight} onChange={e => setCeilingHeight(e.target.value)}>
            <option value="2.1">2.1 m (low)</option>
            <option value="2.4">2.4 m (standard)</option>
            <option value="2.7">2.7 m (high stud)</option>
            <option value="3.0">3.0 m</option>
            <option value="3.6">3.6 m (very high)</option>
            <option value="other">Other — enter below</option>
          </select>
        </div>
        {ceilingHeight === 'other' && (
          <div className={styles.calcField}>
            <label>Custom Ceiling Height (m)</label>
            <input type="number" min="0" step="0.1" value={customHeight} autoFocus
              onChange={e => setCustomHeight(e.target.value)}
              placeholder="e.g. 4.2" />
          </div>
        )}
        <div className={styles.calcField} style={{ gridColumn: '1 / -1' }}>
          <label>Insulation Level</label>
          <select value={insulation} onChange={e => setInsulation(e.target.value)}>
            <option value="good">Good — modern well-insulated home (× 0.05)</option>
            <option value="average">Average — partially insulated (× 0.055)</option>
            <option value="poor">Poor — older uninsulated home (× 0.06)</option>
          </select>
        </div>
      </div>

      {ceilingHeight === 'other' && !(parseFloat(customHeight) > 0) && (
        <div className={styles.calcNote}>Enter a ceiling height to size the heat pump.</div>
      )}

      {kw && (
        <div className={styles.calcResult}>
          <div className={styles.calcResultRow}><span>Volume</span><strong>{m3.toFixed(1)} m³</strong></div>
          <div className={styles.calcResultRow}><span>Recommended capacity</span><strong className={styles.calcTotal}>{kw} kW</strong></div>

          {overCapacity && (
            <div className={styles.calcNote} style={{ marginTop: 10 }}>
              {kw} kW is beyond the largest highwall unit ({HEATPUMP_MAX_KW} kW). This space likely needs multiple units or a ducted system — please contact us for a custom design.
            </div>
          )}

          {tableMatch && <>
            <div className={styles.calcResultRow}><span>Recommended model</span><strong>{tableMatch.model}</strong></div>
            <div className={styles.calcResultRow}><span>Unit</span><strong>{tableMatch.description}</strong></div>
            {exGst != null && <>
              <div className={styles.calcResultRow}><span>Total (ex GST)</span><strong>${exGst.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>
              <div className={styles.calcResultRow}><span>Total (inc GST)</span><strong className={styles.calcTotal}>${incGst.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>
            </>}
            {!priceProduct && (
              <div className={styles.calcNote} style={{ marginTop: 10 }}>
                Add "{tableMatch.model}" to your Price List to enable live pricing and quote line items.
              </div>
            )}
            {priceProduct && onPick && (
              <button className={styles.addToJobBtn} onClick={() => onPick(priceProduct)}>
                + Add {tableMatch.model} to Quote
              </button>
            )}
            {priceProduct && (
              <button className={styles.brochureBtn} onClick={() => {
                if (fullPriceProduct) { setShowBrochure(true); return; }
                api.get(`/products/${priceProduct.id}`).then(r => {
                  setFullPriceProduct(r.data);
                  if (r.data.brochure_base64) setShowBrochure(true);
                  else alert('No brochure uploaded for this product.');
                }).catch(() => {});
              }}>
                📄 View Product Brochure
              </button>
            )}
          </>}
        </div>
      )}

      {showBrochure && fullPriceProduct?.brochure_base64 && (
        <BrochureModal src={fullPriceProduct.brochure_base64} name={tableMatch?.model} onClose={() => setShowBrochure(false)} />
      )}
    </div>
  );
}

function UnitCalculator({ product }) {
  const [qty, setQty] = useState(1);
  const unitPrice = product.price_from / 100 || 0;
  const total = unitPrice * qty;

  return (
    <div className={styles.calc}>
      <h3 className={styles.calcTitle}>Pricing</h3>
      <div className={styles.calcGrid}>
        <div className={styles.calcField}>
          <label>Quantity</label>
          <input type="number" value={qty} min="1" onChange={e => setQty(parseInt(e.target.value) || 1)} />
        </div>
        {unitPrice > 0 && (
          <div className={styles.calcField}>
            <label>Unit Price (ex GST)</label>
            <input value={`$${unitPrice.toFixed(2)}`} readOnly style={{ background: '#f8fafc' }} />
          </div>
        )}
      </div>
      {unitPrice > 0 && (
        <div className={styles.calcResult}>
          <div className={styles.calcResultRow}><span>Total (ex GST)</span><strong>${total.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>
          <div className={styles.calcResultRow}><span>Total (inc GST)</span><strong className={styles.calcTotal}>${(total * 1.15).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>
        </div>
      )}
    </div>
  );
}

const SMARTVENT_LITE_TABLE = [
  { houseMin: 0,   houseMax: 100, outlets: 1, model: 'SV01L+',                        exGst: 2487.02, incGst: 2860.07 },
  { houseMin: 0,   houseMax: 100, outlets: 2, model: 'SV02L+',                        exGst: 2621.76, incGst: 3015.02 },
  { houseMin: 0,   houseMax: 100, outlets: 3, model: 'SV02L+ with 1 Extension Kit',   exGst: 2823.94, incGst: 3247.53 },
  { houseMin: 101, houseMax: 280, outlets: 4, model: 'SV04L+',                        exGst: 3111.88, incGst: 3578.67 },
  { houseMin: 101, houseMax: 280, outlets: 5, model: 'SV04L+ with 1 Extension Kit',   exGst: 3314.06, incGst: 3811.17 },
  { houseMin: 101, houseMax: 280, outlets: 6, model: 'SV04L+ with 2 Extension Kits',  exGst: 3516.24, incGst: 4043.68 },
  { houseMin: 281, houseMax: 560, outlets: 6, model: 'SV06L+',                        exGst: 4257.09, incGst: 4895.66 },
  { houseMin: 281, houseMax: 560, outlets: 7, model: 'SV06L+ with 1 Extension Kit',   exGst: 4459.27, incGst: 5128.17 },
  { houseMin: 281, houseMax: 560, outlets: 8, model: 'SV06L+ with 2 Extension Kits',  exGst: 4661.45, incGst: 5360.67 },
];

function SmartVentLiteCalculator({ onPick }) {
  const [m2, setM2] = useState('');
  const [outlets, setOutlets] = useState('');
  const [priceListProducts, setPriceListProducts] = useState([]);
  const [showBrochure, setShowBrochure] = useState(false);
  const [fullPriceProduct, setFullPriceProduct] = useState(null);

  useEffect(() => {
    api.get('/products').then(r => setPriceListProducts(r.data)).catch(() => {});
  }, []);

  const houseSize = parseInt(m2) || 0;
  const numOutlets = parseInt(outlets) || 0;

  const exactMatch = houseSize > 0 && numOutlets > 0
    ? SMARTVENT_LITE_TABLE.find(r =>
        houseSize >= r.houseMin && houseSize <= r.houseMax && numOutlets === r.outlets)
    : null;
  const outletOnlyMatch = !exactMatch && numOutlets > 0
    ? SMARTVENT_LITE_TABLE.find(r => numOutlets === r.outlets)
    : null;
  const tableMatch = exactMatch || outletOnlyMatch;

  // Find matching price list product by name (e.g. "SV04L+")
  const priceProduct = tableMatch
    ? priceListProducts.find(p =>
        (p.description || '').trim().toLowerCase() === tableMatch.model.trim().toLowerCase() ||
        p.name.trim().toLowerCase() === tableMatch.model.trim().toLowerCase()
      )
    : null;

  const exGst  = priceProduct ? priceProduct.unit_price / 100 : (tableMatch?.exGst ?? null);
  const incGst = priceProduct ? Math.round((priceProduct.unit_price / 100) * 1.15 * 100) / 100 : (tableMatch?.incGst ?? null);

  return (
    <div className={styles.calc}>
      <h3 className={styles.calcTitle}>SmartVent Lite+ Calculator</h3>
      <div className={styles.calcGrid}>
        <div className={styles.calcField}>
          <label>House Size (m²)</label>
          <input type="number" value={m2} onChange={e => setM2(e.target.value)}
            placeholder="e.g. 150" min="0" max="560" />
        </div>
        <div className={styles.calcField}>
          <label>Number of Outlets</label>
          <input type="number" value={outlets} onChange={e => setOutlets(e.target.value)}
            placeholder="e.g. 4" min="1" max="8" />
        </div>
      </div>
      {houseSize > 560 && (
        <div className={styles.calcNote}>House size exceeds SmartVent Lite+ range (max 560 m²). Please contact us for a custom solution.</div>
      )}
      {tableMatch && (
        <div className={styles.calcResult}>
          <div className={styles.calcResultRow}><span>Model</span><strong>{tableMatch.model}</strong></div>
          {exGst != null && <>
            <div className={styles.calcResultRow}><span>Total (ex GST)</span><strong>${exGst.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>
            <div className={styles.calcResultRow}><span>Total (inc GST)</span><strong className={styles.calcTotal}>${incGst.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>
          </>}
          {!priceProduct && <div className={styles.calcNote} style={{ marginTop: 10 }}>Add "{tableMatch.model}" to your Price List to enable live pricing and job line items.</div>}
          {priceProduct && onPick && (
            <button className={styles.addToJobBtn} onClick={() => onPick(priceProduct)}>
              + Add {tableMatch.model} to Quote
            </button>
          )}
          {priceProduct && (
            <button className={styles.brochureBtn} onClick={() => {
              if (fullPriceProduct) { setShowBrochure(true); return; }
              api.get(`/products/${priceProduct.id}`).then(r => {
                setFullPriceProduct(r.data);
                if (r.data.brochure_base64) setShowBrochure(true);
                else alert('No brochure uploaded for this product.');
              }).catch(() => {});
            }}>
              📄 View Product Brochure
            </button>
          )}
        </div>
      )}
      {showBrochure && fullPriceProduct?.brochure_base64 && (
        <BrochureModal src={fullPriceProduct.brochure_base64} name={tableMatch.model} onClose={() => setShowBrochure(false)} />
      )}
    </div>
  );
}

// ── SmartVent Positive Pressure lookup table ──────────────────────────────────
const PP_TABLE = [
  // SmartVent Lite+
  { system: 'SmartVent Lite+',             houseMin: 1,   houseMax: 100, outlets: 1,  model: 'SV01L+' },
  { system: 'SmartVent Lite+',             houseMin: 1,   houseMax: 100, outlets: 2,  model: 'SV02L+' },
  { system: 'SmartVent Lite+',             houseMin: 1,   houseMax: 100, outlets: 3,  model: 'SV02L+ with 1 Extension Kit' },
  { system: 'SmartVent Lite+',             houseMin: 101, houseMax: 280, outlets: 4,  model: 'SV04L+' },
  { system: 'SmartVent Lite+',             houseMin: 101, houseMax: 280, outlets: 5,  model: 'SV04L+ with 1 Extension Kit' },
  { system: 'SmartVent Lite+',             houseMin: 101, houseMax: 280, outlets: 6,  model: 'SV04L+ with 2 Extension Kits' },
  { system: 'SmartVent Lite+',             houseMin: 281, houseMax: 560, outlets: 6,  model: 'SV06L+' },
  { system: 'SmartVent Lite+',             houseMin: 281, houseMax: 560, outlets: 7,  model: 'SV06L+ with 1 Extension Kit' },
  { system: 'SmartVent Lite+',             houseMin: 281, houseMax: 560, outlets: 8,  model: 'SV06L+ with 2 Extension Kits' },
  { system: 'SmartVent Lite+',             houseMin: 281, houseMax: 560, outlets: 9,  model: 'SV06L+ with 3 Extension Kits' },
  { system: 'SmartVent Lite+',             houseMin: 281, houseMax: 560, outlets: 10, model: 'SV06L+ with 4 Extension Kits' },
  { system: 'SmartVent Lite+',             houseMin: 281, houseMax: 560, outlets: 11, model: 'SV06L+ with 5 Extension Kits' },
  { system: 'SmartVent Lite+',             houseMin: 281, houseMax: 560, outlets: 12, model: 'SV06L+ with 6 Extension Kits' },
  // SmartVent Positive3
  { system: 'SmartVent Positive3',        houseMin: 1,   houseMax: 100, outlets: 1,  model: 'SV01P3' },
  { system: 'SmartVent Positive3',        houseMin: 1,   houseMax: 100, outlets: 2,  model: 'SV02P3' },
  { system: 'SmartVent Positive3',        houseMin: 1,   houseMax: 100, outlets: 3,  model: 'SV02P3 with 1 Extension Kit' },
  { system: 'SmartVent Positive3',        houseMin: 101, houseMax: 280, outlets: 4,  model: 'SV04P3' },
  { system: 'SmartVent Positive3',        houseMin: 101, houseMax: 280, outlets: 5,  model: 'SV04P3 with 1 Extension Kit' },
  { system: 'SmartVent Positive3',        houseMin: 101, houseMax: 280, outlets: 6,  model: 'SV04P3 with 2 Extension Kits' },
  { system: 'SmartVent Positive3',        houseMin: 281, houseMax: 560, outlets: 6,  model: 'SV06P3' },
  { system: 'SmartVent Positive3',        houseMin: 281, houseMax: 560, outlets: 7,  model: 'SV06P3 with 1 Extension Kit' },
  { system: 'SmartVent Positive3',        houseMin: 281, houseMax: 560, outlets: 8,  model: 'SV06P3 with 2 Extension Kits' },
  { system: 'SmartVent Positive3',        houseMin: 281, houseMax: 560, outlets: 9,  model: 'SV06P3 with 3 Extension Kits' },
  { system: 'SmartVent Positive3',        houseMin: 281, houseMax: 560, outlets: 10, model: 'SV06P3 with 4 Extension Kits' },
  { system: 'SmartVent Positive3',        houseMin: 281, houseMax: 560, outlets: 11, model: 'SV06P3 with 5 Extension Kits' },
  { system: 'SmartVent Positive3',        houseMin: 281, houseMax: 560, outlets: 12, model: 'SV06P3 with 6 Extension Kits' },
  // SmartVent Positive Advance (starts at 2 outlets)
  { system: 'SmartVent Positive Advance',  houseMin: 1,   houseMax: 100, outlets: 2,  model: 'SV02AD' },
  { system: 'SmartVent Positive Advance',  houseMin: 1,   houseMax: 100, outlets: 3,  model: 'SV02AD with 1 Extension Kit' },
  { system: 'SmartVent Positive Advance',  houseMin: 101, houseMax: 280, outlets: 4,  model: 'SV04AD' },
  { system: 'SmartVent Positive Advance',  houseMin: 101, houseMax: 280, outlets: 5,  model: 'SV04AD with 1 Extension Kit' },
  { system: 'SmartVent Positive Advance',  houseMin: 101, houseMax: 280, outlets: 6,  model: 'SV04AD with 2 Extension Kits' },
  { system: 'SmartVent Positive Advance',  houseMin: 281, houseMax: 560, outlets: 6,  model: 'SV06AD' },
  { system: 'SmartVent Positive Advance',  houseMin: 281, houseMax: 560, outlets: 7,  model: 'SV06AD with 1 Extension Kit' },
  { system: 'SmartVent Positive Advance',  houseMin: 281, houseMax: 560, outlets: 8,  model: 'SV06AD with 2 Extension Kits' },
  { system: 'SmartVent Positive Advance',  houseMin: 281, houseMax: 560, outlets: 9,  model: 'SV06AD with 3 Extension Kits' },
  { system: 'SmartVent Positive Advance',  houseMin: 281, houseMax: 560, outlets: 10, model: 'SV06AD with 4 Extension Kits' },
  { system: 'SmartVent Positive Advance',  houseMin: 281, houseMax: 560, outlets: 11, model: 'SV06AD with 5 Extension Kits' },
  { system: 'SmartVent Positive Advance',  houseMin: 281, houseMax: 560, outlets: 12, model: 'SV06AD with 6 Extension Kits' },
];

function SmartVentPositivePressureCalculator({ onPick, product: presenterProduct }) {
  const [m2, setM2] = useState('');
  const [outlets, setOutlets] = useState('');
  const [priceListProducts, setPriceListProducts] = useState([]);
  const [showBrochure, setShowBrochure] = useState(false);
  const [fullPriceProduct, setFullPriceProduct] = useState(null);

  useEffect(() => {
    api.get('/products').then(r => setPriceListProducts(r.data)).catch(() => {});
  }, []);

  const houseSize = parseInt(m2) || 0;
  const numOutlets = parseInt(outlets) || 0;

  // Normalise: lowercase + strip spaces/+ so "SmartVent Positive 3" == "SmartVent Positive3"
  const norm = s => s.toLowerCase().replace(/[\s+]/g, '');
  const productName = norm(presenterProduct?.name || '');
  const systemRows = productName
    ? PP_TABLE.filter(r => {
        const sys = norm(r.system);
        return productName.includes(sys) || sys.includes(productName);
      })
    : PP_TABLE;
  // If nothing matched (e.g. product not named after a system), show all rows
  const searchRows = systemRows.length > 0 ? systemRows : PP_TABLE;

  const exactMatch = houseSize > 0 && numOutlets > 0
    ? searchRows.find(r => houseSize >= r.houseMin && houseSize <= r.houseMax && numOutlets === r.outlets)
    : null;
  const outletOnlyMatch = !exactMatch && numOutlets > 0
    ? searchRows.find(r => numOutlets === r.outlets)
    : null;
  const tableMatch = exactMatch || outletOnlyMatch;

  const priceProduct = tableMatch
    ? priceListProducts.find(p =>
        (p.description || '').trim().toLowerCase() === tableMatch.model.trim().toLowerCase() ||
        p.name.trim().toLowerCase() === tableMatch.model.trim().toLowerCase()
      )
    : null;

  const exGst  = priceProduct ? priceProduct.unit_price / 100 : null;
  const incGst = priceProduct ? Math.round((priceProduct.unit_price / 100) * 1.15 * 100) / 100 : null;

  return (
    <div className={styles.calc}>
      <h3 className={styles.calcTitle}>SmartVent Positive Pressure Calculator</h3>
      <div className={styles.calcGrid}>
        <div className={styles.calcField}>
          <label>House Size (m²)</label>
          <input type="number" value={m2} onChange={e => setM2(e.target.value)}
            placeholder="e.g. 150" min="0" max="560" />
        </div>
        <div className={styles.calcField}>
          <label>Number of Outlets</label>
          <input type="number" value={outlets} onChange={e => setOutlets(e.target.value)}
            placeholder="e.g. 4" min="1" max="12" />
        </div>
      </div>
      {houseSize > 560 && (
        <div className={styles.calcNote}>House size exceeds the supported range (max 560 m²). Please contact us for a custom solution.</div>
      )}
      {tableMatch && (
        <div className={styles.calcResult}>
          <div className={styles.calcResultRow}><span>System Type</span><strong>{tableMatch.system}</strong></div>
          <div className={styles.calcResultRow}><span>Model</span><strong>{tableMatch.model}</strong></div>
          {exGst != null && <>
            <div className={styles.calcResultRow}><span>Total (ex GST)</span><strong>${exGst.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>
            <div className={styles.calcResultRow}><span>Total (inc GST)</span><strong className={styles.calcTotal}>${incGst.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>
          </>}
          {!priceProduct && <div className={styles.calcNote} style={{ marginTop: 10 }}>Add "{tableMatch.model}" to your Price List to enable live pricing and job line items.</div>}
          {priceProduct && onPick && (
            <button className={styles.addToJobBtn} onClick={() => onPick(priceProduct)}>
              + Add {tableMatch.model} to Quote
            </button>
          )}
          {priceProduct && (
            <button className={styles.brochureBtn} onClick={() => {
              if (fullPriceProduct) { setShowBrochure(true); return; }
              api.get(`/products/${priceProduct.id}`).then(r => {
                setFullPriceProduct(r.data);
                if (r.data.brochure_base64) setShowBrochure(true);
                else alert('No brochure uploaded for this product.');
              }).catch(() => {});
            }}>
              📄 View Product Brochure
            </button>
          )}
        </div>
      )}
      {showBrochure && fullPriceProduct?.brochure_base64 && (
        <BrochureModal src={fullPriceProduct.brochure_base64} name={tableMatch.model} onClose={() => setShowBrochure(false)} />
      )}
    </div>
  );
}

// ── SmartVent Balanced Pressure lookup table ──────────────────────────────────
// Source: "SmartVent Balanced Pressure Table.xlsx" (System Type / House Size / Outlets / Model)
const BP_TABLE = [
  { system: 'SmartVent Synergy 3', houseMin: 1,   houseMax: 150, outlets: 3, model: 'SYN1015AD' },
  { system: 'SmartVent Synergy 3', houseMin: 1,   houseMax: 150, outlets: 4, model: 'SYN1015AD with 1 Extension Kit' },
  { system: 'SmartVent Synergy 3', houseMin: 151, houseMax: 250, outlets: 3, model: 'SYN2025AD' },
  { system: 'SmartVent Synergy 3', houseMin: 151, houseMax: 250, outlets: 4, model: 'SYN2025AD with 1 Extension Kit' },
  { system: 'SmartVent Synergy 3', houseMin: 151, houseMax: 250, outlets: 5, model: 'SYN2025AD with 2 Extension Kits' },
  { system: 'SmartVent Synergy 3', houseMin: 251, houseMax: 350, outlets: 3, model: 'SYN3035AD' },
  { system: 'SmartVent Synergy 3', houseMin: 251, houseMax: 350, outlets: 4, model: 'SYN3035AD with 1 Extension Kit' },
  { system: 'SmartVent Synergy 3', houseMin: 251, houseMax: 350, outlets: 5, model: 'SYN3035AD with 2 Extension Kits' },
  { system: 'SmartVent Synergy 3', houseMin: 251, houseMax: 350, outlets: 6, model: 'SYN3035AD with 3 Extension Kits' },
  { system: 'SmartVent Balance',   houseMin: 1,   houseMax: 150, outlets: 3, model: 'BAL205' },
  { system: 'SmartVent Balance',   houseMin: 1,   houseMax: 150, outlets: 4, model: 'BAL205 with 1 Extension Kit' },
  { system: 'SmartVent Balance',   houseMin: 1,   houseMax: 150, outlets: 5, model: 'BAL205 with 2 Extension Kit' },
  { system: 'SmartVent Balance',   houseMin: 151, houseMax: 250, outlets: 5, model: 'BAL405' },
  { system: 'SmartVent Balance',   houseMin: 151, houseMax: 250, outlets: 6, model: 'BAL405 with 1 Extension Kit' },
];
const BP_SYSTEMS = [...new Set(BP_TABLE.map(r => r.system))];
const BP_MAX_HOUSE = Math.max(...BP_TABLE.map(r => r.houseMax));

function SmartVentBalancedPressureCalculator({ onPick }) {
  const [system, setSystem] = useState(BP_SYSTEMS[0]);
  const [m2, setM2] = useState('');
  const [outlets, setOutlets] = useState('');
  const [priceListProducts, setPriceListProducts] = useState([]);
  const [showBrochure, setShowBrochure] = useState(false);
  const [fullPriceProduct, setFullPriceProduct] = useState(null);

  useEffect(() => {
    api.get('/products').then(r => setPriceListProducts(r.data)).catch(() => {});
  }, []);

  const houseSize = parseInt(m2) || 0;
  const numOutlets = parseInt(outlets) || 0;
  const systemRows = BP_TABLE.filter(r => r.system === system);

  const exactMatch = houseSize > 0 && numOutlets > 0
    ? systemRows.find(r => houseSize >= r.houseMin && houseSize <= r.houseMax && numOutlets === r.outlets)
    : null;
  const outletOnlyMatch = !exactMatch && numOutlets > 0
    ? systemRows.find(r => numOutlets === r.outlets)
    : null;
  const tableMatch = exactMatch || outletOnlyMatch;

  const priceProduct = tableMatch
    ? priceListProducts.find(p =>
        (p.description || '').trim().toLowerCase() === tableMatch.model.trim().toLowerCase() ||
        p.name.trim().toLowerCase() === tableMatch.model.trim().toLowerCase()
      )
    : null;

  const exGst  = priceProduct ? priceProduct.unit_price / 100 : null;
  const incGst = priceProduct ? Math.round((priceProduct.unit_price / 100) * 1.15 * 100) / 100 : null;

  return (
    <div className={styles.calc}>
      <h3 className={styles.calcTitle}>SmartVent Balanced Pressure Calculator</h3>
      <div className={styles.calcGrid}>
        <div className={styles.calcField} style={{ gridColumn: '1 / -1' }}>
          <label>System Type</label>
          <select value={system} onChange={e => setSystem(e.target.value)}>
            {BP_SYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className={styles.calcField}>
          <label>House Size (m²)</label>
          <input type="number" value={m2} onChange={e => setM2(e.target.value)}
            placeholder="e.g. 150" min="0" max={BP_MAX_HOUSE} />
        </div>
        <div className={styles.calcField}>
          <label>Number of Outlets</label>
          <input type="number" value={outlets} onChange={e => setOutlets(e.target.value)}
            placeholder="e.g. 4" min="1" max="6" />
        </div>
      </div>
      {houseSize > BP_MAX_HOUSE && (
        <div className={styles.calcNote}>House size exceeds the supported range (max {BP_MAX_HOUSE} m²). Please contact us for a custom solution.</div>
      )}
      {tableMatch && (
        <div className={styles.calcResult}>
          <div className={styles.calcResultRow}><span>System Type</span><strong>{tableMatch.system}</strong></div>
          <div className={styles.calcResultRow}><span>Model</span><strong>{tableMatch.model}</strong></div>
          {exGst != null && <>
            <div className={styles.calcResultRow}><span>Total (ex GST)</span><strong>${exGst.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>
            <div className={styles.calcResultRow}><span>Total (inc GST)</span><strong className={styles.calcTotal}>${incGst.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>
          </>}
          {!priceProduct && <div className={styles.calcNote} style={{ marginTop: 10 }}>Add "{tableMatch.model}" to your Price List to enable live pricing and job line items.</div>}
          {priceProduct && onPick && (
            <button className={styles.addToJobBtn} onClick={() => onPick(priceProduct)}>
              + Add {tableMatch.model} to Quote
            </button>
          )}
          {priceProduct && (
            <button className={styles.brochureBtn} onClick={() => {
              if (fullPriceProduct) { setShowBrochure(true); return; }
              api.get(`/products/${priceProduct.id}`).then(r => {
                setFullPriceProduct(r.data);
                if (r.data.brochure_base64) setShowBrochure(true);
                else alert('No brochure uploaded for this product.');
              }).catch(() => {});
            }}>
              📄 View Product Brochure
            </button>
          )}
        </div>
      )}
      {showBrochure && fullPriceProduct?.brochure_base64 && (
        <BrochureModal src={fullPriceProduct.brochure_base64} name={tableMatch.model} onClose={() => setShowBrochure(false)} />
      )}
    </div>
  );
}

// ── BDVAir Positive Pressure lookup table ─────────────────────────────────────
// Source: "BDVAir Positive Pressure Table.xlsx" (System Type / House Size / Number of
// Outlets / Model / Unit Buy Price / Unit with Mark Up / Install Cost Price / Install
// with Mark Up / Commission). exGst = Unit with Mark Up + Install with Mark Up (install
// is a flat $630 across every priced row in the source table), matching the all-in
// per-SKU price the Price List's unit_price otherwise represents for this calculator.
// Model names match the source table's SKUs exactly so they can match Price List
// product names for live pricing — "-Upgrade" rows and 211-420's 4-7 outlet rows have
// no price in the source table (larger houses would normally take 8+ outlets).
const BDVAIR_PP_TABLE = [
  { houseMin: 1,   houseMax: 210, outlets: 0,  model: 'BDV 1EC-Upgrade', exGst: null },
  { houseMin: 1,   houseMax: 210, outlets: 2,  model: 'BDV 1EC-2',       exGst: null },
  { houseMin: 1,   houseMax: 210, outlets: 3,  model: 'BDV 1EC-3',       exGst: null },
  { houseMin: 1,   houseMax: 210, outlets: 4,  model: 'BDV 1EC-4',       exGst: 2979.84 },
  { houseMin: 1,   houseMax: 210, outlets: 5,  model: 'BDV 1EC-5',       exGst: 3042.11 },
  { houseMin: 1,   houseMax: 210, outlets: 6,  model: 'BDV 1EC-6',       exGst: 3252.89 },
  { houseMin: 1,   houseMax: 210, outlets: 7,  model: 'BDV 1EC-7',       exGst: 3472.44 },
  { houseMin: 211, houseMax: 420, outlets: 0,  model: 'BDV 2EC-Upgrade', exGst: null },
  { houseMin: 211, houseMax: 420, outlets: 4,  model: 'BDV 2EC-4',       exGst: null },
  { houseMin: 211, houseMax: 420, outlets: 5,  model: 'BDV 2EC-5',       exGst: null },
  { houseMin: 211, houseMax: 420, outlets: 6,  model: 'BDV 2EC-6',       exGst: null },
  { houseMin: 211, houseMax: 420, outlets: 7,  model: 'BDV 2EC-7',       exGst: null },
  { houseMin: 211, houseMax: 420, outlets: 8,  model: 'BDV 2EC-8',       exGst: 3683.21 },
  { houseMin: 211, houseMax: 420, outlets: 9,  model: 'BDV 2EC-9',       exGst: 3893.99 },
  { houseMin: 211, houseMax: 420, outlets: 10, model: 'BDV 2EC-10',      exGst: 4744.90 },
  { houseMin: 211, houseMax: 420, outlets: 11, model: 'BDV 2EC-11',      exGst: 4955.67 },
  { houseMin: 211, houseMax: 420, outlets: 12, model: 'BDV 2EC-12',      exGst: 5166.44 },
  { houseMin: 211, houseMax: 420, outlets: 13, model: 'BDV 2EC-13',      exGst: 5377.21 },
  { houseMin: 211, houseMax: 420, outlets: 14, model: 'BDV 2EC-14',      exGst: 5587.99 },
];
const BDVAIR_MAX_HOUSE = Math.max(...BDVAIR_PP_TABLE.map(r => r.houseMax));
const BDVAIR_MAX_OUTLETS = Math.max(...BDVAIR_PP_TABLE.map(r => r.outlets));

function BDVAirPositivePressureCalculator({ onPick }) {
  const [m2, setM2] = useState('');
  const [outlets, setOutlets] = useState('');
  const [priceListProducts, setPriceListProducts] = useState([]);
  const [showBrochure, setShowBrochure] = useState(false);
  const [fullPriceProduct, setFullPriceProduct] = useState(null);

  useEffect(() => {
    api.get('/products').then(r => setPriceListProducts(r.data)).catch(() => {});
  }, []);

  const houseSize = parseInt(m2) || 0;
  // Some models (the "F Upgrade" SKUs) sit at 0 outlets, unlike the other
  // SmartVent calculators — treat an empty field as "no entry" rather than 0
  // so it doesn't accidentally match those rows.
  const numOutlets = outlets === '' ? null : (parseInt(outlets) || 0);

  const exactMatch = houseSize > 0 && numOutlets !== null
    ? BDVAIR_PP_TABLE.find(r => houseSize >= r.houseMin && houseSize <= r.houseMax && numOutlets === r.outlets)
    : null;
  const outletOnlyMatch = !exactMatch && numOutlets !== null
    ? BDVAIR_PP_TABLE.find(r => numOutlets === r.outlets)
    : null;
  const tableMatch = exactMatch || outletOnlyMatch;

  const priceProduct = tableMatch
    ? priceListProducts.find(p =>
        (p.description || '').trim().toLowerCase() === tableMatch.model.trim().toLowerCase() ||
        p.name.trim().toLowerCase() === tableMatch.model.trim().toLowerCase()
      )
    : null;

  const exGst  = priceProduct ? priceProduct.unit_price / 100 : (tableMatch?.exGst ?? null);
  const incGst = exGst != null ? Math.round(exGst * 1.15 * 100) / 100 : null;

  return (
    <div className={styles.calc}>
      <h3 className={styles.calcTitle}>BDVAir Positive Pressure Calculator</h3>
      <div className={styles.calcGrid}>
        <div className={styles.calcField}>
          <label>House Size (m²)</label>
          <input type="number" value={m2} onChange={e => setM2(e.target.value)}
            placeholder="e.g. 150" min="0" max={BDVAIR_MAX_HOUSE} />
        </div>
        <div className={styles.calcField}>
          <label>Number of Outlets</label>
          <input type="number" value={outlets} onChange={e => setOutlets(e.target.value)}
            placeholder="e.g. 4" min="0" max={BDVAIR_MAX_OUTLETS} />
        </div>
      </div>
      {houseSize > BDVAIR_MAX_HOUSE && (
        <div className={styles.calcNote}>House size exceeds BDVAir Positive Pressure range (max {BDVAIR_MAX_HOUSE} m²). Please contact us for a custom solution.</div>
      )}
      {tableMatch && (
        <div className={styles.calcResult}>
          <div className={styles.calcResultRow}><span>Model</span><strong>{tableMatch.model}</strong></div>
          {exGst != null && <>
            <div className={styles.calcResultRow}><span>Total (ex GST)</span><strong>${exGst.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>
            <div className={styles.calcResultRow}><span>Total (inc GST)</span><strong className={styles.calcTotal}>${incGst.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>
          </>}
          {!priceProduct && exGst != null && <div className={styles.calcNote} style={{ marginTop: 10 }}>Add "{tableMatch.model}" to your Price List to enable live pricing and job line items.</div>}
          {exGst == null && <div className={styles.calcNote} style={{ marginTop: 10 }}>No price on file for "{tableMatch.model}" — contact the office to price this unit.</div>}
          {priceProduct && onPick && (
            <button className={styles.addToJobBtn} onClick={() => onPick(priceProduct)}>
              + Add {tableMatch.model} to Quote
            </button>
          )}
          {priceProduct && (
            <button className={styles.brochureBtn} onClick={() => {
              if (fullPriceProduct) { setShowBrochure(true); return; }
              api.get(`/products/${priceProduct.id}`).then(r => {
                setFullPriceProduct(r.data);
                if (r.data.brochure_base64) setShowBrochure(true);
                else alert('No brochure uploaded for this product.');
              }).catch(() => {});
            }}>
              📄 View Product Brochure
            </button>
          )}
        </div>
      )}
      {showBrochure && fullPriceProduct?.brochure_base64 && (
        <BrochureModal src={fullPriceProduct.brochure_base64} name={tableMatch.model} onClose={() => setShowBrochure(false)} />
      )}
    </div>
  );
}

// The heat pump's price comes from whichever model the sizing calculator
// lands on, so a fixed "From" figure alongside it would just contradict the
// real one.
function showsFromPrice(product) {
  return product.calculator_type !== 'heatpump' && product.price_from > 0;
}

// Calculators that work out which model suits and offer their own "Add to
// Quote" button — the panel must not add a second, generic one alongside.
const SELF_PICK_CALCULATORS = new Set([
  'heatpump',
  'paling_fence',
  'smartvent_lite',
  'smartvent_positive_pressure',
  'smartvent_balanced_pressure',
  'bdvair_positive_pressure',
]);

function Calculator({ product, onPick, jobId, onSelectVariant }) {
  const type = product.calculator_type || 'unit';
  if (type === 'area') return <AreaCalculator product={product} jobId={jobId} />;
  if (type === 'linear') return <LinearCalculator product={product} />;
  if (type === 'heatpump') return <HeatpumpCalculator onPick={onPick} />;
  if (type === 'paling_fence') return <PalingFenceCalculator onPick={onPick} jobId={jobId} product={product} onSelectVariant={onSelectVariant} />;
  if (type === 'smartvent_lite') return <SmartVentLiteCalculator onPick={onPick} />;
  if (type === 'smartvent_positive_pressure') return <SmartVentPositivePressureCalculator onPick={onPick} product={product} />;
  if (type === 'smartvent_balanced_pressure') return <SmartVentBalancedPressureCalculator onPick={onPick} />;
  if (type === 'bdvair_positive_pressure') return <BDVAirPositivePressureCalculator onPick={onPick} />;
  return <UnitCalculator product={product} />;
}

// ── Product Detail Panel ──────────────────────────────────────────────────────
function BrochureModal({ src, name, onClose }) {
  const isPdf = src?.startsWith('data:application/pdf');
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const contentRef = useRef(null);
  const [pageWidth, setPageWidth] = useState(null);

  // Markup / annotation
  const [markupMode, setMarkupMode] = useState(false);
  const [penColor, setPenColor] = useState('#e11d48');
  const [penSize, setPenSize] = useState(4);
  const [isEraser, setIsEraser] = useState(false);
  const [history, setHistory] = useState([]);
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const lastPt = useRef(null);

  const measureWidth = useCallback(() => {
    if (contentRef.current) setPageWidth(contentRef.current.clientWidth - 32);
  }, []);
  useEffect(() => {
    measureWidth();
    window.addEventListener('resize', measureWidth);
    return () => window.removeEventListener('resize', measureWidth);
  }, [measureWidth]);

  const effectiveWidth = pageWidth ? pageWidth * scale : undefined;

  // Keep canvas sized to the visible content area
  useEffect(() => {
    const canvas = canvasRef.current;
    const content = contentRef.current;
    if (!canvas || !content) return;
    const w = content.clientWidth;
    const h = content.clientHeight;
    if (canvas.width === w && canvas.height === h) return;
    const saved = canvas.width > 0 && canvas.height > 0 ? canvas.toDataURL() : null;
    canvas.width = w;
    canvas.height = h;
    if (saved) {
      const img = new Image();
      img.onload = () => canvas.getContext('2d').drawImage(img, 0, 0);
      img.src = saved;
    }
  }, [pageWidth, scale]);

  // Clear annotations when navigating to a different PDF page
  const prevPageRef = useRef(pageNumber);
  useEffect(() => {
    if (prevPageRef.current === pageNumber) return;
    prevPageRef.current = pageNumber;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      setHistory([]);
    }
  }, [pageNumber]);

  function getPos(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function startDraw(e) {
    if (!markupMode) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    drawing.current = true;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (canvas.width > 0 && canvas.height > 0) {
      setHistory(h => [...h.slice(-19), ctx.getImageData(0, 0, canvas.width, canvas.height)]);
    }
    lastPt.current = getPos(e);
  }

  function onDraw(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pt = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPt.current.x, lastPt.current.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (isEraser) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = penSize * 5;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = penColor;
      ctx.lineWidth = penSize;
      ctx.stroke();
    }
    lastPt.current = pt;
  }

  function endDraw() {
    drawing.current = false;
    lastPt.current = null;
  }

  function handleUndo() {
    if (!history.length) return;
    canvasRef.current.getContext('2d').putImageData(history[history.length - 1], 0, 0);
    setHistory(h => h.slice(0, -1));
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (canvas.width > 0 && canvas.height > 0) {
      setHistory(h => [...h.slice(-19), ctx.getImageData(0, 0, canvas.width, canvas.height)]);
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return (
    <div className={styles.brochureOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.brochureModal}>
        <div className={styles.brochureHeader}>
          <span className={styles.brochureTitle}>{name}</span>
          <div className={styles.brochureControls}>
            {isPdf && numPages > 1 && (
              <div className={styles.brochureNav}>
                <button className={styles.brochureNavBtn}
                  onClick={() => setPageNumber(p => Math.max(1, p - 1))}
                  disabled={pageNumber <= 1}>‹</button>
                <span className={styles.brochureNavLabel}>{pageNumber} / {numPages}</span>
                <button className={styles.brochureNavBtn}
                  onClick={() => setPageNumber(p => Math.min(numPages, p + 1))}
                  disabled={pageNumber >= numPages}>›</button>
              </div>
            )}
            {isPdf && (
              <div className={styles.brochureZoom}>
                <button className={styles.brochureNavBtn}
                  onClick={() => setScale(s => Math.max(0.5, +(s - 0.25).toFixed(2)))}>−</button>
                <span className={styles.brochureNavLabel}>{Math.round(scale * 100)}%</span>
                <button className={styles.brochureNavBtn}
                  onClick={() => setScale(s => Math.min(3, +(s + 0.25).toFixed(2)))}>+</button>
              </div>
            )}
            <button
              className={`${styles.markupToggle} ${markupMode ? styles.markupToggleActive : ''}`}
              onClick={() => setMarkupMode(m => !m)}
              title={markupMode ? 'Exit drawing mode' : 'Annotate / draw'}
            >✏️</button>
            <button className={styles.brochureClose} onClick={onClose}>✕ Close</button>
          </div>

          {markupMode && (
            <div className={styles.markupToolbar}>
              <input
                type="color"
                value={penColor}
                onChange={e => { setPenColor(e.target.value); setIsEraser(false); }}
                className={styles.markupColorPicker}
                title="Pen colour"
              />
              {[2, 4, 8, 16].map(s => (
                <button
                  key={s}
                  className={`${styles.markupSizeBtn} ${!isEraser && penSize === s ? styles.markupSizeBtnActive : ''}`}
                  onClick={() => { setPenSize(s); setIsEraser(false); }}
                  title={`Pen size ${s}`}
                >
                  <span style={{ width: s + 2, height: s + 2, borderRadius: '50%', background: 'white', display: 'block', flexShrink: 0 }} />
                </button>
              ))}
              <div className={styles.markupDivider} />
              <button
                className={`${styles.markupBtn} ${isEraser ? styles.markupBtnActive : ''}`}
                onClick={() => setIsEraser(e => !e)}
              >⌫ Erase</button>
              <button
                className={styles.markupBtn}
                onClick={handleUndo}
                disabled={!history.length}
              >↩ Undo</button>
              <button className={styles.markupBtn} onClick={handleClear}>🗑 Clear</button>
            </div>
          )}
        </div>

        <div
          className={styles.brochureContent}
          ref={contentRef}
          style={markupMode ? { overflow: 'hidden' } : undefined}
        >
          {isPdf ? (
            <Document
              file={src}
              onLoadSuccess={({ numPages }) => { setNumPages(numPages); setPageNumber(1); }}
              loading={<div className={styles.brochurePdfLoading}>Loading PDF…</div>}
              error={<div className={styles.brochurePdfLoading}>Failed to load PDF.</div>}
            >
              <Page
                pageNumber={pageNumber}
                width={effectiveWidth}
                renderAnnotationLayer={true}
                renderTextLayer={true}
              />
            </Document>
          ) : (
            <img src={src} alt="Product Brochure" className={styles.brochureImg} />
          )}
          <canvas
            ref={canvasRef}
            className={styles.markupCanvas}
            style={{
              pointerEvents: markupMode ? 'all' : 'none',
              cursor: markupMode ? (isEraser ? 'cell' : 'crosshair') : 'default',
            }}
            onPointerDown={startDraw}
            onPointerMove={onDraw}
            onPointerUp={endDraw}
            onPointerLeave={endDraw}
            onPointerCancel={endDraw}
          />
        </div>
      </div>
    </div>
  );
}

function ProductPanel({ product, section, onClose, onPick, jobId, onSelectVariant }) {
  const [showBrochure, setShowBrochure] = useState(false);
  return (
    <div className={styles.panelOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.panel}>
        <button className={styles.panelClose} onClick={onClose}>✕</button>
        {product.image_base64 && (
          <div className={styles.panelImage}>
            <img src={product.image_base64} alt={product.name} />
          </div>
        )}
        <div className={styles.panelBody}>
          <div className={styles.panelTag} style={{ background: section.color + '22', color: section.color }}>
            {section.icon} {section.name}
          </div>
          <h2 className={styles.panelTitle}>{product.name}</h2>
          {product.description && <p className={styles.panelDesc}>{product.description}</p>}
          {product.features?.length > 0 && (
            <ul className={styles.panelFeatures}>
              {product.features.map((f, i) => <li key={i}>✓ {f}</li>)}
            </ul>
          )}
          {showsFromPrice(product) && (
            <div className={styles.panelPriceFrom}>
              From <strong>${(product.price_from / 100).toLocaleString('en-NZ')}</strong> <span>+ GST</span>
            </div>
          )}
          <Calculator product={product} onPick={onPick} jobId={jobId} onSelectVariant={onSelectVariant} />
          {onPick && !SELF_PICK_CALCULATORS.has(product.calculator_type) && (
            <button className={styles.addToJobBtn} onClick={() => onPick(product.price_list_product || product)}>
              + Add to Quote
            </button>
          )}
          {product.brochure_base64 && (
            <button className={styles.brochureBtn} onClick={() => setShowBrochure(true)}>
              📄 View Product Brochure
            </button>
          )}
        </div>
      </div>
      {showBrochure && (
        <BrochureModal src={product.brochure_base64} name={product.name} onClose={() => setShowBrochure(false)} />
      )}
    </div>
  );
}

// ── Subcategory grid ──────────────────────────────────────────────────────────
function SubcategoryGrid({ subcategories, section, onPick: onPickSubcat }) {
  return (
    <div className={styles.productGrid}>
      {subcategories.map(sc => (
        <button key={sc.id} className={styles.productCard} onClick={() => onPickSubcat(sc)}>
          {sc.image_base64 ? (
            <img src={sc.image_base64} alt={sc.name} className={styles.productImage} />
          ) : (
            <div className={styles.productImagePlaceholder} style={{ background: (section?.color || '#1e40af') + '22' }}>
              <span style={{ fontSize: 40 }}>📁</span>
            </div>
          )}
          <div className={styles.productInfo}>
            {!sc.hide_label && <h3 className={styles.productName}>{sc.name}</h3>}
            {sc.product_count > 0 && <p className={styles.productDesc}>{sc.product_count} product{sc.product_count !== 1 ? 's' : ''}</p>}
            <div className={styles.productCta} style={{ background: section?.color || '#1e40af' }}>
              View Products →
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Main Presenter ────────────────────────────────────────────────────────────
export default function SalesPresenter({ onPick, jobId }) {
  const navigate = useNavigate();
  const [sections, setSections] = useState([]);
  const [activeSection, setActiveSection] = useState(null);
  const [subcategories, setSubcategories] = useState([]);
  const [subcatStack, setSubcatStack] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedProductFull, setSelectedProductFull] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const currentNode = subcatStack[subcatStack.length - 1] || null;

  // A calculator can swap the panel to a sibling product — the fence one does
  // this when the height or top cap changes, so the image, name and price at
  // the top follow the option being discussed. Falls back silently if that
  // variant hasn't been set up as its own presenter product.
  function selectVariantByName(name) {
    const target = normFenceName(name);
    const match = products.find(p => normFenceName(p.name) === target);
    if (!match || match.id === selectedProduct?.id) return;
    setSelectedProduct(match);
    setSelectedProductFull(null);
    api.get(`/presenter/products/${match.id}`).then(r => setSelectedProductFull(r.data)).catch(() => {});
  }

  // Adding a product keeps the presenter open — it just closes the product
  // panel and flashes a confirmation, so the rep can keep working through the
  // catalogue and add several products in one sitting. Only Cancel/Exit
  // (onPick(null)) actually leaves.
  async function handlePick(product) {
    if (!product) { onPick(null); return; }
    try {
      await onPick(product);
      setSelectedProduct(null);
      setSelectedProductFull(null);
      setToast(`${product.name} added to quote`);
      setTimeout(() => setToast(null), 2600);
    } catch {
      setToast('Could not add that product — please try again.');
      setTimeout(() => setToast(null), 3200);
    }
  }

  useEffect(() => {
    api.get('/presenter/sections').then(r => {
      setSections(r.data);
      if (r.data.length > 0) setActiveSection(r.data[0]);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeSection) return;
    setSubcategories([]); setSubcatStack([]); setProducts([]); setSelectedProduct(null);
    api.get(`/presenter/sections/${activeSection.id}/subcategories`).then(r => {
      setSubcategories(r.data);
      if (r.data.length === 0) {
        api.get(`/presenter/sections/${activeSection.id}/products`).then(rp =>
          setProducts(rp.data.filter(p => !p.subcategory_id))
        );
      }
    });
  }, [activeSection]);

  useEffect(() => {
    if (!currentNode) return;
    setProducts([]); setSelectedProduct(null);
    // Load children of this node
    api.get(`/presenter/subcategories/${currentNode.id}/subcategories`).then(r => {
      setSubcategories(r.data);
      // If no children, show products
      if (r.data.length === 0) {
        api.get(`/presenter/subcategories/${currentNode.id}/products`).then(rp => setProducts(rp.data));
      }
    });
  }, [currentNode]);

  // View mode: show subcategory grid or product grid
  const viewMode = subcategories.length > 0 ? 'subcats' : 'products';

  if (loading) return (
    <div className={styles.presenter}>
      <div className={styles.loadingScreen}>Loading presenter…</div>
    </div>
  );

  return (
    <div className={styles.presenter}>
      {/* Top bar */}
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          <img src="/favicon.png" alt="Dekker" className={styles.headerLogo} />
          <span className={styles.headerName}>Dekker App</span>
        </div>

        <nav className={styles.sectionTabs}>
          {sections.map(s => (
            <button
              key={s.id}
              className={`${styles.sectionTab} ${activeSection?.id === s.id ? styles.sectionTabActive : ''}`}
              style={activeSection?.id === s.id ? { borderBottomColor: s.color, color: s.color } : {}}
              onClick={() => { setActiveSection(s); setSelectedProduct(null); }}
            >
              {s.image_base64
                ? <img src={s.image_base64} alt={s.name} style={{ width: 24, height: 24, objectFit: 'cover', borderRadius: 4 }} />
                : <span>{s.icon}</span>}
              {s.name}
            </button>
          ))}
        </nav>

        <button className={styles.exitBtn} onClick={() => onPick ? onPick(null) : navigate('/')}>
          ✕ {onPick ? 'Cancel' : 'Exit'}
        </button>
      </header>

      {/* Section hero / breadcrumb */}
      {activeSection && (
        <div className={styles.sectionHero} style={{ borderTopColor: activeSection.color }}>
          {activeSection.image_base64
            ? <img src={activeSection.image_base64} alt={activeSection.name} className={styles.heroImage} />
            : <div className={styles.heroIcon}>{activeSection.icon}</div>}
          <div style={{ flex: 1 }}>
            <div className={styles.breadcrumb}>
              <span
                className={subcatStack.length > 0 ? styles.breadcrumbLink : styles.breadcrumbCurrent}
                onClick={() => { if (subcatStack.length > 0) { setSubcatStack([]); setSubcategories([]); setProducts([]); setSelectedProduct(null); api.get(`/presenter/sections/${activeSection.id}/subcategories`).then(r => { setSubcategories(r.data); if (r.data.length === 0) api.get(`/presenter/sections/${activeSection.id}/products`).then(rp => setProducts(rp.data.filter(p => !p.subcategory_id))); }); } }}
              >
                {activeSection.name}
              </span>
              {subcatStack.map((sc, i) => (
                <span key={sc.id}>
                  <span className={styles.breadcrumbSep}>›</span>
                  <span
                    className={i === subcatStack.length - 1 ? styles.breadcrumbCurrent : styles.breadcrumbLink}
                    onClick={() => {
                      if (i < subcatStack.length - 1) {
                        const newStack = subcatStack.slice(0, i + 1);
                        setSubcatStack(newStack);
                        setSubcategories([]); setProducts([]); setSelectedProduct(null);
                      }
                    }}
                  >
                    {sc.name}
                  </span>
                </span>
              ))}
            </div>
            <p className={styles.heroSub}>
              {viewMode === 'subcats'
                ? 'Select a category below'
                : `${products.length} product${products.length !== 1 ? 's' : ''} — select to view details and pricing`}
            </p>
          </div>
        </div>
      )}

      {/* Subcategory grid or product grid */}
      {viewMode === 'subcats' ? (
        <SubcategoryGrid subcategories={subcategories} section={activeSection} onPick={sc => setSubcatStack(s => [...s, sc])} />
      ) : (
      <div className={styles.productGrid}>
        {products.length === 0 ? (
          <div className={styles.emptySection}>
            <div className={styles.emptyIcon}>{activeSection?.icon}</div>
            <p>No products added yet{currentNode ? ` for ${currentNode.name}` : ` for ${activeSection?.name}`}.</p>
            <p className={styles.emptyHint}>Go to <strong>Settings → Sales Presenter</strong> to add products.</p>
          </div>
        ) : products.map(p => (
          <button key={p.id} className={styles.productCard} onClick={() => {
          setSelectedProduct(p);
          setSelectedProductFull(null);
          api.get(`/presenter/products/${p.id}`).then(r => setSelectedProductFull(r.data)).catch(() => {});
        }}>
            {p.image_base64 ? (
              <img src={p.image_base64} alt={p.name} className={styles.productImage} />
            ) : (
              <div className={styles.productImagePlaceholder} style={{ background: activeSection?.color + '22' }}>
                <span style={{ fontSize: 40 }}>{activeSection?.icon}</span>
              </div>
            )}
            <div className={styles.productInfo}>
              <h3 className={styles.productName}>{p.name}</h3>
              {p.description && <p className={styles.productDesc}>{p.description}</p>}
              {showsFromPrice(p) && (
                <div className={styles.productPrice} style={{ color: activeSection?.color }}>
                  From ${(p.price_from / 100).toLocaleString('en-NZ')} + GST
                </div>
              )}
              <div className={styles.productCta} style={{ background: activeSection?.color }}>
                View & Calculate →
              </div>
            </div>
          </button>
        ))}
      </div>
      )}

      {/* Product detail panel */}
      {selectedProduct && (
        <ProductPanel
          product={selectedProductFull || selectedProduct}
          section={activeSection}
          onClose={() => { setSelectedProduct(null); setSelectedProductFull(null); }}
          onPick={onPick ? handlePick : null}
          jobId={jobId}
          onSelectVariant={selectVariantByName}
        />
      )}

      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  );
}
