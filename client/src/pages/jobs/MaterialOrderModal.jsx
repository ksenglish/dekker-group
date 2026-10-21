import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { overlayClose } from '../../lib/overlayClose';
import styles from './Materials.module.css';

// Sending an order to a supplier: either something to pick up, or something to
// be dropped at site.
//
// Everything the supplier needs is already known — the job number, the site, who
// to ask for — so the form arrives filled in and the only thing that usually has
// to be typed is the date. The preview is built by the same code that builds the
// email, so what is shown is what is sent.

const qty = v => {
  const n = parseFloat(v) || 0;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
};

// "280 m" tells the supplier something. "280 each" does not — the number has
// already said it. Kept in step with the same list on the server, which is
// what the emailed order is built from.
const FILLER_UNITS = new Set(['each', 'ea', 'ea.', 'item', 'items', 'unit', 'units', 'pc', 'pcs', 'qty', 'no', 'no.']);
const unitWord = u => {
  const s = String(u || '').trim();
  return s && !FILLER_UNITS.has(s.toLowerCase()) ? s : '';
};

// Tomorrow, as a sensible default — almost nothing is wanted the same day.
const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA');
};

export default function OrderModal({ jobId, job, team = [], method, group, materialIds, onClose, onSent }) {
  const collect = method === 'collect';
  const items = group.items.filter(i => materialIds.includes(i.id));

  const [form, setForm] = useState({
    email_to: group.supplier_email || '',
    required_date: tomorrow(),
    deliver_to: job.site_address || '',
    contact_name: job.contact_name || '',
    contact_phone: job.contact_phone || '',
    instructions: '',
  });
  const [preview, setPreview] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saveEmail, setSaveEmail] = useState(!group.supplier_email);

  const [pickedPerson, setPickedPerson] = useState('');
  const alsoTo = (group.supplier_order_emails || [])
    .filter(e => e.toLowerCase() !== form.email_to.trim().toLowerCase());

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Picking someone fills both fields. The phone stays editable afterwards —
  // a second number for the day is a normal thing to want.
  function choosePerson(id) {
    setPickedPerson(id);
    const person = team.find(p => p.id === id);
    if (!person) return;
    setForm(f => ({ ...f, contact_name: person.name, contact_phone: person.phone || '' }));
  }

  // The preview comes from the server so it cannot drift from the email.
  useEffect(() => {
    let live = true;
    api.post(`/jobs/${jobId}/materials/order/preview`, {
      method, material_ids: materialIds,
      required_date: form.required_date, deliver_to: form.deliver_to,
      contact_name: form.contact_name, contact_phone: form.contact_phone,
      instructions: form.instructions,
    }).then(r => { if (live) setPreview(r.data); }).catch(() => {});
    return () => { live = false; };
  }, [jobId, method, materialIds, form.required_date, form.deliver_to,
      form.contact_name, form.contact_phone, form.instructions]);

  async function send() {
    if (!form.email_to.trim()) return setError('Where should this be emailed?');
    setBusy(true); setError('');
    try {
      // Remembering the address means the next order to this supplier is one
      // click shorter.
      if (saveEmail && group.supplier) {
        await api.put('/products/supplier-contacts', {
          name: group.supplier, email: form.email_to.trim(),
        }).catch(() => {});
      }
      const { data } = await api.post(`/jobs/${jobId}/materials/order`, {
        method, supplier: group.supplier, material_ids: materialIds, ...form,
      });
      if (!data.sent) {
        setError('The order was saved but the email did not go out. Check the address and try again.');
        setBusy(false);
        return;
      }
      await onSent();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not send that');
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalOverlay} {...overlayClose(onClose)}>
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <h2>{collect ? '🛒 Click & Collect' : '🚚 Arrange Delivery'}</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>

        <div className={styles.modalBody}>
          <p className={styles.modalIntro}>
            {items.length} item{items.length === 1 ? '' : 's'} from <strong>{group.supplier}</strong>
            {' '}for job <strong>{job.number}</strong>.
          </p>

          <div className={styles.formGrid}>
            <label className={styles.field}>
              Email the order to
              <input type="email" value={form.email_to} placeholder="orders@supplier.co.nz"
                onChange={e => set('email_to', e.target.value)} />
              {/* Set up in Settings → Suppliers. Said here so nobody adds an
                  address that is already going to get a copy. */}
              {alsoTo.length > 0 && (
                <span className={styles.alsoTo}>Also going to {alsoTo.join(', ')}</span>
              )}
            </label>
            <label className={styles.field}>
              {collect ? 'Collection date' : 'Delivery date'}
              <input type="date" value={form.required_date}
                onChange={e => set('required_date', e.target.value)} />
            </label>

            {!collect && (
              <label className={`${styles.field} ${styles.wide}`}>
                Deliver to
                <input value={form.deliver_to} onChange={e => set('deliver_to', e.target.value)} />
              </label>
            )}

            <label className={styles.field}>
              Site contact
              {/* The people on this job, so the name and the mobile arrive
                  together — the number is the point of the field, and nobody
                  wants to go and look it up on the Users screen. Still typable
                  for the customer's own site contact. */}
              {team.length > 0 && (
                <select className={styles.picker} value={pickedPerson}
                  onChange={e => choosePerson(e.target.value)}>
                  <option value="">Someone else…</option>
                  {team.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.phone ? '' : ' (no mobile saved)'}
                    </option>
                  ))}
                </select>
              )}
              <input value={form.contact_name} onChange={e => {
                setPickedPerson('');
                set('contact_name', e.target.value);
              }} />
            </label>
            <label className={styles.field}>
              Contact phone
              <input value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} />
            </label>

            <label className={`${styles.field} ${styles.wide}`}>
              Anything else they should know
              <textarea rows={2} value={form.instructions}
                placeholder={collect ? 'e.g. Ask for Tom at the trade desk' : 'e.g. Leave behind the gate, gravel drive'}
                onChange={e => set('instructions', e.target.value)} />
            </label>
          </div>

          {group.supplier && (
            <label className={styles.remember}>
              <input type="checkbox" checked={saveEmail} onChange={e => setSaveEmail(e.target.checked)} />
              Remember this address for {group.supplier}
            </label>
          )}

          <div className={styles.itemList}>
            <div className={`${styles.itemLine} ${styles.itemHead}`}>
              <span>Product</span>
              <span className={styles.qty}>Quantity</span>
            </div>
            {items.map(i => (
              <div key={i.id} className={styles.itemLine}>
                <span>
                  {i.sku && <span className={styles.sku}>{i.sku}</span>}
                  {i.description}
                </span>
                <span className={styles.qty}>
                  {qty(i.quantity)}
                  {unitWord(i.unit) && <span className={styles.qtyUnit}> {unitWord(i.unit)}</span>}
                </span>
              </div>
            ))}
          </div>

          <button className={styles.linkBtn} onClick={() => setShowPreview(p => !p)}>
            {showPreview ? 'Hide what they will get' : 'See what they will get'}
          </button>
          {showPreview && preview && (
            <div className={styles.preview}>
              <div className={styles.previewSubject}>{preview.subject}</div>
              <div className={styles.previewBody} dangerouslySetInnerHTML={{ __html: preview.html }} />
            </div>
          )}

          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.modalFoot}>
          <button className={styles.btnSmall} onClick={onClose}>Cancel</button>
          <button className={styles.btnSmallPrimary} onClick={send} disabled={busy || !items.length}>
            {busy ? 'Sending…' : collect ? 'Send the order' : 'Request the delivery'}
          </button>
        </div>
      </div>
    </div>
  );
}
