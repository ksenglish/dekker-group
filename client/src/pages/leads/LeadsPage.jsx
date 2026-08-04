import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './Leads.module.css';
import { overlayClose } from '../../lib/overlayClose';

const STATUSES = ['new', 'contacted', 'converted', 'dismissed'];
const STATUS_COLOURS = { new: '#1e40af', contacted: '#d97706', converted: '#16a34a', dismissed: '#6b7280' };
const STATUS_LABEL = { new: 'New', contacted: 'Contacted', converted: 'Converted', dismissed: 'Dismissed' };

const EMPTY_LEAD = {
  name: '', contact_name: '', company: '', email: '', mobile: '', phone: '',
  address_street: '', address_city: '', address_region: '', address_postcode: '',
  address_country: 'New Zealand', source: '', service_required: '', message: '',
};

// Rough but readable — these averages are decision aids, not billing figures.
function formatDuration(secs) {
  if (secs == null) return '—';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min`;
  const hours = secs / 3600;
  if (hours < 48) return `${hours.toFixed(1)} hr`;
  return `${(hours / 24).toFixed(1)} days`;
}

const fmtDateTime = d => new Date(d).toLocaleString('en-NZ', {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

// Tells the sidebar badge to recount after anything that changes lead status.
const announceChange = () => window.dispatchEvent(new Event('leads-updated'));

export default function LeadsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('new');
  const [selected, setSelected] = useState(null);
  const [converting, setConverting] = useState(false);
  const [stats, setStats] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(EMPTY_LEAD);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [sources, setSources] = useState([]);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function load() {
    api.get('/leads').then(r => setLeads(r.data)).catch(() => {}).finally(() => setLoading(false));
    api.get('/leads/stats').then(r => setStats(r.data)).catch(() => {});
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.get('/customers/lead-sources').then(r => setSources(r.data || [])).catch(() => {});
  }, []);

  async function createLead(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    if (!form.email.trim() && !form.phone.trim() && !form.mobile.trim()) {
      setFormError('Enter at least an email, mobile or phone number'); return;
    }
    setSaving(true); setFormError('');
    try {
      await api.post('/leads', form);
      setShowNew(false);
      setForm(EMPTY_LEAD);
      setFilter('new');
      load();
      announceChange();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save lead');
    } finally { setSaving(false); }
  }

  const counts = STATUSES.reduce((acc, s) => ({ ...acc, [s]: leads.filter(l => l.status === s).length }), {});
  const visible = filter ? leads.filter(l => l.status === filter) : leads;

  async function setStatus(lead, status) {
    const { data } = await api.patch(`/leads/${lead.id}/status`, { status });
    setLeads(ls => ls.map(l => l.id === lead.id ? data : l));
    setSelected(s => s && s.id === lead.id ? data : s);
    api.get('/leads/stats').then(r => setStats(r.data)).catch(() => {});
    announceChange();
  }

  async function convert(lead) {
    if (!confirm(`Create a customer from ${lead.name}?`)) return;
    setConverting(true);
    try {
      const { data } = await api.post(`/leads/${lead.id}/convert`);
      announceChange();
      navigate(`/customers/${data.customer_id}`);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to convert lead');
    } finally { setConverting(false); }
  }

  async function remove(lead) {
    if (!confirm(`Delete the lead from ${lead.name}? This cannot be undone.`)) return;
    await api.delete(`/leads/${lead.id}`);
    setLeads(ls => ls.filter(l => l.id !== lead.id));
    setSelected(null);
    api.get('/leads/stats').then(r => setStats(r.data)).catch(() => {});
    announceChange();
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>New Leads</h1>
          <p className={styles.pageSubtitle}>Website enquiries and manually entered leads</p>
        </div>
        <button className={styles.btnPrimary} onClick={() => { setForm(EMPTY_LEAD); setFormError(''); setShowNew(true); }}>
          + New Lead
        </button>
      </div>

      {stats && stats.total_count > 0 && (
        <div className={styles.statBar}>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{formatDuration(stats.avg_secs_to_result)}</span>
            <span className={styles.statLabel}>Avg time to first result</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{formatDuration(stats.avg_secs_to_convert)}</span>
            <span className={styles.statLabel}>Avg time to convert</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statValue}>
              {stats.conversion_rate == null ? '—' : `${Math.round(stats.conversion_rate * 100)}%`}
            </span>
            <span className={styles.statLabel}>Conversion rate</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{stats.website_count} / {stats.manual_count}</span>
            <span className={styles.statLabel}>Website / manual</span>
          </div>
        </div>
      )}

      <div className={styles.summaryGrid}>
        {STATUSES.map(s => (
          <button key={s} className={`${styles.summaryCard} ${filter === s ? styles.summaryCardActive : ''}`}
            onClick={() => setFilter(f => f === s ? '' : s)}>
            <span className={styles.summaryCount} style={{ color: STATUS_COLOURS[s] }}>{counts[s] || 0}</span>
            <span className={styles.summaryLabel}>{STATUS_LABEL[s]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : visible.length === 0 ? (
        <div className={styles.empty}>
          {filter ? `No ${STATUS_LABEL[filter].toLowerCase()} leads.` : 'No leads yet.'} New website enquiries will appear here automatically.
        </div>
      ) : (
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span>Received</span>
            <span>Name</span>
            <span>Contact</span>
            <span>Service</span>
            <span>Source</span>
            <span>Status</span>
          </div>
          {visible.map(lead => (
            <button key={lead.id} className={styles.tableRow} onClick={() => setSelected(lead)}>
              <span className={styles.muted}>{new Date(lead.created_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}</span>
              <span className={styles.leadName}>{lead.name}</span>
              <span className={styles.contactCell}>
                {lead.phone && <span>{lead.phone}</span>}
                {lead.email && <span className={styles.muted}>{lead.email}</span>}
              </span>
              <span>{lead.service_required || <span className={styles.muted}>—</span>}</span>
              <span className={styles.muted}>{lead.source || '—'}</span>
              <span>
                <span className={styles.badge} style={{ background: STATUS_COLOURS[lead.status] + '18', color: STATUS_COLOURS[lead.status] }}>
                  {STATUS_LABEL[lead.status]}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className={styles.overlay} {...overlayClose(() => setSelected(null))}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>{selected.name}</h2>
              <button className={styles.modalClose} onClick={() => setSelected(null)}>✕</button>
            </div>

            <div className={styles.pipeline}>
              {STATUSES.map(s => (
                <button key={s}
                  className={`${styles.pipelineBtn} ${selected.status === s ? styles.pipelineBtnActive : ''}`}
                  style={selected.status === s ? { borderColor: STATUS_COLOURS[s], color: STATUS_COLOURS[s], background: STATUS_COLOURS[s] + '12' } : {}}
                  onClick={() => setStatus(selected, s)}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>

            <div className={styles.detailList}>
              {selected.phone && <div className={styles.detailRow}><span>Phone</span><strong><a href={`tel:${selected.phone}`}>{selected.phone}</a></strong></div>}
              {selected.email && <div className={styles.detailRow}><span>Email</span><strong><a href={`mailto:${selected.email}`}>{selected.email}</a></strong></div>}
              {selected.address && <div className={styles.detailRow}><span>Address</span><strong>{selected.address}</strong></div>}
              {selected.service_required && <div className={styles.detailRow}><span>Service Required</span><strong>{selected.service_required}</strong></div>}
              {selected.source && <div className={styles.detailRow}><span>Source</span><strong>{selected.source}</strong></div>}
              <div className={styles.detailRow}>
                <span>Received</span>
                <strong>{fmtDateTime(selected.created_at)}{selected.entry_method === 'manual' ? ' (entered manually)' : ''}</strong>
              </div>
              {selected.resulted_at && (
                <div className={styles.detailRow}>
                  <span>First actioned</span>
                  <strong>
                    {fmtDateTime(selected.resulted_at)}
                    <span className={styles.muted}>
                      {' · '}{formatDuration((new Date(selected.resulted_at) - new Date(selected.created_at)) / 1000)} after arriving
                    </span>
                  </strong>
                </div>
              )}
              {selected.converted_at && (
                <div className={styles.detailRow}>
                  <span>Converted</span>
                  <strong>
                    {fmtDateTime(selected.converted_at)}
                    <span className={styles.muted}>
                      {' · '}{formatDuration((new Date(selected.converted_at) - new Date(selected.created_at)) / 1000)} after arriving
                    </span>
                  </strong>
                </div>
              )}
              {selected.dismissed_at && !selected.converted_at && (
                <div className={styles.detailRow}><span>Dismissed</span><strong>{fmtDateTime(selected.dismissed_at)}</strong></div>
              )}
              {selected.customer_name && <div className={styles.detailRow}><span>Customer</span><strong>{selected.customer_name}</strong></div>}
            </div>

            {selected.message && <div className={styles.messageBlock}>{selected.message}</div>}

            <div className={styles.modalFooter}>
              {user?.role === 'admin' && (
                <button className={styles.btnDanger} onClick={() => remove(selected)}>Delete</button>
              )}
              {!selected.customer_id ? (
                <button className={styles.btnPrimary} onClick={() => convert(selected)} disabled={converting}>
                  {converting ? 'Converting…' : '→ Convert to Customer'}
                </button>
              ) : (
                <button className={styles.btnSecondary} onClick={() => navigate(`/customers/${selected.customer_id}`)}>
                  View Customer
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <div className={styles.overlay} {...overlayClose(() => setShowNew(false))}>
          <form className={`${styles.modal} ${styles.modalWide}`} onSubmit={createLead}>
            <div className={styles.modalHeader}>
              <h2>New Lead</h2>
              <button type="button" className={styles.modalClose} onClick={() => setShowNew(false)}>✕</button>
            </div>

            <div className={styles.formBody}>
              {formError && <div className={styles.formError}>{formError}</div>}

              <div className={styles.formGrid}>
                <div className={styles.formFieldWide}>
                  <label>Customer Name *</label>
                  <input value={form.name} onChange={e => setField('name', e.target.value)} placeholder="e.g. John Smith" autoFocus />
                </div>
                <div className={styles.formField}>
                  <label>Contact Name</label>
                  <input value={form.contact_name} onChange={e => setField('contact_name', e.target.value)} placeholder="If different" />
                </div>
                <div className={styles.formField}>
                  <label>Company</label>
                  <input value={form.company} onChange={e => setField('company', e.target.value)} placeholder="e.g. Smith Industries" />
                </div>

                <div className={styles.formField}>
                  <label>Email Address</label>
                  <input type="email" value={form.email} onChange={e => setField('email', e.target.value)} placeholder="e.g. john@example.com" />
                </div>
                <div className={styles.formField}>
                  <label>Mobile</label>
                  <input type="tel" value={form.mobile} onChange={e => setField('mobile', e.target.value)} placeholder="e.g. 021 123 4567" />
                </div>
                <div className={styles.formField}>
                  <label>Phone</label>
                  <input type="tel" value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="e.g. 07 123 4567" />
                </div>
                <div className={styles.formField}>
                  <label>Lead Source</label>
                  <input list="lead-sources" value={form.source} onChange={e => setField('source', e.target.value)} placeholder="e.g. Phone, Referral" />
                  <datalist id="lead-sources">
                    {sources.map(s => <option key={s} value={s} />)}
                  </datalist>
                </div>

                <div className={styles.formFieldWide}>
                  <label>Street Address</label>
                  <input value={form.address_street} onChange={e => setField('address_street', e.target.value)} placeholder="e.g. 12 Example Road" />
                </div>
                <div className={styles.formField}>
                  <label>City / Suburb</label>
                  <input value={form.address_city} onChange={e => setField('address_city', e.target.value)} placeholder="e.g. Tauranga" />
                </div>
                <div className={styles.formField}>
                  <label>Postcode</label>
                  <input value={form.address_postcode} onChange={e => setField('address_postcode', e.target.value)} placeholder="e.g. 3110" />
                </div>
                <div className={styles.formField}>
                  <label>Region</label>
                  <input value={form.address_region} onChange={e => setField('address_region', e.target.value)} placeholder="e.g. Bay of Plenty" />
                </div>
                <div className={styles.formField}>
                  <label>Country</label>
                  <input value={form.address_country} onChange={e => setField('address_country', e.target.value)} />
                </div>

                <div className={styles.formFieldWide}>
                  <label>Service Required</label>
                  <input value={form.service_required} onChange={e => setField('service_required', e.target.value)} placeholder="e.g. Heat pump install" />
                </div>
                <div className={styles.formFieldWide}>
                  <label>Message / Notes</label>
                  <textarea rows={3} value={form.message} onChange={e => setField('message', e.target.value)}
                    placeholder="What did the customer ask for?" />
                </div>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button type="button" className={styles.btnSecondary} onClick={() => setShowNew(false)}>Cancel</button>
              <button type="submit" className={styles.btnPrimary} disabled={saving}>
                {saving ? 'Saving…' : 'Save Lead'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
