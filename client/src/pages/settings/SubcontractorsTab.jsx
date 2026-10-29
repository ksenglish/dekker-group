import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import styles from './Settings.module.css';

// Who we pay to do work, as opposed to who we buy things from.
//
// This list is what tells the app which invoices are labour. A document from a
// name on here lands under Sub-Contractor Costs on the job, is totalled apart
// from materials, and its lines are kept off the price list — a sparky's
// "install 3 x downlights, 4 hrs" is a cost on one job and not a thing anybody
// can ever buy again.
//
// The name has to be the one their invoices actually arrive under, which is
// why the names already seen on documents are offered rather than left to be
// typed from memory. Getting that wrong is the only way to get this wrong.

const blank = {
  name: '', trade: '', contact_name: '', email: '', phone: '',
  gst_number: '', also_known_as: '', notes: '', is_active: true,
};

const toForm = s => ({
  name: s.name || '',
  trade: s.trade || '',
  contact_name: s.contact_name || '',
  email: s.email || '',
  phone: s.phone || '',
  gst_number: s.gst_number || '',
  also_known_as: (s.also_known_as || []).join('\n'),
  notes: s.notes || '',
  is_active: s.is_active !== false,
});

const money = cents => (Number(cents || 0) / 100).toLocaleString('en-NZ', {
  style: 'currency', currency: 'NZD', maximumFractionDigits: 0,
});

const when = d => (d
  ? new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  : null);

