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
// Used by the Log Time form and by the timer on a job, because it is the same
// question and two of them would not stay the same for long.
import styles from './OutsideScheduleDialog.module.css';

export default function OutsideScheduleDialog({ warning, busy, onCancel, onConfirm }) {
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
          <p className={styles.note}>
            Nothing has been recorded yet. If you record these hours anyway, the
            office is emailed so they can check the job before it is invoiced.
          </p>
          <p className={styles.note}>
            If they belong on another job, cancel and change the job.
          </p>
        </div>

        <div className={styles.foot}>
          <button type="button" className={styles.cancel} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={styles.confirm} onClick={onConfirm} disabled={busy}>
            {busy ? 'Recording…' : 'Record anyway'}
          </button>
        </div>
      </div>
    </div>
  );
}
