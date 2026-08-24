import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { FIELD_TYPES, STAGES, typeLabel, stageLabel, newFieldId } from '../../lib/formFields';
import styles from './Settings.module.css';

const EMPTY = { name: '', description: '', stage: 'post_install', fields: [] };

function FieldEditor({ field, onChange, onRemove, onMove, isFirst, isLast }) {
  const needsOptions = field.type === 'select';
  return (
    <div className={styles.fieldRow}>
      <div className={styles.fieldRowTop}>
        <div className={styles.fieldMoves}>
          <button type="button" onClick={() => onMove(-1)} disabled={isFirst} title="Move up">↑</button>
          <button type="button" onClick={() => onMove(1)} disabled={isLast} title="Move down">↓</button>
        </div>
        <select value={field.type} onChange={e => onChange({ ...field, type: e.target.value })}
          className={styles.fieldTypeSelect}>
          {FIELD_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
        <input className={styles.fieldLabelInput} value={field.label}
          onChange={e => onChange({ ...field, label: e.target.value })}
          placeholder={field.type === 'section' ? 'Section name' : 'Question / field label'} />
        {field.type !== 'section' && (
          <label className={styles.fieldReq} title="Must be answered before the form can be marked complete">
            <input type="checkbox" checked={!!field.required}
              onChange={e => onChange({ ...field, required: e.target.checked })} />
            Required
          </label>
        )}
        <button type="button" className={styles.fieldRemove} onClick={onRemove} title="Remove field">✕</button>
      </div>

      <input className={styles.fieldHelpInput} value={field.help || ''}
        onChange={e => onChange({ ...field, help: e.target.value })}
        placeholder="Helper text (optional)" />

      {needsOptions && (
        <input className={styles.fieldHelpInput} value={(field.options || []).join(', ')}
          onChange={e => onChange({ ...field, options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
          placeholder="Options, comma separated — e.g. Pass, Fail, N/A" />
      )}
      {field.type === 'checkbox' && (
        <input className={styles.fieldHelpInput} value={field.checkboxText || ''}
          onChange={e => onChange({ ...field, checkboxText: e.target.value })}
          placeholder="Text beside the tick box (default: Confirmed)" />
      )}
    </div>
  );
}

function TemplateEditor({ template, onSave, onCancel }) {
  const [form, setForm] = useState(template);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function addField(type = 'text') {
    set('fields', [...form.fields, { id: newFieldId(), type, label: '', required: false }]);
  }
  function updateField(i, next) {
    set('fields', form.fields.map((f, j) => j === i ? next : f));
  }
  function removeField(i) {
    set('fields', form.fields.filter((_, j) => j !== i));
  }
  function moveField(i, dir) {
    const next = [...form.fields];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set('fields', next);
  }

  async function save() {
    if (!form.name.trim()) return setError('Give the form a name');
    const unlabelled = form.fields.filter(f => !String(f.label || '').trim()).length;
    if (unlabelled) return setError(`${unlabelled} field${unlabelled === 1 ? ' has' : 's have'} no label`);
    setSaving(true); setError('');
    try {
      const payload = { name: form.name, description: form.description, stage: form.stage, fields: form.fields };
      const { data } = form.id
        ? await api.put(`/forms/templates/${form.id}`, payload)
        : await api.post('/forms/templates', payload);
      onSave(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this form');
      setSaving(false);
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h2>{form.id ? 'Edit Form' : 'New Form'}</h2>
      </div>
      <div className={styles.cardBody}>
        {error && <div className={styles.errorBanner}>{error}</div>}

        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label>Form Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. Ventilation Pre-Install Check" />
          </div>
          <div className={styles.field}>
            <label>Type</label>
            <select value={form.stage} onChange={e => set('stage', e.target.value)}>
              {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className={styles.field} style={{ gridColumn: '1/-1' }}>
            <label>Description</label>
            <input value={form.description || ''} onChange={e => set('description', e.target.value)}
              placeholder="Shown under the form name on the job" />
          </div>
        </div>

        <h3 className={styles.subHeading}>Fields</h3>
        {form.fields.length === 0 && (
          <p className={styles.hint}>No fields yet — add one below to start building the form.</p>
        )}
        <div className={styles.fieldList}>
          {form.fields.map((f, i) => (
            <FieldEditor key={f.id} field={f}
              onChange={next => updateField(i, next)}
              onRemove={() => removeField(i)}
              onMove={dir => moveField(i, dir)}
              isFirst={i === 0} isLast={i === form.fields.length - 1} />
          ))}
        </div>

        <div className={styles.addFieldRow}>
          {FIELD_TYPES.map(t => (
            <button key={t.type} type="button" className={styles.addFieldBtn}
              onClick={() => addField(t.type)} title={t.hint || ''}>
              + {t.label}
            </button>
          ))}
        </div>

        <div className={styles.formActions} style={{ marginTop: 20 }}>
          <button className={styles.btnSecondary} onClick={onCancel}>Cancel</button>
          <button className={styles.btnPrimary} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Form'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FormsTab() {
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  function load() {
    api.get('/forms/templates', { params: { include_archived: true } })
      .then(r => setTemplates(r.data))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function toggleArchive(t) {
    await api.put(`/forms/templates/${t.id}`, { archived: !t.archived });
    load();
  }

  async function remove(t) {
    if (!confirm(`Delete "${t.name}"?`)) return;
    try {
      await api.delete(`/forms/templates/${t.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Could not delete this form');
    }
  }

  if (editing) {
    return (
      <TemplateEditor
        template={editing}
        onSave={() => { setEditing(null); load(); }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  const visible = templates.filter(t => showArchived || !t.archived);

  return (
    <div className={styles.section}>
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2>Forms</h2>
          <button className={styles.btnPrimary} onClick={() => setEditing({ ...EMPTY })}>+ New Form</button>
        </div>
        <div className={styles.cardBody}>
          <p className={styles.hint} style={{ marginBottom: 14 }}>
            Build the Pre-Install and Post Install forms your team fills in on site. Attach them to a job type
            under Job Types &amp; Templates and they'll load automatically on every new job of that type.
            The Electrical COC is built in and doesn't appear here.
          </p>

          {loading ? <p className={styles.hint}>Loading…</p> : visible.length === 0 ? (
            <p className={styles.hint}>No forms yet.</p>
          ) : STAGES.map(stage => {
            const inStage = visible.filter(t => t.stage === stage.value);
            if (!inStage.length) return null;
            return (
              <div key={stage.value} style={{ marginBottom: 18 }}>
                <h3 className={styles.subHeading}>{stage.label}s</h3>
                {inStage.map(t => (
                  <div key={t.id} className={styles.templateRow} style={t.archived ? { opacity: 0.55 } : undefined}>
                    <div>
                      <div className={styles.templateName}>
                        {t.name}
                        {t.archived && <span className={styles.archivedTag}>Archived</span>}
                      </div>
                      <div className={styles.templateMeta}>
                        {(t.fields || []).filter(f => f.type !== 'section').length} fields
                        {parseInt(t.submission_count) > 0 && ` · used on ${t.submission_count} job${t.submission_count === '1' ? '' : 's'}`}
                        {t.description ? ` · ${t.description}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button className={styles.btnSmall} onClick={() => setEditing({ ...t, fields: t.fields || [] })}>Edit</button>
                      <button className={styles.btnSmall} onClick={() => toggleArchive(t)}>
                        {t.archived ? 'Restore' : 'Archive'}
                      </button>
                      <button className={styles.btnSmall} style={{ color: '#dc2626' }} onClick={() => remove(t)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}

          {templates.some(t => t.archived) && (
            <label className={styles.hint} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
              Show archived forms
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
