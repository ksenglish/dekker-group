import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import styles from './Products.module.css';

const fmt = cents => '$' + (cents / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const UNITS = ['each', 'hr', 'm', 'm²', 'kg', 'L', 'day', 'kit', 'set'];

function ProductModal({ product, onSave, onClose }) {
  const [form, setForm] = useState({
    name: product?.name || '',
    description: product?.description || '',
    category: product?.category || '',
    unit: product?.unit || 'each',
    unit_price: product ? (product.unit_price / 100).toFixed(2) : '',
    is_active: product?.is_active !== false,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) return setErr('Name is required');
    setSaving(true); setErr('');
    try {
      if (product) {
        const { data } = await api.put(`/products/${product.id}`, form);
        onSave(data);
      } else {
        const { data } = await api.post('/products', form);
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
              <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional additional detail shown on quotes/invoices" />
            </div>
            <div className={styles.formGroup}>
              <label>Category</label>
              <input value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Installation, Parts, Labour" />
            </div>
            <div className={styles.formGroup}>
              <label>Unit</label>
              <select value={form.unit} onChange={e => set('unit', e.target.value)}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Unit Price (excl. GST)</label>
              <input type="number" min="0" step="0.01" value={form.unit_price}
                onChange={e => set('unit_price', e.target.value)} placeholder="0.00" />
            </div>
            <div className={styles.formGroup} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 24 }}>
              <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
              <label htmlFor="is_active" style={{ marginBottom: 0 }}>Active (shows in search)</label>
            </div>
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
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef();

  function loadFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setCsv(ev.target.result);
    reader.readAsText(file);
  }

  async function doImport() {
    setLoading(true);
    try {
      const { data } = await api.post('/products/import', { csv });
      setResult(data);
      if (data.imported > 0) onDone();
    } catch (e) { setResult({ imported: 0, errors: [e.response?.data?.error || 'Import failed'] }); }
    setLoading(false);
  }

  return (
    <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2>Import Products from CSV</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.importNote}>
            CSV must have a header row with columns: <code>name</code>, <code>description</code>, <code>category</code>, <code>unit</code>, <code>unit_price</code> (dollars, excl. GST)
          </p>
          <div className={styles.formGroup}>
            <label>Upload CSV file</label>
            <input type="file" accept=".csv,text/csv" ref={fileRef} onChange={loadFile} />
          </div>
          {csv && (
            <div className={styles.formGroup}>
              <label>Preview ({csv.split('\n').length - 1} data rows)</label>
              <textarea readOnly rows={6} value={csv} className={styles.csvPreview} />
            </div>
          )}
          {result && (
            <div className={result.errors.length ? styles.formError : styles.formSuccess}>
              {result.imported} products imported.
              {result.errors.length > 0 && <div>{result.errors.join(', ')}</div>}
            </div>
          )}
          <div className={styles.modalFooter}>
            <button className={styles.btnSecondary} onClick={onClose}>Close</button>
            <button className={styles.btnPrimary} disabled={!csv || loading} onClick={doImport}>
              {loading ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProductList() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

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

  useEffect(() => { load(); }, [search, category, showInactive]);

  async function deleteProduct(p) {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    await api.delete(`/products/${p.id}`);
    setProducts(ps => ps.filter(x => x.id !== p.id));
  }

  function onSaved(p) {
    setProducts(ps => {
      const idx = ps.findIndex(x => x.id === p.id);
      if (idx > -1) { const n = [...ps]; n[idx] = p; return n; }
      return [p, ...ps];
    });
    setEditing(null); setAdding(false);
  }

  const grouped = products.reduce((acc, p) => {
    const cat = p.category || 'Uncategorised';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Price List</h1>
          <p className={styles.pageSubtitle}>{products.length} product{products.length !== 1 ? 's' : ''}</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={() => setImporting(true)}>⬆ Import CSV</button>
          <button className={styles.btnPrimary} onClick={() => setAdding(true)}>+ Add Product</button>
        </div>
      </div>

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
                <span>Product</span>
                <span>Unit</span>
                <span style={{ textAlign: 'right' }}>Unit Price</span>
                <span style={{ textAlign: 'right' }}>Inc. GST</span>
                <span></span>
              </div>
              {items.map(p => (
                <div key={p.id} className={`${styles.tableRow} ${!p.is_active ? styles.inactive : ''}`}>
                  <div>
                    <div className={styles.productName}>{p.name} {!p.is_active && <span className={styles.inactiveBadge}>Inactive</span>}</div>
                    {p.description && <div className={styles.productDesc}>{p.description}</div>}
                  </div>
                  <div>{p.unit}</div>
                  <div style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(p.unit_price)}</div>
                  <div style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>{fmt(Math.round(p.unit_price * 1.15))}</div>
                  <div className={styles.rowActions}>
                    <button className={styles.btnIcon} onClick={() => setEditing(p)} title="Edit">✏</button>
                    <button className={styles.btnIcon} onClick={() => deleteProduct(p)} title="Delete">🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {(adding || editing) && (
        <ProductModal product={editing} onSave={onSaved} onClose={() => { setAdding(false); setEditing(null); }} />
      )}
      {importing && <ImportModal onDone={load} onClose={() => setImporting(false)} />}
    </div>
  );
}
