import { useState, useEffect, useMemo, useRef } from 'react';
import api from '../../lib/api';
import { readSpec, DEFAULT_SPEC } from './palingFence';
import styles from './PalingFenceSetup.module.css';

// How we build a paling fence, written down where it can be changed.
//
// The calculator does the arithmetic; this says what the arithmetic is about.
// Post spacing, how deep they go, bags of concrete each, how many rails a
// height takes, what a paling covers, and which Price List item is the post,
// the rail, the paling, the cap and the concrete.
//
// All of it changes. A supplier swaps a paling, concrete goes up, somebody
// decides a 1500 fence gets three rails. None of that should need anybody to
// touch the app, which is the whole reason this page exists.

// Finding a Price List item without scrolling the Price List. The same
// search-as-you-type as the rest of this page.
function ProductPick({ value, products, onChange, placeholder }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const picked = products.find(p => p.id === value) || null;

  useEffect(() => {
    const away = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products.filter(p => p.name.toLowerCase().includes(q)
      || (p.sku || '').toLowerCase().includes(q)).slice(0, 12);
  }, [search, products]);

  if (picked && !open) {
    return (
      <div className={styles.picked}>
        <span className={styles.pickedName} title={picked.name}>{picked.name}</span>
        <span className={styles.pickedPrice}>
          {picked.unit_price ? `$${(picked.unit_price / 100).toFixed(2)}` : 'no price'}
        </span>
        <button type="button" onClick={() => { setSearch(''); setOpen(true); }}>Change</button>
        <button type="button" onClick={() => onChange(null)}>✕</button>
      </div>
    );
  }

  return (
    <div className={styles.pickBox} ref={box}>
      <input
        value={search}
        autoFocus={open}
        onChange={e => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div className={styles.pickList}>
          {matches.map(p => (
            <button type="button" key={p.id} className={styles.pickOption}
              onMouseDown={() => { onChange(p.id); setOpen(false); setSearch(''); }}>
              <span>{p.name}</span>
              <em>
                {p.unit_price ? `$${(p.unit_price / 100).toFixed(2)}` : 'no price'}
                {p.unit && p.unit !== 'each' ? ` per ${p.unit}` : ''}
              </em>
            </button>
          ))}
        </div>
      )}
      {open && search.trim() && matches.length === 0 && (
        <div className={styles.pickList}>
          <p className={styles.pickNone}>
            Nothing on the Price List matches that. Add it under Price List first, then come
            back and pick it here.
          </p>
        </div>
      )}
    </div>
  );
}

