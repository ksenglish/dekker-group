import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { isAdmin } from '../../lib/permissions';
import { formatJobNumber } from '../../lib/formatJobNumber';
import { htmlToText } from '../../lib/richText';
import ScanFlow from './ScanFlow';
import AddBarcodeFlow from './AddBarcodeFlow';
import LabelSheet from './LabelSheet';
import styles from './Stock.module.css';

const fmtQty = q => {
  const n = Number(q || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

const fmtDateTime = d => new Date(d).toLocaleString('en-NZ', {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
});

const fmtMoney = cents => (Number(cents || 0) / 100).toLocaleString('en-NZ', {
  style: 'currency', currency: 'NZD', minimumFractionDigits: 2,
});

const REASON_LABEL = {
  receive: 'Received', transfer: 'Moved', used_on_job: 'Used on job', adjust: 'Adjusted',
};

export default function StockPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const canManage = ['admin', 'office'].includes(user?.role);

  const [tab, setTab] = useState('levels');
  const [rows, setRows] = useState([]);
  const [locations, setLocations] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [scanMode, setScanMode] = useState(null); // 'receive' | 'transfer'
  // Teaching the app a barcode it has never seen. Admin only.
  const [addingBarcode, setAddingBarcode] = useState(false);
  const [labelsFor, setLabelsFor] = useState(null);
  // Moving something by hand rather than by scanning it. { from, product }
  // when opened off a row, or an empty object from the button in the header.
  const [moving, setMoving] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/stock'),
      api.get('/stock/locations'),
    ]).then(([s, l]) => {
      setRows(s.data);
      setLocations(l.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab !== 'movements') return;
    api.get('/stock/movements').then(r => setMovements(r.data)).catch(() => {});
  }, [tab]);

  const warehouse = locations.find(l => l.type === 'warehouse');
  const vans = locations.filter(l => l.type === 'van');

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      // Searchable too — somebody looking for "concrete" should find the row
      // whose name is a supplier code they have never seen.
      htmlToText(r.description || '').toLowerCase().includes(q) ||
      (r.category || '').toLowerCase().includes(q) ||
      (r.barcodes || []).some(b => b.code.toLowerCase().includes(q))
    );
  }, [rows, search]);

  const qtyAt = (row, locationId) => {
    const hit = (row.levels || []).find(l => l.location_id === locationId);
    return Number(hit?.quantity || 0);
  };

  async function handleAdjust(row, location) {
    const current = qtyAt(row, location.id);
    const entered = prompt(`Set ${row.name} at ${location.name} to:`, fmtQty(current));
    if (entered === null) return;
    const quantity = Number(entered);
    if (Number.isNaN(quantity)) { alert('That is not a number'); return; }
    try {
      await api.post('/stock/adjust', { product_id: row.id, location_id: location.id, quantity });
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not adjust');
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <Link to="/reports" className={styles.backLink}>← Reports</Link>
          <h1 className={styles.title}>Stock</h1>
          <p className={styles.subtitle}>
            What we hold in the warehouse and in each van. Scanning moves it.
          </p>
        </div>
        <div className={styles.headerActions}>
          {/* The one place an unrecognised barcode is the point. Admin only:
              everywhere else the camera ignores codes we do not hold, because
              a barcode filed against the wrong product stays wrong. */}
          {admin && (
            <button className={styles.btnSecondary} onClick={() => setAddingBarcode(true)}>
              + Add New Barcode
            </button>
          )}
          {/* Scanning is how stock normally moves. This is for the rest: a
              stocktake correction, a van swapped over, a tool handed from one
              crew to another with nothing to scan. Admin only, and it lands in
              Recent movements like any other move. */}
          {admin && (
            <button className={styles.btnSecondary} onClick={() => setMoving({})}>
              ⇄ Move stock
            </button>
          )}
          <button className={styles.btnSecondary} onClick={() => setScanMode('receive')}>
            Receive into warehouse
          </button>
          <button className={styles.btnPrimary} onClick={() => setScanMode('transfer')}>
            Load a van
          </button>
        </div>
      </div>

      <div className={styles.tabs}>
        {[
          ['levels', 'Stock levels'],
          ['tools', 'Tools'],
          ['warehouse', 'Warehouse'],
          ['vans', 'Vans'],
          ['movements', 'Recent movements'],
          ...(admin ? [['value', 'Value']] : []),
        ].map(([key, label]) => (
          <button
            key={key}
            className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : tab === 'levels' ? (
        <>
          <input
            className={styles.search}
            placeholder="Search by product, category or barcode…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          {visible.length === 0 ? (
            <div className={styles.empty}>
              {rows.length === 0
                ? 'Nothing is tracked yet. Assign a barcode to a product, or receive some stock in, and it will appear here.'
                : 'No products match that search.'}
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Description</th>
                    {warehouse && <th className={styles.num}>{warehouse.name}</th>}
                    {vans.map(v => <th key={v.id} className={styles.num}>{v.name}</th>)}
                    <th className={styles.num}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(row => (
                    <tr key={row.id}>
                      <td>
                        <div className={styles.productName}>{row.name}</div>
                        <div className={styles.productMeta}>
                          {row.category && <span>{row.category}</span>}
                          {(row.barcodes || []).length === 0
                            ? <span className={styles.noBarcode}>no barcode</span>
                            : (row.barcodes || []).map(b => (
                              <span key={b.code} className={styles.code}>{b.code}</span>
                            ))}
                        </div>
                      </td>
                      {/* Flattened: a product description can be rich text,
                          and a table row is no place for its markup. */}
                      <td className={styles.description}>
                        {htmlToText(row.description || '') || <span className={styles.muted}>—</span>}
                      </td>
                      {warehouse && (
                        <td className={styles.num}>
                          <QtyCell
                            value={qtyAt(row, warehouse.id)}
                            onClick={admin ? () => handleAdjust(row, warehouse) : undefined}
                          />
                        </td>
                      )}
                      {vans.map(v => (
                        <td key={v.id} className={styles.num}>
                          <QtyCell
                            value={qtyAt(row, v.id)}
                            onClick={admin ? () => handleAdjust(row, v) : undefined}
                          />
                        </td>
                      ))}
                      <td className={`${styles.num} ${styles.total}`}>{fmtQty(row.total_quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className={styles.footNote}>
            {admin
              ? 'Tap any quantity to correct it after a stocktake. '
              : 'Quantities change by scanning. Ask an admin if a count needs correcting. '}
            Negative figures mean more has been scanned out than was recorded in — worth a recount.
            {canManage && (
              <> <button className={styles.linkBtn} onClick={() => setLabelsFor(rows)}>Print labels</button></>
            )}
          </div>
        </>
      ) : tab === 'movements' ? (
        movements.length === 0 ? (
          <div className={styles.empty}>Nothing has moved yet.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>When</th><th>Product</th><th>Movement</th>
                  <th className={styles.num}>Qty</th><th>Who</th>
                </tr>
              </thead>
              <tbody>
                {movements.map(m => (
                  <tr key={m.id}>
                    <td className={styles.muted}>{fmtDateTime(m.created_at)}</td>
                    <td>{m.product_name}</td>
                    <td>
                      <span className={styles.reason}>{REASON_LABEL[m.reason] || m.reason}</span>
                      {' '}
                      <span className={styles.muted}>
                        {m.from_name && `from ${m.from_name}`}
                        {m.from_name && (m.to_name || m.job_id) ? ' ' : ''}
                        {m.to_name && `to ${m.to_name}`}
                        {m.job_id && (
                          <> to <Link to={`/jobs/${m.job_id}`}>{formatJobNumber(m) || 'job'}</Link></>
                        )}
                      </span>
                    </td>
                    <td className={styles.num}>{fmtQty(m.quantity)}</td>
                    <td className={styles.muted}>{m.user_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'tools' ? (
        <ToolsTab warehouse={warehouse} vans={vans} canSeeValue={admin} />
      ) : tab === 'warehouse' ? (
        <WarehouseTab
          warehouse={warehouse}
          canSeeValue={admin}
          onMove={admin ? row => setMoving({ from: warehouse.id, product: row }) : null}
        />
      ) : tab === 'value' ? (
        <ValueTab />
      ) : (
        <VansTab locations={locations} canManage={canManage} onChanged={load}
          onMove={admin ? (vanId, row) => setMoving({ from: vanId, product: row }) : null} />
      )}

      {scanMode && (
        <ScanFlow
          mode={scanMode}
          locations={locations}
          onClose={() => { setScanMode(null); load(); }}
        />
      )}

      {addingBarcode && (
        <AddBarcodeFlow
          onClose={() => setAddingBarcode(false)}
          onSaved={() => load()}
        />
      )}

      {labelsFor && <LabelSheet rows={labelsFor} onClose={() => { setLabelsFor(null); load(); }} />}

      {moving && (
        <MoveStock
          locations={locations}
          start={moving}
          onClose={() => setMoving(null)}
          onMoved={() => { setMoving(null); load(); }}
        />
      )}
    </div>
  );
}

// What is actually on the shelf.
//
// The Stock levels tab answers "where is this product"; this answers "what is
// in the warehouse", which is the question somebody standing in it is asking.
// Materials and tools are listed apart for the same reason they are counted
// apart — a shelf of consumables and a rack of drills are two different
// things to be short of.
function WarehouseTab({ warehouse, canSeeValue, onMove }) {
  const [items, setItems] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!warehouse) { setItems([]); return; }
    api.get(`/stock/locations/${warehouse.id}/stock`)
      .then(r => setItems(r.data))
      .catch(() => setItems([]));
  }, [warehouse]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!items) return [];
    if (!q) return items;
    return items.filter(i =>
      i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q));
  }, [items, search]);

  if (!warehouse) {
    return (
      <div className={styles.empty}>
        There is no warehouse set up yet. Add one under Vans — a location of type
        warehouse is where stock is received into.
      </div>
    );
  }
  if (items === null) return <div className={styles.loading}>Loading…</div>;

  const sum = rows => rows.reduce((t, i) => t + Number(i.value_cents || 0), 0);
  const units = rows => rows.reduce((t, i) => t + Number(i.quantity || 0), 0);
  const materials = visible.filter(i => i.stock_kind !== 'tool');
  const tools = visible.filter(i => i.stock_kind === 'tool');

  const section = (heading, rows, blurb) => rows.length === 0 ? null : (
    <div key={heading} style={{ marginBottom: 20 }}>
      <div className={styles.whSectionHead}>
        <h3 className={styles.whSectionTitle}>{heading}</h3>
        <span className={styles.whSectionHint}>{blurb}</span>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th className={styles.num}>On hand</th>
              {canSeeValue && <th className={styles.num}>Value at cost</th>}
              {onMove && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map(i => (
              <tr key={i.id}>
                <td><span className={styles.productName}>{i.name}</span></td>
                <td className={styles.muted}>{i.category || '—'}</td>
                <td className={styles.num}>
                  <QtyCell value={Number(i.quantity || 0)} /> <span className={styles.muted}>{i.unit || 'each'}</span>
                </td>
                {canSeeValue && <td className={styles.num}>{fmtMoney(i.value_cents)}</td>}
                {onMove && (
                  <td className={styles.num}>
                    <button className={styles.linkBtn} onClick={() => onMove(i)}>Move…</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className={styles.total}>
                {rows.length} product{rows.length === 1 ? '' : 's'}
              </td>
              <td className={`${styles.num} ${styles.total}`}>{fmtQty(units(rows))}</td>
              {canSeeValue && <td className={`${styles.num} ${styles.total}`}>{fmtMoney(sum(rows))}</td>}
              {onMove && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  return (
    <>
      {canSeeValue && (
        <div className={styles.valueTotal}>
          <div className={styles.valueTotalLabel}>In {warehouse.name}, at cost</div>
          <div className={styles.valueTotalFigure}>{fmtMoney(sum(visible))}</div>
        </div>
      )}

      <input
        className={styles.search}
        placeholder="Search the warehouse by product or category…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {items.length === 0 ? (
        <div className={styles.empty}>
          Nothing is recorded in {warehouse.name} yet. Receive a delivery in, or move
          something back off a van, and it will show here.
        </div>
      ) : visible.length === 0 ? (
        <div className={styles.empty}>Nothing in the warehouse matches that search.</div>
      ) : (
        <>
          {section('Materials', materials, 'Consumables — used up on a job and charged to it.')}
          {section('Tools', tools, 'Ours. They go out to a job and come back, and are never charged to one.')}
        </>
      )}

      <div className={styles.footNote}>
        {onMove
          ? 'Tap Move… on any line to send it to a van, or use ⇄ Move stock at the top. '
          : 'Stock moves by scanning. Ask an admin to move something by hand. '}
        Negative figures mean more has been scanned out than was recorded in — worth a recount.
      </div>
    </>
  );
}

// Moving something by hand.
//
// Scanning is how stock normally moves and it stays that way. This is for the
// rest of it — a van swapped over, a tool handed between crews, a stocktake
// that found four of something in the wrong place — and it writes the same
// movement a scan would, so Recent movements tells the whole story rather
// than most of it.
function MoveStock({ locations, start, onClose, onMoved }) {
  const places = locations.filter(l => l.is_active !== false);
  const [fromId, setFromId] = useState(start?.from || places[0]?.id || '');
  const [toId, setToId] = useState('');
  const [productId, setProductId] = useState(start?.product?.id || '');
  const [qty, setQty] = useState(start?.product ? '1' : '1');
  const [stock, setStock] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // What is actually at the place it is coming from. Picking from the whole
  // price list would offer four thousand things that are not there, and the
  // one number that matters — how many there are — would be missing.
  useEffect(() => {
    if (!fromId) { setStock([]); return; }
    setStock(null);
    api.get(`/stock/locations/${fromId}/stock`)
      .then(r => setStock(r.data))
      .catch(() => setStock([]));
  }, [fromId]);

  useEffect(() => {
    // Keep a pre-filled product only while it is still at the place chosen.
    if (!stock) return;
    if (productId && !stock.some(s => s.id === productId)) setProductId('');
  }, [stock, productId]);

  const picked = (stock || []).find(s => s.id === productId) || null;
  const available = Number(picked?.quantity || 0);
  const wanted = Number(qty);
  const destinations = places.filter(l => l.id !== fromId);

  async function submit(e) {
    e.preventDefault();
    if (!productId || !fromId || !toId) { setError('Pick what is moving, and where from and to.'); return; }
    if (!(wanted > 0)) { setError('Quantity must be more than zero.'); return; }
    setBusy(true); setError('');
    try {
      await api.post('/stock/transfer', {
        product_id: productId, from_location_id: fromId, to_location_id: toId, quantity: wanted,
      });
      onMoved();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not move that');
      setBusy(false);
    }
  }

  const nameOf = id => places.find(p => p.id === id)?.name || '';

  return (
    <div className={styles.overlay} onClick={onClose}>
      <form className={styles.movePanel} onClick={e => e.stopPropagation()} onSubmit={submit}>
        <div className={styles.movePanelHead}>
          <h2>Move stock</h2>
          <button type="button" className={styles.close} onClick={onClose}>✕</button>
        </div>

        <p className={styles.moveHint}>
          Recorded in Recent movements exactly as a scan would be, with your name on it.
        </p>

        <label className={styles.moveField}>
          <span>From</span>
          <select value={fromId} onChange={e => { setFromId(e.target.value); setError(''); }}>
            {places.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>

        <label className={styles.moveField}>
          <span>What is moving</span>
          {stock === null ? (
            <div className={styles.muted}>Loading what is there…</div>
          ) : stock.length === 0 ? (
            <div className={styles.muted}>Nothing is recorded at {nameOf(fromId)}.</div>
          ) : (
            <select value={productId} onChange={e => { setProductId(e.target.value); setError(''); }}>
              <option value="">Choose…</option>
              {stock.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} — {fmtQty(s.quantity)} {s.unit || 'each'}
                  {s.stock_kind === 'tool' ? ' (tool)' : ''}
                </option>
              ))}
            </select>
          )}
        </label>

        <label className={styles.moveField}>
          <span>To</span>
          <select value={toId} onChange={e => { setToId(e.target.value); setError(''); }}>
            <option value="">Choose…</option>
            {destinations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>

        <label className={styles.moveField}>
          <span>How many</span>
          <input type="number" min="0" step="0.01" value={qty}
            onChange={e => { setQty(e.target.value); setError(''); }} />
          {picked && (
            <span className={styles.moveNote}>
              {fmtQty(available)} {picked.unit || 'each'} at {nameOf(fromId)}
              {/* Allowed, because refusing it would only mean the move goes
                  unrecorded and the count drifts further — the same reason
                  scanning lets a figure go negative. Said out loud, though. */}
              {wanted > available && ` · moving ${fmtQty(wanted)} leaves it at ${fmtQty(available - wanted)}`}
            </span>
          )}
        </label>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.moveActions}>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.btnPrimary} disabled={busy || !productId || !toId}>
            {busy ? 'Moving…' : 'Move'}
          </button>
        </div>
      </form>
    </div>
  );
}

// The tool register: every tool, where it is, and what it is worth.
//
// Tools are not stock in the sense the other tab means it — they are not used
// up and never reach a job's costs — so they are counted here instead, in the
// same places, with a column for the ones that are out on a job. A tool that
// reads zero everywhere still appears: that is one nobody has counted yet, and
// hiding it is how it stays uncounted.
function ToolsTab({ warehouse, vans, canSeeValue }) {
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/stock/tools').then(r => setRows(r.data)).catch(() => setRows([]));
  }, []);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.category || '').toLowerCase().includes(q) ||
      htmlToText(r.description || '').toLowerCase().includes(q) ||
      (r.barcodes || []).some(b => b.code.toLowerCase().includes(q))
    );
  }, [rows, search]);

  if (!rows) return <div className={styles.loading}>Loading…</div>;

  const qtyAt = (row, locationId) =>
    Number((row.levels || []).find(l => l.location_id === locationId)?.quantity || 0);

  // Valued at cost, the same as stock — what we paid is what the tool is worth
  // on the books, and there is no sell price on a drill we are not selling.
  const valueOf = row =>
    (Number(row.held_quantity || 0) + Number(row.out_quantity || 0)) * Number(row.cost_price || 0);

  const totalValue = visible.reduce((t, r) => t + valueOf(r), 0);
  const valueAt = locationId => visible.reduce(
    (t, r) => t + qtyAt(r, locationId) * Number(r.cost_price || 0), 0);
  const outValue = visible.reduce(
    (t, r) => t + Number(r.out_quantity || 0) * Number(r.cost_price || 0), 0);
  const uncosted = visible.filter(r => !Number(r.cost_price)).length;

  if (rows.length === 0) {
    return (
      <div className={styles.empty}>
        Nothing is marked as a tool yet. Open a product on the Price List and set
        its Stock type to <strong>Tool</strong>, and it will be counted here instead
        of in stock.
      </div>
    );
  }

  return (
    <>
      {canSeeValue && (
        <div className={styles.valueTotal}>
          <div className={styles.valueTotalLabel}>Total tools on hand, at cost</div>
          <div className={styles.valueTotalFigure}>{fmtMoney(totalValue)}</div>
        </div>
      )}

      <input
        className={styles.search}
        placeholder="Search tools by name, category or barcode…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {visible.length === 0 ? (
        <div className={styles.empty}>No tools match that search.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tool</th>
                {warehouse && <th className={styles.num}>{warehouse.name}</th>}
                {vans.map(v => <th key={v.id} className={styles.num}>{v.name}</th>)}
                <th className={styles.num}>On jobs</th>
                <th className={styles.num}>Total</th>
                {canSeeValue && <th className={styles.num}>Value at cost</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map(row => (
                <tr key={row.id}>
                  <td>
                    <div className={styles.productName}>{row.name}</div>
                    <div className={styles.productMeta}>
                      {row.category && <span>{row.category}</span>}
                      {(row.on_jobs || []).map(j => (
                        <Link key={j.job_id} to={`/jobs/${j.job_id}`} className={styles.code}>
                          {j.job_number || j.external_ref || 'job'}
                          {Number(j.quantity) !== 1 ? ` ×${fmtQty(j.quantity)}` : ''}
                        </Link>
                      ))}
                    </div>
                  </td>
                  {warehouse && (
                    <td className={styles.num}><QtyCell value={qtyAt(row, warehouse.id)} /></td>
                  )}
                  {vans.map(v => (
                    <td key={v.id} className={styles.num}><QtyCell value={qtyAt(row, v.id)} /></td>
                  ))}
                  <td className={styles.num}><QtyCell value={Number(row.out_quantity || 0)} /></td>
                  <td className={`${styles.num} ${styles.total}`}>
                    {fmtQty(Number(row.held_quantity || 0) + Number(row.out_quantity || 0))}
                  </td>
                  {canSeeValue && (
                    <td className={`${styles.num} ${styles.total}`}>{fmtMoney(valueOf(row))}</td>
                  )}
                </tr>
              ))}
            </tbody>
            {canSeeValue && (
              <tfoot>
                <tr>
                  <td className={styles.total}>Value at cost</td>
                  {warehouse && <td className={`${styles.num} ${styles.total}`}>{fmtMoney(valueAt(warehouse.id))}</td>}
                  {vans.map(v => (
                    <td key={v.id} className={`${styles.num} ${styles.total}`}>{fmtMoney(valueAt(v.id))}</td>
                  ))}
                  <td className={`${styles.num} ${styles.total}`}>{fmtMoney(outValue)}</td>
                  <td />
                  <td className={`${styles.num} ${styles.total}`}>{fmtMoney(totalValue)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <div className={styles.footNote}>
        Tools move the same way stock does — scan them onto a van, or onto a job
        from the job&apos;s Tools tab — but they are never charged to the job.
        {uncosted > 0 && (
          <> {uncosted} tool{uncosted === 1 ? ' has' : 's have'} no cost price on the
            Price List, so {uncosted === 1 ? 'it counts' : 'they count'} as nothing in
            the figures above.</>
        )}
      </div>
    </>
  );
}

// Stock valued at what we paid for it. Sell price would inflate this by the
// margin, which is not what stock on hand is worth.
function ValueTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/stock/valuation')
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (!data) return <div className={styles.empty}>Could not load the valuation.</div>;

  const missing = data.locations.reduce((sum, l) => sum + Number(l.missing_cost_count || 0), 0);

  return (
    <>
      <div className={styles.valueTotal}>
        <div className={styles.valueTotalLabel}>Total stock on hand, at cost</div>
        <div className={styles.valueTotalFigure}>{fmtMoney(data.total_value_cents)}</div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Location</th>
              <th className={styles.num}>Units</th>
              {/* Split, because they are two questions. "The van holds $900 of
                  materials" and "the van holds $4,200 of tools" are both worth
                  knowing, and a single figure answers neither. */}
              <th className={styles.num}>Materials</th>
              <th className={styles.num}>Tools</th>
              <th className={styles.num}>Value at cost</th>
            </tr>
          </thead>
          <tbody>
            {data.locations.map(l => (
              <tr key={l.id}>
                <td>
                  <span className={styles.productName}>{l.name}</span>
                  {l.type === 'warehouse' && <span className={styles.chip} style={{ marginLeft: 8 }}>Warehouse</span>}
                </td>
                <td className={styles.num}>{fmtQty(l.unit_count)}</td>
                <td className={styles.num}>{fmtMoney(l.material_value_cents)}</td>
                <td className={styles.num}>{fmtMoney(l.tool_value_cents)}</td>
                <td className={`${styles.num} ${styles.total}`}>{fmtMoney(l.value_cents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className={styles.total}>All locations</td>
              <td />
              <td className={`${styles.num} ${styles.total}`}>{fmtMoney(data.total_material_value_cents)}</td>
              <td className={`${styles.num} ${styles.total}`}>{fmtMoney(data.total_tool_value_cents)}</td>
              <td className={`${styles.num} ${styles.total}`}>{fmtMoney(data.total_value_cents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {missing > 0 && (
        <div className={styles.footNote}>
          {missing} product{missing === 1 ? ' has' : 's have'} no cost price on the Price List, so
          {missing === 1 ? ' it counts' : ' they count'} as nothing here. The real figure is higher
          until {missing === 1 ? 'that is' : 'those are'} filled in.
        </div>
      )}
    </>
  );
}

function QtyCell({ value, onClick }) {
  const cls = value < 0 ? styles.qtyNegative : value === 0 ? styles.qtyZero : styles.qty;
  if (!onClick) return <span className={cls}>{fmtQty(value)}</span>;
  return (
    <button className={`${cls} ${styles.qtyBtn}`} onClick={onClick} title="Tap to correct">
      {fmtQty(value)}
    </button>
  );
}

function VansTab({ locations, canManage, onChanged, onMove }) {
  const [staff, setStaff] = useState([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);
  const [openStock, setOpenStock] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/users').then(r => setStaff(r.data.filter(u => u.is_active !== false))).catch(() => {});
  }, []);

  const vans = locations.filter(l => l.type === 'van');

  async function createVan(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.post('/stock/locations', { name: name.trim(), type: 'van' });
      setName(''); setAdding(false); onChanged();
    } catch (err) { alert(err.response?.data?.error || 'Could not add the van'); }
    finally { setSaving(false); }
  }

  async function saveAssignment(van, userIds) {
    try {
      await api.put(`/stock/locations/${van.id}`, { user_ids: userIds });
      setEditing(null); onChanged();
    } catch (err) { alert(err.response?.data?.error || 'Could not save'); }
  }

  return (
    <div>
      {vans.length === 0 && (
        <div className={styles.empty}>
          No vans set up yet. Add one so stock can be loaded onto it.
        </div>
      )}

      <div className={styles.vanList}>
        {vans.map(van => (
          <div key={van.id} className={styles.vanCard}>
            <div className={styles.vanRow}>
              <div>
                <div className={styles.vanName}>{van.name}</div>
                <div className={styles.vanUsers}>
                  {(van.users || []).length === 0
                    ? <span className={styles.muted}>Nobody assigned</span>
                    : van.users.map(u => <span key={u.id} className={styles.chip}>{u.name}</span>)}
                </div>
              </div>
              <div className={styles.vanActions}>
                <button
                  className={styles.btnSecondary}
                  onClick={() => setOpenStock(id => (id === van.id ? null : van.id))}
                >
                  {openStock === van.id ? 'Hide van stock' : 'Van stock'}
                </button>
                {canManage && editing !== van.id && (
                  <button className={styles.btnSecondary} onClick={() => setEditing(van.id)}>
                    Who drives it
                  </button>
                )}
              </div>
            </div>

            {canManage && editing === van.id && (
              <AssignEditor
                staff={staff}
                selected={(van.users || []).map(u => u.id)}
                onCancel={() => setEditing(null)}
                onSave={ids => saveAssignment(van, ids)}
              />
            )}

            {openStock === van.id && (
              <LocationStock locationId={van.id}
                onMove={onMove ? row => onMove(van.id, row) : null} />
            )}
          </div>
        ))}
      </div>

      {canManage && (
        adding ? (
          <form className={styles.addVan} onSubmit={createVan}>
            <input
              className={styles.input}
              placeholder="Van name, e.g. Van 1 — Hilux"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
            <button type="submit" className={styles.btnPrimary} disabled={saving || !name.trim()}>Add</button>
            <button type="button" className={styles.btnSecondary} onClick={() => setAdding(false)}>Cancel</button>
          </form>
        ) : (
          <button className={styles.btnPrimary} onClick={() => setAdding(true)}>+ Add a van</button>
        )
      )}
    </div>
  );
}

// What should be on the van right now — the list a tech checks against before
// heading out, rather than reading it off the wide grid.
function LocationStock({ locationId, onMove }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    let live = true;
    api.get(`/stock/locations/${locationId}/stock`)
      .then(r => { if (live) setItems(r.data); })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [locationId]);

  if (items === null) return <div className={styles.vanStockLoading}>Loading…</div>;
  if (items.length === 0) return <div className={styles.vanStockEmpty}>Nothing on this van.</div>;

  const totalUnits = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0);

  return (
    <div className={styles.vanStock}>
      <div className={styles.vanStockHeader}>
        <span>{items.length} product{items.length === 1 ? '' : 's'}</span>
        <span>{fmtQty(totalUnits)} units</span>
      </div>
      {items.map(i => (
        <div key={i.id} className={styles.vanStockRow}>
          <span className={styles.vanStockName}>
            {i.name}
            {i.category && <span className={styles.muted}> · {i.category}</span>}
          </span>
          <span className={`${styles.num} ${Number(i.quantity) < 0 ? styles.qtyNegative : ''}`}>
            {fmtQty(i.quantity)} {i.unit || 'each'}
            {/* Off the van and back to the warehouse, or across to another
                van — the move that has nothing to scan, because the thing is
                already in somebody's hand. */}
            {onMove && (
              <> <button className={styles.linkBtn} onClick={() => onMove(i)}>Move…</button></>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function AssignEditor({ staff, selected, onCancel, onSave }) {
  const [ids, setIds] = useState(selected);
  const toggle = id => setIds(v => v.includes(id) ? v.filter(x => x !== id) : [...v, id]);
  return (
    <div className={styles.assignEditor}>
      <div className={styles.assignList}>
        {staff.map(u => (
          <label key={u.id} className={`${styles.assignOption} ${ids.includes(u.id) ? styles.assignOn : ''}`}>
            <input type="checkbox" checked={ids.includes(u.id)} onChange={() => toggle(u.id)} />
            {u.name}
          </label>
        ))}
      </div>
      <div className={styles.assignButtons}>
        <button className={styles.btnPrimary} onClick={() => onSave(ids)}>Save</button>
        <button className={styles.btnSecondary} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
