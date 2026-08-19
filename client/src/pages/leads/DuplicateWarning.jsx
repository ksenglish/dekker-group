import { Link } from 'react-router-dom';
import styles from './Leads.module.css';

const MATCH_LABEL = { name: 'Name', email: 'Email', mobile: 'Mobile', address: 'Address' };

// Shows who this lead might already be, and whether there's work already
// booked at the address. Purely advisory — a genuine second enquiry from the
// same person is normal, so nothing here blocks saving.
//
// `onMerge` is only passed once the lead exists; while it's still being typed
// there's nothing to merge yet.
export default function DuplicateWarning({ dupes, onMerge, merging }) {
  const customers = dupes?.customers || [];
  const jobs = dupes?.jobs || [];
  if (!customers.length && !jobs.length) return null;

  return (
    <div className={styles.dupeBox}>
      {customers.length > 0 && (
        <>
          <div className={styles.dupeHead}>
            ⚠ {customers.length === 1 ? 'This may already be a customer' : 'These may already be customers'}
          </div>
          {customers.map(c => (
            <div key={c.id} className={styles.dupeRow}>
              <div className={styles.dupeWho}>
                <Link to={`/customers/${c.id}`} className={styles.dupeName}>{c.name}</Link>
                <span className={styles.dupeDetail}>
                  {[c.mobile, c.email, c.address].filter(Boolean).join(' · ') || 'No contact details'}
                </span>
              </div>
              <div className={styles.dupeTags}>
                {c.matched_on.map(m => (
                  <span key={m} className={styles.dupeTag}>{MATCH_LABEL[m] || m} matches</span>
                ))}
              </div>
              {onMerge && (
                <button type="button" className={styles.dupeMergeBtn}
                  disabled={merging} onClick={() => onMerge(c)}>
                  {merging ? 'Merging…' : 'Merge'}
                </button>
              )}
            </div>
          ))}
        </>
      )}

      {jobs.length > 0 && (
        <>
          <div className={styles.dupeHead} style={{ marginTop: customers.length ? 12 : 0 }}>
            ⚠ {jobs.length === 1 ? 'A job already exists at this address' : 'Jobs already exist at this address'}
          </div>
          {jobs.map(j => (
            <div key={j.id} className={styles.dupeRow}>
              <div className={styles.dupeWho}>
                <Link to={`/jobs/${j.id}`} className={styles.dupeName}>
                  {j.external_ref || (j.job_number != null ? `JB${String(j.job_number).padStart(5, '0')}` : 'Job')}
                </Link>
                <span className={styles.dupeDetail}>
                  {[j.customer_name, j.description].filter(Boolean).join(' · ').slice(0, 90) || '—'}
                </span>
              </div>
              <div className={styles.dupeTags}>
                <span className={styles.dupeTag}>{String(j.status || '').replace('_', ' ')}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
