import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import BarcodeScanner from '../../components/BarcodeScanner';
import styles from './Stock.module.css';

// Drives what a scan actually does. Five modes:
//   receive  — goods arriving, into the warehouse
//   transfer — warehouse onto a van
//   use      — off a van and onto a job as a cost
//   put      — into any van or the warehouse
//   take     — out of any van or the warehouse, onto a job as a cost
//
// put and take are the plain ones: a stock take finds things in the wrong
// place, or not counted at all, and neither of those is a delivery arriving or
// a van being loaded. They work against any location rather than assuming the
// warehouse is the source and a van is the destination.
//
// Either mode can be worked by camera or by hand. A barcode is quicker when
// there is one, and plenty of what sits in a van — offcuts, loose fixings, a
// box with the label worn off — has never had one, so the price list can be
// searched instead rather than leaving somebody stuck.
//
// Scanning stays open after each item so a run of boxes can be done one after
// another, with a running tally of what's been counted.
export default function ScanFlow({ mode, locations, jobId, jobLabel, onClose, onUsed }) {
  const { user } = useAuth();
  const vans = locations.filter(l => l.type === 'van');
  const warehouse = locations.find(l => l.type === 'warehouse');

  // put and take are about a place, not about which kind of place.
  const anyLocation = mode === 'put' || mode === 'take';

  // Default to the van this person is assigned to, so the common case is
  // no setup at all.
  const myVan = vans.find(v => (v.users || []).some(u => u.id === user?.id));
  const [vanId, setVanId] = useState(myVan?.id || vans[0]?.id || '');
  const [quantity, setQuantity] = useState(1);

  // 'choose' asks where and how before the camera opens; 'scan' is the camera;
  // 'search' is the price list. The older modes go straight to the camera, as
  // they always have.
  const [step, setStep] = useState(anyLocation ? 'choose' : 'scan');

  const [pending, setPending] = useState(null);   // resolved product awaiting confirm
  const [unknown, setUnknown] = useState(null);   // code with no product yet
  const [done, setDone] = useState([]);           // running tally
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (myVan && !vanId) setVanId(myVan.id); }, [myVan, vanId]);

  const handleScan = useCallback(async code => {
    setError('');
    try {
      const { data } = await api.get('/stock/lookup', { params: { code } });
      setPending({ ...data, code });
      setQuantity(1);
    } catch (err) {
      if (err.response?.status === 404) setUnknown(code);
      else setError(err.response?.data?.error || 'Lookup failed');
    }
  }, []);

  async function confirm() {
    if (!pending) return;
    setBusy(true); setError('');
    try {
      const qty = Number(quantity) || 1;
      if (mode === 'receive') {
        await api.post('/stock/receive', {
          product_id: pending.id, location_id: warehouse.id, quantity: qty,
        });
      } else if (mode === 'transfer') {
        if (!vanId) throw new Error('Pick a van first');
        await api.post('/stock/transfer', {
          product_id: pending.id, from_location_id: warehouse.id,
          to_location_id: vanId, quantity: qty,
        });
      } else if (mode === 'put') {
        if (!vanId) throw new Error('Pick somewhere to put it first');
        await api.post('/stock/receive', {
          product_id: pending.id, location_id: vanId, quantity: qty,
        });
      } else {
        // use, and take — both come off a location and land on the job.
        if (!vanId) throw new Error('Pick where it came from first');
        const { data } = await api.post('/stock/use', {
          product_id: pending.id, from_location_id: vanId, job_id: jobId, quantity: qty,
        });
        onUsed?.(data);
      }
      setDone(d => [{ name: pending.name, qty, at: Date.now() }, ...d]);
      setPending(null);
      resume();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not record that');
    } finally { setBusy(false); }
  }

  // Every location for put and take; the old modes keep their own lists.
  const places = anyLocation ? locations.filter(l => l.is_active !== false) : vans;
  const placeName = places.find(p => p.id === vanId)?.name
    || (anyLocation ? 'a van or the warehouse' : 'the van');

  const destination =
    mode === 'receive' ? warehouse?.name
    : mode === 'transfer' ? (vans.find(v => v.id === vanId)?.name || 'a van')
    : mode === 'put' ? placeName
    : jobLabel || 'this job';

  const title =
    mode === 'receive' ? 'Receive into warehouse'
    : mode === 'transfer' ? 'Load a van'
    : mode === 'put' ? 'Add product to stock'
    : mode === 'take' ? 'Remove product from stock'
    : 'Add stock to this job';

  const hint =
    mode === 'receive' ? 'Scan each item as it comes off the delivery.'
    : mode === 'transfer' ? `Scanning moves stock out of the warehouse and onto ${destination}.`
    : mode === 'put' ? `Each one found goes onto ${placeName}.`
    : mode === 'take' ? `Each one comes off ${placeName} and onto ${jobLabel || 'this job'}.`
    : `Scanning takes stock off ${placeName} and adds it to the job's costs.`;

  // Exactly one of these is on screen at a time: the camera, or the panel
  // asking about the thing just scanned. Leaving the camera running behind the
  // confirmation would have it reading the same box again.
  const scanning = step === 'scan' && !pending && !unknown;
  const counted = done.reduce((sum, d) => sum + Number(d.qty || 0), 0);

  // Where to go back to once an item is dealt with: the camera keeps scanning,
  // and a hand-picked one returns to the list so the next can be found.
  const resume = () => setStep(step === 'search' ? 'search' : (anyLocation ? 'choose' : 'scan'));

  return (
    <>
      {scanning && (
        <BarcodeScanner
          title={title}
          hint={done.length ? `${hint} ${counted} counted so far.` : hint}
          onScan={handleScan}
          onClose={onClose}
        />
      )}

      {(pending || unknown || step === 'choose' || step === 'search') && (
        <div className={styles.scanOverlay}>
          <div className={styles.scanPanel}>
            <div className={styles.scanHeader}>
              <h2>{title}</h2>
              <button className={styles.close} onClick={onClose}>✕</button>
            </div>

            {mode !== 'receive' && places.length > 0 && (
              <div className={styles.scanField}>
                <label className={styles.label}>
                  {mode === 'transfer' ? 'Onto which van'
                    : mode === 'put' ? 'Put it where'
                    : anyLocation ? 'Take it off' : 'From which van'}
                </label>
                <select className={styles.input} value={vanId} onChange={e => setVanId(e.target.value)}>
                  {places.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.id === myVan?.id ? `${v.name} (yours)` : v.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Before anything is found: say where, then say how. A barcode
                when there is one, the price list when there is not. */}
            {step === 'choose' && !pending && !unknown && (
              <div className={styles.assignBox}>
                <p className={styles.assignHelp}>{hint}</p>
                <div className={styles.confirmButtons}>
                  <button className={styles.btnPrimary} onClick={() => setStep('scan')} disabled={!vanId}>
                    📷 Scan a barcode
                  </button>
                  <button className={styles.btnSecondary} onClick={() => setStep('search')} disabled={!vanId}>
                    🔎 Find it on the price list
                  </button>
                </div>
              </div>
            )}

            {step === 'search' && !pending && !unknown && (
              <ProductPicker
                help={hint}
                onPick={product => { setPending({ ...product, code: null }); setQuantity(1); }}
                onCancel={() => setStep(anyLocation ? 'choose' : 'scan')}
              />
            )}

            {error && <div className={styles.scanError}>{error}</div>}

            {pending && (
              <div className={styles.confirmBox}>
                <div className={styles.confirmName}>{pending.name}</div>
                {/* Nothing to show for one picked by hand — it has no code,
                    which is usually why it was picked by hand. */}
                {pending.code && <div className={styles.confirmCode}>{pending.code}</div>}
                <div className={styles.qtyRow}>
                  <button className={styles.stepBtn} onClick={() => setQuantity(q => Math.max(1, Number(q) - 1))}>−</button>
                  <input
                    className={styles.qtyInput}
                    type="number"
                    min="0"
                    step="any"
                    value={quantity}
                    onChange={e => setQuantity(e.target.value)}
                  />
                  <button className={styles.stepBtn} onClick={() => setQuantity(q => Number(q) + 1)}>+</button>
                  <span className={styles.unit}>{pending.unit || 'each'}</span>
                </div>
                <div className={styles.confirmButtons}>
                  <button className={styles.btnPrimary} onClick={confirm} disabled={busy}>
                    {busy ? 'Saving…'
                      : mode === 'take' ? `Take off ${placeName}`
                      : `Add to ${destination}`}
                  </button>
                  <button className={styles.btnSecondary}
                    onClick={() => { setPending(null); resume(); }} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {unknown && (
              <AssignBarcode
                code={unknown}
                onCancel={() => setUnknown(null)}
                onAssigned={product => { setUnknown(null); setPending({ ...product, code: unknown }); setQuantity(1); }}
              />
            )}

            {done.length > 0 && (
              <div className={styles.tally}>
                <div className={styles.tallyTitle}>Counted this session</div>
                {done.map((d, i) => (
                  <div key={i} className={styles.tallyRow}><span>{d.name}</span><strong>{d.qty}</strong></div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Finding a product without a barcode to scan.
//
// Plenty of what is in a van has no label worth scanning — offcuts, loose
// fixings, the box whose barcode has worn off — and during a stock take that
// is most of what gets counted. Searches on the name and on the supplier's
// code, since either may be what somebody is reading off the shelf.
function ProductPicker({ help, onPick, onCancel }) {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/products', { params: { limit: 500 } })
      .then(r => setProducts(r.data.products || r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const term = search.trim().toLowerCase();
  const matches = (term
    ? products.filter(p => p.name.toLowerCase().includes(term)
        || String(p.sku || '').toLowerCase().includes(term))
    : products).slice(0, 25);

  return (
    <div className={styles.assignBox}>
      <p className={styles.assignHelp}>{help}</p>
      <input
        className={styles.input}
        placeholder="Search the price list by name or code…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        autoFocus
      />
      <div className={styles.assignResults}>
        {loading && <div className={styles.muted}>Loading the price list…</div>}
        {!loading && matches.map(p => (
          <button key={p.id} className={styles.assignResult} onClick={() => onPick(p)}>
            <span>{p.name}</span>
            <span className={styles.muted}>
              {[p.sku, p.category].filter(Boolean).join(' · ')}
            </span>
          </button>
        ))}
        {!loading && matches.length === 0 && <div className={styles.muted}>No products match.</div>}
      </div>
      <button className={styles.btnSecondary} onClick={onCancel}>Back</button>
    </div>
  );
}

// A code we've never seen. Rather than a dead end, it's an opportunity to
// teach the app what the box is — done once, then remembered forever.
function AssignBarcode({ code, onCancel, onAssigned }) {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/products', { params: { limit: 500 } })
      .then(r => setProducts(r.data.products || r.data || []))
      .catch(() => {});
  }, []);

  const matches = search.trim()
    ? products.filter(p => p.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 25)
    : products.slice(0, 25);

  async function assign(product) {
    setSaving(true); setError('');
    try {
      await api.post('/stock/barcodes', { product_id: product.id, code, source: 'supplier' });
      onAssigned(product);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save that barcode');
      setSaving(false);
    }
  }

  return (
    <div className={styles.assignBox}>
      <div className={styles.assignTitle}>New barcode</div>
      <div className={styles.confirmCode}>{code}</div>
      <p className={styles.assignHelp}>
        We haven't seen this one before. Pick the Price List product it belongs to and
        it'll be recognised from now on.
      </p>
      <input
        className={styles.input}
        placeholder="Search the price list…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        autoFocus
      />
      {error && <div className={styles.scanError}>{error}</div>}
      <div className={styles.assignResults}>
        {matches.map(p => (
          <button key={p.id} className={styles.assignResult} onClick={() => assign(p)} disabled={saving}>
            <span>{p.name}</span>
            {p.category && <span className={styles.muted}>{p.category}</span>}
          </button>
        ))}
        {matches.length === 0 && <div className={styles.muted}>No products match.</div>}
      </div>
      <button className={styles.btnSecondary} onClick={onCancel}>Cancel</button>
    </div>
  );
}
