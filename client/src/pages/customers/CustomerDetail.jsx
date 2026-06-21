import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import styles from './Customers.module.css';

const STATUS_COLOURS = {
  new: '#1e40af', quoted: '#7c3aed', scheduled: '#0891b2',
  in_progress: '#d97706', invoiced: '#9333ea', complete: '#16a34a', cancelled: '#6b7280',
};

const EMPTY_FORM = {
  name: '', contact_name: '', company: '', phone: '', mobile: '', email: '',
  lead_source: '',
  address_street: '', address_city: '', address_region: '', address_postcode: '',
  address_country: 'New Zealand',
};

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = id === 'new';

  const [customer, setCustomer] = useState(null);
  const [notes, setNotes] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [noteText, setNoteText] = useState('');
  const [addingSite, setAddingSite] = useState(false);
  const [newSite, setNewSite] = useState({ address: '', label: '' });
  const [editMode, setEditMode] = useState(isNew);
  const [form, setForm] = useState(EMPTY_FORM);
  const [leadSources, setLeadSources] = useState([]);
  const [addingLeadSource, setAddingLeadSource] = useState(false);
  const [newLeadSource, setNewLeadSource] = useState('');

  // Checkboxes: contact name same as customer name
  const [contactSameAsName, setContactSameAsName] = useState(true);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get('/customers/lead-sources').then(r => setLeadSources(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const { data } = await api.get(`/customers/${id}`);
        setCustomer(data);
        setForm({
          name:             data.name || '',
          contact_name:     data.contact_name || '',
          company:          data.company || '',
          phone:            data.phone || '',
          mobile:           data.mobile || '',
          email:            data.email || '',
          lead_source:      data.lead_source || '',
          address_street:   data.address_street || '',
          address_city:     data.address_city || '',
          address_region:   data.address_region || '',
          address_postcode: data.address_postcode || '',
          address_country:  data.address_country || 'New Zealand',
        });
        setContactSameAsName(!data.contact_name || data.contact_name === data.name);
        const [notesRes, quotesRes, invoicesRes, emailsRes] = await Promise.all([
          api.get(`/customers/${id}/notes`),
          api.get('/quotes', { params: { customer: id } }),
          api.get('/invoices', { params: { customer: id } }),
          api.get(`/customers/${id}/emails`).catch(() => ({ data: [] })),
        ]);
        setNotes(notesRes.data);
        setQuotes(quotesRes.data || []);
        setInvoices(invoicesRes.data || []);
        setEmails(emailsRes.data || []);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Keep contact_name in sync when checkbox is on
  useEffect(() => {
    if (contactSameAsName) set('contact_name', form.name);
  }, [contactSameAsName, form.name]);

  async function handleSave() {
    if (!form.name.trim()) { setError('Customer name is required'); return; }
    setSaving(true); setError('');
    const payload = { ...form, contact_name: contactSameAsName ? form.name : form.contact_name };
    try {
      if (isNew) {
        const { data } = await api.post('/customers', payload);
        navigate(`/customers/${data.id}`, { replace: true });
      } else {
        const { data } = await api.put(`/customers/${id}`, payload);
        setCustomer(c => ({ ...c, ...data }));
        setEditMode(false);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddLeadSource() {
    if (!newLeadSource.trim()) return;
    const { data } = await api.post('/customers/lead-sources', { name: newLeadSource.trim() });
    setLeadSources(data);
    set('lead_source', newLeadSource.trim());
    setNewLeadSource('');
    setAddingLeadSource(false);
  }

  async function handleDelete() {
    if (!confirm(`Delete ${customer.name}? This cannot be undone.`)) return;
    await api.delete(`/customers/${id}`);
    navigate('/customers');
  }

  async function handleAddNote() {
    if (!noteText.trim()) return;
    const { data } = await api.post(`/customers/${id}/notes`, { content: noteText });
    setNotes(n => [data, ...n]);
    setNoteText('');
  }

  async function handleDeleteNote(noteId) {
    await api.delete(`/customers/${id}/notes/${noteId}`);
    setNotes(n => n.filter(x => x.id !== noteId));
  }

  async function handleAddSite() {
    if (!newSite.address.trim()) return;
    const { data } = await api.post(`/customers/${id}/sites`, newSite);
    setCustomer(c => ({ ...c, sites: [...(c.sites || []), data] }));
    setNewSite({ address: '', label: '' });
    setAddingSite(false);
  }

  async function handleDeleteSite(siteId) {
    await api.delete(`/customers/${id}/sites/${siteId}`);
    setCustomer(c => ({ ...c, sites: c.sites.filter(s => s.id !== siteId) }));
  }

  const fullAddress = [
    customer?.address_street, customer?.address_city,
    customer?.address_region, customer?.address_postcode,
  ].filter(Boolean).join(', ');

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.breadcrumb}>
          <Link to="/customers">Customers</Link>
          <span>›</span>
          <span>{isNew ? 'New Customer' : customer?.name}</span>
        </div>
        {!isNew && !editMode && (
          <div className={styles.headerActions}>
            <button className={styles.btnSecondary} onClick={() => setEditMode(true)}>Edit</button>
            {user?.role === 'admin' && (
              <button className={styles.btnDanger} onClick={handleDelete}>Delete</button>
            )}
          </div>
        )}
      </div>

      <div className={styles.detailLayout}>
        <div className={styles.detailMain}>
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2>{isNew ? 'New Customer' : 'Customer Details'}</h2>
            </div>

            {editMode ? (
              <div className={styles.form}>
                {error && <div className={styles.errorBanner}>{error}</div>}

                <div className={styles.formGrid}>
                  {/* Customer Name */}
                  <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                    <label>Customer Name *</label>
                    <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. John Smith" />
                  </div>

                  {/* Street Address autocomplete */}
                  <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                    <label>Street Address</label>
                    <AddressAutocomplete
                      value={form.address_street}
                      onChange={v => set('address_street', v)}
                      onSelect={({ street, city, region, postcode, country }) => setForm(f => ({
                        ...f,
                        address_street:   street,
                        address_city:     city     || f.address_city,
                        address_region:   region   || f.address_region,
                        address_postcode: postcode || f.address_postcode,
                        address_country:  country  || f.address_country,
                      }))}
                      placeholder="Start typing an address…"
                    />
                  </div>

                  {/* City / Postcode */}
                  <div className={styles.field}>
                    <label>City / Suburb</label>
                    <input value={form.address_city} onChange={e => set('address_city', e.target.value)} placeholder="e.g. Tauranga" />
                  </div>
                  <div className={styles.field}>
                    <label>Postcode</label>
                    <input value={form.address_postcode} onChange={e => set('address_postcode', e.target.value)} placeholder="e.g. 3110" />
                  </div>

                  {/* Region / Country */}
                  <div className={styles.field}>
                    <label>Region</label>
                    <input value={form.address_region} onChange={e => set('address_region', e.target.value)} placeholder="e.g. Bay of Plenty" />
                  </div>
                  <div className={styles.field}>
                    <label>Country</label>
                    <input value={form.address_country} onChange={e => set('address_country', e.target.value)} placeholder="New Zealand" />
                  </div>

                  {/* Postal same as physical */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div className={styles.checkboxRow}>
                      <input type="checkbox" id="postalSame" defaultChecked readOnly />
                      <label htmlFor="postalSame" className={styles.checkLabel}>Postal address is the same as physical address</label>
                    </div>
                  </div>

                  <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />

                  {/* Contact Name */}
                  <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                    <label>Contact Name</label>
                    <div className={styles.checkboxRow}>
                      <input type="checkbox" id="contactSame" checked={contactSameAsName} onChange={e => setContactSameAsName(e.target.checked)} />
                      <label htmlFor="contactSame" className={styles.checkLabel}>Same as Customer Name</label>
                    </div>
                    {!contactSameAsName && (
                      <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="e.g. Jane Smith" style={{ marginTop: 6 }} />
                    )}
                  </div>

                  {/* Mobile / Phone */}
                  <div className={styles.field}>
                    <label>Mobile</label>
                    <input value={form.mobile} onChange={e => set('mobile', e.target.value)} placeholder="e.g. 021 123 4567" type="tel" />
                  </div>
                  <div className={styles.field}>
                    <label>Phone</label>
                    <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="e.g. 07 123 4567" type="tel" />
                  </div>

                  {/* Email */}
                  <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                    <label>Email</label>
                    <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="e.g. john@example.com" />
                  </div>

                  {/* Lead Source with Add New */}
                  <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                    <label>Lead Source</label>
                    {addingLeadSource ? (
                      <div className={styles.addLeadSourceRow}>
                        <input
                          autoFocus
                          value={newLeadSource}
                          onChange={e => setNewLeadSource(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleAddLeadSource(); if (e.key === 'Escape') setAddingLeadSource(false); }}
                          placeholder="e.g. Trade Show"
                        />
                        <button className={styles.btnPrimary} onClick={handleAddLeadSource}>Add</button>
                        <button className={styles.btnSecondary} onClick={() => { setAddingLeadSource(false); setNewLeadSource(''); }}>Cancel</button>
                      </div>
                    ) : (
                      <div className={styles.leadSourceRow}>
                        <select value={form.lead_source} onChange={e => set('lead_source', e.target.value)}>
                          <option value="">— Select —</option>
                          {leadSources.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <button className={styles.btnAddSource} onClick={() => setAddingLeadSource(true)}>+ New</button>
                      </div>
                    )}
                  </div>

                  {/* Company — bottom */}
                  <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />
                  <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                    <label>Company</label>
                    <input value={form.company} onChange={e => set('company', e.target.value)} placeholder="e.g. Smith Industries" />
                  </div>
                </div>

                <div className={styles.formActions}>
                  {!isNew && <button className={styles.btnSecondary} onClick={() => setEditMode(false)}>Cancel</button>}
                  <button className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving…' : isNew ? 'Create Customer' : 'Save Changes'}
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.detailGrid}>
                <div className={styles.detailItem}><span>Customer Name</span><strong>{customer?.name}</strong></div>
                {customer?.contact_name && customer.contact_name !== customer.name && (
                  <div className={styles.detailItem}><span>Contact Name</span><strong>{customer.contact_name}</strong></div>
                )}
                {fullAddress && <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}><span>Address</span><strong>{fullAddress}</strong></div>}
                {customer?.mobile && <div className={styles.detailItem}><span>Mobile</span><strong><a href={`tel:${customer.mobile}`}>{customer.mobile}</a></strong></div>}
                {customer?.phone && <div className={styles.detailItem}><span>Phone</span><strong><a href={`tel:${customer.phone}`}>{customer.phone}</a></strong></div>}
                {customer?.email && <div className={styles.detailItem}><span>Email</span><strong><a href={`mailto:${customer.email}`}>{customer.email}</a></strong></div>}
                {customer?.lead_source && <div className={styles.detailItem}><span>Lead Source</span><strong>{customer.lead_source}</strong></div>}
                {customer?.company && <div className={styles.detailItem}><span>Company</span><strong>{customer.company}</strong></div>}
              </div>
            )}
          </div>

          {/* Sites */}
          {!isNew && (
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Site Addresses</h2>
                <button className={styles.btnSmall} onClick={() => setAddingSite(true)}>+ Add Site</button>
              </div>
              {customer?.sites?.length === 0 && !addingSite && (
                <p className={styles.emptySmall}>No sites added yet.</p>
              )}
              {customer?.sites?.map(site => (
                <div key={site.id} className={styles.siteRow}>
                  <div>
                    <div className={styles.siteAddress}>{site.address}</div>
                    {site.label && <div className={styles.siteLabel}>{site.label}</div>}
                  </div>
                  <button className={styles.deleteBtn} onClick={() => handleDeleteSite(site.id)}>✕</button>
                </div>
              ))}
              {addingSite && (
                <div className={styles.addSiteForm}>
                  <input placeholder="Street address" value={newSite.address} onChange={e => setNewSite(s => ({ ...s, address: e.target.value }))} />
                  <input placeholder="Label (e.g. Main Office, Site B)" value={newSite.label} onChange={e => setNewSite(s => ({ ...s, label: e.target.value }))} />
                  <div className={styles.formActions}>
                    <button className={styles.btnSecondary} onClick={() => setAddingSite(false)}>Cancel</button>
                    <button className={styles.btnPrimary} onClick={handleAddSite}>Add Site</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {!isNew && (
            <div className={styles.card}>
              <div className={styles.cardHeader}><h2>Notes</h2></div>
              <div className={styles.noteInput}>
                <textarea rows={3} placeholder="Add a note…" value={noteText} onChange={e => setNoteText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleAddNote(); }} />
                <button className={styles.btnPrimary} onClick={handleAddNote} disabled={!noteText.trim()}>Add Note</button>
              </div>
              {notes.length === 0 && <p className={styles.emptySmall}>No notes yet.</p>}
              {notes.map(note => (
                <div key={note.id} className={styles.noteRow}>
                  <div className={styles.noteMeta}>
                    <strong>{note.author_name}</strong>
                    <span>{new Date(note.created_at).toLocaleString('en-NZ')}</span>
                  </div>
                  <p className={styles.noteContent}>{note.content}</p>
                  {(user?.role === 'admin' || user?.role === 'office') && (
                    <button className={styles.deleteBtn} onClick={() => handleDeleteNote(note.id)}>✕</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        {!isNew && (
          <div className={styles.detailSidebar}>
            {(quotes.length > 0 || invoices.length > 0) && (
              <div className={styles.card}>
                <div className={styles.cardHeader}><h2>Account Summary</h2></div>
                <div className={styles.detailGrid} style={{ padding: '12px 16px' }}>
                  <div className={styles.detailItem}><span>Total Jobs</span><strong>{customer?.recent_jobs?.length ?? 0}</strong></div>
                  <div className={styles.detailItem}><span>Quotes</span><strong>{quotes.length}</strong></div>
                  <div className={styles.detailItem}><span>Invoiced</span>
                    <strong>${(invoices.reduce((s, i) => s + (i.total || 0), 0) / 100).toFixed(2)}</strong>
                  </div>
                  <div className={styles.detailItem}><span>Outstanding</span>
                    <strong style={{ color: '#dc2626' }}>
                      ${(invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.total || 0), 0) / 100).toFixed(2)}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {customer?.recent_jobs?.length > 0 && (
              <div className={styles.card}>
                <div className={styles.cardHeader}><h2>Recent Jobs</h2></div>
                {customer.recent_jobs.map(job => (
                  <Link key={job.id} to={`/jobs/${job.id}`} className={styles.jobRow}>
                    <div className={styles.jobTop}>
                      <span className={styles.jobNumber}>#{job.job_number}</span>
                      <span className={styles.statusBadge} style={{ background: STATUS_COLOURS[job.status] + '20', color: STATUS_COLOURS[job.status] }}>
                        {job.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className={styles.jobDesc}>{job.description || job.type}</div>
                    {job.lead_tech_name && <div className={styles.jobTech}>{job.lead_tech_name}</div>}
                  </Link>
                ))}
                <Link to={`/jobs?customer=${id}`} className={styles.viewAllLink}>View all jobs →</Link>
              </div>
            )}

            {invoices.length > 0 && (
              <div className={styles.card}>
                <div className={styles.cardHeader}><h2>Invoices</h2></div>
                {invoices.slice(0, 5).map(inv => (
                  <Link key={inv.id} to={`/invoices/${inv.id}`} className={styles.jobRow}>
                    <div className={styles.jobTop}>
                      <span className={styles.jobNumber}>INV-{inv.id.slice(0,6).toUpperCase()}</span>
                      <span className={styles.statusBadge} style={{
                        background: inv.status === 'paid' ? '#dcfce7' : inv.status === 'overdue' ? '#fee2e2' : '#fef9c3',
                        color: inv.status === 'paid' ? '#16a34a' : inv.status === 'overdue' ? '#dc2626' : '#ca8a04'
                      }}>{inv.status}</span>
                    </div>
                    <div className={styles.jobDesc}>${(inv.total / 100).toFixed(2)} · {new Date(inv.created_at).toLocaleDateString('en-NZ')}</div>
                  </Link>
                ))}
                <Link to={`/invoices?customer=${id}`} className={styles.viewAllLink}>View all invoices →</Link>
              </div>
            )}

            {emails.length > 0 && (
              <div className={styles.card}>
                <div className={styles.cardHeader}><h2>Email History</h2></div>
                {emails.slice(0, 6).map(e => (
                  <div key={e.id} className={styles.jobRow} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, cursor: 'default' }}>
                    <div>
                      <div className={styles.jobTop}>
                        <span className={styles.statusBadge} style={{ background: '#f0fdf4', color: '#16a34a' }}>{e.type}</span>
                        {e.job_number && <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 4 }}>#{e.job_number}</span>}
                      </div>
                      <div className={styles.jobDesc}>{e.recipient}</div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {new Date(e.sent_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
