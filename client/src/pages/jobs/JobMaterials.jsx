import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { isAdmin } from '../../lib/permissions';
import OrderModal from './MaterialOrderModal';
import { overlayClose } from '../../lib/overlayClose';
import ProductSearch from '../../components/products/ProductSearch';
import NewProductModal from '../../components/products/NewProductModal';
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

// One step back, for a button pressed by mistake. "Received" is the easy one
// to hit on a phone, and until now there was no way back off it.
const STEP_BACK = { received: 'ordered', ordered: 'needed', cancelled: 'needed' };

// Who is picking it up. A short list of the people already on this job, so
// the common case is one tap — and a way to take the name off again, since
// plans change on the morning more often than they change on paper.
function PickupModal({ jobId, team, items, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function assign(userId) {
    setBusy(true); setError('');
    try {
      await api.put(`/jobs/${jobId}/materials/pickup`, {
        material_ids: items.map(i => i.id), user_id: userId,
      });
      await onDone();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not set that');
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalOverlay} {...overlayClose(onClose)}>
      <div className={styles.modalSmall}>
        <div className={styles.modalHead}>
          <h2>👷 Team member to pick up</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.modalIntro}>
            Who is organising to pick up {items.length === 1
              ? <strong>{items[0].description}</strong>
              : <>these <strong>{items.length} items</strong></>}
            {' '}on the day? Nothing is emailed — the list just says who is seeing to it.
          </p>
          {team.length === 0 ? (
            <p className={styles.noSupplier}>
              Nobody is on this job yet. Put somebody on it in the Schedule tab and they will
              turn up here.
            </p>
          ) : (
            <div className={styles.pickupList}>
              {team.map(p => (
                <button key={p.id} className={styles.pickupChoice} disabled={busy}
                  onClick={() => assign(p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
          )}
          {error && <p className={styles.pickupError}>{error}</p>}
          <button className={styles.linkBtnQuiet} disabled={busy} onClick={() => assign(null)}>
            Take the name off these and put them back on the list
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ jobId, item, checked, onToggle, onChanged, canEdit, canUndo }) {
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
  // What has been arranged for this line, in the words a crew needs: who is
  // picking it up, or what was ordered and when. Said instead of "To order",
  // which answered none of the questions anybody standing on site has.
  // The order it was on is still on record, but a line put back to "to order"
  // is not arranged any more, whatever that record says. Left showing, it told
  // a crew a delivery was coming for something the office had just taken back
  // off the order.
  const arranged = (item.status !== 'needed' || item.pickup_user_id)
    ? item.arrangement : null;
  // A line somebody is picking up is not one to put on an order, so it does
  // not offer itself for one.
  const spokenFor = !!item.pickup_user_id;
  return (
    <div className={`${styles.row} ${item.status !== 'needed' ? styles.rowDone : ''}`}>
      <input type="checkbox" checked={checked}
        disabled={item.status !== 'needed' || spokenFor}
        onChange={() => onToggle(item.id)}
        title={spokenFor ? 'Somebody is picking this one up'
          : item.status === 'needed' ? 'Include in an order' : 'Already ordered'} />
      <span className={styles.what}>
        {item.description}
        {SOURCE_NOTE[item.source] && <em className={styles.src}>{SOURCE_NOTE[item.source]}</em>}
      </span>
      <span className={styles.qty}>{qty(item.quantity)}{item.unit ? ` ${item.unit}` : ''}</span>
      {arranged ? (
        <span className={`${styles.arranged} ${styles[`arr_${arranged.kind}`] || styles.stOrdered}`}
          title={st.label}>
          {arranged.text}
        </span>
      ) : (
        <span className={`${styles.status} ${styles[st.cls]}`}>{st.label}</span>
      )}
      {canEdit && (
        <span className={styles.rowActions}>
          {/* Picked up or delivered, it has arrived and the line is done. */}
          {(item.status === 'ordered' || spokenFor) && (
            <button className={styles.linkBtn} onClick={() => setStatus('received')}>
              {spokenFor ? 'Picked up' : 'Received'}
            </button>
          )}
          {spokenFor && item.status === 'needed' && (
            <button className={styles.linkBtnQuiet} title="Put it back on the list to be ordered"
              onClick={async () => {
                await api.put(`/jobs/${jobId}/materials/pickup`, {
                  material_ids: [item.id], user_id: null,
                });
                await onChanged();
              }}>↶ Undo</button>
          )}
          {canUndo && STEP_BACK[item.status] && (
            <button className={styles.linkBtnQuiet}
              title={`Put this back to "${STATUS[STEP_BACK[item.status]].label}"`}
              onClick={() => setStatus(STEP_BACK[item.status])}>↶ Undo</button>
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
  const [assigning, setAssigning] = useState(null); // the group a pickup is being set on
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ description: '', quantity: '1', unit: 'each', supplier: '', product_id: null });
  const [newProduct, setNewProduct] = useState(false);
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

  // The wrong method, the wrong supplier, the wrong job. The email is gone and
  // nothing here can call it back, so the confirmation says so plainly rather
  // than letting somebody think pressing this undoes the order at the supplier.
  async function undoOrder(o) {
    if (!confirm(
      `Undo ${o.reference} to ${o.supplier}?\n\n`
      + 'Its materials go back to "To order" so they can be ordered again, and the '
      + 'order is marked undone here.\n\n'
      + `The ${o.method === 'collect' ? 'collection' : 'delivery'} email has already been sent — `
      + 'you still need to tell them it is cancelled.'
    )) return;
    setError('');
    try {
      const { data: r } = await api.post(`/jobs/${jobId}/materials/orders/${o.id}/undo`);
      await load();
      if (!r.freed) {
        setError(`${o.reference} is marked undone. Nothing went back on the list — `
          + 'its materials had already been received or taken off.');
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Could not undo that order');
    }
  }

  async function addMaterial(e) {
    e.preventDefault();
    if (!draft.description.trim()) return;
    try {
      await api.post(`/jobs/${jobId}/materials`, { ...draft, quantity: parseFloat(draft.quantity) || 1 });
      setDraft({ description: '', quantity: '1', unit: 'each', supplier: '', product_id: null });
      setAdding(false);
      await load();
    } catch (e2) { setError(e2.response?.data?.error || 'Could not add that'); }
  }

  if (loading) return <div className={styles.empty}>Loading…</div>;
  if (!data) return <div className={styles.empty}>{error || 'Could not load the materials'}</div>;

  // A line is sorted once something has been arranged for it — ordered,
  // delivered, or somebody put down to pick it up. Counting "needed" alone
  // called a line still to order when a name was already against it.
  //
  // Undo is the way back, and it has to be, because it is what brings the
  // ordering buttons back to a supplier that has none left showing. So this
  // reads the two things undo actually changes — the status, and the name
  // against it — not the order record, which stays as a record of what was
  // sent whatever anybody does to the line afterwards.
  const waiting = i => i.status === 'needed' && !i.pickup_user_id;
  const toOrder = data.groups.flatMap(g => g.items).filter(waiting).length;

  return (
    <div>
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {/* "Everything is ordered" is only true if there was anything to
              order. On an empty list it read as reassurance that the job was
              taken care of, which is the opposite of what it meant. */}
          {data.groups.length === 0 ? 'Nothing on the list'
            : toOrder > 0 ? `${toOrder} still to sort out`
            : 'All sorted'}
        </span>
        <span className={styles.spacer} />
        <button className={styles.btnSmall} onClick={() => setAdding(a => !a)}>+ Add a material</button>
        {/* On an empty list this button appears again beside the sentence
            explaining why, which is where it belongs — two of them side by
            side is just the same thing twice. */}
        {data.groups.length > 0 && (
          <button className={styles.btnSmall} onClick={regenerate}
            title="Rebuild from the accepted quote. Anything added by hand is kept.">
            ↻ Rebuild from the quote
          </button>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* Added off the price list rather than typed from nothing.
          A line typed by hand has no supplier and no code, so it lands in the
          group that cannot be ordered and somebody has to go and fix it.
          Picking the product brings both with it. */}
      {adding && (
        <>
          <form className={styles.addRow} onSubmit={addMaterial}>
            <ProductSearch
              value={draft.description}
              placeholder="Search the price list, or type what it is…"
              onChange={p => setDraft(d => ({
                ...d,
                description: p.description,
                product_id: p.product_id ?? null,
                // Only a picked product fills these in. Typing over the top
                // clears the link, and clearing the supplier with it would
                // wipe one somebody had just typed.
                ...(p.product_id
                  ? { unit: p.unit || 'each', supplier: p.supplier || '' }
                  : {}),
              }))}
            />
            <input type="number" step="0.001" min="0.001" value={draft.quantity}
              onChange={e => setDraft(d => ({ ...d, quantity: e.target.value }))} />
            <input placeholder="unit" value={draft.unit}
              onChange={e => setDraft(d => ({ ...d, unit: e.target.value }))} />
            <input placeholder="supplier" value={draft.supplier}
              onChange={e => setDraft(d => ({ ...d, supplier: e.target.value, product_id: null }))} />
            <button className={styles.btnSmallPrimary}>Add</button>
          </form>
          {/* Matching nothing on the list. Most of these are things we buy
              again, so offer to put it there rather than leave another line
              nobody can order. */}
          {!draft.product_id && draft.description.trim() && (
            <button className={styles.addToList} onClick={() => setNewProduct(true)}>
              + Add “{draft.description.trim().slice(0, 48)}
              {draft.description.trim().length > 48 ? '…' : ''}” to the Price List
            </button>
          )}
        </>
      )}

      {newProduct && (
        <NewProductModal
          initialDescription={draft.description}
          initialSupplier={draft.supplier}
          onClose={() => setNewProduct(false)}
          onCreated={product => {
            setDraft(d => ({
              ...d,
              product_id: product.id,
              description: (product.description || '').trim() || product.name,
              unit: product.unit || d.unit,
              supplier: product.supplier || d.supplier,
            }));
            setNewProduct(false);
          }}
        />
      )}

      {data.groups.length === 0 && (
        <div className={styles.empty}>
          {/* The server works out which of several quite different reasons this
              is empty for. They look identical on screen otherwise, which is
              how an accepted quote with materials sitting on it reads exactly
              like a job nobody has quoted. */}
          {data.empty_because?.message || (
            <>Nothing on the list yet. It fills in when a quote on this job is accepted —
              or add what you need by hand.</>
          )}
          {data.empty_because?.rebuildable && (
            <div style={{ marginTop: 10 }}>
              <button className={styles.btnSmallPrimary} onClick={regenerate}>
                ↻ Rebuild from the quote
              </button>
            </div>
          )}
        </div>
      )}

      {data.groups.map(group => {
        const needed = group.items.filter(i => i.status === 'needed');
        const pickedHere = needed.filter(i => picked.includes(i.id)).length;
        // Nothing left under this supplier to arrange, so none of the ways of
        // arranging it are offered. A tab of buttons that cannot do anything
        // is a tab nobody can read at a glance, and the only honest answer to
        // "what is outstanding here" is nothing. Undoing a line puts them
        // back, because then there is something to arrange again.
        const allSorted = group.items.length > 0 && !group.items.some(waiting);
        return (
          <div key={group.supplier || 'none'} className={styles.group}>
            <div className={styles.groupHead}>
              <input type="checkbox" disabled={needed.length === 0 || allSorted}
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
              {/* Said once, instead of a row of buttons that can do nothing. */}
              {allSorted && <span className={styles.groupSorted}>✓ All sorted</span>}
              {canOrder && !allSorted && (
                <span className={styles.groupActions}>
                  <button className={styles.btnCollect} disabled={pickedHere === 0}
                    onClick={() => setOrdering({ method: 'collect', group })}>
                    🛒 Click &amp; Collect
                  </button>
                  <button className={styles.btnDeliver} disabled={pickedHere === 0}
                    onClick={() => setOrdering({ method: 'delivery', group })}>
                    🚚 Arrange Delivery
                  </button>
                  {/* In to our own yard rather than out to the job — what an
                      Auckland supplier gets, to be taken out later. Put
                      through as a delivery it told them to drop a pallet at
                      the customer's house. */}
                  <button className={styles.btnDepot} disabled={pickedHere === 0}
                    onClick={() => setOrdering({ method: 'depot', group })}>
                    🏭 Order from Supplier
                  </button>
                </span>
              )}
              {/* Outside the canOrder block on purpose. The things this is
                  for — top soil, metal, a load of bark — have no supplier on
                  the price list, so the group they land in is exactly the one
                  that shows none of the ordering buttons. */}
              {canEdit && !allSorted && (
                <span className={styles.groupActions}>
                  <button className={styles.btnPickup} disabled={pickedHere === 0}
                    onClick={() => setAssigning(group)}>
                    👷 Team member to pick up
                  </button>
                </span>
              )}
            </div>
            {!group.supplier && !allSorted && (
              <p className={styles.noSupplier}>
                These have no supplier on the price list, so they cannot be ordered from here yet.
                Set one on the product, or edit the line below.
              </p>
            )}
            <div className={styles.rows}>
              {/* Said once at the top rather than left to be worked out from
                  the numbers — a bare "4" beside a description could be a
                  quantity or anything else. */}
              <div className={styles.rowHead}>
                <span />
                <span>Material</span>
                <span>Qty</span>
                <span>Arranged</span>
                <span />
              </div>
              {group.items.map(item => (
                <Row key={item.id} jobId={jobId} item={item}
                  checked={picked.includes(item.id)} onToggle={toggle}
                  onChanged={load} canEdit={canEdit} canUndo={canOrder} />
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
                {o.method === 'collect' ? 'Click & Collect' : o.method === 'depot' ? 'Supplier order' : 'Delivery'}
                {o.required_date && ` · ${new Date(`${String(o.required_date).slice(0, 10)}T12:00:00`)
                  .toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}`}
              </span>
              <span className={styles.orderCount}>{o.line_count} item{o.line_count === 1 ? '' : 's'}</span>
              <span className={
                o.status === 'sent' ? styles.orderSent
                  : o.status === 'cancelled' ? styles.orderUndone : styles.orderFailed}>
                {o.status === 'sent' ? `sent ${fmtWhen(o.sent_at)}`
                  : o.status === 'cancelled' ? `undone ${fmtWhen(o.cancelled_at)}`
                  : 'did not send'}
              </span>
              {canOrder && o.status !== 'cancelled' && (
                <button className={styles.linkBtnQuiet} onClick={() => undoOrder(o)}
                  title="Put the record straight — this does not unsend the email">↶ Undo</button>
              )}
            </div>
          ))}
        </div>
      )}

      {ordering && (
        <OrderModal
          jobId={jobId}
          job={data.job}
          team={data.team || []}
          method={ordering.method}
          group={ordering.group}
          materialIds={ordering.group.items.filter(i => picked.includes(i.id)).map(i => i.id)}
          onClose={() => setOrdering(null)}
          onSent={async () => { setOrdering(null); setPicked([]); await load(); }}
        />
      )}

      {assigning && (
        <PickupModal
          jobId={jobId}
          team={data.team || []}
          items={assigning.items.filter(i => picked.includes(i.id))}
          onClose={() => setAssigning(null)}
          onDone={async () => { setAssigning(null); setPicked([]); await load(); }}
        />
      )}
    </div>
  );
}
