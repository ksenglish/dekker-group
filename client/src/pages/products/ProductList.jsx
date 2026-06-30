import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './Products.module.css';

const fmt = cents => '$' + (cents / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const UNITS = ['each', 'hr', 'm', 'm²', 'kg', 'L', 'day', 'kit', 'set'];

function ImageUpload({ value, onChange }) {
  const ref = useRef();

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
      return alert('Please upload a JPG or PNG image.');
    if (file.size > 2 * 1024 * 1024)
      return alert('Image must be under 2MB.');
    const reader = new FileReader();
    reader.onload = ev => onChange(ev.target.result);
    reader.readAsDataURL(file);
  }

  return (
    <div className={styles.imageUpload}>
      {value ? (
        <div className={styles.imagePreviewWrap}>
          <img src={value} alt="Product" className={styles.imagePreview} />
          <button type="button" className={styles.imageRemove} onClick={() => onChange('')}>✕ Remove</button>
        </div>
      ) : (
        <button type="button" className={styles.imagePickBtn} onClick={() => ref.current.click()}>
          📷 Upload Image (JPG / PNG)
        </button>
      )}
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  );
}

function BrochureUpload({ value, onChange }) {
  const ref = useRef();

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type))
      return alert('Please upload a JPG, PNG, or PDF.');
    if (file.size > 10 * 1024 * 1024)
      return alert('Brochure must be under 10MB.');
    const reader = new FileReader();
    reader.onload = ev => onChange(ev.target.result);
    reader.readAsDataURL(file);
  }

  const isPdf = value?.startsWith('data:application/pdf');

  return (
    <div className={styles.imageUpload}>
      {value ? (
        <div className={styles.imagePreviewWrap}>
          {isPdf
            ? <div style={{ padding: '10px 16px', background: '#f1f5f9', borderRadius: 6, fontSize: 13, color: '#334155' }}>📄 PDF brochure uploaded</div>
            : <img src={value} alt="Brochure preview" className={styles.imagePreview} style={{ maxHeight: 120 }} />
          }
          <button type="button" className={styles.imageRemove} onClick={() => onChange('')}>✕ Remove</button>
        </div>
      ) : (
        <button type="button" className={styles.imagePickBtn} onClick={() => ref.current.click()}>
          📄 Upload Brochure (PDF, JPG or PNG — max 10MB)
        </button>
      )}
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  );
}

