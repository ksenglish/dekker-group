import { useState, useEffect } from 'react';
import api from '../../lib/api';
import styles from './PresenterAdmin.module.css';

const CALC_TYPES = [
  { value: 'unit',     label: 'Unit / Fixed Price' },
  { value: 'area',     label: 'Area (m² × price/m²)' },
  { value: 'linear',   label: 'Linear (m × price/m)' },
  { value: 'heatpump', label: 'Heat Pump Sizing' },
];

function ProductForm({ sectionId, product, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: product?.name || '',
    description: product?.description || '',
    price_from: product ? (product.price_from / 100).toFixed(2) : '',
    features: product?.features?.join('\n') || '',
    calculator_type: product?.calculator_type || 'unit',
    image_base64: product?.image_base64 || '',
    sort_order: product?.sort_order || 0,
  });
  const [saving, setSaving] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function handleImage(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { alert('Image must be under 3MB'); return; }
    const reader = new FileReader();
    reader.onload = ev => set('image_base64', ev.target.result);
    reader.readAsDataURL(file);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        price_from: parseFloat(form.price_from) || 0,
        features: form.features.split('\n').map(f => f.trim()).filter(Boolean),
      };
      let data;
      if (product) {
        ({ data } = await api.put(`/presenter/products/${product.id}`, payload));
      } else {
        ({ data } = await api.post(`/presenter/sections/${sectionId}/products`, payload));
      }
      onSave(data);
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSave} className={styles.productForm}>
      <div className={styles.formGrid}>
        <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
          <label>Product Name *</label>
          <input value={form.name} onChange={e => set('name', e.target.value)} required placeholder="e.g. Mitsubishi 2.5kW Heat Pump" />
        </div>
        <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
          <label>Description</label>
          <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Brief product description shown on the card and detail panel" />
        </div>
        <div className={styles.field}>
          <label>Starting Price (ex GST)</label>
          <input type="number" step="0.01" value={form.price_from} onChange={e => set('price_from', e.target.value)} placeholder="0.00" />
        </div>
        <div className={styles.field}>
          <label>Calculator Type</label>
          <select value={form.calculator_type} onChange={e => set('calculator_type', e.target.value)}>
            {CALC_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
          <label>Key Features (one per line)</label>
          <textarea rows={4} value={form.features} onChange={e => set('features', e.target.value)}
            placeholder="5 year warranty&#10;R32 refrigerant&#10;Wi-Fi control&#10;Quiet operation" />
        </div>
        <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
          <label>Product Photo</label>
          {form.image_base64 && (
            <div className={styles.imagePreview}>
              <img src={form.image_base64} alt="preview" />
              <button type="button" className={styles.removeImage} onClick={() => set('image_base64', '')}>Remove</button>
            </div>
          )}
          <input type="file" accept="image/*" onChange={handleImage} />
          <span className={styles.hint}>JPG or PNG, max 3MB</span>
        </div>
      </div>
      <div className={styles.formActions}>
        <button type="button" className={styles.btnSecondary} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.btnPrimary} disabled={saving}>
          {saving ? 'Saving…' : product ? 'Update Product' : 'Add Product'}
        </button>
      </div>
    </form>
  );
}

