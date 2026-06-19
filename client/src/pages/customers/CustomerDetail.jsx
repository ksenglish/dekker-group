import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './Customers.module.css';

const STATUS_COLOURS = {
  new: '#1e40af', quoted: '#7c3aed', scheduled: '#0891b2',
  in_progress: '#d97706', invoiced: '#9333ea', complete: '#16a34a', cancelled: '#6b7280',
};

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = id === 'new';

  const [customer, setCustomer] = useState(null);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [noteText, setNoteText] = useState('');
  const [addingSite, setAddingSite] = useState(false);
  const [newSite, setNewSite] = useState({ address: '', label: '' });
  const [editMode, setEditMode] = useState(isNew);
  const [form, setForm] = useState({ name: '', company: '', phone: '', email: '' });

  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const { data } = await api.get(`/customers/${id}`);
        setCustomer(data);
        setForm({ name: data.name, company: data.company || '', phone: data.phone || '', email: data.email || '' });
        const notesRes = await api.get(`/customers/${id}/notes`);
        setNotes(notesRes.data);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      if (isNew) {
        const { data } = await api.post('/customers', form);
        navigate(`/customers/${data.id}`, { replace: true });
      } else {
        const { data } = await api.put(`/customers/${id}`, form);
        setCustomer(c => ({ ...c, ...data }));
        setEditMode(false);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
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
          {/* Customer Info Card */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2>{isNew ? 'New Customer' : 'Customer Details'}</h2>
            </div>
            {editMode ? (
              <div className={styles.form}>
                {error && <div className={styles.errorBanner}>{error}</div>}
                <div className={styles.formGrid}>
                  <div className={styles.field}>
                    <label>Full Name *</label>
                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. John Smith" />
                  </div>
                  <div className={styles.field}>
                    <label>Company</label>
                    <input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="e.g. Smith Industries" />
                  </div>
                  <div className={styles.field}>
                    <label>Phone</label>
                    <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="e.g. 021 123 4567" />
                  </div>
                  <div className={styles.field}>
                    <label>Email</label>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="e.g. john@example.com" />
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
                <div className={styles.detailItem}><span>Name</span><strong>{customer?.name}</strong></div>
                <div className={styles.detailItem}><span>Company</span><strong>{customer?.company || '—'}</strong></div>
                <div className={styles.detailItem}><span>Phone</span><strong>{customer?.phone || '—'}</strong></div>
                <div className={styles.detailItem}><span>Email</span><strong>{customer?.email ? <a href={`mailto:${customer.email}`}>{customer.email}</a> : '—'}</strong></div>
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
                  <input
                    placeholder="Street address"
                    value={newSite.address}
                    onChange={e => setNewSite(s => ({ ...s, address: e.target.value }))}
                  />
                  <input
                    placeholder="Label (e.g. Main Office, Site B)"
                    value={newSite.label}
                    onChange={e => setNewSite(s => ({ ...s, label: e.target.value }))}
                  />
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
                <textarea
                  rows={3}
                  placeholder="Add a note…"
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleAddNote(); }}
                />
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

        {/* Recent Jobs Sidebar */}
        {!isNew && customer?.recent_jobs?.length > 0 && (
          <div className={styles.detailSidebar}>
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
          </div>
        )}
      </div>
    </div>
  );
}
