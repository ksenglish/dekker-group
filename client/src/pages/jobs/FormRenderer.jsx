import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { compressImage } from '../../lib/image';
import { missingRequired, isAnswered } from '../../lib/formFields';
import styles from './Jobs.module.css';
import formStyles from './JobFormsTab.module.css';

// Photos are served from an authenticated endpoint, so they're fetched as
// blobs rather than pointed at directly from an <img src>.
function FormPhoto({ photo }) {
  const [url, setUrl] = useState(photo.inline || null);
  useEffect(() => {
    if (photo.inline || !photo.key) return;
    let objectUrl;
    api.get('/forms/photos', { params: { key: photo.key }, responseType: 'blob' })
      .then(r => { objectUrl = URL.createObjectURL(r.data); setUrl(objectUrl); })
      .catch(() => {});
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo.key, photo.inline]);
  if (!url) return <div className={formStyles.photoThumbLoading}>…</div>;
  return <img src={url} alt={photo.filename || 'Photo'} className={formStyles.photoThumb} />;
}

function PhotoField({ value, onChange, readOnly }) {
  const photos = Array.isArray(value) ? value : [];
  const [busy, setBusy] = useState(false);

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    try {
      const added = [];
      for (const file of files) {
        // Same compression the rest of the app uses before upload
        const dataUrl = await compressImage(file);
        const { data } = await api.post('/forms/photos', { filename: file.name, data_base64: dataUrl });
        added.push(data);
      }
      onChange([...photos, ...added]);
    } catch {
      alert('Could not upload that photo. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className={formStyles.photoRow}>
        {photos.map((p, i) => (
          <div key={p.key || i} className={formStyles.photoWrap}>
            <FormPhoto photo={p} />
            {!readOnly && (
              <button type="button" className={formStyles.photoRemove}
                onClick={() => onChange(photos.filter((_, j) => j !== i))}>✕</button>
            )}
          </div>
        ))}
      </div>
      {!readOnly && (
        <label className={formStyles.photoAdd}>
          {busy ? 'Uploading…' : '📷 Add photo'}
          <input type="file" accept="image/*" capture="environment" multiple
            style={{ display: 'none' }} onChange={handleFiles} disabled={busy} />
        </label>
      )}
    </div>
  );
}

function Field({ field, value, onChange, readOnly }) {
  const set = v => onChange(field.id, v);

  if (field.type === 'section') {
    return (
      <div className={formStyles.sectionHeading}>
        <h3>{field.label}</h3>
        {field.help && <p>{field.help}</p>}
      </div>
    );
  }

  const label = (
    <label className={formStyles.fieldLabel}>
      {field.label}{field.required && <span className={formStyles.req}> *</span>}
    </label>
  );

  return (
    <div className={formStyles.field}>
      {label}
      {field.help && <p className={formStyles.fieldHelp}>{field.help}</p>}

      {field.type === 'text' && (
        <input value={value || ''} onChange={e => set(e.target.value)} disabled={readOnly} />
      )}
      {field.type === 'textarea' && (
        <textarea rows={3} value={value || ''} onChange={e => set(e.target.value)} disabled={readOnly} />
      )}
      {field.type === 'number' && (
        <input type="number" value={value ?? ''} onChange={e => set(e.target.value)} disabled={readOnly} />
      )}
      {field.type === 'date' && (
        <input type="date" value={value || ''} onChange={e => set(e.target.value)} disabled={readOnly} />
      )}
      {field.type === 'select' && (
        <select value={value || ''} onChange={e => set(e.target.value)} disabled={readOnly}>
          <option value="">— Select —</option>
          {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {field.type === 'checkbox' && (
        <label className={formStyles.inlineCheck}>
          <input type="checkbox" checked={value === true}
            onChange={e => set(e.target.checked)} disabled={readOnly} />
          <span>{field.checkboxText || 'Confirmed'}</span>
        </label>
      )}
      {field.type === 'yesno' && (
        <div className={formStyles.yesNo}>
          {['Yes', 'No'].map(opt => (
            <button key={opt} type="button" disabled={readOnly}
              className={`${formStyles.yesNoBtn} ${value === opt ? formStyles.yesNoActive : ''}`}
              onClick={() => set(value === opt ? '' : opt)}>{opt}</button>
          ))}
        </div>
      )}
      {field.type === 'photo' && (
        <PhotoField value={value} onChange={v => set(v)} readOnly={readOnly} />
      )}
      {field.type === 'signoff' && (
        <div className={formStyles.signoffRow}>
          <input placeholder="Full name" value={value?.name || ''}
            onChange={e => set({ ...(value || {}), name: e.target.value })} disabled={readOnly} />
          <input type="date" value={value?.date || ''}
            onChange={e => set({ ...(value || {}), date: e.target.value })} disabled={readOnly} />
        </div>
      )}
    </div>
  );
}

export default function FormRenderer({ jobId, submission, onBack, onSaved }) {
  // Render against the snapshot taken when the form was attached, so editing
  // the template later never changes a form someone has already filled in.
  const fields = submission.fields_snapshot?.length ? submission.fields_snapshot : [];
  const [answers, setAnswers] = useState(submission.answers || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const readOnly = submission.status === 'completed';

  function setAnswer(id, value) {
    setAnswers(a => ({ ...a, [id]: value }));
    setError('');
  }

  async function save(status) {
    if (status === 'completed') {
      const missing = missingRequired(fields, answers);
      if (missing.length) { setError(`Please complete: ${missing.join(', ')}`); return; }
    }
    setSaving(true); setError('');
    try {
      const { data } = await api.put(`/jobs/${jobId}/forms/${submission.id}`, { answers, status });
      onSaved(data);
      if (status === 'completed') onBack();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this form');
    } finally { setSaving(false); }
  }

  const answerable = fields.filter(f => f.type !== 'section');
  const done = answerable.filter(f => isAnswered(f, answers[f.id])).length;

  return (
    <div className={styles.card}>
      <div className={formStyles.formHeader}>
        <button type="button" className={styles.btnSecondary} onClick={onBack}>‹ Back</button>
        <div>
          <h2 className={formStyles.formTitle}>{submission.name}</h2>
          <p className={formStyles.formProgress}>
            {readOnly
              ? `Completed${submission.completed_by_name ? ` by ${submission.completed_by_name}` : ''}`
              : `${done} of ${answerable.length} answered`}
          </p>
        </div>
      </div>

      {error && <div className={styles.errorBanner} style={{ margin: '0 20px' }}>{error}</div>}

      <div className={formStyles.formBody}>
        {fields.length === 0 && <div className={styles.emptySmall}>This form has no fields yet.</div>}
        {fields.map(f => (
          <Field key={f.id} field={f} value={answers[f.id]} onChange={setAnswer} readOnly={readOnly} />
        ))}
      </div>

      <div className={formStyles.formActions}>
        {readOnly ? (
          <button type="button" className={styles.btnSecondary} onClick={() => save('in_progress')} disabled={saving}>
            Reopen for editing
          </button>
        ) : (
          <>
            <button type="button" className={styles.btnSecondary} onClick={() => save('in_progress')} disabled={saving}>
              {saving ? 'Saving…' : 'Save progress'}
            </button>
            <button type="button" className={styles.btnPrimary} onClick={() => save('completed')} disabled={saving}>
              ✓ Mark complete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
