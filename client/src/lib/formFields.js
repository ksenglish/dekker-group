// Field types available in the Form Builder.
// Keep in step with FIELD_TYPES in server/src/routes/forms.js.

export const FIELD_TYPES = [
  { type: 'section',  label: 'Section heading', hint: 'Splits the form into parts. No answer.' },
  { type: 'text',     label: 'Short text',      hint: 'One line — names, serial numbers, model.' },
  { type: 'textarea', label: 'Long text',       hint: 'Notes, observations, comments.' },
  { type: 'number',   label: 'Number',          hint: 'Readings, quantities, measurements.' },
  { type: 'date',     label: 'Date' },
  { type: 'select',   label: 'Dropdown',        hint: 'Pick one of your options.' },
  { type: 'checkbox', label: 'Tick box',        hint: 'Single confirmation — "I checked this".' },
  { type: 'yesno',    label: 'Yes / No' },
  { type: 'signoff',  label: 'Sign-off',        hint: 'Typed name and date, same as the Electrical COC.' },
  { type: 'photo',    label: 'Photo',           hint: 'One or more photos taken on site.' },
];

export const STAGES = [
  { value: 'pre_install',  label: 'Pre-Install Form' },
  { value: 'post_install', label: 'Post Install Form' },
];

export const typeLabel = t => FIELD_TYPES.find(f => f.type === t)?.label || t;
export const stageLabel = s => STAGES.find(x => x.value === s)?.label || s;

// Fields that hold an answer (everything but a heading)
export const isAnswerable = f => f.type !== 'section';

export function newFieldId() {
  return 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Has this field been answered? Used for required-field checks and progress.
export function isAnswered(field, value) {
  if (!isAnswerable(field)) return true;
  if (field.type === 'checkbox') return value === true;
  if (field.type === 'photo') return Array.isArray(value) && value.length > 0;
  if (field.type === 'signoff') return !!(value && String(value.name || '').trim());
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export function missingRequired(fields, answers) {
  return (fields || [])
    .filter(f => f.required && isAnswerable(f))
    .filter(f => !isAnswered(f, (answers || {})[f.id]))
    .map(f => f.label);
}
