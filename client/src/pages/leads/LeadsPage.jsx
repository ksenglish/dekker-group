import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './Leads.module.css';
import { overlayClose } from '../../lib/overlayClose';

const STATUSES = ['new', 'contacted', 'call_back', 'converted', 'not_interested'];
const STATUS_COLOURS = {
  new: '#1e40af', contacted: '#d97706', call_back: '#7c3aed',
  converted: '#16a34a', not_interested: '#6b7280',
};
const STATUS_LABEL = {
  new: 'New', contacted: 'Contacted', call_back: 'Call Back',
  converted: 'Converted', not_interested: 'Not Interested',
};

// Picking a result is how a lead moves — the status follows from what actually
// happened on the call, so nobody has to map one to the other in their head.
const CALL_RESULTS = [
  { value: 'left_voicemail', label: 'Left Voice Mail', to: 'contacted' },
  { value: 'no_reply',       label: 'No Reply',        to: 'contacted' },
  { value: 'emailed',        label: 'Emailed',         to: 'contacted' },
  { value: 'texted',         label: 'Texted',          to: 'contacted' },
  { value: 'call_back',      label: 'Call Back',       to: 'call_back' },
  { value: 'booked',         label: 'Booked',          to: 'converted' },
  { value: 'not_interested', label: 'Not Interested',  to: 'not_interested' },
];

// Strips spaces and NZ formatting so tel:/sms: links dial reliably
const dialable = v => (v || '').replace(/[^\d+]/g, '');

