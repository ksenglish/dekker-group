import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { compressImage } from '../../lib/image';
import styles from './Products.module.css';
import { overlayClose } from '../../lib/overlayClose';
import PriceListBrowser from '../../components/products/PriceListBrowser';

const fmt = cents => '$' + (cents / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GST_RATE = 0.15;
const fmtIncGst = cents => fmt(Math.round(cents * (1 + GST_RATE)));
const UNITS = ['each', 'hr', 'm', 'm²', 'kg', 'L', 'day', 'kit', 'set'];

function ImageUpload({ value, onChange }) {
  const ref = useRef();

  async function handleFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
      return alert('Please upload a JPG or PNG image.');
    // Downscale first — the limit is on what gets stored, not the raw file.
    const { dataUrl, bytes } = await compressImage(file);
    if (bytes > 2 * 1024 * 1024)
      return alert('Image must be under 2MB.');
    onChange(dataUrl);
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

  async function handleFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type))
      return alert('Please upload a JPG, PNG, or PDF.');
    // PDFs pass through compressImage untouched.
    const { dataUrl, bytes } = await compressImage(file);
    if (bytes > 10 * 1024 * 1024)
      return alert('Brochure must be under 10MB.');
    onChange(dataUrl);
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
    quote_description: product?.quote_description || '',
    subcategory_1: product?.subcategory_1 || '',
    subcategory_2: product?.subcategory_2 || '',
    subcategory_3: product?.subcategory_3 || '',
    subcategory_4: product?.subcategory_4 || '',
    // A product whose image is in the bucket comes back as a URL to fetch
    // rather than the bytes. Both work as an <img src>, and posting the URL
    // back on save is read as "unchanged" rather than as a new upload.
    media_base64:    product?.media_url    || product?.media_base64    || '',
    brochure_base64: product?.brochure_url || product?.brochure_base64 || '',
    is_active: product?.is_active !== false,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // What the media fields looked like when the form opened, so save can tell
  // "untouched" from "cleared on purpose".
  const initialMedia = useRef(product?.media_url || product?.media_base64 || '');
  const initialBrochure = useRef(product?.brochure_url || product?.brochure_base64 || '');

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
      // The image and brochure are only sent when they've actually been
      // touched. The server reads an empty value as "remove it", so sending a
      // field the form never knew the value of would delete the file — which
      // is exactly what editing a product from the list used to do, since the
      // list carries no image data to populate the form with.
      const payload = { ...form };
      if (form.media_base64 === initialMedia.current) delete payload.media_base64;
      if (form.brochure_base64 === initialBrochure.current) delete payload.brochure_base64;
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
    <div className={styles.modalOverlay} {...overlayClose(onClose)}>
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
              <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="The line that appears on the quote, e.g. Paling Fence 1.8m High" />
            </div>
            <div className={styles.formGroup} style={{ gridColumn: '1/-1' }}>
              <label>Quote Description</label>
              <textarea rows={3} value={form.quote_description}
                onChange={e => set('quote_description', e.target.value)}
                placeholder="Wording added to the quote's description box when this product is added" />
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                Description goes on the line item; this goes in the description box above the lines.
              </span>
            </div>
            <div className={styles.formGroup}>
              <label>Category</label>
              <input value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Dekker Air" />
            </div>
            <div className={styles.formGroup}>
              <label>Sub Category 1</label>
              <input value={form.subcategory_1} onChange={e => set('subcategory_1', e.target.value)} placeholder="e.g. Ventilation" />
            </div>
            <div className={styles.formGroup}>
              <label>Sub Category 2</label>
              <input value={form.subcategory_2} onChange={e => set('subcategory_2', e.target.value)} placeholder="e.g. Extraction" />
            </div>
            <div className={styles.formGroup}>
              <label>Sub Category 3</label>
              <input value={form.subcategory_3} onChange={e => set('subcategory_3', e.target.value)} placeholder="e.g. Inline Fans" />
            </div>
            <div className={styles.formGroup}>
              <label>Sub Category 4</label>
              <input value={form.subcategory_4} onChange={e => set('subcategory_4', e.target.value)} placeholder="e.g. 150mm" />
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
        if (data.imported > 0 || data.updated > 0) onDone();
      } else {
        const { data } = await api.post('/products/import', { csv });
        setResult(data);
        if (data.imported > 0 || data.updated > 0) onDone();
      }
    } catch (e) { setResult({ imported: 0, errors: [e.response?.data?.error || 'Import failed'] }); }
    setLoading(false);
  }

  const canImport = tab === 'zip' ? !!zipFile : !!csv;

  return (
    <div className={styles.modalOverlay} {...overlayClose(onClose)}>
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
              ✓ {result.imported} added
              {result.updated > 0 && ` · ${result.updated} updated`}
              {result.imagesFound !== undefined && ` · ${result.imagesFound} file${result.imagesFound !== 1 ? 's' : ''} found`}
              {result.errors?.length > 0 && <div style={{ marginTop: 4 }}>{result.errors.slice(0,5).join(', ')}</div>}
              {result.updated > 0 && (
                <div style={{ marginTop: 4, fontWeight: 400 }}>
                  Matched on product name — prices and any images or brochures in this
                  upload were applied to the existing products.
                </div>
              )}
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
  const isSales = user?.role === 'sales';
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  // The list deliberately carries no image data, so the full record is fetched
  // before editing — otherwise the form opens with an empty image box and the
  // existing picture isn't visible to keep or remove.
  async function openEditor(p) {
    try {
      const { data } = await api.get(`/products/${p.id}`);
      setEditing(data);
    } catch {
      setEditing(p);
    }
  }

  const [view, setView] = useState('Browse');
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
          {/* Browse is the default — the table is for editing, not for finding
              something to quote. */}
          <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden', marginRight: 4 }}>
            {['Browse', 'Manage'].map(v => (
              <button key={v} onClick={() => setView(v)}
                style={{
                  padding: '8px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', border: 'none',
                  background: view === v ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: view === v ? '#fff' : 'var(--color-text)',
                }}>{v}</button>
            ))}
          </div>
          {isAdmin && <button className={styles.btnSecondary} onClick={() => exportCsv(products)}>⬇ Export CSV</button>}
          {isAdmin && <button className={styles.btnSecondary} onClick={() => setImporting(true)}>⬆ Import</button>}
          {isAdmin && <button className={styles.btnPrimary} onClick={() => setAdding(true)}>+ Add Product</button>}
        </div>
      </div>

      {view === 'Browse' && <PriceListBrowser />}

      {view === 'Manage' && <>
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
                {!isSales && <span>Supplier</span>}
                <span>Unit</span>
                {isAdmin && <span style={{ textAlign: 'right' }}>Cost</span>}
                <span style={{ textAlign: 'right' }}>Sell (inc GST)</span>
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
                    {!isSales && <div className={styles.supplierCol}>{p.supplier || <span className={styles.muted}>—</span>}</div>}
                    <div>{p.unit}</div>
                    {isAdmin && (
                      <div style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>
                        {p.cost_price ? fmt(p.cost_price) : <span className={styles.muted}>—</span>}
                      </div>
                    )}
                    <div style={{ textAlign: 'right', fontWeight: 600 }}>{fmtIncGst(p.unit_price)}</div>
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
                        <button className={styles.btnIcon} onClick={() => openEditor(p)} title="Edit">✏</button>
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
      </>}

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
