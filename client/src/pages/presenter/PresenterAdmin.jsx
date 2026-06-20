import { useState, useEffect, useRef, useCallback } from 'react';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, DragOverlay, useDroppable,
} from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
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

// ── Draggable subcategory row ─────────────────────────────────────────────────
function DraggableSubcatRow({ sc, onDrill, onEdit, onDelete, isDragging: externalDragging }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: sc.id, data: { sc } });
  return (
    <div
      ref={setNodeRef}
      className={`${styles.listItem} ${isDragging ? styles.listItemDragging : ''}`}
      style={{ opacity: isDragging ? 0.3 : 1 }}
    >
      {/* Drag handle */}
      <span {...listeners} {...attributes} className={styles.dragHandle} title="Drag to reparent">⠿</span>
      {sc.image_base64
        ? <img src={sc.image_base64} alt="" className={styles.listThumb} />
        : <span style={{ fontSize: 18 }}>📁</span>}
      <div className={styles.listInfo} onClick={() => onDrill(sc)} style={{ cursor: 'pointer' }}>
        <span className={styles.listName}>{sc.name}</span>
        <span className={styles.listMeta}>
          {sc.child_count > 0 ? `${sc.child_count} sub-categories` : `${sc.product_count} products`}
        </span>
      </div>
      <button className={styles.editSmall} onClick={() => onEdit(sc)}>✎</button>
      <button className={styles.arrowBtn} onClick={() => onDrill(sc)}>›</button>
      <button className={styles.deleteSmall} onClick={() => onDelete(sc.id)}>✕</button>
    </div>
  );
}