// Records what happened on the call and lets the result decide the status.
function CallResultPicker({ lead, onRecorded }) {
  const [result, setResult] = useState('');
  const [callBackOn, setCallBackOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const needsDate = result === 'call_back';
  const moveTo = CALL_RESULTS.find(r => r.value === result)?.to;

  async function save() {
    if (!result) return;
    if (needsDate && !callBackOn) { setError('Pick a date to call back on'); return; }
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/leads/${lead.id}/result`, {
        result, call_back_on: needsDate ? callBackOn : null,
      });
      setResult(''); setCallBackOn('');
      onRecorded(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record that');
    } finally { setBusy(false); }
  }

  return (
    <div className={styles.resultBar}>
      <label className={styles.resultLabel}>Call result</label>
      <div className={styles.resultRow}>
        <select
          className={styles.resultSelect}
          value={result}
          onChange={e => { setResult(e.target.value); setError(''); }}
        >
          <option value="">— Select —</option>
          {CALL_RESULTS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>

        {needsDate && (
          <input
            type="date"
            className={styles.resultSelect}
            value={callBackOn}
            onChange={e => setCallBackOn(e.target.value)}
          />
        )}

        <button className={styles.btnPrimary} onClick={save} disabled={!result || busy}>
          {busy ? 'Saving…' : 'Record'}
        </button>
      </div>

      {moveTo && (
        <div className={styles.resultHint}>
          Moves this lead to <strong style={{ color: STATUS_COLOURS[moveTo] }}>{STATUS_LABEL[moveTo]}</strong>
          {moveTo === 'converted' && ' and opens a job'}
          {!lead.customer_id && ', and saves them to Customers'}.
        </div>
      )}
      {error && <div className={styles.resultError}>{error}</div>}
    </div>
  );
}

// Details stay editable at any stage — a number taken down wrong shouldn't
// need the lead converting first.
function LeadEditForm({ lead, onCancel, onSaved }) {
  const [f, setF] = useState({
    name: lead.name || '', contact_name: lead.contact_name || '', company: lead.company || '',
    email: lead.email || '', phone: lead.phone || '', mobile: lead.mobile || '',
    service_required: lead.service_required || '', message: lead.message || '',
    address: lead.address || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  async function save(e) {
    e.preventDefault();
    if (!f.name.trim()) { setError('Name is required'); return; }
    setBusy(true); setError('');
    try {
      const { data } = await api.put(`/leads/${lead.id}`, { ...lead, ...f });
      onSaved(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save');
      setBusy(false);
    }
  }

  const field = (key, label, type = 'text') => (
    <label className={styles.editField}>
      <span>{label}</span>
      <input type={type} value={f[key]} onChange={e => set(key, e.target.value)} />
    </label>
  );

  return (
    <form className={styles.editForm} onSubmit={save}>
      {field('name', 'Name')}
      {field('contact_name', 'Contact name')}
      {field('company', 'Company')}
      {field('email', 'Email', 'email')}
      {field('mobile', 'Mobile')}
      {field('phone', 'Phone')}
      {field('address', 'Address')}
      {field('service_required', 'Service required')}
      <label className={styles.editField}>
        <span>Message</span>
        <textarea rows={3} value={f.message} onChange={e => set('message', e.target.value)} />
      </label>
      {error && <div className={styles.resultError}>{error}</div>}
      <div className={styles.editButtons}>
        <button type="submit" className={styles.btnPrimary} disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className={styles.btnSecondary} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

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
  const [editing, setEditing] = useState(false);
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

  // Converting now means the work is booked, so it opens a job rather than
  // just a customer record — the customer already exists by this point.
  async function convert(lead) {
    if (!confirm(`Book ${lead.name} in as a job?`)) return;
    setConverting(true);
    try {
      const { data } = await api.post(`/leads/${lead.id}/convert`);
      announceChange();
      navigate(`/jobs/${data.job_id}`);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to book this lead');
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
        <div className={styles.overlay} {...overlayClose(() => { setSelected(null); setEditing(false); })}>
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

            {/* One tap to reach them, straight from the record being worked */}
            <div className={styles.hotButtons}>
              <a
                className={`${styles.hotBtn} ${!(selected.mobile || selected.phone) ? styles.hotBtnOff : ''}`}
                href={`tel:${dialable(selected.mobile || selected.phone)}`}
                onClick={e => { if (!(selected.mobile || selected.phone)) e.preventDefault(); }}
              >📞 Call</a>
              <a
                className={`${styles.hotBtn} ${!(selected.mobile || selected.phone) ? styles.hotBtnOff : ''}`}
                href={`sms:${dialable(selected.mobile || selected.phone)}`}
                onClick={e => { if (!(selected.mobile || selected.phone)) e.preventDefault(); }}
              >💬 Text</a>
              <a
                className={`${styles.hotBtn} ${!selected.email ? styles.hotBtnOff : ''}`}
                href={`mailto:${selected.email || ''}`}
                onClick={e => { if (!selected.email) e.preventDefault(); }}
              >✉ Email</a>
            </div>

            <CallResultPicker
              lead={selected}
              onRecorded={updated => {
                setSelected(s => (s && s.id === updated.id ? { ...s, ...updated } : s));
                load();
              }}
            />

            {editing ? (
              <LeadEditForm
                lead={selected}
                onCancel={() => setEditing(false)}
                onSaved={updated => {
                  setEditing(false);
                  setSelected(s => (s && s.id === updated.id ? { ...s, ...updated } : s));
                  load();
                }}
              />
            ) : (
            <div className={styles.detailList}>
              {(selected.mobile || selected.phone) && <div className={styles.detailRow}><span>Phone</span><strong><a href={`tel:${dialable(selected.mobile || selected.phone)}`}>{selected.mobile || selected.phone}</a></strong></div>}
              {selected.email && <div className={styles.detailRow}><span>Email</span><strong><a href={`mailto:${selected.email}`}>{selected.email}</a></strong></div>}
              {selected.address && <div className={styles.detailRow}><span>Address</span><strong>{selected.address}</strong></div>}
              {selected.service_required && <div className={styles.detailRow}><span>Service Required</span><strong>{selected.service_required}</strong></div>}
              {selected.source && <div className={styles.detailRow}><span>Source</span><strong>{selected.source}</strong></div>}
              {selected.call_back_on && (
                <div className={styles.detailRow}>
                  <span>Call back on</span>
                  <strong style={{ color: '#7c3aed' }}>
                    {new Date(String(selected.call_back_on).slice(0, 10) + 'T12:00:00')
                      .toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'long' })}
                  </strong>
                </div>
              )}
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
              {(selected.not_interested_at || selected.dismissed_at) && !selected.converted_at && (
                <div className={styles.detailRow}>
                  <span>Not interested</span>
                  <strong>{fmtDateTime(selected.not_interested_at || selected.dismissed_at)}</strong>
                </div>
              )}
              {selected.customer_name && <div className={styles.detailRow}><span>Customer</span><strong>{selected.customer_name}</strong></div>}
            </div>
            )}

            {selected.message && !editing && <div className={styles.messageBlock}>{selected.message}</div>}

            <div className={styles.modalFooter}>
              {user?.role === 'admin' && (
                <button className={styles.btnDanger} onClick={() => remove(selected)}>Delete</button>
              )}
              {!editing && (
                <button className={styles.btnSecondary} onClick={() => setEditing(true)}>Edit details</button>
              )}
              {selected.customer_id && (
                <button className={styles.btnSecondary} onClick={() => navigate(`/customers/${selected.customer_id}`)}>
                  View Customer
                </button>
              )}
              {selected.job_id ? (
                <button className={styles.btnSecondary} onClick={() => navigate(`/jobs/${selected.job_id}`)}>
                  View Job
                </button>
              ) : (
                <button className={styles.btnPrimary} onClick={() => convert(selected)} disabled={converting}>
                  {converting ? 'Booking…' : '→ Book as Job'}
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
