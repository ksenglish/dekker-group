import { useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../lib/api';
import { toLocalDateStr } from '../../lib/date';
import styles from './StopTimerDialog.module.css';

// Stopping somebody else's timer, from the office.
//
// The case this is for: a timer that has been going since yesterday morning
// because the stop never got through, or because whoever started it has gone
// home. Until now the only way to clear it was to ring them and ask them to
// open the job and press stop — and the hours still had to be reconstructed
// by hand afterwards.
//
// Two different things can be wanted here and they are offered as two
// buttons, because getting them the wrong way round is expensive:
//
//   Record the hours   They did the work; the clock just kept running. The
//                      finish time is editable because 7am-to-now is almost
//                      never what actually happened.
//
//   Stop, record none  The timer was started by mistake, or the hours are
//                      already on the timesheet from somewhere else. Nothing
//                      is written; the timer simply stops.
//
// The hours go in as an ordinary timesheet entry against that person, through
// the same diary check and rate check as anything else — this is not a back
// door that writes hours nobody looked at.

// 'YYYY-MM-DDTHH:mm' in the browser's own zone, which is what a datetime-local
// input wants and what the person reading the screen is thinking in.
function localInput(at) {
  const d = new Date(at);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Quarter hours, the way the timer itself rounds, with a floor of a quarter so
// a two-minute entry is not recorded as nothing.
const hoursBetween = (from, to) => {
  const secs = Math.max(0, (to - from) / 1000);
  return secs < 60 ? 0.25 : Math.max(0.25, Math.round(secs / 900) * 0.25);
};

export default function StopTimerDialog({ timer, rates = [], onClose, onDone }) {
  const [from, setFrom] = useState(localInput(timer.started_at));
  const [to, setTo] = useState(localInput(Date.now()));
  const [rateId, setRateId] = useState(timer.billing_rate_id || '');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // The diary's answer, when it has one. Nothing is written until it is
  // acknowledged and answered, the same as everywhere else time is recorded.
  const [warning, setWarning] = useState('');
  const [reason, setReason] = useState('');

  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const sane = Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs;
  const hours = sane ? hoursBetween(fromMs, toMs) : 0;

  async function justStop() {
    setBusy('stop');
    setError('');
    try {
      await api.delete(`/timesheets/timer/${timer.user_id}`);
      onDone?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not stop that timer');
    } finally { setBusy(''); }
  }

  async function recordAndStop(acknowledged, scheduleReason) {
    if (!sane) { setError('The finish time has to be after the start time.'); return; }
    setBusy('record');
    setError('');
    try {
      await api.post('/timesheets', {
        user_id: timer.user_id,
        job_id: timer.job_id,
        date: toLocalDateStr(new Date(fromMs)),
        hours,
        description: desc || 'Timer stopped by the office',
        start_time: new Date(fromMs).toISOString(),
        end_time: new Date(toMs).toISOString(),
        source: 'timer',
        billing_rate_id: rateId || null,
        acknowledged,
        schedule_reason: scheduleReason || undefined,
      });
      // Only once the hours are safely recorded. Stopping first and failing
      // here would lose both the timer and the time.
      await api.delete(`/timesheets/timer/${timer.user_id}`);
      onDone?.();
      onClose();
    } catch (err) {
      const body = err.response?.data;
      if (body?.needs_confirmation) { setWarning(body.warning); return; }
      setError(body?.error || 'Could not record those hours');
    } finally { setBusy(''); }
  }

  return createPortal(
    <div className={styles.overlay}>
      <div className={styles.box} role="dialog" aria-modal="true" aria-label="Stop this timer">
        <div className={styles.head}>
          <h2>{timer.user_name}’s timer</h2>
          <p>
            Running since {new Date(timer.started_at).toLocaleString('en-NZ', {
              weekday: 'short', day: 'numeric', month: 'short',
              hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
            })}
            {timer.customer_name ? ` · ${timer.customer_name}` : ''}
          </p>
        </div>

        {warning ? (
          <div className={styles.body}>
            <div className={styles.warning}>
              <strong>Hours outside of scheduled time</strong>
              <p>{warning}</p>
            </div>
            {/* Asked here too. Hours the office records for somebody else are
                the ones most in need of a line saying where they came from —
                the person whose hours they are is not in the room. */}
            <label className={styles.field}>
              <span>Why were these outside the booking? (required)</span>
              <input type="text" value={reason} maxLength={400}
                onChange={e => setReason(e.target.value)}
                placeholder="e.g. Rang in — on site until 5, timer left running" />
            </label>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary}
                onClick={() => setWarning('')}>Back</button>
              <button type="button" className={styles.primary}
                disabled={busy !== '' || reason.trim().length < 5}
                onClick={() => { const r = reason.trim(); setWarning(''); recordAndStop(true, r); }}>
                Record anyway
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.body}>
            <div className={styles.fields}>
              <label className={styles.field}>
                <span>Started</span>
                <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Finished</span>
                <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />
              </label>
            </div>

            {rates.length > 0 && (
              <label className={styles.field}>
                <span>Billing rate</span>
                <select value={rateId} onChange={e => setRateId(e.target.value)}>
                  <option value="">No rate</option>
                  {rates.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </label>
            )}

            <label className={styles.field}>
              <span>What they were doing</span>
              <input type="text" value={desc} onChange={e => setDesc(e.target.value)}
                placeholder="Timer stopped by the office" />
            </label>

            <div className={sane ? styles.total : styles.totalBad}>
              {sane
                ? <>That records <strong>{hours.toFixed(2)} hours</strong> against {timer.user_name.split(' ')[0]}.</>
                : 'The finish time has to be after the start time.'}
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.actions}>
              <button type="button" className={styles.quiet}
                disabled={busy !== ''} onClick={justStop}>
                {busy === 'stop' ? 'Stopping…' : 'Stop, record nothing'}
              </button>
              <button type="button" className={styles.secondary} onClick={onClose}>Cancel</button>
              <button type="button" className={styles.primary}
                disabled={busy !== '' || !sane} onClick={() => recordAndStop(false)}>
                {busy === 'record' ? 'Saving…' : 'Record the hours and stop'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
