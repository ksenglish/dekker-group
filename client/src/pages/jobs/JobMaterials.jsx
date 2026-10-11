import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { isAdmin } from '../../lib/permissions';
import OrderModal from './MaterialOrderModal';
import styles from './Materials.module.css';

// What this job needs, grouped by who sells it.
//
// The list builds itself when a quote is accepted: a kit becomes its parts, a
// proposal becomes the products it was priced from, and labour lines are left
// out because nobody orders those. Anything missed gets typed in, and the list
// can be rebuilt from the quote without losing what was typed.
//
// No prices anywhere on this screen. It answers one question — what do I order,
// and from whom.

const STATUS = {
  needed:    { label: 'To order', cls: 'stNeeded' },
  ordered:   { label: 'Ordered',  cls: 'stOrdered' },
  received:  { label: 'Received', cls: 'stReceived' },
  cancelled: { label: 'Not needed', cls: 'stCancelled' },
};

const SOURCE_NOTE = {
  kit_component: 'from a kit',
  proposal_product: 'from a proposal',
  manual: 'added by hand',
};

const qty = v => {
  const n = parseFloat(v) || 0;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
};

const fmtWhen = d => (d ? new Date(d).toLocaleDateString('en-NZ', {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
}) : '');

function Row({ jobId, item, checked, onToggle, onChanged, canEdit }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ description: '', quantity: '', supplier: '', unit: '' });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.put(`/jobs/${jobId}/materials/${item.id}`, {
        description: f.description, quantity: parseFloat(f.quantity),
        supplier: f.supplier, unit: f.unit,
      });
      setEditing(false);
      await onChanged();
    } finally { setBusy(false); }
  }

  async function setStatus(status) {
    await api.put(`/jobs/${jobId}/materials/${item.id}`, { status });
    await onChanged();
  }

  async function remove() {
    if (!confirm(`Take "${item.description}" off the list?`)) return;
    await api.delete(`/jobs/${jobId}/materials/${item.id}`);
    await onChanged();
  }

  if (editing) {
    return (
      <div className={styles.editRow}>
        <input value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))} />
        <input type="number" step="0.001" min="0.001" value={f.quantity}
          onChange={e => setF(x => ({ ...x, quantity: e.target.value }))} />
        <input value={f.unit} placeholder="unit"
          onChange={e => setF(x => ({ ...x, unit: e.target.value }))} />
        <input value={f.supplier} placeholder="supplier"
          onChange={e => setF(x => ({ ...x, supplier: e.target.value }))} />
        <button className={styles.btnSmallPrimary} onClick={save} disabled={busy}>Save</button>
        <button className={styles.btnSmall} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    );
  }

  const st = STATUS[item.status] || STATUS.needed;
  return (
    <div className={`${styles.row} ${item.status !== 'needed' ? styles.rowDone : ''}`}>
      <input type="checkbox" checked={checked} disabled={item.status !== 'needed'}
        onChange={() => onToggle(item.id)}
        title={item.status === 'needed' ? 'Include in an order' : 'Already ordered'} />
      <span className={styles.what}>
        {item.description}
        {SOURCE_NOTE[item.source] && <em className={styles.src}>{SOURCE_NOTE[item.source]}</em>}
      </span>
      <span className={styles.qty}>{qty(item.quantity)}{item.unit ? ` ${item.unit}` : ''}</span>
      <span className={`${styles.status} ${styles[st.cls]}`}>{st.label}</span>
      {canEdit && (
        <span className={styles.rowActions}>
          {item.status === 'ordered' && (
            <button className={styles.linkBtn} onClick={() => setStatus('received')}>Received</button>
          )}
          <button className={styles.iconBtn} title="Correct this line"
            onClick={() => {
              setF({ description: item.description, quantity: String(qty(item.quantity)),
                     supplier: item.supplier || '', unit: item.unit || '' });
              setEditing(true);
            }}>✎</button>
          <button className={styles.iconBtn} title="Take it off the list" onClick={remove}>✕</button>
        </span>
      )}
    </div>
  );
}

