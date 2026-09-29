import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../lib/api';
import ProductSearch from '../../components/products/ProductSearch';
import styles from './Jobs.module.css';

// Priced proposals on a job — the Job Sheet spreadsheet, in the app.
//
// One proposal per scope of work. Each is built from price-list products (at
// cost and at RRP) plus labour lines carrying both what they cost us and what
// we charge, with a markup on the materials. Margin falls out of the two.
//
// Everything is cents excl. GST, matching the server. The inputs are dollars,
// converted at the edges only.

const c2d = c => ((c || 0) / 100).toFixed(2);
const d2c = d => Math.round((parseFloat(d) || 0) * 100);
const money = c => `$${((c || 0) / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const AUTOSAVE_DELAY = 1200;

let rowSeq = 0;
const key = () => `r${++rowSeq}`;

// Server rows -> editable rows. Prices become dollar strings so the inputs
// behave; ids become stable keys so deleting a middle row doesn't shuffle the
// one below it into the deleted row's component.
const toForm = p => ({
  ...p,
  products: (p.products || []).map(x => ({
    _key: x.id || key(), product_id: x.product_id, description: x.description, product_name: x.product_name,
    quantity: String(x.quantity ?? 1), cost_price: c2d(x.cost_price), rrp: c2d(x.rrp),
  })),
  labour: (p.labour || []).map(x => ({
    _key: x.id || key(), label: x.label,
    cost_rate: c2d(x.cost_rate), charge_rate: c2d(x.charge_rate), quantity: String(x.quantity ?? 0),
  })),
  markup_cost: String(p.markup_cost_pct ?? 43),
  markup_rrp: String(p.markup_rrp_pct ?? 15),
  override: p.quote_price == null ? '' : c2d(p.quote_price),
});

const toPayload = f => ({
  name: f.name,
  materials_basis: f.materials_basis,
  markup_cost_pct: parseFloat(f.markup_cost) || 0,
  markup_rrp_pct: parseFloat(f.markup_rrp) || 0,
  quote_price: f.override === '' ? null : d2c(f.override),
  notes: f.notes,
  products: f.products.map(x => ({
    product_id: x.product_id || null, description: x.description, product_name: x.product_name || null,
    quantity: parseFloat(x.quantity) || 0, cost_price: d2c(x.cost_price), rrp: d2c(x.rrp),
  })),
  labour: f.labour.map(x => ({
    label: x.label, cost_rate: d2c(x.cost_rate), charge_rate: d2c(x.charge_rate),
    quantity: parseFloat(x.quantity) || 0,
  })),
});

// The same sums the server does, so the screen updates as you type instead of
// waiting on a save. The server's answer is authoritative and overwrites this
// the moment it lands.
function priceLocally(f) {
  const r = n => Math.round(n);
  const productCost = f.products.reduce((s, p) => s + r((parseFloat(p.quantity) || 0) * d2c(p.cost_price)), 0);
  const productRrp = f.products.reduce((s, p) => s + r((parseFloat(p.quantity) || 0) * d2c(p.rrp)), 0);
  const labourCost = f.labour.reduce((s, l) => s + r((parseFloat(l.quantity) || 0) * d2c(l.cost_rate)), 0);
  const labourCharge = f.labour.reduce((s, l) => s + r((parseFloat(l.quantity) || 0) * d2c(l.charge_rate)), 0);
  const materialsFromCost = r(productCost * (1 + (parseFloat(f.markup_cost) || 0) / 100));
  const materialsFromRrp = r(productRrp * (1 + (parseFloat(f.markup_rrp) || 0) / 100));
  const materialsSell = f.materials_basis === 'rrp' ? materialsFromRrp : materialsFromCost;
  const buildUp = materialsSell + labourCharge;
  const quoted = f.override === '' ? buildUp : d2c(f.override);
  const totalCost = productCost + labourCost;
  const margin = quoted - totalCost;
  const gst = r(quoted * 0.15);
  return {
    product_cost: productCost, product_rrp: productRrp, labour_cost: labourCost, labour_charge: labourCharge,
    materials_from_cost: materialsFromCost, materials_from_rrp: materialsFromRrp, materials_sell: materialsSell,
    build_up: buildUp, quoted, is_overridden: f.override !== '',
    total_cost: totalCost, margin, margin_pct: quoted > 0 ? Math.round((margin / quoted) * 10000) / 100 : null,
    gst, total_incl_gst: quoted + gst,
  };
}

function ProposalCard({ jobId, proposal, onSaved, onDeleted, onToggleSelect, selected }) {
  const [f, setF] = useState(() => toForm(proposal));
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const timerRef = useRef(null);
  const fRef = useRef(f);
  const dirtyRef = useRef(false);
  useEffect(() => { fRef.current = f; }, [f]);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  // A save landing mid-typing must not overwrite what is still being typed.
  useEffect(() => { if (!dirtyRef.current) setF(toForm(proposal)); }, [proposal]);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const t = priceLocally(f);

  const save = useCallback(async next => {
    clearTimeout(timerRef.current);
    setSaving(true);
    try {
      const { data } = await api.put(`/jobs/${jobId}/proposals/${proposal.id}`, toPayload(next));
      setDirty(false);
      dirtyRef.current = false;
      onSaved(data);
    } finally { setSaving(false); }
  }, [jobId, proposal.id, onSaved]);

  const touch = useCallback(() => {
    setDirty(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(fRef.current), AUTOSAVE_DELAY);
  }, [save]);

  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); touch(); };
  const setRow = (list, i, patch) =>
    { setF(x => ({ ...x, [list]: x[list].map((r, j) => j === i ? { ...r, ...patch } : r) })); touch(); };
  const addRow = list => {
    setF(x => ({ ...x, [list]: [...x[list], list === 'products'
      ? { _key: key(), description: '', quantity: '1', cost_price: '0.00', rrp: '0.00', product_id: null }
      : { _key: key(), label: '', cost_rate: '0.00', charge_rate: '0.00', quantity: '0' }] }));
    touch();
  };
  const removeRow = (list, i) => {
    const next = { ...fRef.current, [list]: fRef.current[list].filter((_, j) => j !== i) };
    setF(next); fRef.current = next; setDirty(true); save(next);
  };

  async function handleDelete() {
    if (!confirm(`Delete ${f.name}? This cannot be undone.`)) return;
    await api.delete(`/jobs/${jobId}/proposals/${proposal.id}`);
    onDeleted(proposal.id);
  }

  return (
    <div className={styles.propCard}>
      <div className={styles.propHead}>
        <input type="checkbox" checked={selected} onChange={onToggleSelect}
          title="Include this proposal when adding to the job's line items" />
        <button className={styles.propToggle} onClick={() => setOpen(o => !o)} title={open ? 'Collapse' : 'Expand'}>
          {open ? '▾' : '▸'}
        </button>
        <input className={styles.propName} value={f.name} onChange={e => set('name', e.target.value)}
          placeholder="e.g. Construct 14 metre retaining wall" />
        <div className={styles.propHeadTotals}>
          <span className={styles.propHeadQuote}>{money(t.quoted)}</span>
          <span className={t.margin < 0 ? styles.propMarginBad : styles.propMarginOk}>
            {money(t.margin)}{t.margin_pct != null ? ` · ${t.margin_pct.toFixed(2)}%` : ''}
          </span>
        </div>
        <span className={styles.propSaveState}>
          {saving ? 'Saving…' : dirty ? '● Unsaved' : ''}
        </span>
        <button className={styles.deleteBtn} style={{ position: 'static' }} onClick={handleDelete} title="Delete proposal">✕</button>
      </div>

      {open && (
        <div className={styles.propBody}>
          {/* ── Materials, from the price list ── */}
          <div className={styles.propSectionTitle}>Select Product</div>
          <div className={styles.propProdHead}>
            <span>Description</span><span>Units</span><span>Cost Price</span><span>RRP</span>
            <span>Total Cost</span><span>Total RRP</span><span />
          </div>
          {f.products.length === 0 && <div className={styles.emptySmall}>No products yet.</div>}
          {f.products.map((p, i) => (
            <div key={p._key} className={styles.propProdRow}>
              <ProductSearch
                value={p.description}
                onChange={({ description, unit_price, cost_price, product_id, product_name }) => {
                  setRow('products', i, {
                    description,
                    // A picked product brings its own prices; free typing keeps
                    // whatever is already in the row.
                    ...(unit_price !== null ? { rrp: unit_price.toFixed(2) } : {}),
                    ...(cost_price !== null && cost_price !== undefined ? { cost_price: c2d(cost_price) } : {}),
                    ...(product_id !== undefined ? { product_id } : {}),
                    ...(product_name !== null ? { product_name } : {}),
                  });
                }}
              />
              <input type="number" min="0" step="0.001" value={p.quantity}
                onChange={e => setRow('products', i, { quantity: e.target.value })} />
              <input type="number" min="0" step="0.01" value={p.cost_price}
                onChange={e => setRow('products', i, { cost_price: e.target.value })} />
              <input type="number" min="0" step="0.01" value={p.rrp}
                onChange={e => setRow('products', i, { rrp: e.target.value })} />
              <span className={styles.propNum}>{money((parseFloat(p.quantity) || 0) * d2c(p.cost_price))}</span>
              <span className={styles.propNum}>{money((parseFloat(p.quantity) || 0) * d2c(p.rrp))}</span>
              <button className={styles.deleteBtn} style={{ position: 'static' }} onClick={() => removeRow('products', i)}>✕</button>
            </div>
          ))}
          <div className={styles.propProdTotals}>
            <span>Total</span>
            <span className={styles.propNum}>{money(t.product_cost)}</span>
            <span className={styles.propNum}>{money(t.product_rrp)}</span>
          </div>
          <button className={styles.btnSmall} onClick={() => addRow('products')}>+ Add Product</button>

          {/* ── Labour and the other job lines ── */}
          <div className={styles.propSectionTitle} style={{ marginTop: 22 }}>Labour &amp; Other</div>
          <div className={styles.propLabHead}>
            <span>Line</span><span>Cost /unit</span><span>Charge /unit</span><span>Units</span>
            <span>Cost</span><span>Charge</span><span />
          </div>
          {f.labour.map((l, i) => {
            const q = parseFloat(l.quantity) || 0;
            return (
              <div key={l._key} className={`${styles.propLabRow} ${q > 0 ? '' : styles.propLabRowIdle}`}>
                <input value={l.label} onChange={e => setRow('labour', i, { label: e.target.value })} placeholder="e.g. Builder Labour" />
                <input type="number" min="0" step="0.01" value={l.cost_rate}
                  onChange={e => setRow('labour', i, { cost_rate: e.target.value })} />
                <input type="number" min="0" step="0.01" value={l.charge_rate}
                  onChange={e => setRow('labour', i, { charge_rate: e.target.value })} />
                <input type="number" min="0" step="0.25" value={l.quantity}
                  onChange={e => setRow('labour', i, { quantity: e.target.value })} />
                <span className={styles.propNum}>{money(q * d2c(l.cost_rate))}</span>
                <span className={styles.propNum}>{money(q * d2c(l.charge_rate))}</span>
                <button className={styles.deleteBtn} style={{ position: 'static' }} onClick={() => removeRow('labour', i)}>✕</button>
              </div>
            );
          })}
          <div className={styles.propLabTotals}>
            <span>Total</span>
            <span className={styles.propNum}>{money(t.labour_cost)}</span>
            <span className={styles.propNum}>{money(t.labour_charge)}</span>
          </div>
          <button className={styles.btnSmall} onClick={() => addRow('labour')}>+ Add Line</button>

          {/* ── Markup, and what it makes the materials worth ── */}
          <div className={styles.propSectionTitle} style={{ marginTop: 22 }}>Material Mark Up</div>
          {/* Both options side by side, the way the sheet shows them, each with
              its own percentage — RRP already carries the supplier's margin, so
              it takes a smaller uplift than cost does. The label is built from
              the number, so it can't drift away from the formula. */}
          <div className={styles.propMarkup}>
            {[
              ['cost', 'Cost', 'markup_cost', t.materials_from_cost, t.product_cost],
              ['rrp', 'RRP', 'markup_rrp', t.materials_from_rrp, t.product_rrp],
            ].map(([basis, label, field, value, base]) => (
              <div key={basis}
                className={`${styles.propBasis} ${f.materials_basis === basis ? styles.propBasisOn : ''}`}
                onClick={() => set('materials_basis', basis)}
                role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); set('materials_basis', basis); } }}>
                <span className={styles.propBasisLabel}>
                  <input type="radio" checked={f.materials_basis === basis} readOnly tabIndex={-1} />
                  {label} +
                  <input className={styles.propBasisPct} type="number" step="1" value={f[field]}
                    onClick={e => e.stopPropagation()}
                    onChange={e => set(field, e.target.value)} />
                  %
                </span>
                <strong>{money(value)}</strong>
                <em>on {money(base)}</em>
              </div>
            ))}
          </div>

          {/* ── What it all adds up to ── */}
          <div className={styles.propSectionTitle} style={{ marginTop: 22 }}>Quote</div>
          <div className={styles.propQuote}>
            <div className={styles.propQuoteRow}><span>Materials</span><span>{money(t.materials_sell)}</span></div>
            <div className={styles.propQuoteRow}><span>Labour &amp; other</span><span>{money(t.labour_charge)}</span></div>
            <div className={`${styles.propQuoteRow} ${styles.propQuoteSub}`}>
              <span>Build-up</span><span>{money(t.build_up)}</span>
            </div>
            <div className={styles.propQuoteOverride}>
              <label>
                <span>Quote price</span>
                <input type="number" min="0" step="0.01" value={f.override}
                  placeholder={c2d(t.build_up)}
                  onChange={e => set('override', e.target.value)} />
              </label>
              {t.is_overridden
                ? <button className={styles.btnSmall} onClick={() => set('override', '')}>Use build-up</button>
                : <span className={styles.propHint}>Leave blank to quote the build-up, or type a rounded figure.</span>}
            </div>
            <div className={styles.propQuoteRow}><span>GST (15%)</span><span>{money(t.gst)}</span></div>
            <div className={`${styles.propQuoteRow} ${styles.propQuoteTotal}`}>
              <span>Total incl. GST</span><span>{money(t.total_incl_gst)}</span>
            </div>
            <div className={`${styles.propQuoteRow} ${styles.propQuoteMargin} ${t.margin < 0 ? styles.propMarginBad : ''}`}>
              <span>Margin</span>
              <span>{money(t.margin)}{t.margin_pct != null ? ` · ${t.margin_pct.toFixed(2)}%` : ''}</span>
            </div>
            <div className={styles.propHint}>
              Quote price less what the job costs — {money(t.product_cost)} materials and {money(t.labour_cost)} labour.
              Cost prices and margin stay here; they never reach the customer.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function JobProposals({ jobId, onLineItemsChanged }) {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState([]);
  const [itemise, setItemise] = useState(false);
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get(`/jobs/${jobId}/proposals`)
      .then(r => { setProposals(r.data); setSelected(r.data.map(p => p.id)); })
      .catch(() => setErr('Could not load proposals'))
      .finally(() => setLoading(false));
  }, [jobId]);

  async function addProposal(copyFrom) {
    setCreating(true); setErr('');
    try {
      const { data } = await api.post(`/jobs/${jobId}/proposals`, copyFrom ? { copy_from: copyFrom } : {});
      setProposals(ps => [...ps, data]);
      setSelected(s => [...s, data.id]);
    } catch (e) { setErr(e.response?.data?.error || 'Could not add a proposal'); }
    finally { setCreating(false); }
  }

  const onSaved = useCallback(saved => {
    setProposals(ps => ps.map(p => p.id === saved.id ? saved : p));
  }, []);

  function onDeleted(id) {
    setProposals(ps => ps.filter(p => p.id !== id));
    setSelected(s => s.filter(x => x !== id));
  }

  async function addToLineItems() {
    setAdding(true); setErr('');
    try {
      const { data } = await api.post(`/jobs/${jobId}/proposals/to-line-items`, {
        proposal_ids: selected, itemise,
      });
      onLineItemsChanged?.(data.line_items);
      setFlash(`Added ${data.added} line${data.added === 1 ? '' : 's'} to the job. They're on the Line Items tab.`);
      setTimeout(() => setFlash(''), 6000);
    } catch (e) { setErr(e.response?.data?.error || 'Could not add these to the line items'); }
    finally { setAdding(false); }
  }

  const chosen = proposals.filter(p => selected.includes(p.id));
  const grand = chosen.reduce((s, p) => s + p.totals.quoted, 0);
  const grandMargin = chosen.reduce((s, p) => s + p.totals.margin, 0);

  if (loading) return <div className={styles.emptySmall}>Loading proposals…</div>;

  return (
    <div className={styles.propWrap}>
      <div className={styles.propTop}>
        <div>
          <div className={styles.propTopTitle}>Proposals</div>
          <div className={styles.propTopHint}>
            One per scope of work. Price each from the price list and your labour rates; tick the ones
            the customer is getting and send them through to the job's line items.
          </div>
        </div>
        <button className={styles.btnPrimary} onClick={() => addProposal(null)} disabled={creating}>
          {creating ? 'Adding…' : '+ Add Proposal'}
        </button>
      </div>

      {err && <div className={styles.errorBanner}>{err}</div>}
      {flash && <div className={styles.notifyFlash}>{flash}</div>}

      {proposals.length === 0 ? (
        <div className={styles.emptySmall}>
          No proposals yet. Add one per scope of work — a retaining wall and a set of steps get priced separately.
        </div>
      ) : (
        <>
          {proposals.map(p => (
            <ProposalCard key={p.id} jobId={jobId} proposal={p}
              selected={selected.includes(p.id)}
              onToggleSelect={() => setSelected(s => s.includes(p.id) ? s.filter(x => x !== p.id) : [...s, p.id])}
              onSaved={onSaved} onDeleted={onDeleted} />
          ))}

          <div className={styles.propFooter}>
            <div className={styles.propFooterTotals}>
              <span>{chosen.length} of {proposals.length} selected</span>
              <strong>{money(grand)} excl. GST</strong>
              <em className={grandMargin < 0 ? styles.propMarginBad : styles.propMarginOk}>
                margin {money(grandMargin)}
                {grand > 0 ? ` · ${(Math.round((grandMargin / grand) * 10000) / 100).toFixed(2)}%` : ''}
              </em>
            </div>
            <div className={styles.propFooterActions}>
              <label className={styles.propItemise}>
                <input type="checkbox" checked={itemise} onChange={e => setItemise(e.target.checked)} />
                <span>Break into materials and labour lines</span>
              </label>
              <button className={styles.btnSecondary} onClick={() => addProposal(proposals[proposals.length - 1].id)}
                disabled={creating}>Copy last proposal</button>
              <button className={styles.btnPrimary} onClick={addToLineItems} disabled={adding || chosen.length === 0}>
                {adding ? 'Adding…' : '→ Add to Line Items'}
              </button>
            </div>
            <div className={styles.propHint}>
              {itemise
                ? 'The customer sees a materials line and each labour line, at charge-out rates.'
                : 'The customer sees one line per proposal at its quoted price. Tick above to break it out.'}
              {' '}From there, raise a quote or invoice the job as usual.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
