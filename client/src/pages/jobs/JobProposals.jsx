import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import ProductSearch from '../../components/products/ProductSearch';
import NewProductModal from '../../components/products/NewProductModal';
import styles from './Jobs.module.css';

// Priced proposals on a job — the Job Sheet spreadsheet, in the app.
//
// One proposal per scope of work. Each is built from price-list products, every
// row carrying what it COSTS and what it is CHARGED at, plus labour lines with
// the same two rates. Margin falls out of the two. The markup fills the charge
// column; it is a tool, not a second source of truth.
//
// Everything is cents excl. GST, matching the server. The inputs are dollars,
// converted at the edges only.
//
// There is no autosave. Picking a product is a search-and-click that takes
// longer than any sensible debounce, and a save landing mid-search wrote the
// half-typed row. Save is explicit, and leaving with unsaved work warns.

const c2d = c => ((c || 0) / 100).toFixed(2);
const d2c = d => Math.round((parseFloat(d) || 0) * 100);
const money = c => `$${((c || 0) / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

let rowSeq = 0;
const key = () => `r${++rowSeq}`;

const toForm = p => ({
  ...p,
  products: (p.products || []).map(x => ({
    _key: x.id || key(), product_id: x.product_id, description: x.description, product_name: x.product_name,
    quantity: String(x.quantity ?? 1), cost_price: c2d(x.cost_price), charge_price: c2d(x.charge_price),
  })),
  labour: (p.labour || []).map(x => ({
    _key: x.id || key(), label: x.label,
    cost_rate: c2d(x.cost_rate), charge_rate: c2d(x.charge_rate), quantity: String(x.quantity ?? 0),
  })),
  markup: String(p.markup_pct ?? 15),
  override: p.quote_price == null ? '' : c2d(p.quote_price),
});

const toPayload = f => ({
  name: f.name,
  markup_pct: parseFloat(f.markup) || 0,
  quote_price: f.override === '' ? null : d2c(f.override),
  notes: f.notes,
  products: f.products.map(x => ({
    product_id: x.product_id || null, description: x.description, product_name: x.product_name || null,
    quantity: parseFloat(x.quantity) || 0, cost_price: d2c(x.cost_price), charge_price: d2c(x.charge_price),
  })),
  labour: f.labour.map(x => ({
    label: x.label, cost_rate: d2c(x.cost_rate), charge_rate: d2c(x.charge_rate),
    quantity: parseFloat(x.quantity) || 0,
  })),
});

// The same sums the server does, so the screen answers as you type. The
// server's figures overwrite these the moment a save lands.
function priceLocally(f) {
  const r = n => Math.round(n);
  const productCost = f.products.reduce((s, p) => s + r((parseFloat(p.quantity) || 0) * d2c(p.cost_price)), 0);
  const productCharge = f.products.reduce((s, p) => s + r((parseFloat(p.quantity) || 0) * d2c(p.charge_price)), 0);
  const labourCost = f.labour.reduce((s, l) => s + r((parseFloat(l.quantity) || 0) * d2c(l.cost_rate)), 0);
  const labourCharge = f.labour.reduce((s, l) => s + r((parseFloat(l.quantity) || 0) * d2c(l.charge_rate)), 0);
  const markup = parseFloat(f.markup) || 0;
  const materialsAtMarkup = r(productCost * (1 + markup / 100));
  const buildUp = productCharge + labourCharge;
  const quoted = f.override === '' ? buildUp : d2c(f.override);
  const totalCost = productCost + labourCost;
  const margin = quoted - totalCost;
  const gst = r(quoted * 0.15);
  return {
    product_cost: productCost, product_charge: productCharge, materials_at_markup: materialsAtMarkup,
    labour_cost: labourCost, labour_charge: labourCharge,
    build_up: buildUp, quoted, is_overridden: f.override !== '',
    total_cost: totalCost, margin, margin_pct: quoted > 0 ? Math.round((margin / quoted) * 10000) / 100 : null,
    gst, total_incl_gst: quoted + gst,
  };
}

function ProposalCard({ jobId, proposal, onSaved, onDeleted, onToggleSelect, selected, onDirty }) {
  const [f, setF] = useState(() => toForm(proposal));
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState('');
  // Which product row is having a price-list entry created for it, if any.
  const [newProductFor, setNewProductFor] = useState(null);
  const fRef = useRef(f);
  const dirtyRef = useRef(false);
  useEffect(() => { fRef.current = f; }, [f]);
  useEffect(() => { dirtyRef.current = dirty; onDirty(proposal.id, dirty); }, [dirty, proposal.id, onDirty]);

  // A save landing from elsewhere must not overwrite what is being typed.
  useEffect(() => { if (!dirtyRef.current) setF(toForm(proposal)); }, [proposal]);

  const t = priceLocally(f);

  const save = useCallback(async next => {
    setSaving(true); setErr('');
    try {
      const { data } = await api.put(`/jobs/${jobId}/proposals/${proposal.id}`, toPayload(next));
      setDirty(false);
      dirtyRef.current = false;
      onSaved(data);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not save this proposal');
    } finally { setSaving(false); }
  }, [jobId, proposal.id, onSaved]);

  const touch = () => setDirty(true);
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); touch(); };
  const setRow = (list, i, patch) =>
    { setF(x => ({ ...x, [list]: x[list].map((r, j) => j === i ? { ...r, ...patch } : r) })); touch(); };
  const addRow = list => {
    setF(x => ({ ...x, [list]: [...x[list], list === 'products'
      ? { _key: key(), description: '', quantity: '1', cost_price: '0.00', charge_price: '0.00', product_id: null }
      : { _key: key(), label: '', cost_rate: '0.00', charge_rate: '0.00', quantity: '0' }] }));
    touch();
  };
  const removeRow = (list, i) => { setF(x => ({ ...x, [list]: x[list].filter((_, j) => j !== i) })); touch(); };

  // The markup's job: fill the charge column off the cost column. Rows already
  // priced by hand are overwritten too — it is a deliberate button press, and
  // leaving some rows behind would be worse than doing all of them.
  function applyMarkup() {
    const mult = 1 + (parseFloat(f.markup) || 0) / 100;
    setF(x => ({
      ...x,
      products: x.products.map(p => ({ ...p, charge_price: (((d2c(p.cost_price) * mult) | 0) / 100).toFixed(2) })),
    }));
    touch();
  }

  async function handleDelete() {
    if (!confirm(`Delete ${f.name}? This cannot be undone.`)) return;
    await api.delete(`/jobs/${jobId}/proposals/${proposal.id}`);
    onDeleted(proposal.id);
  }

  return (
    <div className={`${styles.propCard} ${dirty ? styles.propCardDirty : ''}`}>
      <div className={styles.propHead}>
        <input type="checkbox" checked={selected} onChange={onToggleSelect}
          title="Include this proposal in the quote" />
        <button className={styles.propToggle} onClick={() => setOpen(o => !o)} title={open ? 'Collapse' : 'Expand'}>
          {open ? '▾' : '▸'}
        </button>
        <input className={styles.propName} value={f.name} onChange={e => set('name', e.target.value)}
          placeholder="e.g. Construct 14 metre retaining wall" />
        {proposal.quoted_on && (
          <span className={styles.propQuoted} title="This scope has already gone out on a quote">
            quoted{proposal.quote_number ? ` QT-${String(proposal.quote_number).padStart(4, '0')}` : ''}
          </span>
        )}
        <div className={styles.propHeadTotals}>
          <span className={styles.propHeadQuote}>{money(t.quoted)}</span>
          <span className={t.margin < 0 ? styles.propMarginBad : styles.propMarginOk}>
            {money(t.margin)}{t.margin_pct != null ? ` · ${t.margin_pct.toFixed(2)}%` : ''}
          </span>
        </div>
        {dirty && (
          <button className={styles.btnPrimary} onClick={() => save(fRef.current)} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        <button className={styles.deleteBtn} style={{ position: 'static' }} onClick={handleDelete} title="Delete proposal">✕</button>
      </div>

      {open && (
        <div className={styles.propBody}>
          {err && <div className={styles.errorBanner}>{err}</div>}

          {/* ── Materials, from the price list ── */}
          <div className={styles.propSectionTitle}>Select Product</div>
          <div className={styles.propProdHead}>
            <span>Description</span><span>Units</span><span>Cost</span><span>Charge</span>
            <span>Total Cost</span><span>Total Charge</span><span />
          </div>
          {f.products.length === 0 && <div className={styles.emptySmall}>No products yet.</div>}
          {f.products.map((p, i) => (
            <div key={p._key} className={styles.propProdRow}>
              <ProductSearch
                value={p.description}
                onChange={({ description, unit_price, cost_price, product_id, product_name }) => {
                  const mult = 1 + (parseFloat(f.markup) || 0) / 100;
                  const cost = cost_price !== null && cost_price !== undefined ? cost_price : null;
                  setRow('products', i, {
                    description,
                    ...(cost !== null ? { cost_price: c2d(cost) } : {}),
                    // A picked product prices itself: charge from its sell price
                    // where the price list has one, else cost plus the markup.
                    ...(unit_price !== null ? { charge_price: unit_price.toFixed(2) }
                      : cost !== null ? { charge_price: c2d(Math.round(cost * mult)) } : {}),
                    ...(product_id !== undefined ? { product_id } : {}),
                    ...(product_name !== null ? { product_name } : {}),
                  });
                }}
              />
              <input type="number" min="0" step="0.001" value={p.quantity}
                onChange={e => setRow('products', i, { quantity: e.target.value })} />
              <input type="number" min="0" step="0.01" value={p.cost_price}
                onChange={e => setRow('products', i, { cost_price: e.target.value })} />
              <input type="number" min="0" step="0.01" value={p.charge_price}
                onChange={e => setRow('products', i, { charge_price: e.target.value })} />
              <span className={styles.propNum}>{money((parseFloat(p.quantity) || 0) * d2c(p.cost_price))}</span>
              <span className={styles.propNum}>{money((parseFloat(p.quantity) || 0) * d2c(p.charge_price))}</span>
              <button className={styles.deleteBtn} style={{ position: 'static' }} onClick={() => removeRow('products', i)}>✕</button>
              {/* Typed by hand and matching nothing on the price list. Offer to
                  put it there — most of these are things we buy again. */}
              {!p.product_id && String(p.description || '').trim() && (
                <button className={styles.propAddToList} onClick={() => setNewProductFor(i)}
                  title="This isn't on the price list — add it, and fill this row in from it">
                  + Add “{String(p.description).trim().slice(0, 40)}{String(p.description).trim().length > 40 ? '…' : ''}” to the Price List
                </button>
              )}
            </div>
          ))}
          <div className={styles.propProdTotals}>
            <span>Total</span>
            <span className={styles.propNum}>{money(t.product_cost)}</span>
            <span className={styles.propNum}>{money(t.product_charge)}</span>
          </div>
          <button className={styles.btnSmall} onClick={() => addRow('products')}>+ Add Product</button>

          {/* ── The markup that fills the charge column ── */}
          <div className={styles.propSectionTitle} style={{ marginTop: 22 }}>Material Mark Up</div>
          <div className={styles.propMarkup}>
            <label className={styles.propMarkupPct}>
              <span>Cost +</span>
              <input type="number" step="1" value={f.markup} onChange={e => set('markup', e.target.value)} />
              <span>%</span>
            </label>
            <button className={styles.btnSmall} onClick={applyMarkup}>Apply to every Charge</button>
            <span className={styles.propHint} style={{ marginTop: 0 }}>
              {money(t.product_cost)} at {parseFloat(f.markup) || 0}% would be <strong>{money(t.materials_at_markup)}</strong>
              {/* Rounding each row and then adding them up never lands exactly
                  on the markup applied to the total, so a gap of a cent or so
                  per row is arithmetic, not a decision. Only flag a real one. */}
              {Math.abs(t.product_charge - t.materials_at_markup) > Math.max(100, f.products.length) && (
                <> — the charge column totals {money(t.product_charge)}, so some rows are priced by hand.</>
              )}
            </span>
          </div>

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

          {/* ── What it all adds up to ── */}
          <div className={styles.propSectionTitle} style={{ marginTop: 22 }}>Quote</div>
          <div className={styles.propQuote}>
            <div className={styles.propQuoteRow}><span>Materials</span><span>{money(t.product_charge)}</span></div>
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

          <div className={styles.propBodyActions}>
            <button className={styles.btnPrimary} onClick={() => save(fRef.current)} disabled={saving || !dirty}>
              {saving ? 'Saving…' : dirty ? 'Save Proposal' : 'Saved'}
            </button>
            {dirty && <span className={styles.propUnsaved}>● Unsaved changes</span>}
          </div>
        </div>
      )}

      {newProductFor !== null && (
        <NewProductModal
          initialDescription={f.products[newProductFor]?.description || ''}
          initialCostDollars={f.products[newProductFor]?.cost_price || ''}
          initialChargeDollars={f.products[newProductFor]?.charge_price || ''}
          markupPct={parseFloat(f.markup) || 0}
          onClose={() => setNewProductFor(null)}
          onCreated={product => {
            // The row is filled in from what was just saved, so the proposal and
            // the price list agree from the outset. The proposal itself still
            // needs saving — the button is right there and now says so.
            setRow('products', newProductFor, {
              product_id: product.id,
              product_name: product.name,
              description: (product.description || '').trim() || product.name,
              cost_price: c2d(product.cost_price),
              charge_price: c2d(product.unit_price),
            });
            setNewProductFor(null);
          }}
        />
      )}
    </div>
  );
}

export default function JobProposals({ jobId }) {
  const navigate = useNavigate();
  const [proposals, setProposals] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState([]);
  const [itemise, setItemise] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [err, setErr] = useState('');
  const [dirtyIds, setDirtyIds] = useState([]);

  useEffect(() => {
    Promise.all([
      api.get(`/jobs/${jobId}/proposals`),
      api.get('/settings/proposal-templates').catch(() => ({ data: [] })),
    ]).then(([pRes, tRes]) => {
      setProposals(pRes.data);
      setSelected(pRes.data.map(p => p.id));
      const live = (tRes.data || []).filter(t => !t.archived);
      setTemplates(live);
      setTemplateId(live.find(t => t.is_default)?.id || live[0]?.id || '');
    }).catch(() => setErr('Could not load proposals'))
      .finally(() => setLoading(false));
  }, [jobId]);

  // Unsaved work is now possible, so leaving has to warn about it.
  useEffect(() => {
    if (!dirtyIds.length) return undefined;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyIds]);

  const onDirty = useCallback((id, isDirty) => {
    setDirtyIds(ids => (isDirty ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter(x => x !== id)));
  }, []);

  async function addProposal(copyFrom) {
    setCreating(true); setErr('');
    try {
      const { data } = await api.post(`/jobs/${jobId}/proposals`,
        copyFrom ? { copy_from: copyFrom } : (templateId ? { template_id: templateId } : {}));
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
    setDirtyIds(ids => ids.filter(x => x !== id));
  }

  async function createQuote() {
    if (dirtyIds.length) { setErr('Save your changes first — the quote is built from what has been saved.'); return; }
    setQuoting(true); setErr('');
    try {
      const { data } = await api.post(`/jobs/${jobId}/proposals/to-quote`, { proposal_ids: selected, itemise });
      navigate(`/quotes/${data.quote.id}`);
    } catch (e) { setErr(e.response?.data?.error || 'Could not create the quote'); setQuoting(false); }
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
            One per scope of work. Price each from the price list and your labour rates, then tick the ones
            the customer is getting and raise a quote from them.
          </div>
        </div>
        <div className={styles.propTopActions}>
          {templates.length > 1 && (
            <select value={templateId} onChange={e => setTemplateId(e.target.value)}
              title="Which template a new proposal starts from">
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>)}
            </select>
          )}
          <button className={styles.btnPrimary} onClick={() => addProposal(null)} disabled={creating}>
            {creating ? 'Adding…' : '+ Add Proposal'}
          </button>
        </div>
      </div>

      {err && <div className={styles.errorBanner}>{err}</div>}

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
              onSaved={onSaved} onDeleted={onDeleted} onDirty={onDirty} />
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
                <span>Itemise on the quote</span>
              </label>
              <button className={styles.btnSecondary} onClick={() => addProposal(proposals[proposals.length - 1].id)}
                disabled={creating}>Copy last proposal</button>
              <button className={styles.btnPrimary} onClick={createQuote}
                disabled={quoting || chosen.length === 0 || dirtyIds.length > 0}>
                {quoting ? 'Creating…' : '→ Create Quote'}
              </button>
            </div>
            <div className={styles.propHint}>
              {dirtyIds.length > 0
                ? `Save the ${dirtyIds.length} proposal${dirtyIds.length === 1 ? '' : 's'} you've changed before raising the quote.`
                : itemise
                  ? 'The quote lists every product and labour line at its charge rate.'
                  : 'The quote gets one line per proposal at its quoted price. Tick above to itemise.'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
