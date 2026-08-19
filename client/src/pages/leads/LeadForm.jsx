import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../../lib/api';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import DuplicateWarning from './DuplicateWarning';
import styles from './Leads.module.css';

// Deliberately mirrors the New Customer form field for field, in the same
// order, so there's one way to take down a name and contact details whichever
// screen you're on. Service Required and Message are the only additions —
// they're what makes it an enquiry rather than just a contact.
export const EMPTY_LEAD = {
  name: '', contact_name: '', company: '', phone: '', mobile: '', email: '',
  source: '',
  address_street: '', address_city: '', address_region: '', address_postcode: '',
  address_country: 'New Zealand',
  service_required: '', message: '',
};

export default function LeadForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  const [form, setForm] = useState(EMPTY_LEAD);
  const [sources, setSources] = useState([]);
  const [contactSameAsName, setContactSameAsName] = useState(true);
  const [dupes, setDupes] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get('/customers/lead-sources').then(r => setSources(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (isNew) return;
    api.get('/leads').then(r => {
      const lead = (r.data || []).find(l => l.id === id);
      if (!lead) { setError('Lead not found'); return; }
      setForm({
        name: lead.name || '', contact_name: lead.contact_name || '', company: lead.company || '',
        phone: lead.phone || '', mobile: lead.mobile || '', email: lead.email || '',
        source: lead.source || '',
        address_street: lead.address_street || '', address_city: lead.address_city || '',
        address_region: lead.address_region || '', address_postcode: lead.address_postcode || '',
        address_country: lead.address_country || 'New Zealand',
        service_required: lead.service_required || '', message: lead.message || '',
      });
      setContactSameAsName(!lead.contact_name || lead.contact_name === lead.name);
    }).catch(() => setError('Could not load this lead')).finally(() => setLoading(false));
  }, [id, isNew]);

  useEffect(() => {
    if (contactSameAsName) set('contact_name', form.name);
  }, [contactSameAsName, form.name]);

  // Checked as details are filled in, so a duplicate shows up while there's
  // still a chance to do something about it rather than after saving.
  useEffect(() => {
    const hasSomething = form.name.trim() || form.email.trim() || form.mobile.trim() || form.address_street.trim();
    if (!hasSomething) { setDupes(null); return; }
    const t = setTimeout(() => {
      api.post('/leads/check-duplicates', {
        name: form.name, email: form.email, mobile: form.mobile,
        phone: form.phone, address_street: form.address_street,
      }).then(r => setDupes(r.data)).catch(() => setDupes(null));
    }, 500);
    return () => clearTimeout(t);
  }, [form.name, form.email, form.mobile, form.phone, form.address_street]);

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.email.trim() && !form.phone.trim() && !form.mobile.trim()) {
      setError('Enter at least an email, mobile or phone number'); return;
    }
    setSaving(true); setError('');
    const payload = { ...form, contact_name: contactSameAsName ? form.name : form.contact_name };
    try {
      if (isNew) await api.post('/leads', payload);
      else await api.put(`/leads/${id}`, payload);
      window.dispatchEvent(new Event('leads-updated'));
      navigate('/leads');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save lead');
      setSaving(false);
    }
  }

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  return (
    <div className={styles.page}>
      <div className={styles.breadcrumb}>
        <Link to="/leads">New Leads</Link>
        <span>›</span>
        <span>{isNew ? 'New Lead' : form.name || 'Edit Lead'}</span>
      </div>

      <form onSubmit={save}>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>{isNew ? 'New Lead' : 'Edit Lead'}</h1>
        </div>

        {error && <div className={styles.formError}>{error}</div>}

        <DuplicateWarning dupes={dupes} />
        {dupes?.customers?.length > 0 && !isNew && (
          <p className={styles.dupeFoot}>
            Saving will keep this as a separate lead. Use Merge on the lead itself to attach it
            to an existing customer.
          </p>
        )}

        <div className={styles.card}>
          <div className={styles.cardBody}>
            <div className={styles.formGrid}>
              <div className={styles.formFieldWide}>
                <label>Customer Name *</label>
                <input value={form.name} onChange={e => set('name', e.target.value)}
                  placeholder="e.g. John Smith" autoFocus />
              </div>

              <div className={styles.formFieldWide}>
                <label>Contact Name</label>
                <div className={styles.checkRow}>
                  <input type="checkbox" id="leadContactSame" checked={contactSameAsName}
                    onChange={e => setContactSameAsName(e.target.checked)} />
                  <label htmlFor="leadContactSame" className={styles.checkLabel}>
                    Contact Name is the same as Customer Name
                  </label>
                </div>
                {!contactSameAsName && (
                  <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)}
                    placeholder="e.g. Jane Smith" style={{ marginTop: 6 }} />
                )}
              </div>

              <div className={styles.formFieldWide}>
                <label>Find Address</label>
                <AddressAutocomplete
                  value={form.address_street}
                  onChange={v => set('address_street', v)}
                  onSelect={({ street, city, region, postcode, country }) => setForm(f => ({
                    ...f,
                    address_street:   street   || f.address_street,
                    address_city:     city     || f.address_city,
                    address_region:   region   || f.address_region,
                    address_postcode: postcode || f.address_postcode,
                    address_country:  country  || f.address_country,
                  }))}
                />
              </div>

              <div className={styles.formField}>
                <label>City / Suburb</label>
                <input value={form.address_city} onChange={e => set('address_city', e.target.value)} placeholder="e.g. Tauranga" />
              </div>
              <div className={styles.formField}>
                <label>Postcode</label>
                <input value={form.address_postcode} onChange={e => set('address_postcode', e.target.value)} placeholder="e.g. 3110" />
              </div>
              <div className={styles.formField}>
                <label>Region</label>
                <input value={form.address_region} onChange={e => set('address_region', e.target.value)} placeholder="e.g. Bay of Plenty" />
              </div>
              <div className={styles.formField}>
                <label>Country</label>
                <input value={form.address_country} onChange={e => set('address_country', e.target.value)} />
              </div>

              <div className={styles.formField}>
                <label>Email Address</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="e.g. john@example.com" />
              </div>
              <div className={styles.formField}>
                <label>Lead Source</label>
                <input list="lead-form-sources" value={form.source} onChange={e => set('source', e.target.value)}
                  placeholder="e.g. Phone, Referral" />
                <datalist id="lead-form-sources">
                  {sources.map(s => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div className={styles.formField}>
                <label>Mobile</label>
                <input type="tel" value={form.mobile} onChange={e => set('mobile', e.target.value)} placeholder="e.g. 021 123 4567" />
              </div>
              <div className={styles.formField}>
                <label>Phone</label>
                <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="e.g. 07 123 4567" />
              </div>
              <div className={styles.formFieldWide}>
                <label>Company</label>
                <input value={form.company} onChange={e => set('company', e.target.value)} placeholder="e.g. Smith Industries" />
              </div>
            </div>
          </div>
        </div>

        {/* The enquiry itself — no equivalent on the customer form. */}
        <div className={styles.card} style={{ marginTop: 20 }}>
          <div className={styles.cardBody}>
            <div className={styles.formGrid}>
              <div className={styles.formFieldWide}>
                <label>Service Required</label>
                <input value={form.service_required} onChange={e => set('service_required', e.target.value)}
                  placeholder="e.g. Heat pump install" />
              </div>
              <div className={styles.formFieldWide}>
                <label>Message / Notes</label>
                <textarea rows={4} value={form.message} onChange={e => set('message', e.target.value)}
                  placeholder="What did the customer ask for?" />
              </div>
            </div>
          </div>
        </div>

        <div className={styles.formActions}>
          <button type="button" className={styles.btnSecondary} onClick={() => navigate('/leads')}>Cancel</button>
          <button type="submit" className={styles.btnPrimary} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Save Lead' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
