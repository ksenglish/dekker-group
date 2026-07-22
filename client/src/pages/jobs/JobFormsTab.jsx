import { useState, useEffect } from 'react';
import api from '../../lib/api';
import ElectricalCocForm from './ElectricalCocForm';
import styles from './Jobs.module.css';
import formStyles from './JobFormsTab.module.css';

// Library of onsite digital forms available on a job. Electrical COC is the
// first entry — more form types can be added here as their own {key, name,
// description, load, Component} without touching the list UI below.
const AVAILABLE_FORMS = [
  {
    key: 'electrical_coc',
    name: 'Electrical COC',
    description: 'Electrical Certificate of Compliance & Electrical Safety Certificate',
  },
];

export default function JobFormsTab({ jobId, job, user }) {
  const [openForm, setOpenForm] = useState(null);
  const [status, setStatus] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/jobs/${jobId}/electrical-coc`).then(r => {
      setStatus(s => ({ ...s, electrical_coc: r.data }));
    }).finally(() => setLoading(false));
  }, [jobId]);

  if (openForm === 'electrical_coc') {
    return (
      <ElectricalCocForm
        jobId={jobId}
        job={job}
        user={user}
        onBack={() => setOpenForm(null)}
        onSaved={data => setStatus(s => ({ ...s, electrical_coc: data }))}
      />
    );
  }

  return (
    <div className={styles.card}>
      {loading ? (
        <div className={styles.emptySmall}>Loading…</div>
      ) : (
        <div className={formStyles.list}>
          {AVAILABLE_FORMS.map(f => {
            const submitted = status[f.key];
            return (
              <button key={f.key} type="button" className={formStyles.formCard} onClick={() => setOpenForm(f.key)}>
                <div className={formStyles.formInfo}>
                  <div className={formStyles.formName}>{f.name}</div>
                  <div className={formStyles.formDesc}>{f.description}</div>
                </div>
                <span className={`${formStyles.status} ${submitted ? formStyles.statusDone : formStyles.statusPending}`}>
                  {submitted ? `✅ Completed ${new Date(submitted.updated_at).toLocaleDateString('en-NZ')}` : 'Not started'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
