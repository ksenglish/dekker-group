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
  const [jobs, setJobs] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('info');
  const [editMode, setEditMode] = useState(isNew);
  const [form, setForm] = useState(EMPTY_FORM);
  const [leadSources, setLeadSources] = useState([]);
  const [addingLeadSource, setAddingLeadSource] = useState(false);
  const [newLeadSource, setNewLeadSource] = useState('');
  const [contactSameAsName, setContactSameAsName] = useState(true);
  const [noteText, setNoteText] = useState('');
  const [addingSite, setAddingSite] = useState(false);
  const [newSite, setNewSite] = useState({ address: '', label: '' });

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
        const [notesRes, jobsRes, quotesRes, invoicesRes] = await Promise.all([
          api.get(`/customers/${id}/notes`),
          api.get('/jobs', { params: { customer: id, limit: 100 } }),
          api.get('/quotes', { params: { customer: id } }),
          api.get('/invoices', { params: { customer: id } }),
        ]);
        setNotes(notesRes.data || []);
        setJobs(jobsRes.data?.jobs || []);
        setQuotes(quotesRes.data || []);
        setInvoices(invoicesRes.data || []);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

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

  const TABS = [
    { key: 'info',     label: 'Information' },
    { key: 'notes',    label: 'Notes',    count: notes.length },
    { key: 'jobs',     label: 'Jobs',     count: jobs.length },
    { key: 'quotes',   label: 'Quotes',   count: quotes.length },
    { key: 'invoices', label: 'Invoices', count: invoices.length },
  ];

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  return (
    <div className={styles.customerDetailPage}>

      {/* Page heading */}
      <div className={styles.detailHeading}>
        <div>
          <div className={styles.detailBreadcrumb}>
            <Link to="/customers">Customers</Link>
            <span>›</span>
            <span>{isNew ? 'New Customer' : customer?.name}</span>
          </div>
          <h1 className={styles.detailTitle}>{isNew ? 'New Customer' : customer?.name}</h1>
        </div>
        {!isNew && (
          <div className={styles.headerActions}>
            {!editMode && tab === 'info' && (
              <button className={styles.btnSecondary} onClick={() => setEditMode(true)}>Edit</button>
            )}
            {user?.role === 'admin' && (
              <button className={styles.btnDanger} onClick={handleDelete}>Delete</button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      {!isNew && (
        <div className={styles.tabBar}>
          {TABS.map(t => (
            <button
              key={t.key}
              className={`${styles.tabBtn} ${tab === t.key ? styles.tabActive : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.count > 0 && <span className={styles.tabBadge}>{t.count}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Tab content */}
      <div className={styles.tabContent}>

        {/* ── INFORMATION ── */}
        {(tab === 'info' || isNew) && (
          <div className={styles.tabPanel}>
            {error && <div className={styles.errorBanner}>{error}</div>}

            {editMode || isNew ? (
              <div className={styles.formGrid}>
                <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                  <label>Customer Name *</label>
                  <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. John Smith" />
                </div>

                <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                  <label>Contact Name</label>
                  <div className={styles.checkboxRow}>
                    <input type="checkbox" id="contactSame" checked={contactSameAsName} onChange={e => setContactSameAsName(e.target.checked)} />
                    <label htmlFor="contactSame" className={styles.checkLabel}>Contact Name is the same as Customer Name</label>
                  </div>
                  {!contactSameAsName && (
                    <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="e.g. Jane Smith" style={{ marginTop: 6 }} />
                  )}
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <h3 className={styles.formSectionTitle}>Physical Address</h3>
                </div>

                <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                  <label>Find Address</label>
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

                <div className={styles.field}>
                  <label>City / Suburb</label>
                  <input value={form.address_city} onChange={e => set('address_city', e.target.value)} placeholder="e.g. Tauranga" />
                </div>
                <div className={styles.field}>
                  <label>Postcode</label>
                  <input value={form.address_postcode} onChange={e => set('address_postcode', e.target.value)} placeholder="e.g. 3110" />
                </div>
                <div className={styles.field}>
                  <label>Region</label>
                  <input value={form.address_region} onChange={e => set('address_region', e.target.value)} placeholder="e.g. Bay of Plenty" />
                </div>
                <div className={styles.field}>
                  <label>Country</label>
                  <input value={form.address_country} onChange={e => set('address_country', e.target.value)} placeholder="New Zealand" />
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <div className={styles.checkboxRow}>
                    <input type="checkbox" id="postalSame" defaultChecked readOnly />
                    <label htmlFor="postalSame" className={styles.checkLabel}>Postal Address is the same as Physical Address</label>
                  </div>
                </div>

                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />

                <div className={styles.field}>
                  <label>Email Address</label>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="e.g. john@example.com" />
                </div>
                <div className={styles.field}>
                  <label>Lead Source</label>
                  {addingLeadSource ? (
                    <div className={styles.addLeadSourceRow}>
                      <input autoFocus value={newLeadSource} onChange={e => setNewLeadSource(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleAddLeadSource(); if (e.key === 'Escape') setAddingLeadSource(false); }}
                        placeholder="e.g. Trade Show" />
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
                <div className={styles.field}>
                  <label>Mobile</label>
                  <input value={form.mobile} onChange={e => set('mobile', e.target.value)} placeholder="e.g. 021 123 4567" type="tel" />
                </div>
                <div className={styles.field}>
                  <label>Phone</label>
                  <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="e.g. 07 123 4567" type="tel" />
                </div>
                <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                  <label>Company</label>
                  <input value={form.company} onChange={e => set('company', e.target.value)} placeholder="e.g. Smith Industries" />
                </div>
              </div>
            ) : (
              <div className={styles.infoView}>
                <div className={styles.infoRow}><span>Customer Name</span><strong>{customer?.name}</strong></div>
                {customer?.contact_name && customer.contact_name !== customer.name && (
                  <div className={styles.infoRow}><span>Contact Name</span><strong>{customer.contact_name}</strong></div>
                )}
                {customer?.company && <div className={styles.infoRow}><span>Company</span><strong>{customer.company}</strong></div>}
                {fullAddress && <div className={styles.infoRow}><span>Address</span><strong>{fullAddress}</strong></div>}
                {customer?.email && <div className={styles.infoRow}><span>Email</span><strong><a href={`mailto:${customer.email}`}>{customer.email}</a></strong></div>}
                {customer?.mobile && <div className={styles.infoRow}><span>Mobile</span><strong><a href={`tel:${customer.mobile}`}>{customer.mobile}</a></strong></div>}
                {customer?.phone && <div className={styles.infoRow}><span>Phone</span><strong><a href={`tel:${customer.phone}`}>{customer.phone}</a></strong></div>}
                {customer?.lead_source && <div className={styles.infoRow}><span>Lead Source</span><strong>{customer.lead_source}</strong></div>}
              </div>
            )}
          </div>
        )}

        {/* ── NOTES ── */}
        {tab === 'notes' && (
          <div className={styles.tabPanel}>
            <div className={styles.noteInput}>
              <textarea rows={3} placeholder="Add a note…" value={noteText}
                onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleAddNote(); }} />
              <button className={styles.btnPrimary} onClick={handleAddNote} disabled={!noteText.trim()}>Add Note</button>
            </div>
            {notes.length === 0 && <p className={styles.emptyState}>No notes yet.</p>}
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

        {/* ── JOBS ── */}
        {tab === 'jobs' && (
          <div className={styles.tabPanel}>
            <div className={styles.tabToolbar}>
              <Link to={`/jobs/new?customer=${id}`} className={styles.btnPrimary}>+ New Job</Link>
            </div>
            {jobs.length === 0 && <p className={styles.emptyState}>No jobs for this customer yet.</p>}
            {jobs.map(job => (
              <Link key={job.id} to={`/jobs/${job.id}`} className={styles.listRow}>
                <div className={styles.listRowMain}>
                  <span className={styles.listRowTitle}>#{job.job_number} — {job.description || job.type || 'Job'}</span>
                  <span className={styles.statusPill} style={{
                    background: (STATUS_COLOURS[job.status] || '#64748b') + '20',
                    color: STATUS_COLOURS[job.status] || '#64748b',
                  }}>{job.status?.replace('_', ' ')}</span>
                </div>
                <div className={styles.listRowSub}>
                  {job.due_date && <span>{new Date(job.due_date).toLocaleDateString('en-NZ')}</span>}
                  {job.lead_tech_name && <span>{job.lead_tech_name}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* ── QUOTES ── */}
        {tab === 'quotes' && (
          <div className={styles.tabPanel}>
            <div className={styles.tabToolbar}>
              <Link to={`/quotes/new?customer=${id}`} className={styles.btnPrimary}>+ New Quote</Link>
            </div>
            {quotes.length === 0 && <p className={styles.emptyState}>No quotes for this customer yet.</p>}
            {quotes.map(q => (
              <Link key={q.id} to={`/quotes/${q.id}`} className={styles.listRow}>
                <div className={styles.listRowMain}>
                  <span className={styles.listRowTitle}>
                    {q.quote_number ? `Quote #${q.quote_number}` : `Quote ${q.id.slice(0,6).toUpperCase()}`}
                  </span>
                  <span className={styles.statusPill} style={{
                    background: q.status === 'accepted' ? '#dcfce7' : q.status === 'sent' ? '#dbeafe' : '#f1f5f9',
                    color:      q.status === 'accepted' ? '#16a34a' : q.status === 'sent' ? '#1d4ed8' : '#64748b',
                  }}>{q.status}</span>
                </div>
                <div className={styles.listRowSub}>
                  {q.total != null && <span>${(q.total / 100).toFixed(2)}</span>}
                  {q.created_at && <span>{new Date(q.created_at).toLocaleDateString('en-NZ')}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* ── INVOICES ── */}
        {tab === 'invoices' && (
          <div className={styles.tabPanel}>
            {invoices.length === 0 && <p className={styles.emptyState}>No invoices for this customer yet.</p>}
            {invoices.map(inv => (
              <Link key={inv.id} to={`/invoices/${inv.id}`} className={styles.listRow}>
                <div className={styles.listRowMain}>
                  <span className={styles.listRowTitle}>INV-{inv.id.slice(0,6).toUpperCase()}</span>
                  <span className={styles.statusPill} style={{
                    background: inv.status === 'paid' ? '#dcfce7' : inv.status === 'overdue' ? '#fee2e2' : '#fef9c3',
                    color:      inv.status === 'paid' ? '#16a34a' : inv.status === 'overdue' ? '#dc2626' : '#ca8a04',
                  }}>{inv.status}</span>
                </div>
                <div className={styles.listRowSub}>
                  {inv.total != null && <span>${(inv.total / 100).toFixed(2)}</span>}
                  {inv.created_at && <span>{new Date(inv.created_at).toLocaleDateString('en-NZ')}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Bottom action bar — always visible */}
      <div className={styles.bottomBar}>
        <button className={styles.btnSecondary} onClick={() => {
          if (editMode && !isNew) { setEditMode(false); }
          else { navigate('/customers'); }
        }}>
          {editMode && !isNew ? 'Cancel' : '← Back to Customers'}
        </button>
        {(editMode || isNew) && tab === 'info' && (
          <button className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Save & Continue' : 'Save Changes'}
          </button>
        )}
      </div>

      {/* Sites — shown inside info tab when not editing */}
      {tab === 'info' && !editMode && !isNew && (
        <div className={styles.sitesSection}>
          <div className={styles.sitesSectionHeader}>
            <h3>Site Addresses</h3>
            <button className={styles.btnSmall} onClick={() => setAddingSite(true)}>+ Add Site</button>
          </div>
          {customer?.sites?.length === 0 && !addingSite && (
            <p className={styles.emptyState}>No sites added yet.</p>
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
    </div>
  );
}
