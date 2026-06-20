import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import styles from './SalesPresenter.module.css';

// ── Calculators ───────────────────────────────────────────────────────────────

function AreaCalculator({ product }) {
  const cfg = product.calculator_config || {};
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [qty, setQty] = useState(1);
  const pricePerM2 = (product.price_from / 100) || cfg.price_per_m2 || 0;
  const area = (parseFloat(length) || 0) * (parseFloat(width) || 0);
  const total = area * pricePerM2 * qty;

  return (
    <div className={styles.calc}>
      <h3 className={styles.calcTitle}>Area Calculator</h3>
      <div className={styles.calcGrid}>
        <div className={styles.calcField}>
          <label>Length (m)</label>
          <input type="number" value={length} onChange={e => setLength(e.target.value)} placeholder="0" />
        </div>
        <div className={styles.calcField}>
          <label>Width (m)</label>
          <input type="number" value={width} onChange={e => setWidth(e.target.value)} placeholder="0" />
        </div>
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
          <div className={styles.calcResultRow}><span>Area</span><strong>{area.toFixed(1)} m²</strong></div>
          {pricePerM2 > 0 && <div className={styles.calcResultRow}><span>Estimate (ex GST)</span><strong>${total.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>}
          {pricePerM2 > 0 && <div className={styles.calcResultRow}><span>Total (inc GST)</span><strong className={styles.calcTotal}>${(total * 1.15).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>}
        </div>
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

function HeatpumpCalculator({ product }) {
  const [length, setLength] = useState(5);
  const [width, setWidth] = useState(4);
  const [m2, setM2] = useState('20');
  const [ceilingHeight, setCeilingHeight] = useState('2.4');
  const [insulation, setInsulation] = useState('average');
  const basePrice = product.price_from / 100 || 0;

  function handleLength(v) { setLength(v); setM2((v * width).toFixed(1)); }
  function handleWidth(v)  { setWidth(v);  setM2((length * v).toFixed(1)); }
  function handleM2(v)     { setM2(v); } // manual override — sliders stay where they are

  const kwMultiplier = { good: 0.05, average: 0.055, poor: 0.06 }[insulation];
  const m3 = (parseFloat(m2) || 0) * (parseFloat(ceilingHeight) || 0);
  const kw = m3 > 0 ? (m3 * kwMultiplier).toFixed(2) : null;
  const total = basePrice > 0 ? basePrice * (insulation === 'poor' ? 1.1 : insulation === 'good' ? 0.95 : 1) : 0;

  return (
    <div className={styles.calc}>
      <h3 className={styles.calcTitle}>Heat Pump Sizing Calculator</h3>

      {/* Sliders */}
      <div className={styles.sliderSection}>
        <div className={styles.sliderRow}>
          <span className={styles.sliderLabel}>Length</span>
          <input type="range" min="1" max="30" step="0.5" value={length}
            onChange={e => handleLength(parseFloat(e.target.value))} className={styles.slider} />
          <span className={styles.sliderVal}>{length} m</span>
        </div>
        <div className={styles.sliderRow}>
          <span className={styles.sliderLabel}>Width</span>
          <input type="range" min="1" max="20" step="0.5" value={width}
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
          </select>
        </div>
        <div className={styles.calcField} style={{ gridColumn: '1 / -1' }}>
          <label>Insulation Level</label>
          <select value={insulation} onChange={e => setInsulation(e.target.value)}>
            <option value="good">Good — modern well-insulated home (× 0.05)</option>
            <option value="average">Average — partially insulated (× 0.055)</option>
            <option value="poor">Poor — older uninsulated home (× 0.06)</option>
          </select>
        </div>
      </div>

      {kw && (
        <div className={styles.calcResult}>
          <div className={styles.calcResultRow}><span>Volume</span><strong>{m3.toFixed(1)} m³</strong></div>
          <div className={styles.calcResultRow}><span>Recommended capacity</span><strong className={styles.calcTotal}>{kw} kW</strong></div>
          {basePrice > 0 && <>
            <div className={styles.calcResultRow}><span>Estimated install (ex GST)</span><strong>${total.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>
            <div className={styles.calcResultRow}><span>Total (inc GST)</span><strong>${(total * 1.15).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>
          </>}
        </div>
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
  const incGst = priceProduct ? (priceProduct.unit_price / 100) * 1.15 : (tableMatch?.incGst ?? null);

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
              + Add {tableMatch.model} to Job
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Calculator({ product, onPick }) {
  const type = product.calculator_type || 'unit';
  if (type === 'area') return <AreaCalculator product={product} />;
  if (type === 'linear') return <LinearCalculator product={product} />;
  if (type === 'heatpump') return <HeatpumpCalculator product={product} />;
  if (type === 'smartvent_lite') return <SmartVentLiteCalculator onPick={onPick} />;
  return <UnitCalculator product={product} />;
}

// ── Product Detail Panel ──────────────────────────────────────────────────────
function ProductPanel({ product, section, onClose, onPick }) {
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
          {product.price_from > 0 && (
            <div className={styles.panelPriceFrom}>
              From <strong>${(product.price_from / 100).toLocaleString('en-NZ')}</strong> <span>+ GST</span>
            </div>
          )}
          <Calculator product={product} onPick={onPick} />
          {onPick && product.calculator_type !== 'smartvent_lite' && (
            <button className={styles.addToJobBtn} onClick={() => onPick(product)}>
              + Add to Job
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Presenter ────────────────────────────────────────────────────────────
export default function SalesPresenter({ onPick }) {
  const navigate = useNavigate();
  const [sections, setSections] = useState([]);
  const [activeSection, setActiveSection] = useState(null);
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/presenter/sections').then(r => {
      setSections(r.data);
      if (r.data.length > 0) setActiveSection(r.data[0]);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeSection) return;
    setProducts([]);
    api.get(`/presenter/sections/${activeSection.id}/products`).then(r => setProducts(r.data));
  }, [activeSection]);

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
          <div className={styles.headerLogo}>DG</div>
          <span className={styles.headerName}>Dekker Group</span>
        </div>

        <nav className={styles.sectionTabs}>
          {sections.map(s => (
            <button
              key={s.id}
              className={`${styles.sectionTab} ${activeSection?.id === s.id ? styles.sectionTabActive : ''}`}
              style={activeSection?.id === s.id ? { borderBottomColor: s.color, color: s.color } : {}}
              onClick={() => { setActiveSection(s); setSelectedProduct(null); }}
            >
              <span>{s.icon}</span>
              {s.name}
            </button>
          ))}
        </nav>

        <button className={styles.exitBtn} onClick={() => onPick ? onPick(null) : navigate('/')}>
          ✕ {onPick ? 'Cancel' : 'Exit'}
        </button>
      </header>

      {/* Section hero */}
      {activeSection && (
        <div className={styles.sectionHero} style={{ borderTopColor: activeSection.color }}>
          <div className={styles.heroIcon}>{activeSection.icon}</div>
          <div>
            <h1 className={styles.heroTitle} style={{ color: activeSection.color }}>{activeSection.name}</h1>
            <p className={styles.heroSub}>Select a product to view details and pricing</p>
          </div>
        </div>
      )}

      {/* Product grid */}
      <div className={styles.productGrid}>
        {products.length === 0 ? (
          <div className={styles.emptySection}>
            <div className={styles.emptyIcon}>{activeSection?.icon}</div>
            <p>No products added yet for {activeSection?.name}.</p>
            <p className={styles.emptyHint}>Go to <strong>Settings → Sales Presenter</strong> to add products.</p>
          </div>
        ) : products.map(p => (
          <button key={p.id} className={styles.productCard} onClick={() => setSelectedProduct(p)}>
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
              {p.price_from > 0 && (
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

      {/* Product detail panel */}
      {selectedProduct && (
        <ProductPanel
          product={selectedProduct}
          section={activeSection}
          onClose={() => setSelectedProduct(null)}
          onPick={onPick}
        />
      )}
    </div>
  );
}
