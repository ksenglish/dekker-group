import { useState } from 'react';
import api from '../../lib/api';
import styles from './ServiceReport.module.css';

// Rates for the people who worked on the job, where the job's own rate is not
// the whole story: an electrician and an installer share a van, so the trip is
// charged once, and the installer's hours go out lower than the sparky's.
//
// Blank means "charge them the way the job says", which is how someone goes
// back to normal — nothing here has to be filled in.

const money = cents => {
  const n = (cents || 0) / 100;
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const hoursLabel = p => [
  p.hours > 0 ? `${p.hours}h` : null,
  p.travel_hours > 0 ? `${p.travel_hours}h travel` : null,
].filter(Boolean).join(' · ') || 'no hours';

function PersonRow({ jobId, person, jobRates, onChanged }) {
  const [labour, setLabour] = useState(person.labour_rate == null ? '' : String(person.labour_rate));
  const [mode, setMode] = useState(person.travel_mode || '');
  const [rate, setRate] = useState(person.travel_rate == null ? '' : String(person.travel_rate));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save(next = {}) {
    const body = {
      labour_rate: 'labour' in next ? next.labour : labour,
      travel_mode: 'mode' in next ? next.mode : mode,
      travel_rate: 'rate' in next ? next.rate : rate,
    };
    // An empty box is "no override", not zero.
    if (body.labour_rate === '') body.labour_rate = null;
    if (body.travel_mode === '') { body.travel_mode = null; body.travel_rate = null; }
    else if (body.travel_rate === '') body.travel_rate = 0;

    setBusy(true); setErr('');
    try {
      await api.put(`/jobs/${jobId}/service-report/rates/${person.user_id}`, body);
      await onChanged();
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not save that');
    } finally { setBusy(false); }
  }

  function changeMode(value) {
    setMode(value);
    // Switching to a charged mode with nothing typed starts from whatever the
    // job charges, rather than silently from zero.
    const starting = value && rate === ''
      ? String(jobRates.travel_rate ?? jobRates.house_travel_rate ?? 0)
      : rate;
    setRate(value ? starting : '');
    save({ mode: value, rate: value ? starting : '' });
  }

  return (
    <div className={styles.personRow}>
      <span className={styles.personName}>
        {person.name}
        <em>{hoursLabel(person)}</em>
      </span>

      <label className={styles.personField}>
        Labour
        $<input type="number" step="0.01" min="0" value={labour} disabled={busy}
          placeholder={String(jobRates.labour_rate ?? jobRates.house_labour_rate ?? 0)}
          title="Charge rate per hour for this person on this job. Blank uses the job's rate."
          onChange={e => setLabour(e.target.value)}
          onBlur={() => save()} />
        /h
      </label>

      <label className={styles.personField}>
        Travel
        <select value={mode} disabled={busy || person.travel_hours === 0}
          onChange={e => changeMode(e.target.value)}>
          <option value="">As per job</option>
          <option value="hourly">Hourly</option>
          <option value="fixed">Per trip</option>
          <option value="none">No charge</option>
        </select>
        {(mode === 'hourly' || mode === 'fixed') && (
          <>
            $<input type="number" step="0.01" min="0" value={rate} disabled={busy}
              onChange={e => setRate(e.target.value)} onBlur={() => save()} />
            {mode === 'hourly' ? '/h' : '/trip'}
          </>
        )}
      </label>

      <span className={styles.personCharge}>{money(person.charge_cents)}</span>
      {err && <span className={styles.personErr}>{err}</span>}
    </div>
  );
}

export default function PersonRates({ jobId, rates, onChanged }) {
  const [open, setOpen] = useState(false);
  const people = (rates?.people || []).filter(p => p.user_id);
  if (!people.length) return null;

  const set = people.filter(p => p.labour_rate != null || p.travel_mode).length;

  return (
    <div className={styles.personPanel}>
      <button className={styles.personToggle} onClick={() => setOpen(o => !o)}>
        <span className={styles.treeArrow}>{open ? '▾' : '▸'}</span>
        Rates by team member
        <em>
          {people.length} on this job
          {set > 0 && ` · ${set} on their own rate`}
        </em>
      </button>
      {open && (
        <div className={styles.personRows}>
          {people.map(p => (
            <PersonRow key={p.user_id} jobId={jobId} person={p} jobRates={rates} onChanged={onChanged} />
          ))}
          <p className={styles.personHint}>
            Blank charges them the way the job does. “No charge” leaves their travel on the
            report at $0.00 — the hours still show, which is what a passenger in the van looks like.
          </p>
        </div>
      )}
    </div>
  );
}
