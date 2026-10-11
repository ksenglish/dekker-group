import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../lib/api';
import { isAdmin } from '../../lib/permissions';
import { useAuth } from '../../context/AuthContext';
import styles from './AppUpdates.module.css';

// App Updates — describe a change to Dekker App and it gets made.
//
// The work happens on a worker running Claude Code elsewhere, so this is a
// queue rather than a chat: ask, wait, then read what it did before anything
// goes live. Polling only runs while something is actually in flight.
//
// The app cannot be previewed on a URL the way the website can — it is one
// service with one database behind it. So a finished change is judged on what
// the checks said and what the screen looked like afterwards, and publishing
// is a separate, deliberate step.

const STATUS = {
  queued:    { label: 'Waiting',       cls: 'stQueued' },
  running:   { label: 'Working on it', cls: 'stRunning' },
  done:      { label: 'Ready to review', cls: 'stDone' },
  failed:    { label: 'Did not work',  cls: 'stFailed' },
  cancelled: { label: 'Called off',    cls: 'stCancelled' },
  published: { label: 'Live',          cls: 'stPublished' },
};

const EXAMPLES = [
  'On the Costs tab, show the supplier name next to the date on every line.',
  'The Jobs list should default to sorting by job number, newest first.',
  'Add a “Notes” box to the customer form, under their phone number.',
];

const fmtWhen = d => (d ? new Date(d).toLocaleString('en-NZ', {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
}) : '');

function Shot({ jobId, shot }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let objectUrl;
    api.get(`/app-console/jobs/${jobId}/shots/${shot.id}`, { responseType: 'blob' })
      .then(r => { objectUrl = URL.createObjectURL(r.data); setUrl(objectUrl); })
      .catch(() => {});
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [jobId, shot.id]);
  if (!url) return <div className={styles.shotLoading} />;
  return (
    <figure className={styles.shot}>
      <img src={url} alt={shot.caption || 'What the screen looks like'} />
      {shot.caption && <figcaption>{shot.caption}</figcaption>}
    </figure>
  );
}

function JobDetail({ job, admin, onPublished }) {
  const [full, setFull] = useState(null);
  const [pub, setPub] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    api.get(`/app-console/jobs/${job.id}`).then(r => setFull(r.data)).catch(() => {});
    if (job.status === 'done') {
      api.get(`/app-console/jobs/${job.id}/publish-status`).then(r => setPub(r.data)).catch(() => {});
    }
  }, [job.id, job.status]);

  async function publish() {
    if (!confirm('Publish this change to the live app? Everyone will be on the new version once it deploys.')) return;
    setBusy(true); setErr('');
    try {
      await api.post(`/app-console/jobs/${job.id}/publish`);
      await onPublished();
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not publish that');
    } finally { setBusy(false); }
  }

  if (!full) return <div className={styles.detailLoading}>Loading…</div>;

  return (
    <div className={styles.detail}>
      {full.result && <p className={styles.summary}>{full.result}</p>}

      {full.checks?.length > 0 && (
        <div className={styles.checks}>
          {full.checks.map(c => (
            <span key={c.name} className={`${styles.check} ${c.ok ? styles.checkOk : styles.checkBad}`}>
              {c.ok ? '✓' : '✕'} {c.name}
              {c.detail && <em> · {c.detail}</em>}
            </span>
          ))}
        </div>
      )}

      {full.shots?.length > 0 && (
        <div className={styles.shots}>
          {full.shots.map(s => <Shot key={s.id} jobId={full.id} shot={s} />)}
        </div>
      )}

      {full.commits?.length > 0 && (
        <details className={styles.commits}>
          <summary>{full.commits.length} change{full.commits.length === 1 ? '' : 's'} to the code</summary>
          <ul>{full.commits.map(c => <li key={c.sha}><code>{c.sha}</code> {c.message}</li>)}</ul>
        </details>
      )}

      {full.status === 'done' && (
        <div className={styles.publishRow}>
          {pub && !pub.configured && (
            <span className={styles.publishNote}>
              Publishing is not set up on the server yet — no GitHub token.
            </span>
          )}
          {pub?.error && <span className={styles.publishNote}>{pub.error}</span>}
          {admin ? (
            <button className={styles.btnPublish} onClick={publish}
              disabled={busy || (pub && !pub.configured)}>
              {busy ? 'Publishing…' : '↑ Publish to the app'}
            </button>
          ) : (
            <span className={styles.publishNote}>
              Looks right? Ask an admin to publish it.
            </span>
          )}
          {err && <span className={styles.publishErr}>{err}</span>}
        </div>
      )}

      {full.status === 'published' && (
        <p className={styles.liveNote}>
          Published{full.published_by_name ? ` by ${full.published_by_name}` : ''}
          {full.published_at ? ` · ${fmtWhen(full.published_at)}` : ''}.
          It goes live once the deploy finishes, a few minutes later.
        </p>
      )}

      {full.log && (
        <>
          <button className={styles.logToggle} onClick={() => setShowLog(s => !s)}>
            {showLog ? 'Hide the detail' : 'Show the detail'}
          </button>
          {showLog && <pre className={styles.log}>{full.log}</pre>}
        </>
      )}
    </div>
  );
}