export default function PalingFenceSetup() {
  const [spec, setSpec] = useState(() => readSpec(null));
  const [products, setProducts] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/settings/paling-fence').then(r => r.data).catch(() => ({})),
      api.get('/products').then(r => r.data).catch(() => []),
    ]).then(([stored, list]) => {
      setSpec(readSpec(stored));
      setProducts(list);
    }).finally(() => setLoading(false));
  }, []);

  const rule = (key, value) => setSpec(s => ({ ...s, rules: { ...s.rules, [key]: value } }));
  const part = (key, productId) =>
    setSpec(s => ({ ...s, components: { ...s.components, [key]: { ...s.components[key], productId } } }));
  const height = (mm, patch) => setSpec(s => ({
    ...s,
    heights: s.heights.map(h => (h.mm === mm ? { ...h, ...patch } : h)),
  }));

  async function save() {
    setSaving(true); setError(''); setMsg('');
    try {
      await api.put('/settings/paling-fence', spec);
      setMsg('Saved. The calculator uses this from the next quote on.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save that');
    } finally { setSaving(false); }
  }

  const num = (value, onChange, suffix) => (
    <span className={styles.numField}>
      <input type="number" min="0" step="1" value={value}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
      {suffix && <em>{suffix}</em>}
    </span>
  );

  return (
    <div className={styles.card}>
      <button type="button" className={styles.head} onClick={() => setOpen(o => !o)}>
        <span>
          <strong>Timber Paling Fence Calculator</strong>
          <em>How we build them, and which Price List item each part is</em>
        </span>
        <span className={styles.chev}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (loading ? (
        <p className={styles.note}>Loading…</p>
      ) : (
        <div className={styles.body}>
          <p className={styles.note}>
            The calculator works out posts, concrete, rails, palings and the cap from a fence
            drawn on the plan. What it reads to do that is all here — nothing about how we
            build is written into the app.
          </p>
          {/* Setting this up does not put the calculator in front of anybody.
              It turns up when a presenter product is pointed at it, and
              nothing else on this page says so. */}
          <p className={styles.where}>
            <strong>To put it in front of a customer:</strong> add or edit a product in the
            sections below and set its <em>Calculator Type</em> to “Timber Paling Fence (drawn
            take-off)”. Opening that product in the Sales Presenter then opens this calculator.
          </p>

          {/* ── The rules ── */}
          <h4 className={styles.sub}>How we build them</h4>
          <div className={styles.rules}>
            <label>
              Posts no more than
              {num(spec.rules.maxSpacingMm, v => rule('maxSpacingMm', v), 'mm apart')}
              <em>A run is divided evenly, so the real spacing is this or less</em>
            </label>
            <label>
              Concreted
              {num(spec.rules.embedmentMm, v => rule('embedmentMm', v), 'mm into the ground')}
              <em>Added to the fence height to work out which post to buy</em>
            </label>
            <label>
              Concrete
              {num(spec.rules.bagsPerPost, v => rule('bagsPerPost', v), 'bags per post')}
            </label>
            <label>
              Each paling covers
              {num(spec.rules.palingCoverMm, v => rule('palingCoverMm', v), 'mm')}
              <em>150 is butted up; less overlaps them, more leaves a gap</em>
            </label>
            <label>
              Rails come in
              {num(spec.rules.railLengthMm, v => rule('railLengthMm', v), 'mm lengths')}
            </label>
            <label>
              Caps come in
              {num(spec.rules.capLengthMm, v => rule('capLengthMm', v), 'mm lengths')}
            </label>
          </div>

          {/* ── Per height ── */}
          <h4 className={styles.sub}>Each height</h4>
          <p className={styles.note}>
            The post and the paling are a whole product at a length, so each height has its
            own. A {spec.rules.embedmentMm}mm hole means an 1800 fence wants a post at least{' '}
            {1800 + Number(spec.rules.embedmentMm || 0)}mm long.
          </p>
          <div className={styles.heightHead}>
            <div>Height</div><div>Rails</div><div>Post</div><div>Paling</div>
          </div>
          {spec.heights.map(h => (
            <div key={h.mm} className={styles.heightRow}>
              <div className={styles.heightName}>
                {h.mm}mm
                <em>post {h.mm + Number(spec.rules.embedmentMm || 0)}mm+</em>
              </div>
              <div>{num(h.rails, v => height(h.mm, { rails: v }))}</div>
              <div>
                <ProductPick value={h.postProductId} products={products}
                  placeholder="Search for the post…"
                  onChange={id => height(h.mm, { postProductId: id })} />
              </div>
              <div>
                <ProductPick value={h.palingProductId} products={products}
                  placeholder="Search for the paling…"
                  onChange={id => height(h.mm, { palingProductId: id })} />
              </div>
            </div>
          ))}

          {/* ── The rest ── */}
          <h4 className={styles.sub}>The same whatever the height</h4>
          <div className={styles.parts}>
            <label>
              Rail
              <ProductPick value={spec.components.rail.productId} products={products}
                placeholder="Search for the rail…" onChange={id => part('rail', id)} />
            </label>
            <label>
              Top cap
              <ProductPick value={spec.components.cap.productId} products={products}
                placeholder="Search for the cap…" onChange={id => part('cap', id)} />
            </label>
            <label>
              Concrete
              <ProductPick value={spec.components.concrete.productId} products={products}
                placeholder="Search for the concrete…" onChange={id => part('concrete', id)} />
            </label>
          </div>

          <h4 className={styles.sub}>Putting it up</h4>
          <div className={styles.rules}>
            <label>
              Install
              {num(spec.labour.perMetre,
                v => setSpec(s => ({ ...s, labour: { ...s.labour, perMetre: v } })), '$ per metre')}
            </label>
            <label>
              And
              {num(spec.labour.perPost,
                v => setSpec(s => ({ ...s, labour: { ...s.labour, perPost: v } })), '$ per post')}
              <em>Digging and concreting is charged by the post, not by the metre</em>
            </label>
          </div>

          {error && <p className={styles.error}>{error}</p>}
          {msg && <p className={styles.ok}>{msg}</p>}

          <div className={styles.actions}>
            <button type="button" className={styles.reset}
              onClick={() => setSpec(readSpec(DEFAULT_SPEC))}>
              Back to how we normally build them
            </button>
            <button type="button" className={styles.save} disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
