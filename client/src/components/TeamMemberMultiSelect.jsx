import { useState } from 'react';
import styles from './TeamMemberMultiSelect.module.css';

// Checkbox dropdown for assigning more than one team member to the same
// note/appointment. `options` is [{id, name}]; `selected` is an array of ids.
export default function TeamMemberMultiSelect({ options, selected, onChange, placeholder = 'Select team member(s)…' }) {
  const [open, setOpen] = useState(false);

  const label = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? (options.find(o => o.id === selected[0])?.name || '1 selected')
      : `${selected.length} team members selected`;

  function toggle(id) {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  }

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.trigger}
        onClick={() => setOpen(o => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}>
        <span className={selected.length === 0 ? styles.placeholder : undefined}>{label}</span>
        <span className={styles.chevron}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className={styles.dropdown}>
          {options.length === 0 && <div className={styles.empty}>No team members found.</div>}
          {options.map(o => (
            <label key={o.id} className={styles.option}>
              <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
              {o.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
