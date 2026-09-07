import { useState, useEffect } from 'react';
import api from '../../lib/api';
import ElectricalCocForm from './ElectricalCocForm';
import FormRenderer from './FormRenderer';
import FormReader from './FormReader';
import styles from './Jobs.module.css';
import formStyles from './JobFormsTab.module.css';

// The Electrical COC is a statutory certificate with its own table, layout and
// PDF, so it stays a built-in rather than something rebuilt in the Form
// Builder. It sits under Post Install alongside the admin-built forms.
const BUILT_IN = {
  key: 'electrical_coc',
  name: 'Electrical COC',
  description: 'Electrical Certificate of Compliance & Electrical Safety Certificate',
  stage: 'post_install',
};

function statusLabel(sub) {
  if (sub.status === 'completed') {
    return `✅ Completed ${new Date(sub.completed_at || sub.updated_at).toLocaleDateString('en-NZ')}`;
  }
  if (sub.status === 'in_progress') return '✏️ In progress';
  return 'Not started';
}

export default function JobFormsTab({ jobId, job, user, stage = 'post_install' }) {
  const [openForm, setOpenForm] = useState(null); // 'electrical_coc' | submission id
  // A completed form opens to be read; the same form can then be reopened to
  // edit, which is what drops it back into the renderer.
  const [reading, setReading] = useState(null);
  const [cocStatus, setCocStatus] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const showCoc = stage === BUILT_IN.stage;

  function load() {
    const calls = [api.get(`/jobs/${jobId}/forms`)];
    if (showCoc) calls.push(api.get(`/jobs/${jobId}/electrical-coc`));
    Promise.all(calls)
      .then(([forms, coc]) => {
        setSubmissions(forms.data);
        if (coc) setCocStatus(coc.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(load, [jobId, stage]);

  // Only needed for the "add a form" picker
  useEffect(() => {
    api.get('/forms/templates', { params: { stage } }).then(r => setTemplates(r.data)).catch(() => {});
  }, [stage]);

  const stageSubs = submissions.filter(s => s.stage === stage);

  async function addForm(templateId) {
    try {
      await api.post(`/jobs/${jobId}/forms`, { template_id: templateId });
      setAdding(false);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not add that form');
    }
  }

  async function deleteForm(sub) {
    const warning = sub.status === 'completed'
      ? `Delete "${sub.name}"? It has been completed, and the answers and photos on it will be gone for good.`
      : `Remove "${sub.name}" from this job?`;
    if (!confirm(warning)) return;
    setBusyId(sub.id);
    try {
      await api.delete(`/jobs/${jobId}/forms/${sub.id}`);
      setSubmissions(subs => subs.filter(s => s.id !== sub.id));
      setReading(null);
      setOpenForm(null);
    } catch (err) {
      alert(err.response?.data?.error || 'Could not delete that form');
    } finally { setBusyId(null); }
  }

  async function downloadForm(sub) {
    setBusyId(sub.id);
    try {
      const r = await api.get(`/jobs/${jobId}/forms/${sub.id}/pdf`, { responseType: 'blob' });
      const match = /filename="?([^"]+)"?/.exec(r.headers['content-disposition'] || '');
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = match ? match[1] : `${sub.name || 'Form'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert('Could not produce the PDF. Please try again.');
    } finally { setBusyId(null); }
  }

  // Tapping a form opens it to read once it's finished, and to fill in while
  // it isn't — on site the common case for a completed form is checking what
  // was recorded, not editing it.
  function openSubmission(sub) {
    if (sub.status === 'completed') setReading(sub.id);
    else setOpenForm(sub.id);
  }

  if (openForm === 'electrical_coc') {
    return (
      <ElectricalCocForm
        jobId={jobId} job={job} user={user}
        onBack={() => setOpenForm(null)}
        onSaved={data => setCocStatus(data)}
      />
    );
  }

  const openSub = stageSubs.find(s => s.id === openForm);
  if (openSub) {
    return (
      <FormRenderer
        jobId={jobId}
        submission={openSub}
        onBack={() => setOpenForm(null)}
        onSaved={data => setSubmissions(subs => subs.map(s => s.id === data.id ? { ...s, ...data } : s))}
      />
    );
  }

  const readingSub = stageSubs.find(s => s.id === reading);

  const unattached = templates.filter(t => !stageSubs.some(s => s.template_id === t.id));

  return (
    <div className={styles.card}>
      {loading ? (
        <div className={styles.emptySmall}>Loading…</div>
      ) : (
        <>
          <div className={formStyles.list}>
            {showCoc && (
              <button type="button" className={formStyles.formCard} onClick={() => setOpenForm('electrical_coc')}>
                <div className={formStyles.formInfo}>
                  <div className={formStyles.formName}>{BUILT_IN.name}</div>
                  <div className={formStyles.formDesc}>{BUILT_IN.description}</div>
                </div>
                <span className={`${formStyles.status} ${cocStatus ? formStyles.statusDone : formStyles.statusPending}`}>
                  {cocStatus ? `✅ Completed ${new Date(cocStatus.updated_at).toLocaleDateString('en-NZ')}` : 'Not started'}
                </span>
              </button>
            )}

            {stageSubs.map(sub => (
              // A row rather than a button now: the download and delete
              // controls are their own buttons, and a button can't nest.
              <div key={sub.id} className={formStyles.formRow}>
                <button type="button" className={formStyles.formCard} onClick={() => openSubmission(sub)}>
                  <div className={formStyles.formInfo}>
                    <div className={formStyles.formName}>{sub.name}</div>
                    {sub.description && <div className={formStyles.formDesc}>{sub.description}</div>}
                  </div>
                  <span className={`${formStyles.status} ${sub.status === 'completed' ? formStyles.statusDone : formStyles.statusPending}`}>
                    {statusLabel(sub)}
                  </span>
                </button>
                <div className={formStyles.rowActions}>
                  {sub.status === 'completed' && (
                    <button type="button" className={formStyles.iconBtn} title="Download as PDF"
                      aria-label={`Download ${sub.name} as PDF`}
                      disabled={busyId === sub.id} onClick={() => downloadForm(sub)}>
                      ⬇
                    </button>
                  )}
                  {sub.can_delete && (
                    <button type="button" className={formStyles.iconBtnDanger} title="Delete this form"
                      aria-label={`Delete ${sub.name}`}
                      disabled={busyId === sub.id} onClick={() => deleteForm(sub)}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}

            {!showCoc && stageSubs.length === 0 && (
              <div className={styles.emptySmall}>
                No forms on this job yet. Forms load automatically based on the job type — set those up in Settings → Job Types.
              </div>
            )}
          </div>

          {user?.role !== 'field_tech' && unattached.length > 0 && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border)' }}>
              {adding ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select defaultValue="" onChange={e => e.target.value && addForm(e.target.value)}
                    style={{ flex: 1, minWidth: 200, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 13 }}>
                    <option value="">Choose a form…</option>
                    {unattached.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <button className={styles.btnSecondary} onClick={() => setAdding(false)}>Cancel</button>
                </div>
              ) : (
                <button className={styles.btnSmall} onClick={() => setAdding(true)}>+ Add a form to this job</button>
              )}
            </div>
          )}
        </>
      )}

      {readingSub && (
        <FormReader
          jobId={jobId}
          job={job}
          submission={readingSub}
          onClose={() => setReading(null)}
          onEdit={() => { setReading(null); setOpenForm(readingSub.id); }}
          onDelete={readingSub.can_delete ? () => deleteForm(readingSub) : null}
        />
      )}
    </div>
  );
}
