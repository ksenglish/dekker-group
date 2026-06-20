import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import JobForm from './JobForm';
import LineItemsEditor from './LineItemsEditor';
import styles from './Jobs.module.css';

function JobTimesheets({ jobId, user }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/timesheets', { params: { job_id: jobId } })
      .then(r => setEntries(r.data))
      .finally(() => setLoading(false));
  }, [jobId]);

  async function logTime(e) {
    e.preventDefault();
    if (!hours || parseFloat(hours) <= 0) return;
    setSaving(true);
    try {
      const { data } = await api.post('/timesheets', { job_id: jobId, hours, description, date });
      setEntries(es => [data, ...es]);
      setHours(''); setDescription('');
    } finally { setSaving(false); }
  }

  async function del(id) {
    await api.delete(`/timesheets/${id}`);
    setEntries(es => es.filter(e => e.id !== id));
  }

  const total = entries.reduce((s, e) => s + parseFloat(e.hours || 0), 0);

  return (
    <div className={styles.card}>
      <form onSubmit={logTime} className={styles.timesheetForm}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className={styles.tsInput} />
        <input type="number" min="0.25" max="24" step="0.25" placeholder="Hours" value={hours}
          onChange={e => setHours(e.target.value)} className={styles.tsInput} style={{ width: 80 }} />
        <input placeholder="Description (optional)" value={description}
          onChange={e => setDescription(e.target.value)} className={styles.tsInput} style={{ flex: 1 }} />
        <button className={styles.btnPrimary} disabled={saving || !hours}>
          {saving ? '…' : 'Log'}
        </button>
      </form>
      {loading ? <div className={styles.emptySmall}>Loading…</div> :
       entries.length === 0 ? <div className={styles.emptySmall}>No time logged yet.</div> : (
        <>
          {entries.map(e => (
            <div key={e.id} className={styles.tsRow}>
              <span className={styles.tsDate}>{new Date(e.date).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <span className={styles.tsName}>{e.user_name}</span>
              <span className={styles.tsDesc}>{e.description || '—'}</span>
              <span className={styles.tsHours}>{parseFloat(e.hours).toFixed(1)}h</span>
              {(user.role !== 'field_tech' || e.user_id === user.id) && (
                <button className={styles.deleteBtn} style={{ position: 'static' }} onClick={() => del(e.id)}>✕</button>
              )}
            </div>
          ))}
          <div className={styles.tsTotal}>Total: <strong>{total.toFixed(1)}h</strong></div>
        </>
      )}
    </div>
  );
}

