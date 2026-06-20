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
  const [roomSize, setRoomSize] = useState('');
  const [insulation, setInsulation] = useState('average');
  const [stories, setStories] = useState('1');
  const basePrice = product.price_from / 100 || 0;

  const multiplier = { poor: 1.3, average: 1.0, good: 0.8 }[insulation] || 1;
  const storyMult = stories === '2' ? 1.1 : 1;
  const m2 = parseFloat(roomSize) || 0;
  const kw = m2 > 0 ? ((m2 * 0.07 * multiplier * storyMult)).toFixed(1) : null;
  const total = basePrice > 0 ? basePrice * storyMult * (insulation === 'poor' ? 1.1 : insulation === 'good' ? 0.95 : 1) : 0;

  return (
    <div className={styles.calc}>
      <h3 className={styles.calcTitle}>Heat Pump Sizing</h3>
      <div className={styles.calcGrid}>
        <div className={styles.calcField}>
          <label>Room Area (m²)</label>
          <input type="number" value={roomSize} onChange={e => setRoomSize(e.target.value)} placeholder="e.g. 30" />
        </div>
        <div className={styles.calcField}>
          <label>Insulation</label>
          <select value={insulation} onChange={e => setInsulation(e.target.value)}>
            <option value="good">Good (modern home)</option>
            <option value="average">Average</option>
            <option value="poor">Poor (older home)</option>
          </select>
        </div>
        <div className={styles.calcField}>
          <label>Storeys</label>
          <select value={stories} onChange={e => setStories(e.target.value)}>
            <option value="1">Single storey</option>
            <option value="2">Double storey</option>
          </select>
        </div>
      </div>
      {kw && (
        <div className={styles.calcResult}>
          <div className={styles.calcResultRow}><span>Recommended capacity</span><strong>{kw} kW</strong></div>
          {basePrice > 0 && <div className={styles.calcResultRow}><span>Estimated install (ex GST)</span><strong>${total.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>}
          {basePrice > 0 && <div className={styles.calcResultRow}><span>Total (inc GST)</span><strong className={styles.calcTotal}>${(total * 1.15).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}</strong></div>}
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

function Calculator({ product }) {
  const type = product.calculator_type || 'unit';
  if (type === 'area') return <AreaCalculator product={product} />;
  if (type === 'linear') return <LinearCalculator product={product} />;
  if (type === 'heatpump') return <HeatpumpCalculator product={product} />;
  return <UnitCalculator product={product} />;
}

// ── Product Detail Panel ──────────────────────────────────────────────────────
function ProductPanel({ product, section, onClose }) {
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
          <Calculator product={product} />
        </div>
      </div>
    </div>
  );
}

// ── Main Presenter ────────────────────────────────────────────────────────────
export default function SalesPresenter() {
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

        <button className={styles.exitBtn} onClick={() => navigate('/')}>
          ✕ Exit
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
        />
      )}
    </div>
  );
}
