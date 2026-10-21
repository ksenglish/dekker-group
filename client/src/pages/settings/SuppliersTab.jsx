import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import styles from './Settings.module.css';

// Who we buy from, and how to reach them.
//
// These details are what the Materials tab sends an order with: the address it
// goes to, the account number quoted on it, and the person to ring when the
// truck cannot find the gate. Several suppliers want the order at more than
// one address — a branch desk and a head-office account — so an order goes to
// every address held here, not just the first.
//
// The supplier's name is the join: it is matched to the name spelled on the
// product, ignoring case. Spelling it differently here makes a second supplier
// rather than editing the first, so the names already on the price list are
// offered when adding one.

const blank = {
  name: '', email: '', order_emails: '', account_ref: '',
  contact_name: '', phone: '', notes: '',
};

const toForm = s => ({
  name: s.name || '',
  email: s.email || '',
  order_emails: (s.order_emails || []).join('\n'),
  account_ref: s.account_ref || '',
  contact_name: s.contact_name || '',
  phone: s.phone || '',
  notes: s.notes || '',
});

export default function SuppliersTab() {
  const [rows, setRows] = useState([]);
  const [known, setKnown] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // supplier id, or 'new'
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const load = useCallback(async () => {
    try {
      const [{ data: suppliers }, { data: tax }] = await Promise.all([
        api.get('/products/supplier-contacts'),
        api.get('/products/taxonomy').catch(() => ({ data: {} })),
      ]);
      setRows(suppliers);
      setKnown(tax?.supplier || []);
    } catch {
      setError('Could not load the suppliers');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function startNew(name = '') {
    setEditing('new');
    setForm({ ...blank, name });
    setError('');
  }

  function startEdit(s) {
    setEditing(s.id);
    setForm(toForm(s));
    setError('');
  }

  async function save() {
    if (!form.name.trim()) return setError('Give the supplier a name');
    setBusy(true); setError('');
    try {
      // Sent as written, one address per line or separated by commas — the
      // server is what decides they are addresses.
      await api.put('/products/supplier-contacts', {
        ...form,
        name: form.name.trim(),
        order_emails: form.order_emails,
      });
      setEditing(null);
      setSaved(form.name.trim());
      setTimeout(() => setSaved(''), 2500);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save that');
    } finally { setBusy(false); }
  }

  async function remove(s) {
    if (!confirm(
      `Remove the contact details for ${s.name}?\n\n`
      + 'Products stay where they are and orders already sent keep their own record. '
      + 'Only the address, account number and contact details go.'
    )) return;
    try {
      await api.delete(`/products/supplier-contacts/${s.id}`);
      await load();
    } catch { setError('Could not remove that supplier'); }
  }

  if (loading) return <div className={styles.loading}>Loading…</div>;

  // On the price list but with nothing saved here, so an order to them would
  // have to have its address typed from memory every time.
  const haveNames = new Set(rows.map(r => r.name.toLowerCase()));
  const missing = known.filter(n => !haveNames.has(String(n).toLowerCase()));

  return (
    <div className={styles.section}>
      <div className={styles.pageHeader}>
        <div>
          <h2 className={styles.pageTitle}>Suppliers</h2>
          <p className={styles.pageSubtitle}>
            Where material orders are sent, and the account they are charged to.
          </p>
        </div>
        {editing === null && (
          <button className={styles.btnPrimary} onClick={() => startNew()}>+ Add a supplier</button>
        )}
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}
      {saved && <div className={styles.successMsg}>Saved {saved}</div>}

      {editing !== null && (
        <div className={styles.card} style={{ marginBottom: 18 }}>
          <div className={styles.cardHeader}>
            <strong>{editing === 'new' ? 'New supplier' : form.name}</strong>
          </div>
          <div className={styles.cardBody}>
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label>Supplier name</label>
                <input value={form.name} onChange={e => set('name', e.target.value)}
                  placeholder="e.g. Bunnings" disabled={editing !== 'new'} />
                {editing === 'new' && (
                  <span className={styles.hint}>
                    Spell it the way it is spelled on the products, so orders find it.
                  </span>
                )}
              </div>
              <div className={styles.field}>
                <label>Our account number</label>
                <input value={form.account_ref} onChange={e => set('account_ref', e.target.value)}
                  placeholder="e.g. DEK1042" />
                <span className={styles.hint}>Quoted on every order to them.</span>
              </div>

              <div className={styles.field}>
                <label>Order email</label>
                <input value={form.email} onChange={e => set('email', e.target.value)}
                  placeholder="orders@supplier.co.nz" />
                <span className={styles.hint}>Where an order is addressed.</span>
              </div>
              <div className={styles.field}>
                <label>Also email</label>
                <textarea rows={3} value={form.order_emails}
                  onChange={e => set('order_emails', e.target.value)}
                  placeholder={'branch@supplier.co.nz\naccounts@supplier.co.nz'} />
                <span className={styles.hint}>
                  One per line. Every order to this supplier goes to these as well.
                </span>
              </div>

              <div className={styles.field}>
                <label>Contact name</label>
                <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)}
                  placeholder="e.g. Tom at the trade desk" />
              </div>
              <div className={styles.field}>
                <label>Phone</label>
                <input value={form.phone} onChange={e => set('phone', e.target.value)} />
              </div>

              <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                <label>Notes</label>
                <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
                  placeholder="e.g. Cut-offs charged separately. Deliveries Tuesdays only." />
              </div>
            </div>

            <div className={styles.formActions} style={{ marginTop: 16 }}>
              <button className={styles.btnSecondary} onClick={() => setEditing(null)}>Cancel</button>
              <button className={styles.btnPrimary} onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save supplier'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rows.length === 0 && editing === null && (
        <p className={styles.hint}>
          No suppliers set up yet. Adding one means an order to them arrives filled in.
        </p>
      )}

      {rows.map(s => (
        <div key={s.id} className={styles.card} style={{ marginBottom: 10 }}>
          <div className={styles.cardBody}>
            <div className={styles.templateRow}>
              <div>
                <div className={styles.templateName}>{s.name}</div>
                <div className={styles.templateMeta}>
                  {s.account_ref ? `Account ${s.account_ref}` : 'No account number'}
                  {' · '}
                  {s.email || 'No order email'}
                  {s.order_emails?.length > 0 && ` + ${s.order_emails.length} more`}
                  {s.contact_name && ` · ${s.contact_name}`}
                  {s.phone && ` · ${s.phone}`}
                </div>
              </div>
              <div className={styles.tplActions}>
                <button className={styles.btnSmall} onClick={() => startEdit(s)}>Edit</button>
                <button className={styles.btnDanger} onClick={() => remove(s)}>Remove</button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {missing.length > 0 && (
        <>
          <h3 className={styles.subHeading}>On the price list, with no details saved</h3>
          <p className={styles.hint} style={{ marginBottom: 10 }}>
            Materials from these suppliers can be ordered, but the address has to be
            typed each time and no account number goes on the order.
          </p>
          <div className={styles.addFieldRow}>
            {missing.map(n => (
              <button key={n} className={styles.btnSmall} onClick={() => startNew(n)}>
                + {n}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
