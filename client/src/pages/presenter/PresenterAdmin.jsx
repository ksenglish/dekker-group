import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import styles from './PresenterAdmin.module.css';

const CALC_TYPES = [
  { value: 'unit',           label: 'Unit / Fixed Price' },
  { value: 'area',           label: 'Area (m² × price/m²)' },
  { value: 'linear',         label: 'Linear (m × price/m)' },
  { value: 'heatpump',       label: 'Heat Pump Sizing' },
  { value: 'smartvent_lite', label: 'SmartVent Lite+ (lookup table)' },
];

function ImgUpload({ value, onChange, label = '📷 Upload Image', maxMb = 3 }) {
  const ref = useRef();
  function handle(e) {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > maxMb * 1024 * 1024) { alert(`Max ${maxMb}MB`); return; }
    const r = new FileReader(); r.onload = ev => onChange(ev.target.result); r.readAsDataURL(f);
  }
  return (
    <div className={styles.imgUpload}>
      {value
        ? <div className={styles.imgWrap}><img src={value} alt="" className={styles.imgPreview} /><button type="button" onClick={() => onChange('')}>✕</button></div>
        : <button type="button" className={styles.imgBtn} onClick={() => ref.current.click()}>{label}</button>
      }
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handle} />
    </div>
  );
}

function ProductForm({ sectionId, subcategoryId, product, onSave, onCancel }) {
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
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        price_from: parseFloat(form.price_from) || 0,
        features: form.features.split('\n').map(f => f.trim()).filter(Boolean),
        subcategory_id: subcategoryId || null,
      };
      let data;
      if (product) {
        ({ data } = await api.put(`/presenter/products/${product.id}`, payload));
      } else if (subcategoryId) {
        ({ data } = await api.post(`/presenter/subcategories/${subcategoryId}/products`, { ...payload, section_id: sectionId }));
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
          <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} />
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
          <textarea rows={3} value={form.features} onChange={e => set('features', e.target.value)} placeholder="5 year warranty&#10;Wi-Fi control" />
        </div>
        <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
          <label>Product Photo</label>
          <ImgUpload value={form.image_base64} onChange={v => set('image_base64', v)} />
        </div>
      </div>
      <div className={styles.formActions}>
        <button type="button" className={styles.btnSecondary} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.btnPrimary} disabled={saving}>
          {saving ? 'Saving…' : product ? 'Update' : 'Add Product'}
        </button>
      </div>
    </form>
  );
}