export default function SubcontractorsTab() {
  const [rows, setRows] = useState([]);
  const [seen, setSeen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // id, or 'new'
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const load = useCallback(async () => {
    try {
      const [{ data: list }, { data: names }] = await Promise.all([
        api.get('/subcontractors'),
        api.get('/subcontractors/seen').catch(() => ({ data: [] })),
      ]);
      setRows(list);
      setSeen(names);
    } catch {
      setError('Could not load the sub-contractors');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function startNew(name = '') {
    setError('');
    setForm({ ...blank, name });
    setEditing('new');
  }

  function startEdit(row) {
    setError('');
    setForm(toForm(row));
    setEditing(row.id);
  }

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Give them a name — the one their invoices come in under'); return; }
    setBusy(true); setError('');
    try {
      const payload = {
        ...form,
        also_known_as: form.also_known_as.split('\n').map(a => a.trim()).filter(Boolean),
      };
      const { data } = editing === 'new'
        ? await api.post('/subcontractors', payload)
        : await api.put(`/subcontractors/${editing}`, payload);
      setEditing(null);
      // Adding somebody who has been invoicing for two years moves all of it
      // at once, and that is worth saying rather than being discovered on a
      // job whose costs have quietly changed shape.
      const moved = data?.reclassified?.lines || 0;
      setSaved(moved > 0
        ? `— ${moved} existing cost line${moved === 1 ? '' : 's'} moved under Sub-Contractor Costs`
        : '');
      setTimeout(() => setSaved(''), 7000);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save that');
    } finally { setBusy(false); }
  }

  async function remove(row) {
    if (!confirm(
      `Remove ${row.name}?\n\nTheir invoices go back to counting as materials, `
      + 'and new ones from them would reach the price list again.'
    )) return;
    setBusy(true); setError('');
    try {
      await api.delete(`/subcontractors/${row.id}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove that');
    } finally { setBusy(false); }
  }

  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div className={styles.section}>
      <div className={styles.pageHeader}>
        <div>
          <h2 className={styles.pageTitle}>Sub-Contractors</h2>
          <p className={styles.pageSubtitle}>
            Invoices from anyone on this list are filed under Sub-Contractor Costs on the
            job, totalled apart from materials, and kept off the price list.
          </p>
        </div>
        {editing === null && (
          <button className={styles.btnPrimary} onClick={() => startNew()}>+ Add a sub-contractor</button>
        )}
      </div>

      {error && <div className={styles.errorBanner}>{error}</div>}
      {saved !== '' && <div className={styles.successMsg}>Saved {saved}</div>}

      {editing !== null && (
        <div className={styles.card} style={{ marginBottom: 18 }}>
          <div className={styles.cardHeader}>
            <strong>{editing === 'new' ? 'New sub-contractor' : form.name}</strong>
          </div>
          <div className={styles.cardBody}>
            <form onSubmit={save}>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Name on their invoices</label>
                  <input value={form.name} onChange={e => set('name', e.target.value)}
                    placeholder="e.g. Bay Electrical Ltd" list="subbie-seen" />
                  <datalist id="subbie-seen">
                    {seen.map(s => <option key={s.name} value={s.name} />)}
                  </datalist>
                  <span className={styles.hint}>
                    Has to match what the invoice says. The names already arriving on
                    documents are offered as you type.
                  </span>
                </div>
                <div className={styles.field}>
                  <label>Trade</label>
                  <input value={form.trade} onChange={e => set('trade', e.target.value)}
                    placeholder="e.g. Electrical" />
                </div>
                <div className={styles.field}>
                  <label>Contact</label>
                  <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)}
                    placeholder="Who you ring" />
                </div>
                <div className={styles.field}>
                  <label>Phone</label>
                  <input value={form.phone} onChange={e => set('phone', e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label>Email</label>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label>GST number</label>
                  <input value={form.gst_number} onChange={e => set('gst_number', e.target.value)}
                    placeholder="e.g. 24-882-403" />
                  <span className={styles.hint}>
                    Matched before the name — it is the one thing on an invoice that
                    identifies a business beyond argument.
                  </span>
                </div>
                <div className={styles.field}>
                  <label>Other names they invoice under</label>
                  <textarea rows={2} value={form.also_known_as}
                    onChange={e => set('also_known_as', e.target.value)}
                    placeholder={'One per line'} />
                  <span className={styles.hint}>
                    A one-man band bills as his own name one month and his company&apos;s the next.
                  </span>
                </div>
                <div className={styles.field}>
                  <label>Notes</label>
                  <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label>
                    <input type="checkbox" checked={form.is_active}
                      onChange={e => set('is_active', e.target.checked)} />
                    {' '}Still using them
                  </label>
                  <span className={styles.hint}>
                    Turn this off and their new invoices count as materials again. Nothing is lost.
                  </span>
                </div>
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.btnSecondary}
                  onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit" className={styles.btnPrimary} disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {rows.length === 0 && editing === null && (
        <div className={styles.cardBody}>
          <p className={styles.pageSubtitle}>
            Nobody on the list yet, so every invoice counts as materials.
          </p>
        </div>
      )}

      {rows.map(s => (
        <div key={s.id} className={styles.card} style={{ marginBottom: 10, opacity: s.is_active === false ? 0.6 : 1 }}>
          <div className={styles.cardBody}>
            <div className={styles.templateRow}>
              <div>
                <div className={styles.templateName}>
                  {s.name}{s.trade ? ` · ${s.trade}` : ''}
                  {s.is_active === false && ' · not in use'}
                </div>
                <div className={styles.templateMeta}>
                  {s.job_count > 0
                    ? `${s.job_count} job${s.job_count === 1 ? '' : 's'} · ${money(s.spend_cents)}`
                    : 'No invoices from them yet'}
                  {when(s.last_invoice) && ` · last ${when(s.last_invoice)}`}
                  {s.contact_name && ` · ${s.contact_name}`}
                  {s.phone && ` · ${s.phone}`}
                  {(s.also_known_as || []).length > 0 && ` · also ${s.also_known_as.join(', ')}`}
                </div>
              </div>
              <div className={styles.tplActions}>
                <button className={styles.btnSmall} onClick={() => startEdit(s)}>Edit</button>
                <button className={styles.btnDanger} onClick={() => remove(s)} disabled={busy}>Remove</button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* The quickest way in, and the one that cannot be spelled wrong: the
          names already arriving on invoices, one press each. */}
      {editing === null && seen.length > 0 && (
        <>
          <h3 className={styles.subHeading}>Names on invoices that are not sub-contractors</h3>
          <div className={styles.card}>
            <div className={styles.cardBody}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {seen.slice(0, 24).map(s => (
                  <button key={s.name} className={styles.btnSmall} onClick={() => startNew(s.name)}>
                    + {s.name} ({s.documents})
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