export default function PresenterAdmin() {
  const [sections, setSections] = useState([]);
  const [activeSection, setActiveSection] = useState(null);
  const [products, setProducts] = useState([]);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [showSectionForm, setShowSectionForm] = useState(false);
  const [sectionForm, setSectionForm] = useState({ name: '', color: '#1e40af', icon: '🏠' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/presenter/sections').then(r => {
      setSections(r.data);
      if (r.data.length > 0) setActiveSection(r.data[0]);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeSection) return;
    api.get(`/presenter/sections/${activeSection.id}/products`).then(r => setProducts(r.data));
  }, [activeSection]);

  async function addSection(e) {
    e.preventDefault();
    const { data } = await api.post('/presenter/sections', { ...sectionForm, sort_order: sections.length + 1 });
    setSections(s => [...s, data]);
    setActiveSection(data);
    setShowSectionForm(false);
    setSectionForm({ name: '', color: '#1e40af', icon: '🏠' });
  }

  async function deleteSection(id) {
    if (!confirm('Delete this section and all its products?')) return;
    await api.delete(`/presenter/sections/${id}`);
    const updated = sections.filter(s => s.id !== id);
    setSections(updated);
    setActiveSection(updated[0] || null);
  }

  async function deleteProduct(id) {
    if (!confirm('Delete this product?')) return;
    await api.delete(`/presenter/products/${id}`);
    setProducts(p => p.filter(x => x.id !== id));
  }

  function handleProductSaved(product) {
    if (editingProduct) {
      setProducts(p => p.map(x => x.id === product.id ? product : x));
    } else {
      setProducts(p => [...p, product]);
    }
    setShowProductForm(false);
    setEditingProduct(null);
  }

  if (loading) return <div className={styles.page}><p>Loading…</p></div>;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Sales Presenter</h1>
          <p className={styles.pageSubtitle}>Manage sections, products and pricing shown in the presenter</p>
        </div>
      </div>

      <div className={styles.layout}>
        {/* Section list */}
        <div className={styles.sectionList}>
          <div className={styles.sectionListHeader}>
            <span>Sections</span>
            <button className={styles.btnSmall} onClick={() => setShowSectionForm(f => !f)}>+ Add</button>
          </div>
          {showSectionForm && (
            <form onSubmit={addSection} className={styles.sectionForm}>
              <input value={sectionForm.name} onChange={e => setSectionForm(f => ({...f, name: e.target.value}))}
                placeholder="Section name" required />
              <input value={sectionForm.icon} onChange={e => setSectionForm(f => ({...f, icon: e.target.value}))}
                placeholder="🏠" style={{ width: 60 }} />
              <input type="color" value={sectionForm.color} onChange={e => setSectionForm(f => ({...f, color: e.target.value}))}
                style={{ width: 40, padding: 2, height: 36 }} />
              <button type="submit" className={styles.btnPrimary} style={{ padding: '6px 12px' }}>Add</button>
            </form>
          )}
          {sections.map(s => (
            <div key={s.id} className={`${styles.sectionItem} ${activeSection?.id === s.id ? styles.sectionItemActive : ''}`}
              style={activeSection?.id === s.id ? { borderLeftColor: s.color } : {}}
              onClick={() => { setActiveSection(s); setShowProductForm(false); setEditingProduct(null); }}>
              <span style={{ fontSize: 18 }}>{s.icon}</span>
              <div className={styles.sectionItemInfo}>
                <span className={styles.sectionItemName}>{s.name}</span>
                <span className={styles.sectionItemCount}>{s.product_count} products</span>
              </div>
              <button className={styles.deleteSmall} onClick={e => { e.stopPropagation(); deleteSection(s.id); }}>✕</button>
            </div>
          ))}
        </div>

        {/* Products panel */}
        <div className={styles.productsPanel}>
          {activeSection ? (
            <>
              <div className={styles.productsPanelHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 24 }}>{activeSection.icon}</span>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{activeSection.name}</h2>
                </div>
                <button className={styles.btnPrimary} onClick={() => { setShowProductForm(true); setEditingProduct(null); }}>
                  + Add Product
                </button>
              </div>

              {(showProductForm || editingProduct) && (
                <div className={styles.formCard}>
                  <h3 className={styles.formCardTitle}>{editingProduct ? 'Edit Product' : 'New Product'}</h3>
                  <ProductForm
                    sectionId={activeSection.id}
                    product={editingProduct}
                    onSave={handleProductSaved}
                    onCancel={() => { setShowProductForm(false); setEditingProduct(null); }}
                  />
                </div>
              )}

              {products.length === 0 && !showProductForm && (
                <div className={styles.emptyProducts}>
                  <p>No products in this section yet.</p>
                  <button className={styles.btnPrimary} onClick={() => setShowProductForm(true)}>Add First Product</button>
                </div>
              )}

              <div className={styles.productsList}>
                {products.map(p => (
                  <div key={p.id} className={styles.productRow}>
                    {p.image_base64 ? (
                      <img src={p.image_base64} alt={p.name} className={styles.productThumb} />
                    ) : (
                      <div className={styles.productThumbEmpty}>{activeSection.icon}</div>
                    )}
                    <div className={styles.productRowInfo}>
                      <strong>{p.name}</strong>
                      <span>{p.description || '—'}</span>
                      <span className={styles.productMeta}>
                        {p.price_from > 0 ? `From $${(p.price_from / 100).toFixed(2)} + GST` : 'No price set'} · {CALC_TYPES.find(c => c.value === p.calculator_type)?.label}
                      </span>
                    </div>
                    <div className={styles.productRowActions}>
                      <button className={styles.btnSecondary} style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => { setEditingProduct(p); setShowProductForm(false); }}>Edit</button>
                      <button className={styles.deleteSmall} onClick={() => deleteProduct(p.id)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className={styles.emptyProducts}><p>Select a section on the left to manage products.</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