const PIPELINE = ['new', 'quoted', 'scheduled', 'in_progress', 'invoiced', 'complete'];
const STATUS_COLOURS = {
  new: '#1e40af', quoted: '#7c3aed', scheduled: '#0891b2',
  in_progress: '#d97706', invoiced: '#9333ea', complete: '#16a34a', cancelled: '#6b7280',
};
const PRIORITY_COLOURS = { low: '#6b7280', medium: '#d97706', high: '#dc2626' };

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = id === 'new';

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [editMode, setEditMode] = useState(isNew);
  const [noteText, setNoteText] = useState('');
  const [activeTab, setActiveTab] = useState('details');
  const [creatingQuote, setCreatingQuote] = useState(false);

  useEffect(() => {
    if (isNew) return;
    api.get(`/jobs/${id}`).then(r => { setJob(r.data); setLoading(false); });
  }, [id]);

  async function handleStatusChange(status) {
    const { data } = await api.patch(`/jobs/${id}/status`, { status });
    setJob(j => ({ ...j, status: data.status }));
    // Prompt to create a quote if job has line items and no existing quote
    if (status === 'complete' && job?.line_items?.length > 0 && job?.status !== 'invoiced') {
      if (confirm('Job marked complete. Would you like to create a quote from this job\'s line items?')) {
        try {
          const { data: q } = await api.post('/quotes', { job_id: id, customer_id: job.customer_id });
          navigate(`/quotes/${q.id}`);
        } catch { /* user can create manually */ }
      }
    }
  }

  async function handleAddNote() {
    if (!noteText.trim()) return;
    const { data } = await api.post(`/jobs/${id}/notes`, { content: noteText });
    setJob(j => ({ ...j, notes: [data, ...(j.notes || [])] }));
    setNoteText('');
  }

  async function handleDeleteNote(noteId) {
    await api.delete(`/jobs/${id}/notes/${noteId}`);
    setJob(j => ({ ...j, notes: j.notes.filter(n => n.id !== noteId) }));
  }

  async function handleSaveLineItems(items) {
    const { data } = await api.put(`/jobs/${id}/line-items`, { items });
    setJob(j => ({ ...j, line_items: data }));
  }

  async function handleDelete() {
    if (!confirm(`Delete job #${job.job_number}? This cannot be undone.`)) return;
    await api.delete(`/jobs/${id}`);
    navigate('/jobs');
  }

  function handleSaved(savedJob) {
    if (isNew) {
      navigate(`/jobs/${savedJob.id}`, { replace: true });
    } else {
      setJob(j => ({ ...j, ...savedJob }));
      setEditMode(false);
    }
  }

  const canEdit = user?.role !== 'field_tech';
  const subtotal = (job?.line_items || []).reduce((s, i) => s + (i.unit_price * i.quantity), 0);
  const gst = Math.round(subtotal * 0.15);
  const total = subtotal + gst;

  if (loading) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  if (isNew || editMode) {
    return (
      <div className={styles.page}>
        <div className={styles.breadcrumb}>
          <Link to="/jobs">Jobs</Link><span>›</span>
          <span>{isNew ? 'New Job' : `Edit Job #${job?.job_number}`}</span>
        </div>
        <JobForm
          initial={job}
          onSave={handleSaved}
          onCancel={isNew ? () => navigate('/jobs') : () => setEditMode(false)}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div className={styles.breadcrumb} style={{ marginBottom: 0 }}>
          <Link to="/jobs">Jobs</Link><span>›</span>
          <span>Job #{job.job_number}</span>
        </div>
        {user?.role !== 'field_tech' && (
          <div className={styles.headerActions}>
            <button className={styles.btnSecondary} onClick={() => setEditMode(true)}>Edit</button>
            {user?.role === 'admin' && (
              <button className={styles.btnDanger} onClick={handleDelete}>Delete</button>
            )}
          </div>
        )}
      </div>

      {/* Status pipeline */}
      {job.status !== 'cancelled' ? (
        <div className={styles.pipeline}>
          {PIPELINE.map((s, i) => {
            const idx = PIPELINE.indexOf(job.status);
            const done = i < idx;
            const active = i === idx;
            return (
              <button
                key={s}
                className={`${styles.pipelineStep} ${done ? styles.pipelineDone : ''} ${active ? styles.pipelineActive : ''}`}
                onClick={() => user?.role !== 'field_tech' && handleStatusChange(s)}
                style={active ? { borderColor: STATUS_COLOURS[s], color: STATUS_COLOURS[s] } : {}}
                title={`Move to ${s.replace('_', ' ')}`}
              >
                <span className={styles.pipelineDot} style={active ? { background: STATUS_COLOURS[s] } : done ? { background: '#16a34a' } : {}} />
                {s.replace('_', ' ')}
              </button>
            );
          })}
          {user?.role !== 'field_tech' && (
            <button
              className={`${styles.pipelineStep} ${job.status === 'cancelled' ? styles.pipelineActive : ''}`}
              onClick={() => handleStatusChange('cancelled')}
              style={{ marginLeft: 'auto', color: '#6b7280' }}
            >
              Cancel job
            </button>
          )}
        </div>
      ) : (
        <div className={styles.cancelledBanner}>
          This job is cancelled.
          {user?.role !== 'field_tech' && (
            <button onClick={() => handleStatusChange('new')} className={styles.reopenBtn}>Reopen as New</button>
          )}
        </div>
      )}

      {/* Main layout */}
      <div className={styles.detailLayout}>
        <div className={styles.detailMain}>
          {/* Tabs */}
          <div className={styles.tabs}>
            {['details', 'line_items', 'timesheets', 'notes'].map(t => (
              <button key={t} className={`${styles.tab} ${activeTab === t ? styles.tabActive : ''}`} onClick={() => setActiveTab(t)}>
                {t === 'line_items' ? 'Line Items' : t.charAt(0).toUpperCase() + t.slice(1)}
                {t === 'notes' && job.notes?.length > 0 && <span className={styles.tabCount}>{job.notes.length}</span>}
              </button>
            ))}
          </div>

          {activeTab === 'details' && (
            <div className={styles.card}>
              <div className={styles.detailGrid}>
                <div className={styles.detailItem}><span>Customer</span>
                  <strong>{job.customer_id ? <Link to={`/customers/${job.customer_id}`}>{job.customer_name}</Link> : '—'}</strong>
                </div>
                <div className={styles.detailItem}><span>Site</span><strong>{job.site_address || '—'}{job.site_label ? ` (${job.site_label})` : ''}</strong></div>
                <div className={styles.detailItem}><span>Type</span><strong style={{ textTransform: 'capitalize' }}>{job.type.replace('_', ' ')}</strong></div>
                <div className={styles.detailItem}><span>Priority</span>
                  <strong style={{ color: PRIORITY_COLOURS[job.priority], textTransform: 'capitalize' }}>{job.priority}</strong>
                </div>
                <div className={styles.detailItem}><span>Lead Technician</span><strong>{job.tech_name || '—'}</strong></div>
                {job.is_recurring && (
                  <div className={styles.detailItem}><span>Recurrence</span>
                    <strong style={{ color: '#0891b2' }}>🔁 {job.recurrence_interval} · Next: {job.recurrence_next_date ? new Date(job.recurrence_next_date).toLocaleDateString('en-NZ') : '—'}</strong>
                  </div>
                )}
                <div className={styles.detailItem}><span>Due Date</span>
                  <strong>{job.due_date ? new Date(job.due_date).toLocaleDateString('en-NZ') : '—'}</strong>
                </div>
                {job.description && (
                  <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}>
                    <span>Description</span><strong style={{ fontWeight: 400, whiteSpace: 'pre-wrap' }}>{job.description}</strong>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'line_items' && (
            <div className={styles.card}>
              <LineItemsEditor
                items={job.line_items || []}
                onSave={handleSaveLineItems}
                readonly={user?.role === 'field_tech'}
              />
              {job.line_items?.length > 0 && (
                <div className={styles.totals}>
                  <div className={styles.totalRow}><span>Subtotal</span><span>${(subtotal / 100).toFixed(2)}</span></div>
                  <div className={styles.totalRow}><span>GST (15%)</span><span>${(gst / 100).toFixed(2)}</span></div>
                  <div className={`${styles.totalRow} ${styles.totalFinal}`}><span>Total</span><span>${(total / 100).toFixed(2)}</span></div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'timesheets' && <JobTimesheets jobId={id} user={user} />}

          {activeTab === 'notes' && (
            <div className={styles.card}>
              <div className={styles.noteInput}>
                <textarea rows={3} placeholder="Add a note…" value={noteText} onChange={e => setNoteText(e.target.value)} />
                <button className={styles.btnPrimary} onClick={handleAddNote} disabled={!noteText.trim()}>Add Note</button>
              </div>
              {(!job.notes || job.notes.length === 0) && <p className={styles.emptySmall}>No notes yet.</p>}
              {job.notes?.map(note => (
                <div key={note.id} className={styles.noteRow}>
                  <div className={styles.noteMeta}>
                    <strong>{note.author_name}</strong>
                    <span>{new Date(note.created_at).toLocaleString('en-NZ')}</span>
                  </div>
                  <p className={styles.noteContent}>{note.content}</p>
                  {user?.role !== 'field_tech' && (
                    <button className={styles.deleteBtn} onClick={() => handleDeleteNote(note.id)}>✕</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className={styles.detailSidebar}>
          <div className={styles.card}>
            <div className={styles.cardHeader}><h2>Job Summary</h2></div>
            <div className={styles.summaryList}>
              <div className={styles.summaryItem}>
                <span>Job #</span><strong>#{job.job_number}</strong>
              </div>
              <div className={styles.summaryItem}>
                <span>Status</span>
                <span className={styles.statusBadge} style={{ background: STATUS_COLOURS[job.status] + '18', color: STATUS_COLOURS[job.status] }}>
                  {job.status.replace('_', ' ')}
                </span>
              </div>
              <div className={styles.summaryItem}>
                <span>Created</span><strong>{new Date(job.created_at).toLocaleDateString('en-NZ')}</strong>
              </div>
              {job.line_items?.length > 0 && (
                <div className={styles.summaryItem}>
                  <span>Total (incl. GST)</span><strong>${(total / 100).toFixed(2)}</strong>
                </div>
              )}
            </div>
            {canEdit && job.line_items?.length > 0 && (
              <div className={styles.cardFooter}>
                <button className={styles.btnPrimary} style={{ width: '100%' }} disabled={creatingQuote}
                  onClick={async () => {
                    setCreatingQuote(true);
                    try {
                      const { data } = await api.post('/quotes', { job_id: job.id, customer_id: job.customer_id });
                      navigate(`/quotes/${data.id}`);
                    } catch (err) {
                      alert(err.response?.data?.error || 'Failed to create quote');
                      setCreatingQuote(false);
                    }
                  }}>
                  {creatingQuote ? 'Creating…' : 'Create Quote'}
                </button>
              </div>
            )}
            {job.customer_email && (
              <div className={styles.cardFooter}>
                <a href={`mailto:${job.customer_email}`} className={styles.contactLink}>✉ {job.customer_email}</a>
              </div>
            )}
            {job.customer_phone && (
              <div className={styles.cardFooter} style={{ borderTop: 'none', paddingTop: 0 }}>
                <a href={`tel:${job.customer_phone}`} className={styles.contactLink}>📞 {job.customer_phone}</a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