export default function JobMaterials({ jobId, user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState([]);
  const [ordering, setOrdering] = useState(null);   // { method, group }
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ description: '', quantity: '1', unit: 'each', supplier: '' });
  const canEdit = true;      // the route is already office-and-up
  const canOrder = isAdmin(user?.role);

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get(`/jobs/${jobId}/materials`);
      setData(d);
      // Anything that has gone is no longer selectable.
      const live = new Set(d.groups.flatMap(g => g.items).map(i => i.id));
      setPicked(p => p.filter(id => live.has(id)));
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load the materials');
    } finally { setLoading(false); }
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  function toggle(id) {
    setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  }

  function toggleGroup(group) {
    const ids = group.items.filter(i => i.status === 'needed').map(i => i.id);
    const allOn = ids.every(id => picked.includes(id));
    setPicked(p => (allOn ? p.filter(id => !ids.includes(id)) : [...new Set([...p, ...ids])]));
  }

  async function regenerate() {
    setError('');
    try {
      const { data: r } = await api.post(`/jobs/${jobId}/materials/regenerate`);
      await load();
      if (!r.added) setError('Nothing new — the list already matches the accepted quote.');
    } catch (e) {
      setError(e.response?.data?.error || 'Could not rebuild the list');
    }
  }

  async function addMaterial(e) {
    e.preventDefault();
    if (!draft.description.trim()) return;
    try {
      await api.post(`/jobs/${jobId}/materials`, { ...draft, quantity: parseFloat(draft.quantity) || 1 });
      setDraft({ description: '', quantity: '1', unit: 'each', supplier: '' });
      setAdding(false);
      await load();
    } catch (e2) { setError(e2.response?.data?.error || 'Could not add that'); }
  }

  if (loading) return <div className={styles.empty}>Loading…</div>;
  if (!data) return <div className={styles.empty}>{error || 'Could not load the materials'}</div>;

  const toOrder = data.groups.flatMap(g => g.items).filter(i => i.status === 'needed').length;

  return (
    <div>
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {toOrder > 0 ? `${toOrder} still to order` : 'Everything is ordered'}
        </span>
        <span className={styles.spacer} />
        <button className={styles.btnSmall} onClick={() => setAdding(a => !a)}>+ Add a material</button>
        <button className={styles.btnSmall} onClick={regenerate}
          title="Rebuild from the accepted quote. Anything added by hand is kept.">
          ↻ Rebuild from the quote
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {adding && (
        <form className={styles.addRow} onSubmit={addMaterial}>
          <input autoFocus placeholder="What is it?" value={draft.description}
            onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
          <input type="number" step="0.001" min="0.001" value={draft.quantity}
            onChange={e => setDraft(d => ({ ...d, quantity: e.target.value }))} />
          <input placeholder="unit" value={draft.unit}
            onChange={e => setDraft(d => ({ ...d, unit: e.target.value }))} />
          <input placeholder="supplier" value={draft.supplier}
            onChange={e => setDraft(d => ({ ...d, supplier: e.target.value }))} />
          <button className={styles.btnSmallPrimary}>Add</button>
        </form>
      )}

      {data.groups.length === 0 && (
        <div className={styles.empty}>
          Nothing on the list yet. It fills in when a quote on this job is accepted —
          or add what you need by hand.
        </div>
      )}

      {data.groups.map(group => {
        const needed = group.items.filter(i => i.status === 'needed');
        const pickedHere = needed.filter(i => picked.includes(i.id)).length;
        return (
          <div key={group.supplier || 'none'} className={styles.group}>
            <div className={styles.groupHead}>
              <input type="checkbox" disabled={needed.length === 0}
                checked={needed.length > 0 && pickedHere === needed.length}
                onChange={() => toggleGroup(group)} />
              <span className={styles.supplier}>
                {group.supplier || 'No supplier set'}
                {group.supplier_account && <em className={styles.account}>acct {group.supplier_account}</em>}
              </span>
              <span className={styles.groupCount}>
                {group.items.length} item{group.items.length === 1 ? '' : 's'}
                {pickedHere > 0 && ` · ${pickedHere} picked`}
              </span>
              {canOrder && (
                <span className={styles.groupActions}>
                  <button className={styles.btnCollect} disabled={pickedHere === 0}
                    onClick={() => setOrdering({ method: 'collect', group })}>
                    🛒 Click &amp; Collect
                  </button>
                  <button className={styles.btnDeliver} disabled={pickedHere === 0}
                    onClick={() => setOrdering({ method: 'delivery', group })}>
                    🚚 Arrange Delivery
                  </button>
                </span>
              )}
            </div>
            {!group.supplier && (
              <p className={styles.noSupplier}>
                These have no supplier on the price list, so they cannot be ordered from here yet.
                Set one on the product, or edit the line below.
              </p>
            )}
            <div className={styles.rows}>
              {group.items.map(item => (
                <Row key={item.id} jobId={jobId} item={item}
                  checked={picked.includes(item.id)} onToggle={toggle}
                  onChanged={load} canEdit={canEdit} />
              ))}
            </div>
          </div>
        );
      })}

      {data.orders?.length > 0 && (
        <div className={styles.orders}>
          <h3>Orders sent</h3>
          {data.orders.map(o => (
            <div key={o.id} className={styles.order}>
              <span className={styles.orderRef}>{o.reference}</span>
              <span>{o.supplier}</span>
              <span className={styles.orderMethod}>
                {o.method === 'collect' ? 'Click & Collect' : 'Delivery'}
                {o.required_date && ` · ${new Date(`${String(o.required_date).slice(0, 10)}T12:00:00`)
                  .toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}`}
              </span>
              <span className={styles.orderCount}>{o.line_count} item{o.line_count === 1 ? '' : 's'}</span>
              <span className={o.status === 'sent' ? styles.orderSent : styles.orderFailed}>
                {o.status === 'sent' ? `sent ${fmtWhen(o.sent_at)}` : 'did not send'}
              </span>
            </div>
          ))}
        </div>
      )}

      {ordering && (
        <OrderModal
          jobId={jobId}
          job={data.job}
          method={ordering.method}
          group={ordering.group}
          materialIds={ordering.group.items.filter(i => picked.includes(i.id)).map(i => i.id)}
          onClose={() => setOrdering(null)}
          onSent={async () => { setOrdering(null); setPicked([]); await load(); }}
        />
      )}
    </div>
  );
}
