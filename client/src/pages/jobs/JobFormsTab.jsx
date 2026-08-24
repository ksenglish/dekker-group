import { useState, useEffect } from 'react';
import api from '../../lib/api';
import ElectricalCocForm from './ElectricalCocForm';
import FormRenderer from './FormRenderer';
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
  const [cocStatus, setCocStatus] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

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
              <button key={sub.id} type="button" className={formStyles.formCard} onClick={() => setOpenForm(sub.id)}>
                <div className={formStyles.formInfo}>
                  <div className={formStyles.formName}>{sub.name}</div>
                  {sub.description && <div className={formStyles.formDesc}>{sub.description}</div>}
                </div>
                <span className={`${formStyles.status} ${sub.status === 'completed' ? formStyles.statusDone : formStyles.statusPending}`}>
                  {statusLabel(sub)}
                </span>
              </button>
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
    </div>
  );
}