function ProductModal({ product, onSave, onClose, isAdmin }) {
  const [form, setForm] = useState({
    name: product?.name || '',
    description: product?.description || '',
    category: product?.category || '',
    unit: product?.unit || 'each',
    unit_price: product ? (product.unit_price / 100).toFixed(2) : '',
    cost_price: product ? (product.cost_price / 100).toFixed(2) : '',
    supplier: product?.supplier || '',
    media_base64:    product?.media_base64    || '',
    brochure_base64: product?.brochure_base64 || '',
    is_active: product?.is_active !== false,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const margin = (() => {
    const sell = parseFloat(form.unit_price) || 0;
    const cost = parseFloat(form.cost_price) || 0;
    if (!sell || !cost) return null;
    return (((sell - cost) / sell) * 100).toFixed(1);
  })();

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) return setErr('Name is required');
    setSaving(true); setErr('');
    try {
      const payload = { ...form };
      if (product) {
        const { data } = await api.put(`/products/${product.id}`, payload);
        onSave(data);
      } else {
        const { data } = await api.post('/products', payload);
        onSave(data);
      }
    } catch (e) { setErr(e.response?.data?.error || 'Save failed'); setSaving(false); }
  }

  return (
    <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2>{product ? 'Edit Product' : 'Add Product'}</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={save} className={styles.modalBody}>
          {err && <div className={styles.formError}>{err}</div>}

          <div className={styles.formGrid}>
            <div className={styles.formGroup} style={{ gridColumn: '1/-1' }}>
              <label>Product Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Supply & Install Split System 2.5kW" />
            </div>
            <div className={styles.formGroup} style={{ gridColumn: '1/-1' }}>
              <label>Description</label>
              <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional detail shown on quotes/invoices" />
            </div>
            <div className={styles.formGroup}>
              <label>Category</label>
              <input value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Installation, Parts, Labour" />
            </div>
            <div className={styles.formGroup}>
              <label>Supplier</label>
              <input value={form.supplier} onChange={e => set('supplier', e.target.value)} placeholder="e.g. Daikin NZ, Mitsubishi Electric" />
            </div>
            <div className={styles.formGroup}>
              <label>Unit</label>
              <select value={form.unit} onChange={e => set('unit', e.target.value)}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Sell Price excl. GST</label>
              <input type="number" min="0" step="0.01" value={form.unit_price}
                onChange={e => set('unit_price', e.target.value)} placeholder="0.00" />
            </div>
            {isAdmin && (
              <div className={styles.formGroup}>
                <label>Cost Price excl. GST</label>
                <input type="number" min="0" step="0.01" value={form.cost_price}
                  onChange={e => set('cost_price', e.target.value)} placeholder="0.00" />
              </div>
            )}
            {isAdmin && (
              <div className={styles.formGroup} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 2 }}>
                {margin !== null && (
                  <div className={styles.marginBadge}>
                    Margin: <strong>{margin}%</strong>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={styles.formGroup}>
            <label>Product Image <span style={{ fontWeight: 400, color: '#64748b' }}>(thumbnail shown on quotes)</span></label>
            <ImageUpload value={form.media_base64} onChange={v => set('media_base64', v)} />
          </div>

          <div className={styles.formGroup}>
            <label>Product Brochure <span style={{ fontWeight: 400, color: '#64748b' }}>(full page appended to quote PDF — JPG / PNG)</span></label>
            <BrochureUpload value={form.brochure_base64} onChange={v => set('brochure_base64', v)} />
          </div>

          <div className={styles.formGroup} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
            <label htmlFor="is_active" style={{ marginBottom: 0 }}>Active (shows in search)</label>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>{saving ? 'Saving…' : 'Save Product'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ImportModal({ onDone, onClose }) {
  const [tab, setTab] = useState('zip'); // 'zip' | 'csv'
  const [csv, setCsv] = useState('');
  const [zipFile, setZipFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const csvRef = useRef();
  const zipRef = useRef();

  function loadCsv(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setCsv(ev.target.result);
    reader.readAsText(file);
  }

  async function doImport() {
    setLoading(true); setResult(null);
    try {
      if (tab === 'zip') {
        const fd = new FormData();
        fd.append('file', zipFile);
        const { data } = await api.post('/products/import-zip', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        setResult(data);
        if (data.imported > 0) onDone();
      } else {
        const { data } = await api.post('/products/import', { csv });
        setResult(data);
        if (data.imported > 0) onDone();
      }
    } catch (e) { setResult({ imported: 0, errors: [e.response?.data?.error || 'Import failed'] }); }
    setLoading(false);
  }

  const canImport = tab === 'zip' ? !!zipFile : !!csv;

  return (
    <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2>Import Products</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          {/* Tab switcher */}
          <div className={styles.importTabs}>
            <button className={`${styles.importTab} ${tab === 'zip' ? styles.importTabActive : ''}`} onClick={() => { setTab('zip'); setResult(null); }}>
              📦 ZIP with Images
            </button>
            <button className={`${styles.importTab} ${tab === 'csv' ? styles.importTabActive : ''}`} onClick={() => { setTab('csv'); setResult(null); }}>
              📄 CSV only
            </button>
          </div>

          {tab === 'zip' ? (
            <>
              <div className={styles.importNote}>
                <p>Create a <strong>.zip</strong> file containing:</p>
                <ul style={{ marginTop: 6, paddingLeft: 20, lineHeight: 1.8 }}>
                  <li>A file called <code>products.csv</code> with columns:<br />
                    <code>name, description, category, supplier, unit, unit_price, cost_price, image, brochure</code></li>
                  <li>Your product images (JPG/PNG) and brochures (PDF/JPG/PNG) in the same ZIP</li>
                  <li>The <code>image</code> column should match the thumbnail filename, e.g. <code>daikin-25kw.jpg</code></li>
                  <li>The <code>brochure</code> column should match the brochure filename, e.g. <code>daikin-25kw-brochure.pdf</code></li>
                </ul>
              </div>
              <div className={styles.formGroup}>
                <label>Upload ZIP file (max 50MB)</label>
                <input type="file" accept=".zip,application/zip" ref={zipRef}
                  onChange={e => { setZipFile(e.target.files[0] || null); setResult(null); }} />
              </div>
              {zipFile && <p className={styles.importNote}>Ready: <strong>{zipFile.name}</strong> ({(zipFile.size / 1024 / 1024).toFixed(1)} MB)</p>}
            </>
          ) : (
            <>
              <p className={styles.importNote}>
                CSV columns: <code>name</code>, <code>description</code>, <code>category</code>, <code>supplier</code>, <code>unit</code>, <code>unit_price</code>, <code>cost_price</code> (dollar values excl. GST). No images.
              </p>
              <div className={styles.formGroup}>
                <label>Upload CSV file</label>
                <input type="file" accept=".csv,text/csv" ref={csvRef} onChange={loadCsv} />
              </div>
              {csv && (
                <div className={styles.formGroup}>
                  <label>Preview ({csv.split('\n').filter(Boolean).length - 1} rows)</label>
                  <textarea readOnly rows={5} value={csv} className={styles.csvPreview} />
                </div>
              )}
            </>
          )}

          {result && (
            <div className={result.errors?.length ? styles.formError : styles.formSuccess}>
              ✓ {result.imported} product{result.imported !== 1 ? 's' : ''} imported
              {result.imagesFound !== undefined && ` · ${result.imagesFound} image${result.imagesFound !== 1 ? 's' : ''} found`}
              {result.errors?.length > 0 && <div style={{ marginTop: 4 }}>{result.errors.slice(0,5).join(', ')}</div>}
            </div>
          )}

          <div className={styles.modalFooter}>
            <button className={styles.btnSecondary} onClick={onClose}>Close</button>
            <button className={styles.btnPrimary} disabled={!canImport || loading} onClick={doImport}>
              {loading ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function exportCsv(products) {
  const headers = ['name', 'description', 'category', 'supplier', 'unit', 'unit_price', 'cost_price', 'is_active'];
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = products.map(p => [
    escape(p.name), escape(p.description), escape(p.category), escape(p.supplier),
    escape(p.unit), escape((p.unit_price / 100).toFixed(2)), escape((p.cost_price / 100).toFixed(2)),
    escape(p.is_active ? 'yes' : 'no'),
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'dekker-price-list.csv'; a.click();
  URL.revokeObjectURL(url);
}

export default function ProductList() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [prodPage, setProdPage] = useState(1);
  const PROD_PAGE_SIZE = 20;
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (category) params.category = category;
      if (showInactive) params.active = 'false';
      const [pRes, cRes] = await Promise.all([
        api.get('/products', { params }),
        api.get('/products/categories'),
      ]);
      setProducts(pRes.data);
      setCategories(cRes.data);
    } finally { setLoading(false); }
  }

  useEffect(() => { setProdPage(1); load(); }, [search, category, showInactive]);

  async function deleteProduct(p) {
    if (!confirm(`Delete "${p.name}"?`)) return;
    await api.delete(`/products/${p.id}`);
    setProducts(ps => ps.filter(x => x.id !== p.id));
    setSelected(s => { const n = new Set(s); n.delete(p.id); return n; });
  }

  async function deleteSelected() {
    const count = selected.size;
    const all = count === products.length;
    const msg = all
      ? `Delete ALL ${count} products? This cannot be undone.`
      : `Delete ${count} selected product${count !== 1 ? 's' : ''}? This cannot be undone.`;
    if (!confirm(msg)) return;
    setDeleting(true);
    try {
      await Promise.all([...selected].map(id => api.delete(`/products/${id}`)));
      setProducts(ps => ps.filter(p => !selected.has(p.id)));
      setSelected(new Set());
    } finally { setDeleting(false); }
  }

  function toggleSelect(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleSelectAll() {
    if (selected.size === products.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(products.map(p => p.id)));
    }
  }

  function onSaved(p) {
    setProducts(ps => {
      const idx = ps.findIndex(x => x.id === p.id);
      if (idx > -1) { const n = [...ps]; n[idx] = p; return n; }
      return [p, ...ps];
    });
    setEditing(null); setAdding(false);
  }

  const pagedProducts = products.slice((prodPage - 1) * PROD_PAGE_SIZE, prodPage * PROD_PAGE_SIZE);
  const prodTotalPages = Math.ceil(products.length / PROD_PAGE_SIZE);

  const grouped = pagedProducts.reduce((acc, p) => {
    const cat = p.category || 'Uncategorised';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});

  const allSelected = products.length > 0 && selected.size === products.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Price List</h1>
          <p className={styles.pageSubtitle}>{products.length} product{products.length !== 1 ? 's' : ''}</p>
        </div>
        <div className={styles.headerActions}>
          {isAdmin && <button className={styles.btnSecondary} onClick={() => exportCsv(products)}>⬇ Export CSV</button>}
          {isAdmin && <button className={styles.btnSecondary} onClick={() => setImporting(true)}>⬆ Import</button>}
          {isAdmin && <button className={styles.btnPrimary} onClick={() => setAdding(true)}>+ Add Product</button>}
        </div>
      </div>

      {selected.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkCount}>{selected.size} selected</span>
          <button className={styles.btnSelectAll} onClick={toggleSelectAll}>
            {allSelected ? 'Deselect all' : `Select all ${products.length}`}
          </button>
          <button className={styles.btnDeleteSelected} onClick={deleteSelected} disabled={deleting}>
            {deleting ? 'Deleting…' : `🗑 Delete ${selected.size === products.length ? 'all' : selected.size}`}
          </button>
        </div>
      )}

      <div className={styles.filters}>
        <input className={styles.searchInput} placeholder="Search products…" value={search}
          onChange={e => setSearch(e.target.value)} />
        <select className={styles.filterSelect} value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : products.length === 0 ? (
        <div className={styles.empty}>
          {search || category ? 'No products match your search.' : 'No products yet — add your first product or import from CSV.'}
        </div>
      ) : (
        Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => (
          <div key={cat} className={styles.categoryGroup}>
            <div className={styles.categoryHeader}>{cat}</div>
            <div className={styles.table}>
              <div className={styles.tableHeader}>
                <input type="checkbox" checked={items.every(p => selected.has(p.id))}
                  ref={el => { if (el) el.indeterminate = items.some(p => selected.has(p.id)) && !items.every(p => selected.has(p.id)); }}
                  onChange={() => {
                    const allCatSelected = items.every(p => selected.has(p.id));
                    setSelected(s => {
                      const n = new Set(s);
                      items.forEach(p => allCatSelected ? n.delete(p.id) : n.add(p.id));
                      return n;
                    });
                  }} />
                <span></span>
                <span>Product</span>
                <span>Supplier</span>
                <span>Unit</span>
                {isAdmin && <span style={{ textAlign: 'right' }}>Cost</span>}
                <span style={{ textAlign: 'right' }}>Sell (ex GST)</span>
                {isAdmin && <span style={{ textAlign: 'right' }}>Margin</span>}
                <span></span>
              </div>
              {items.map(p => {
                const margin = p.unit_price && p.cost_price
                  ? (((p.unit_price - p.cost_price) / p.unit_price) * 100).toFixed(1)
                  : null;
                return (
                  <div key={p.id} className={`${styles.tableRow} ${!p.is_active ? styles.inactive : ''} ${selected.has(p.id) ? styles.rowSelected : ''}`}>
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} onClick={e => e.stopPropagation()} />
                    <div className={styles.thumbCell}>
                      {p.media_base64
                        ? <img src={p.media_base64} alt="" className={styles.thumb} onClick={() => setLightbox(p.media_base64)} />
                        : <div className={styles.thumbPlaceholder}>📦</div>
                      }
                    </div>
                    <div>
                      <div className={styles.productName}>{p.name} {!p.is_active && <span className={styles.inactiveBadge}>Inactive</span>}</div>
                      {p.description && <div className={styles.productDesc}>{p.description}</div>}
                    </div>
                    <div className={styles.supplierCol}>{p.supplier || <span className={styles.muted}>—</span>}</div>
                    <div>{p.unit}</div>
                    {isAdmin && (
                      <div style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>
                        {p.cost_price ? fmt(p.cost_price) : <span className={styles.muted}>—</span>}
                      </div>
                    )}
                    <div style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(p.unit_price)}</div>
                    {isAdmin && (
                      <div style={{ textAlign: 'right' }}>
                        {margin !== null
                          ? <span className={parseFloat(margin) >= 30 ? styles.marginGood : styles.marginLow}>{margin}%</span>
                          : <span className={styles.muted}>—</span>
                        }
                      </div>
                    )}
                    {isAdmin && (
                      <div className={styles.rowActions}>
                        <button className={styles.btnIcon} onClick={() => setEditing(p)} title="Edit">✏</button>
                        <button className={styles.btnIcon} onClick={() => deleteProduct(p)} title="Delete">🗑</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {prodTotalPages > 1 && (
        <div className={styles.pagination}>
          <button className={styles.pageBtn} disabled={prodPage === 1} onClick={() => setProdPage(p => p - 1)}>← Prev</button>
          <span className={styles.pageInfo}>Page {prodPage} of {prodTotalPages} ({products.length} products)</span>
          <button className={styles.pageBtn} disabled={prodPage === prodTotalPages} onClick={() => setProdPage(p => p + 1)}>Next →</button>
        </div>
      )}

      {(adding || editing) && (
        <ProductModal product={editing} onSave={onSaved} onClose={() => { setAdding(false); setEditing(null); }} isAdmin={isAdmin} />
      )}
      {importing && <ImportModal onDone={load} onClose={() => setImporting(false)} />}

      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Product" className={styles.lightboxImg} />
          <button className={styles.lightboxClose}>✕</button>
        </div>
      )}
    </div>
  );
}
