import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import ProductSearch from '../../components/products/ProductSearch';
import styles from './Settings.module.css';

// The standing sets of lines a new proposal starts from. Admin only — these
// carry cost rates, same as the proposal editor itself.
//
// Cents excl. GST on the wire; dollars in the inputs.
const c2d = c => ((c || 0) / 100).toFixed(2);
const d2c = d => Math.round((parseFloat(d) || 0) * 100);
const money = c => `$${((c || 0) / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

let rowSeq = 0;
const key = () => `t${++rowSeq}`;

const toForm = t => ({
  name: t.name || '',
  description: t.description || '',
  markup: String(t.markup_pct ?? 15),
  is_default: !!t.is_default,
  archived: !!t.archived,
  labour: (t.labour || []).map(l => ({
    _key: l.id || key(), label: l.label,
    cost_rate: c2d(l.cost_rate), charge_rate: c2d(l.charge_rate), quantity: String(l.quantity ?? 0),
  })),
  products: (t.products || []).map(p => ({
    _key: p.id || key(), product_id: p.product_id, description: p.description, product_name: p.product_name,
    quantity: String(p.quantity ?? 1), cost_price: c2d(p.cost_price), charge_price: c2d(p.charge_price),
  })),
});

const toPayload = f => ({
  name: f.name,
  description: f.description,
  markup_pct: parseFloat(f.markup) || 0,
  is_default: f.is_default,
  archived: f.archived,
  labour: f.labour.map(l => ({
    label: l.label, cost_rate: d2c(l.cost_rate), charge_rate: d2c(l.charge_rate),
    quantity: parseFloat(l.quantity) || 0,
  })),
  products: f.products.map(p => ({
    product_id: p.product_id || null, description: p.description, product_name: p.product_name || null,
    quantity: parseFloat(p.quantity) || 0, cost_price: d2c(p.cost_price), charge_price: d2c(p.charge_price),
  })),
});

function TemplateCard({ template, onSaved, onDeleted, onMadeDefault }) {
  const [f, setF] = useState(() => toForm(template));
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (!dirty) setF(toForm(template)); }, [template]); // eslint-disable-line react-hooks/exhaustive-deps

  const touch = () => setDirty(true);
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); touch(); };
  const setRow = (list, i, patch) =>
    { setF(x => ({ ...x, [list]: x[list].map((r, j) => j === i ? { ...r, ...patch } : r) })); touch(); };
  const addRow = list => {
    setF(x => ({ ...x, [list]: [...x[list], list === 'labour'
      ? { _key: key(), label: '', cost_rate: '0.00', charge_rate: '0.00', quantity: '0' }
      : { _key: key(), description: '', quantity: '1', cost_price: '0.00', charge_price: '0.00', product_id: null }] }));
    touch();
  };
  const removeRow = (list, i) => { setF(x => ({ ...x, [list]: x[list].filter((_, j) => j !== i) })); touch(); };

  async function save(extra) {
    setSaving(true); setErr('');
    try {
      const { data } = await api.put(`/settings/proposal-templates/${template.id}`, { ...toPayload(f), ...extra });
      setDirty(false);
      onSaved(data);
    } catch (e) { setErr(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${f.name}"? Proposals already built from it are unaffected.`)) return;
    try {
      await api.delete(`/settings/proposal-templates/${template.id}`);
      onDeleted(template.id);
    } catch (e) { setErr(e.response?.data?.error || 'Delete failed'); }
  }

  const labourCost = f.labour.reduce((s, l) => s + Math.round((parseFloat(l.quantity) || 0) * d2c(l.cost_rate)), 0);
  const labourCharge = f.labour.reduce((s, l) => s + Math.round((parseFloat(l.quantity) || 0) * d2c(l.charge_rate)), 0);

  return (
    <div className={styles.tplCard}>
      <div className={styles.tplHead}>
        <button className={styles.tplToggle} onClick={() => setOpen(o => !o)}>{open ? '▾' : '▸'}</button>
        <input className={styles.tplName} value={f.name} onChange={e => set('name', e.target.value)} placeholder="Template name" />
        {template.is_default && <span className={styles.tplBadge}>DEFAULT</span>}
        {template.archived && <span className={styles.tplBadgeMuted}>ARCHIVED</span>}
        <span className={styles.tplCount}>
          {f.labour.length} line{f.labour.length === 1 ? '' : 's'}
          {f.products.length > 0 ? ` · ${f.products.length} product${f.products.length === 1 ? '' : 's'}` : ''}
          {' · '}Cost + {parseFloat(f.markup) || 0}%
        </span>
        {dirty && <button className={styles.btnPrimary} onClick={() => save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>}
      </div>

      {open && (
        <div className={styles.tplBody}>
          {err && <div className={styles.tplError}>{err}</div>}

          <div className={styles.tplMeta}>
            <label className={styles.tplField} style={{ flex: 1, minWidth: 220 }}>
              <span>Description</span>
              <input value={f.description} onChange={e => set('description', e.target.value)}
                placeholder="What this template is for" />
            </label>
            <label className={styles.tplField}>
              <span>Material mark up</span>
              <span className={styles.tplPctWrap}>
                Cost +
                <input type="number" step="1" value={f.markup} onChange={e => set('markup', e.target.value)} />
                %
              </span>
            </label>
            <label className={styles.tplCheck}>
              <input type="checkbox" checked={f.is_default}
                onChange={e => { set('is_default', e.target.checked); if (e.target.checked) save({ is_default: true }).then(onMadeDefault); }} />
              <span>Default for new proposals</span>
            </label>
            <label className={styles.tplCheck}>
              <input type="checkbox" checked={f.archived} onChange={e => set('archived', e.target.checked)} />
              <span>Archived</span>
            </label>
          </div>

          <div className={styles.tplSectionTitle}>Labour &amp; Other</div>
          <div className={styles.tplLabHead}>
            <span>Line</span><span>Cost /unit</span><span>Charge /unit</span><span>Units</span><span />
          </div>
          {f.labour.length === 0 && <p className={styles.hint}>No lines yet.</p>}
          {f.labour.map((l, i) => (
            <div key={l._key} className={styles.tplLabRow}>
              <input value={l.label} onChange={e => setRow('labour', i, { label: e.target.value })} placeholder="e.g. Builder Labour" />
              <input type="number" min="0" step="0.01" value={l.cost_rate} onChange={e => setRow('labour', i, { cost_rate: e.target.value })} />
              <input type="number" min="0" step="0.01" value={l.charge_rate} onChange={e => setRow('labour', i, { charge_rate: e.target.value })} />
              <input type="number" min="0" step="0.25" value={l.quantity} onChange={e => setRow('labour', i, { quantity: e.target.value })} />
              <button className={styles.tplDel} onClick={() => removeRow('labour', i)}>✕</button>
            </div>
          ))}
          <button className={styles.btnSmall} onClick={() => addRow('labour')}>+ Add Line</button>
          <p className={styles.hint}>
            Units usually stay at zero — the hours belong to the job, not the template. A template for a
            standard callout can carry them.
            {labourCharge > 0 && <> This one starts a proposal at {money(labourCharge)} charged, {money(labourCost)} cost.</>}
          </p>

          <div className={styles.tplSectionTitle}>Products (optional)</div>
          <div className={styles.tplProdHead}>
            <span>Description</span><span>Units</span><span>Cost</span><span>Charge</span><span />
          </div>
          {f.products.length === 0 && <p className={styles.hint}>None — most templates only carry labour lines.</p>}
          {f.products.map((p, i) => (
            <div key={p._key} className={styles.tplProdRow}>
              <ProductSearch
                value={p.description}
                onChange={({ description, unit_price, cost_price, product_id, product_name }) => {
                  const mult = 1 + (parseFloat(f.markup) || 0) / 100;
                  const cost = cost_price !== null && cost_price !== undefined ? cost_price : null;
                  setRow('products', i, {
                    description,
                    ...(cost !== null ? { cost_price: c2d(cost) } : {}),
                    ...(unit_price !== null ? { charge_price: unit_price.toFixed(2) }
                      : cost !== null ? { charge_price: c2d(Math.round(cost * mult)) } : {}),
                    ...(product_id !== undefined ? { product_id } : {}),
                    ...(product_name !== null ? { product_name } : {}),
                  });
                }}
              />
              <input type="number" min="0" step="0.001" value={p.quantity} onChange={e => setRow('products', i, { quantity: e.target.value })} />
              <input type="number" min="0" step="0.01" value={p.cost_price} onChange={e => setRow('products', i, { cost_price: e.target.value })} />
              <input type="number" min="0" step="0.01" value={p.charge_price} onChange={e => setRow('products', i, { charge_price: e.target.value })} />
              <button className={styles.tplDel} onClick={() => removeRow('products', i)}>✕</button>
            </div>
          ))}
          <button className={styles.btnSmall} onClick={() => addRow('products')}>+ Add Product</button>

          <div className={styles.tplActions}>
            <button className={styles.btnDanger} onClick={handleDelete}>Delete Template</button>
            <button className={styles.btnPrimary} onClick={() => save()} disabled={saving || !dirty}>
              {saving ? 'Saving…' : dirty ? 'Save Template' : 'Saved'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProposalTemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    api.get('/settings/proposal-templates')
      .then(r => setTemplates(r.data))
      .catch(() => setErr('Could not load templates'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setCreating(true); setErr('');
    try {
      const { data } = await api.post('/settings/proposal-templates', { name: 'New Template' });
      setTemplates(ts => [...ts, data]);
    } catch (e) { setErr(e.response?.data?.error || 'Could not add a template'); }
    finally { setCreating(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Proposal Templates</h2>
          <button className={styles.btnPrimary} onClick={add} disabled={creating}>
            {creating ? 'Adding…' : '+ Add Template'}
          </button>
        </div>
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
            What a new proposal on a job starts from — the standing labour lines with their cost and charge
            rates, the material mark up, and any products that always go on. Editing a template does not
            change proposals already built from it.
          </p>
          {err && <div className={styles.tplError}>{err}</div>}
          {loading ? <p className={styles.hint}>Loading…</p>
            : templates.length === 0 ? <p className={styles.hint}>No templates yet — add one to get started.</p>
            : templates.map(t => (
              <TemplateCard key={t.id} template={t}
                onSaved={saved => setTemplates(ts => ts.map(x => x.id === saved.id ? saved : x))}
                onDeleted={id => setTemplates(ts => ts.filter(x => x.id !== id))}
                onMadeDefault={load} />
            ))}
        </div>
      </div>
    </div>
  );
}
