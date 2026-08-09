import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { isAdmin } from '../../lib/permissions';
import { formatJobNumber } from '../../lib/formatJobNumber';
import ScanFlow from './ScanFlow';
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
  const [labelsFor, setLabelsFor] = useState(null);

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
      ) : tab === 'value' ? (
        <ValueTab />
      ) : (
        <VansTab locations={locations} canManage={canManage} onChanged={load} />
      )}

      {scanMode && (
        <ScanFlow
          mode={scanMode}
          locations={locations}
          onClose={() => { setScanMode(null); load(); }}
        />
      )}

      {labelsFor && <LabelSheet rows={labelsFor} onClose={() => { setLabelsFor(null); load(); }} />}
    </div>
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
                <td className={`${styles.num} ${styles.total}`}>{fmtMoney(l.value_cents)}</td>
              </tr>
            ))}
          </tbody>
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

function VansTab({ locations, canManage, onChanged }) {
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

            {openStock === van.id && <LocationStock locationId={van.id} />}
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
function LocationStock({ locationId }) {
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
