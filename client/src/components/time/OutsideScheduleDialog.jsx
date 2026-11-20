// Hours that do not match the diary, offered back before they are recorded.
//
// This used to be a browser alert() after the fact — headed with the site's
// own domain, with nothing to press but OK, and raised once the entry was
// already saved and the office already emailed. So the only way to undo a
// mistyped afternoon was to go and delete it, and the office had a message
// about an entry that no longer existed.
//
// Now nothing is written until this is answered. Cancel leaves no entry and
// sends no email; recording it anyway does both, which is the point of saying
// so plainly on the button.
//
// And it asks why, because the office's first question when that email lands
// was always why, and the answer was a phone call to somebody who by then was
// on another roof. Asked here it costs one line and arrives with the question.
// Required, not optional: an optional box on a dialog somebody is trying to
// get past is a box nobody fills in.
//
// Used by the Log Time form and by the timer on a job, because it is the same
// question and two of them would not stay the same for long.
import { useState } from 'react';
import styles from './OutsideScheduleDialog.module.css';

// Enough to be worth reading. Short is fine — "picked up the gib on the way"
// is an answer — but it has to be words. The server holds the same line, so
// this is about saying so before the round trip rather than instead of it.
const MIN_REASON = 5;

export default function OutsideScheduleDialog({ warning, busy, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const enough = reason.trim().length >= MIN_REASON;

  function confirm() {
    setTried(true);
    if (!enough) return;
    onConfirm(reason.trim());
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="outside-schedule-title">
      <div className={styles.dialog}>
        <div className={styles.head}>
          <h2 id="outside-schedule-title" className={styles.title}>
            WARNING — Hours outside of scheduled time
          </h2>
        </div>

        <div className={styles.body}>
          <p className={styles.warning}>{warning}</p>

          <label className={styles.reason}>
            <span className={styles.reasonLabel}>
              Why were these hours outside the booking? <em>Required</em>
            </span>
            <textarea
              autoFocus
              rows={3}
              value={reason}
              maxLength={400}
              disabled={busy}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Picked up materials from Bunnings first, or stayed on to finish the run"
              aria-invalid={tried && !enough}
            />
            {tried && !enough && (
              <span className={styles.reasonBad}>
                The office is asked to approve these hours — say why so they can.
              </span>
            )}
          </label>

          <p className={styles.note}>
            Nothing has been recorded yet. If you record these hours anyway, the
            office is emailed with what you have written here, and the entry stays
            flagged on your timesheet until they approve it.
          </p>
          <p className={styles.note}>
            If they belong on another job, cancel and change the job.
          </p>
        </div>

        <div className={styles.foot}>
          <button type="button" className={styles.cancel} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={styles.confirm} onClick={confirm} disabled={busy || !enough}>
            {busy ? 'Recording…' : 'Record anyway'}
          </button>
        </div>
      </div>
    </div>
  );
}