export default function AppUpdatesPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);
  const [jobs, setJobs] = useState([]);
  const [worker, setWorker] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const [j, w] = await Promise.all([
        api.get('/app-console/jobs'),
        api.get('/app-console/worker'),
      ]);
      setJobs(j.data);
      setWorker(w.data);
      return j.data;
    } catch {
      setError('Could not load the list of changes');
      return [];
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Polling only while something is in flight — a queue sitting idle should not
  // be asking the server anything.
  const busy = jobs.some(j => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    clearInterval(timer.current);
    if (!busy) return;
    timer.current = setInterval(load, 10000);
    return () => clearInterval(timer.current);
  }, [busy, load]);

  async function send(e) {
    e.preventDefault();
    const instruction = draft.trim();
    if (!instruction) return;
    setSending(true); setError('');
    try {
      await api.post('/app-console/jobs', { instruction });
      setDraft('');
      await load();
    } catch (e2) {
      setError(e2.response?.data?.error || 'Could not queue that');
    } finally { setSending(false); }
  }

  async function cancel(id) {
    try { await api.delete(`/app-console/jobs/${id}`); await load(); }
    catch (e) { setError(e.response?.data?.error || 'Could not call that off'); }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>App Updates</h1>
          <p className={styles.pageSubtitle}>
            Ask for a change to Dekker App, read what was done, then publish it
          </p>
        </div>
        {worker && (
          <span className={`${styles.worker} ${
            !worker.online ? styles.workerOff : worker.authed ? styles.workerOn : styles.workerWarn
          }`}>
            {!worker.online ? '○ Worker not running'
              : worker.authed ? '● Worker running' : '● Needs signing in'}
          </span>
        )}
      </div>

      {/* Running but signed out is the confusing case: the queue looks healthy
          and nothing is being taken off it. Said plainly, with the one command
          that fixes it. */}
      {worker?.online && worker.authed === false && (
        <div className={styles.offline}>
          The worker is running, but Claude is signed out on that machine, so nothing is being
          picked up. Anything asked for here will wait. On that machine, run{' '}
          <code className={styles.cmd}>claude auth login</code> and it will carry on by itself.
        </div>
      )}

      {worker && !worker.online && (
        <div className={styles.offline}>
          The machine that makes these changes is not running at the moment, so anything
          asked for here will wait until it is back on.
          {worker.lastSeen && <> Last seen {fmtWhen(worker.lastSeen)}.</>}
        </div>
      )}

      <form className={styles.ask} onSubmit={send}>
        <textarea rows={3} value={draft} onChange={e => setDraft(e.target.value)}
          placeholder="What would you like changed? Describe it the way you would to a colleague." />
        <div className={styles.askRow}>
          <span className={styles.examples}>
            For example: “{EXAMPLES[0]}”
          </span>
          <button className={styles.btnPrimary} disabled={sending || !draft.trim()}>
            {sending ? 'Queuing…' : 'Ask for this change'}
          </button>
        </div>
        {error && <div className={styles.error}>{error}</div>}
      </form>

      <div className={styles.jobs}>
        {jobs.length === 0 && <p className={styles.empty}>Nothing asked for yet.</p>}
        {jobs.map(j => {
          const st = STATUS[j.status] || STATUS.queued;
          const isOpen = open === j.id;
          return (
            <div key={j.id} className={styles.job}>
              <button className={styles.jobHead} onClick={() => setOpen(isOpen ? null : j.id)}>
                <span className={styles.arrow}>{isOpen ? '▾' : '▸'}</span>
                <span className={styles.instruction}>{j.instruction}</span>
                <span className={`${styles.status} ${styles[st.cls]}`}>{st.label}</span>
                <span className={styles.when}>
                  {j.created_by_name ? `${j.created_by_name} · ` : ''}{fmtWhen(j.created_at)}
                </span>
              </button>
              {j.status === 'queued' && (
                <button className={styles.cancel} onClick={() => cancel(j.id)}>Call it off</button>
              )}
              {isOpen && j.status !== 'queued' && (
                <JobDetail job={j} admin={admin} onPublished={load} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