export default function PresenterAdmin() {
  const [sections, setSections] = useState([]);
  const [activeSection, setActiveSection] = useState(null);
  const [subcategories, setSubcategories] = useState([]);
  const [activeSubcat, setActiveSubcat] = useState(null); // null = section-level view
  const [products, setProducts] = useState([]);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editingSection, setEditingSection] = useState(false);
  const [sectionForm, setSectionForm] = useState({ name: '', color: '#1e40af', icon: '🏠', image_base64: '' });
  const [showSectionForm, setShowSectionForm] = useState(false);
  const [subcatForm, setSubcatForm] = useState({ name: '', image_base64: '' });
  const [showSubcatForm, setShowSubcatForm] = useState(false);
  const [editingSubcat, setEditingSubcat] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/presenter/sections').then(r => {
      setSections(r.data);
      if (r.data.length > 0) setActiveSection(r.data[0]);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeSection) return;
    setSubcategories([]); setActiveSubcat(null); setProducts([]);
    api.get(`/presenter/sections/${activeSection.id}/subcategories`).then(r => setSubcategories(r.data));
  }, [activeSection]);

  useEffect(() => {
    if (!activeSection) return;
    setProducts([]);
    if (activeSubcat) {
      api.get(`/presenter/subcategories/${activeSubcat.id}/products`).then(r => setProducts(r.data));
    } else {
      // Section-level products (no subcategory)
      api.get(`/presenter/sections/${activeSection.id}/products`).then(r =>
        setProducts(r.data.filter(p => !p.subcategory_id))
      );
    }
  }, [activeSection, activeSubcat]);

  async function saveSection(e) {
    e.preventDefault();
    const { data } = await api.post('/presenter/sections', { ...sectionForm, sort_order: sections.length + 1 });
    setSections(s => [...s, data]); setActiveSection(data);
    setShowSectionForm(false); setSectionForm({ name: '', color: '#1e40af', icon: '🏠', image_base64: '' });
  }

  async function updateSection() {
    const { data } = await api.put(`/presenter/sections/${activeSection.id}`, {
      name: activeSection.name, color: activeSection.color, icon: activeSection.icon,
      sort_order: activeSection.sort_order, image_base64: activeSection.image_base64 || null,
    });
    setSections(s => s.map(x => x.id === data.id ? data : x));
    setActiveSection(data); setEditingSection(false);
  }

  async function deleteSection(id) {
    if (!confirm('Delete this section and all its content?')) return;
    await api.delete(`/presenter/sections/${id}`);
    const updated = sections.filter(s => s.id !== id);
    setSections(updated); setActiveSection(updated[0] || null);
  }

  async function saveSubcat(e) {
    e.preventDefault();
    if (editingSubcat) {
      const { data } = await api.put(`/presenter/subcategories/${editingSubcat.id}`, subcatForm);
      setSubcategories(s => s.map(x => x.id === data.id ? data : x));
    } else {
      const { data } = await api.post(`/presenter/sections/${activeSection.id}/subcategories`, {
        ...subcatForm, sort_order: subcategories.length + 1,
      });
      setSubcategories(s => [...s, data]);
    }
    setShowSubcatForm(false); setEditingSubcat(null); setSubcatForm({ name: '', image_base64: '' });
  }

  async function deleteSubcat(id) {
    if (!confirm('Delete this subcategory and all its products?')) return;
    await api.delete(`/presenter/subcategories/${id}`);
    setSubcategories(s => s.filter(x => x.id !== id));
    if (activeSubcat?.id === id) setActiveSubcat(null);
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
    setShowProductForm(false); setEditingProduct(null);
  }

  if (loading) return <div className={styles.page}><p>Loading…</p></div>;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Sales Presenter Setup</h1>
          <p className={styles.pageSubtitle}>Manage sections, subcategories and products</p>
        </div>
      </div>

      <div className={styles.layout3}>

        {/* ── Column 1: Sections ── */}
        <div className={styles.col1}>
          <div className={styles.colHeader}>
            <span>Sections</span>
            <button className={styles.btnSmall} onClick={() => setShowSectionForm(f => !f)}>+ Add</button>
          </div>
          {showSectionForm && (
            <form onSubmit={saveSection} className={styles.miniForm}>
              <input value={sectionForm.name} onChange={e => setSectionForm(f => ({...f, name: e.target.value}))} placeholder="Section name" required />
              <input value={sectionForm.icon} onChange={e => setSectionForm(f => ({...f, icon: e.target.value}))} placeholder="🏠" style={{ width: 48 }} />
              <input type="color" value={sectionForm.color} onChange={e => setSectionForm(f => ({...f, color: e.target.value}))} style={{ width: 36, height: 32, padding: 2 }} />
              <button type="submit" className={styles.btnPrimary} style={{ padding: '5px 10px' }}>Add</button>
            </form>
          )}
          {sections.map(s => (
            <div key={s.id}
              className={`${styles.listItem} ${activeSection?.id === s.id ? styles.listItemActive : ''}`}
              style={activeSection?.id === s.id ? { borderLeftColor: s.color } : {}}
              onClick={() => { setActiveSection(s); setShowProductForm(false); setEditingProduct(null); }}>
              {s.image_base64
                ? <img src={s.image_base64} alt="" className={styles.listThumb} />
                : <span style={{ fontSize: 20 }}>{s.icon}</span>}
              <div className={styles.listInfo}>
                <span className={styles.listName}>{s.name}</span>
                <span className={styles.listMeta}>{s.product_count} products</span>
              </div>
              <button className={styles.deleteSmall} onClick={e => { e.stopPropagation(); deleteSection(s.id); }}>✕</button>
            </div>
          ))}
        </div>

        {/* ── Column 2: Subcategories ── */}
        <div className={styles.col2}>
          {activeSection && (
            <>
              <div className={styles.colHeader}>
                <span style={{ color: activeSection.color }}>{activeSection.icon} {activeSection.name}</span>
                <button className={styles.btnSmall} onClick={() => { setShowSubcatForm(f => !f); setEditingSubcat(null); setSubcatForm({ name: '', image_base64: '' }); }}>+ Subcategory</button>
              </div>

              {/* Section image + edit */}
              {editingSection ? (
                <div className={styles.sectionEdit}>
                  <div className={styles.field}>
                    <label>Section Image (optional)</label>
                    <ImgUpload value={activeSection.image_base64 || ''} onChange={v => setActiveSection(s => ({ ...s, image_base64: v }))} label="📷 Upload Section Image" />
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button className={styles.btnPrimary} style={{ padding: '6px 12px', fontSize: 12 }} onClick={updateSection}>Save</button>
                    <button className={styles.btnSecondary} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setEditingSection(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button className={styles.editSectionBtn} onClick={() => setEditingSection(true)}>
                  {activeSection.image_base64
                    ? <img src={activeSection.image_base64} alt="" className={styles.sectionThumb} />
                    : <span style={{ fontSize: 28 }}>{activeSection.icon}</span>}
                  <span>Edit section image</span>
                </button>
              )}

              {showSubcatForm && (
                <form onSubmit={saveSubcat} className={styles.subcatForm}>
                  <div className={styles.field}>
                    <label>{editingSubcat ? 'Edit Subcategory' : 'New Subcategory'}</label>
                    <input value={subcatForm.name} onChange={e => setSubcatForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Heat Pumps" required />
                  </div>
                  <div className={styles.field}>
                    <label>Subcategory Image (optional)</label>
                    <ImgUpload value={subcatForm.image_base64} onChange={v => setSubcatForm(f => ({...f, image_base64: v}))} label="📷 Upload Image" />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="submit" className={styles.btnPrimary} style={{ padding: '6px 12px', fontSize: 12 }}>
                      {editingSubcat ? 'Update' : 'Add'}
                    </button>
                    <button type="button" className={styles.btnSecondary} style={{ padding: '6px 12px', fontSize: 12 }}
                      onClick={() => { setShowSubcatForm(false); setEditingSubcat(null); }}>Cancel</button>
                  </div>
                </form>
              )}

              {/* Section-level (no subcategory) */}
              <div
                className={`${styles.listItem} ${!activeSubcat ? styles.listItemActive : ''}`}
                style={!activeSubcat ? { borderLeftColor: activeSection.color } : {}}
                onClick={() => setActiveSubcat(null)}>
                <span style={{ fontSize: 16 }}>📦</span>
                <div className={styles.listInfo}>
                  <span className={styles.listName}>Section-level products</span>
                  <span className={styles.listMeta}>No subcategory</span>
                </div>
              </div>

              {subcategories.map(sc => (
                <div key={sc.id}
                  className={`${styles.listItem} ${activeSubcat?.id === sc.id ? styles.listItemActive : ''}`}
                  style={activeSubcat?.id === sc.id ? { borderLeftColor: activeSection.color } : {}}
                  onClick={() => setActiveSubcat(sc)}>
                  {sc.image_base64
                    ? <img src={sc.image_base64} alt="" className={styles.listThumb} />
                    : <span style={{ fontSize: 20 }}>📁</span>}
                  <div className={styles.listInfo}>
                    <span className={styles.listName}>{sc.name}</span>
                    <span className={styles.listMeta}>{sc.product_count} products</span>
                  </div>
                  <button className={styles.editSmall} onClick={e => { e.stopPropagation(); setEditingSubcat(sc); setSubcatForm({ name: sc.name, image_base64: sc.image_base64 || '' }); setShowSubcatForm(true); }}>✎</button>
                  <button className={styles.deleteSmall} onClick={e => { e.stopPropagation(); deleteSubcat(sc.id); }}>✕</button>
                </div>
              ))}
            </>
          )}
        </div>

        {/* ── Column 3: Products ── */}
        <div className={styles.col3}>
          {activeSection && (
            <>
              <div className={styles.colHeader}>
                <span>{activeSubcat ? activeSubcat.name : 'Section-level products'}</span>
                <button className={styles.btnPrimary} style={{ padding: '5px 12px', fontSize: 12 }}
                  onClick={() => { setShowProductForm(true); setEditingProduct(null); }}>+ Add Product</button>
              </div>

              {(showProductForm || editingProduct) && (
                <div className={styles.formCard}>
                  <h3 className={styles.formCardTitle}>{editingProduct ? 'Edit Product' : 'New Product'}</h3>
                  <ProductForm
                    sectionId={activeSection.id}
                    subcategoryId={activeSubcat?.id || null}
                    product={editingProduct}
                    onSave={handleProductSaved}
                    onCancel={() => { setShowProductForm(false); setEditingProduct(null); }}
                  />
                </div>
              )}

              {products.length === 0 && !showProductForm && !editingProduct && (
                <div className={styles.emptyProducts}>
                  <p>No products here yet.</p>
                  <button className={styles.btnPrimary} onClick={() => setShowProductForm(true)}>Add First Product</button>
                </div>
              )}

              {products.map(p => (
                <div key={p.id} className={styles.productRow}>
                  {p.image_base64
                    ? <img src={p.image_base64} alt={p.name} className={styles.productThumb} />
                    : <div className={styles.productThumbEmpty}>📦</div>}
                  <div className={styles.productRowInfo}>
                    <strong>{p.name}</strong>
                    <span>{p.description || '—'}</span>
                    <span className={styles.productMeta}>
                      {p.price_from > 0 ? `From $${(p.price_from / 100).toFixed(2)} + GST` : 'No price'} · {CALC_TYPES.find(c => c.value === p.calculator_type)?.label}
                    </span>
                  </div>
                  <div className={styles.productRowActions}>
                    <button className={styles.btnSmall} onClick={() => { setEditingProduct(p); setShowProductForm(false); }}>Edit</button>
                    <button className={styles.deleteSmall} onClick={() => deleteProduct(p.id)}>✕</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

      </div>
    </div>
  );
}
