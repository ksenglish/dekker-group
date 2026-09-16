import { useState, useEffect, useRef } from 'react';
import styles from './TeamMemberMultiSelect.module.css';

// Checkbox dropdown for assigning more than one team member to the same
// note/appointment. `options` is [{id, name, hint}]; `selected` is an array of
// ids. `hint` is optional trailing text on the row — the scheduler uses it to
// mark who isn't on the job yet.
export default function TeamMemberMultiSelect({ options, selected, onChange, placeholder = 'Select team member(s)…' }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Stays open while people are ticked and unticked, and closes on a click
  // anywhere outside it — or Escape, or the button again. It used to close when
  // the button lost focus, which happens the moment a checkbox is clicked, so it
  // shut after every single tick.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    // mousedown and touchstart rather than click, so a click that starts inside
    // (say, dragging the list's scrollbar) and ends outside doesn't close it.
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? (options.find(o => o.id === selected[0])?.name || '1 selected')
      : `${selected.length} team members selected`;

  function toggle(id) {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button type="button" className={styles.trigger} aria-expanded={open}
        onClick={() => setOpen(o => !o)}>
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
              {o.hint && <span className={styles.optionHint}>{o.hint}</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
