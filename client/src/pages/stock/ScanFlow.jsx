import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import BarcodeScanner from '../../components/BarcodeScanner';
import styles from './Stock.module.css';

// Drives what a scan actually does. Three modes:
//   receive  — goods arriving, into the warehouse
//   transfer — warehouse onto a van
//   use      — off a van and onto a job as a cost
//
// Scanning stays open after each item so a run of boxes can be done one after
// another, with a running tally of what's been counted.
export default function ScanFlow({ mode, locations, jobId, jobLabel, onClose, onUsed }) {
  const { user } = useAuth();
  const vans = locations.filter(l => l.type === 'van');
  const warehouse = locations.find(l => l.type === 'warehouse');

  // Default to the van this person is assigned to, so the common case is
  // no setup at all.
  const myVan = vans.find(v => (v.users || []).some(u => u.id === user?.id));
  const [vanId, setVanId] = useState(myVan?.id || vans[0]?.id || '');
  const [quantity, setQuantity] = useState(1);

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
      } else {
        if (!vanId) throw new Error('Pick a van first');
        const { data } = await api.post('/stock/use', {
          product_id: pending.id, from_location_id: vanId, job_id: jobId, quantity: qty,
        });
        onUsed?.(data);
      }
      setDone(d => [{ name: pending.name, qty, at: Date.now() }, ...d]);
      setPending(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not record that');
    } finally { setBusy(false); }
  }

  const destination =
    mode === 'receive' ? warehouse?.name
    : mode === 'transfer' ? (vans.find(v => v.id === vanId)?.name || 'a van')
    : jobLabel || 'this job';

  const title =
    mode === 'receive' ? 'Receive into warehouse'
    : mode === 'transfer' ? 'Load a van'
    : 'Add stock to this job';

  const hint =
    mode === 'receive' ? 'Scan each item as it comes off the delivery.'
    : mode === 'transfer' ? `Scanning moves stock out of the warehouse and onto ${destination}.`
    : `Scanning takes stock off ${vans.find(v => v.id === vanId)?.name || 'the van'} and adds it to the job's costs.`;

  // Exactly one of these is on screen at a time: the camera, or the panel
  // asking about the thing just scanned. Leaving the camera running behind the
  // confirmation would have it reading the same box again.
  const scanning = !pending && !unknown;
  const counted = done.reduce((sum, d) => sum + Number(d.qty || 0), 0);

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

      {(pending || unknown) && (
        <div className={styles.scanOverlay}>
          <div className={styles.scanPanel}>
            <div className={styles.scanHeader}>
              <h2>{title}</h2>
              <button className={styles.close} onClick={onClose}>✕</button>
            </div>

            {mode !== 'receive' && vans.length > 0 && (
              <div className={styles.scanField}>
                <label className={styles.label}>{mode === 'transfer' ? 'Onto which van' : 'From which van'}</label>
                <select className={styles.input} value={vanId} onChange={e => setVanId(e.target.value)}>
                  {vans.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.id === myVan?.id ? `${v.name} (yours)` : v.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {error && <div className={styles.scanError}>{error}</div>}

            {pending && (
              <div className={styles.confirmBox}>
                <div className={styles.confirmName}>{pending.name}</div>
                <div className={styles.confirmCode}>{pending.code}</div>
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
                    {busy ? 'Saving…' : `Add to ${destination}`}
                  </button>
                  <button className={styles.btnSecondary} onClick={() => setPending(null)} disabled={busy}>
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