// ── Drop zone: another subcategory or the "root" zone ────────────────────────
function DropZoneSubcat({ sc, onDrill, onEdit, onDelete }) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop-${sc.id}`, data: { targetId: sc.id } });
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: sc.id, data: { sc } });

  const combinedRef = (node) => { setNodeRef(node); setDragRef(node); };

  return (
    <div
      ref={combinedRef}
      className={`${styles.listItem} ${isDragging ? styles.listItemDragging : ''} ${isOver ? styles.listItemDropOver : ''}`}
      style={{ opacity: isDragging ? 0.3 : 1 }}
    >
      <span {...listeners} {...attributes} className={styles.dragHandle} title="Drag to reparent">⠿</span>
      {sc.image_base64
        ? <img src={sc.image_base64} alt="" className={styles.listThumb} />
        : <span style={{ fontSize: 18 }}>📁</span>}
      <div className={styles.listInfo} onClick={() => onDrill(sc)} style={{ cursor: 'pointer' }}>
        <span className={styles.listName}>{sc.name}</span>
        <span className={styles.listMeta}>
          {sc.child_count > 0 ? `${sc.child_count} sub-categories` : `${sc.product_count} products`}
        </span>
      </div>
      <button className={styles.editSmall} onClick={() => onEdit(sc)}>✎</button>
      <button className={styles.arrowBtn} onClick={() => onDrill(sc)}>›</button>
      <button className={styles.deleteSmall} onClick={() => onDelete(sc.id)}>✕</button>
    </div>
  );
}

// ── Root drop zone (move to current level) ───────────────────────────────────
function RootDropZone({ currentNode, activeSection }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'drop-root', data: { targetId: null } });
  return (
    <div ref={setNodeRef} className={`${styles.rootDropZone} ${isOver ? styles.rootDropZoneOver : ''}`}>
      Drop here to move to <strong>{currentNode ? currentNode.name : activeSection?.name}</strong> (current level)
    </div>
  );
}

export default function PresenterAdmin() {
  const [sections, setSections] = useState([]);
  const [activeSection, setActiveSection] = useState(null);
  const [editingSection, setEditingSection] = useState(false);
  const [subcatStack, setSubcatStack] = useState([]);
  const [subcats, setSubcats] = useState([]);
  const [products, setProducts] = useState([]);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [showSubcatForm, setShowSubcatForm] = useState(false);
  const [editingSubcat, setEditingSubcat] = useState(null);
  const [subcatForm, setSubcatForm] = useState({ name: '', image_base64: '' });
  const [sectionForm, setSectionForm] = useState({ name: '', color: '#1e40af', icon: '🏠', image_base64: '' });
  const [showSectionForm, setShowSectionForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);

  const currentNode = subcatStack[subcatStack.length - 1] || null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const loadSubcats = useCallback(async (sectionId, parentId) => {
    const url = parentId
      ? `/presenter/subcategories/${parentId}/subcategories`
      : `/presenter/sections/${sectionId}/subcategories`;
    const { data } = await api.get(url);
    setSubcats(data);
  }, []);

  const loadProducts = useCallback(async (sectionId, subcatId) => {
    const url = subcatId
      ? `/presenter/subcategories/${subcatId}/products`
      : `/presenter/sections/${sectionId}/products`;
    const { data } = await api.get(url);
    setProducts(subcatId ? data : data.filter(p => !p.subcategory_id));
  }, []);

  useEffect(() => {
    api.get('/presenter/sections').then(r => {
      setSections(r.data);
      if (r.data.length > 0) setActiveSection(r.data[0]);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeSection) return;
    setSubcatStack([]);
    setShowProductForm(false); setEditingProduct(null);
    loadSubcats(activeSection.id, null);
    loadProducts(activeSection.id, null);
  }, [activeSection, loadSubcats, loadProducts]);

  useEffect(() => {
    if (!activeSection) return;
    loadSubcats(activeSection.id, currentNode?.id || null);
    loadProducts(activeSection.id, currentNode?.id || null);
    setShowProductForm(false); setEditingProduct(null);
  }, [subcatStack, activeSection, currentNode, loadSubcats, loadProducts]);

  async function handleDragEnd(event) {
    setDragging(false);
    const { active, over } = event;
    if (!over || !active) return;

    const draggedId = active.id;
    const targetDropId = over.data.current?.targetId; // null = current level root, uuid = into that subcat

    // Don't drop onto itself
    if (targetDropId === draggedId) return;

    // Don't drop onto its own children (circular check is done server-side too)
    try {
      await api.patch(`/presenter/subcategories/${draggedId}/parent`, {
        parent_id: targetDropId || currentNode?.id || null,
      });
      // Reload current level
      await loadSubcats(activeSection.id, currentNode?.id || null);
    } catch (err) {
      alert(err.response?.data?.error || 'Move failed');
    }
  }

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
      setSubcats(s => s.map(x => x.id === data.id ? { ...data, child_count: x.child_count, product_count: x.product_count } : x));
    } else {
      const url = currentNode
        ? `/presenter/subcategories/${currentNode.id}/subcategories`
        : `/presenter/sections/${activeSection.id}/subcategories`;
      const { data } = await api.post(url, { ...subcatForm, sort_order: subcats.length + 1 });
      setSubcats(s => [...s, { ...data, child_count: 0, product_count: 0 }]);
    }
    setShowSubcatForm(false); setEditingSubcat(null); setSubcatForm({ name: '', image_base64: '' });
  }

  async function deleteSubcat(id) {
    if (!confirm('Delete this category and all its content?')) return;
    await api.delete(`/presenter/subcategories/${id}`);
    setSubcats(s => s.filter(x => x.id !== id));
  }

  function drillInto(sc) {
    setSubcatStack(stack => [...stack, sc]);
    setShowSubcatForm(false); setEditingSubcat(null);
  }

  function navigateTo(index) {
    setSubcatStack(stack => index < 0 ? [] : stack.slice(0, index + 1));
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
          <p className={styles.pageSubtitle}>Manage sections, categories and products · Drag categories to reparent them</p>
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

        {/* ── Column 2: Category drill-down with drag-and-drop ── */}
        <div className={styles.col2}>
          {activeSection && (
            <>
              {/* Breadcrumb */}
              <div className={styles.colHeader} style={{ flexWrap: 'wrap', gap: 4 }}>
                <div className={styles.breadcrumbNav}>
                  <span
                    className={subcatStack.length === 0 ? styles.breadcrumbActive : styles.breadcrumbLink}
                    onClick={() => navigateTo(-1)}
                    style={{ color: activeSection.color }}
                  >
                    {activeSection.icon} {activeSection.name}
                  </span>
                  {subcatStack.map((sc, i) => (
                    <span key={sc.id}>
                      <span className={styles.breadcrumbSep}>›</span>
                      <span
                        className={i === subcatStack.length - 1 ? styles.breadcrumbActive : styles.breadcrumbLink}
                        onClick={() => navigateTo(i)}
                      >
                        {sc.name}
                      </span>
                    </span>
                  ))}
                </div>
                <button className={styles.btnSmall} onClick={() => { setShowSubcatForm(f => !f); setEditingSubcat(null); setSubcatForm({ name: '', image_base64: '' }); }}>
                  + Category
                </button>
              </div>

              {/* Section image edit (root only) */}
              {subcatStack.length === 0 && (
                editingSection ? (
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
                )
              )}

              {showSubcatForm && (
                <form onSubmit={saveSubcat} className={styles.subcatForm}>
                  <div className={styles.field}>
                    <label>{editingSubcat ? 'Edit Category' : `New category under "${currentNode?.name || activeSection.name}"`}</label>
                    <input value={subcatForm.name} onChange={e => setSubcatForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Heat Pumps" required />
                  </div>
                  <div className={styles.field}>
                    <label>Image (optional)</label>
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

              {/* Drag-and-drop subcategory list */}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={() => setDragging(true)}
                onDragEnd={handleDragEnd}
                onDragCancel={() => setDragging(false)}
              >
                {dragging && (
                  <RootDropZone currentNode={currentNode} activeSection={activeSection} />
                )}

                {subcats.map(sc => (
                  <DropZoneSubcat
                    key={sc.id}
                    sc={sc}
                    onDrill={drillInto}
                    onEdit={s => { setEditingSubcat(s); setSubcatForm({ name: s.name, image_base64: s.image_base64 || '' }); setShowSubcatForm(true); }}
                    onDelete={deleteSubcat}
                  />
                ))}

                <DragOverlay>
                  {/* Rendered during drag as floating ghost */}
                </DragOverlay>
              </DndContext>

              {subcats.length === 0 && !showSubcatForm && (
                <div className={styles.emptyNote}>
                  No categories here yet — add one above, or add products directly in the right panel.
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Column 3: Products ── */}
        <div className={styles.col3}>
          {activeSection && (
            <>
              <div className={styles.colHeader}>
                <span>Products {currentNode ? `in "${currentNode.name}"` : `at section level`}</span>
                <button className={styles.btnPrimary} style={{ padding: '5px 12px', fontSize: 12 }}
                  onClick={() => { setShowProductForm(true); setEditingProduct(null); }}>+ Add Product</button>
              </div>

              {(showProductForm || editingProduct) && (
                <div className={styles.formCard}>
                  <h3 className={styles.formCardTitle}>{editingProduct ? 'Edit Product' : 'New Product'}</h3>
                  <ProductForm
                    sectionId={activeSection.id}
                    subcategoryId={currentNode?.id || null}
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
