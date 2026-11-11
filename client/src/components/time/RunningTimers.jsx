// Who is on the clock right now.
//
// The timer used to live entirely in one browser's storage, so nobody but the
// person who started it knew it was going. The office could not see who was
// working; a timer left running over a weekend was invisible until it turned
// up as sixty hours on the Monday.
//
// Two places ask the same question. The job's own Time tab asks about that
// job — who is on site, since when. The dashboard asks about everybody, which
// is the office's view of the morning.
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { formatJobNumber } from '../../lib/formatJobNumber';
import styles from './RunningTimers.module.css';

// Counted from the start rather than ticked up, so a tab left open overnight
// shows the truth instead of however long it managed to stay awake.
function since(startedAt, now) {
  const mins = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const startedWhen = t => new Date(t).toLocaleTimeString('en-NZ',
  { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// A timer running far longer than anybody's day is the one worth looking at.
const LONG_HOURS = 10;
const isLong = (startedAt, now) => now - new Date(startedAt).getTime() > LONG_HOURS * 3600 * 1000;

export default function RunningTimers({ jobId, title = 'On the clock now', refreshKey, showJob = true }) {
  const [rows, setRows] = useState(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    api.get('/timesheets/timers', { params: jobId ? { job_id: jobId } : {} })
      .then(r => setRows(r.data))
      .catch(() => setRows([]));
  }, [jobId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // The clock on screen moves; the list is re-read far less often, because a
  // timer starting is not something anybody needs within the second.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30000);
    const poll = setInterval(load, 120000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [load]);

  if (!rows || rows.length === 0) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.dot} aria-hidden="true" />
        <strong>{title}</strong>
        <span className={styles.count}>{rows.length}</span>
      </div>
      <div className={styles.list}>
        {rows.map(t => (
          <div key={t.user_id} className={styles.row}>
            <div className={styles.who}>
              <span className={styles.name}>{t.user_name}</span>
              {showJob && (
                <Link to={`/jobs/${t.job_id}`} className={styles.job}>
                  {formatJobNumber(t) || 'job'}
                  {t.customer_name ? ` · ${t.customer_name}` : ''}
                </Link>
              )}
            </div>
            <div className={styles.timing}>
              <span className={styles.from}>from {startedWhen(t.started_at)}</span>
              <span className={isLong(t.started_at, now) ? styles.longElapsed : styles.elapsed}>
                {since(t.started_at, now)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
