import { useState } from 'react';
import { overlayClose } from '../../lib/overlayClose';
import styles from './Quotes.module.css';

// Pressing Accepted on a quote that is already accepted.
//
// Accepting for the first time carries the quote onto the job by itself. Doing
// it again is a different act: the quote has been edited since, and somebody is
// deciding whether that edit should reach the job. The two halves of "reaching
// the job" are not equally safe, so they are asked separately.
//
//   Line items  — a replace. Anything added to the job from Costs or Time goes.
//   Materials   — additive. Hand-added lines and anything already ordered stay.
export default function ReacceptModal({ onClose, onConfirm, busy }) {
  const [lineItems, setLineItems] = useState(true);
  const [materials, setMaterials] = useState(true);

  return (
    <div className={styles.overlay} {...overlayClose(onClose)}>
      <div className={styles.modal} style={{ maxWidth: 520 }}>
        <div className={styles.modalHeader}>
          <h2>Update the job from this quote?</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '18px' }}>
          <p className={styles.reacceptIntro}>
            This quote is already accepted. Choose what should be carried across
            to the job now that it has changed.
          </p>

          <label className={styles.reacceptOption}>
            <input type="checkbox" checked={lineItems} onChange={e => setLineItems(e.target.checked)} />
            <span>
              <strong>Replace the job&apos;s line items</strong>
              <em>
                The job&apos;s line items are replaced by this quote&apos;s. Anything added to the
                job from Costs or Time will be removed.
              </em>
            </span>
          </label>

          <label className={styles.reacceptOption}>
            <input type="checkbox" checked={materials} onChange={e => setMaterials(e.target.checked)} />
            <span>
              <strong>Update the materials list</strong>
              <em>
                Adds anything new this quote calls for. What was added by hand, and
                anything already ordered, is left alone.
              </em>
            </span>
          </label>

          {!lineItems && !materials && (
            <p className={styles.reacceptNote}>
              With neither ticked this just saves the quote and leaves the job as it is.
            </p>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.btnSecondary} onClick={onClose}>Cancel</button>
          <button className={styles.btnPrimary} disabled={busy}
            onClick={() => onConfirm({ sync_line_items: lineItems, sync_materials: materials })}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
