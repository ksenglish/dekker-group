// Ask Claude — describe a website change and it gets made.
//
// The work happens on a worker running Claude Code elsewhere, so this is a
// queue rather than a chat: ask, wait a few minutes, read what it did, check
// the preview. Polling only runs while something is actually in flight.
import { useEffect, useRef, useState } from 'react';
import api from '../../lib/api';

const card = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
};

const STATUS = {
  queued: { label: 'Waiting', background: '#e0e7ff', color: '#3730a3' },
  running: { label: 'Working on it', background: '#fef3c7', color: '#92400e' },
  done: { label: 'Done', background: '#dcfce7', color: '#166534' },
  failed: { label: 'Did not work', background: '#fee2e2', color: '#b91c1c' },
  cancelled: { label: 'Called off', background: '#f1f5f9', color: '#475569' },
};

const EXAMPLES = [
  'The phone number in the footer is wrong — it should be 07 777 1234.',
  'Add a line under the heading on the HVAC Servicing page saying we offer same-day servicing.',
  'Take the winter heat pump deal off the Latest Deals page, it has finished.',
];

export default function WebsiteAgent({ openJob = null }) {
  const [jobs, setJobs] = useState([]);
  const [worker, setWorker] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [highlight, setHighlight] = useState(openJob);
  const box = useRef(null);

  const busy = jobs.some(j => j.status === 'queued' || j.status === 'running');

  async function load() {
    try {
      const { data } = await api.get('/website/jobs');
      setJobs(data.jobs);
      setWorker(data.worker);
      setPreviewUrl(data.previewUrl);
      return data.jobs;
    } catch {
      setError('Could not load the list of changes');
      return [];
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { if (openJob) setHighlight(openJob); }, [openJob]);

  // Poll only while something is queued or running, and stop as soon as the
  // list settles. A quiet page makes no requests.
  useEffect(() => {
    if (!busy) return undefined;
    const timer = setTimeout(load, 5000);
    return () => clearTimeout(timer);
  }, [busy, jobs]);

  async function submit(e) {
    e.preventDefault();
    const instruction = draft.trim();
    if (!instruction || sending) return;
    setSending(true); setError(null);
    try {
      const { data } = await api.post('/website/jobs', { instruction });
      setDraft('');
      setHighlight(data.id);
      await load();
      box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add that to the list');
    } finally { setSending(false); }
  }

  async function cancel(id) {
    try { await api.delete(`/website/jobs/${id}`); }
    catch (err) { setError(err.response?.data?.error || 'Could not call that off'); }
    load();
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 24, alignItems: 'start' }}>
      <div>
        <form onSubmit={submit} style={{ ...card, padding: 18 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Ask for a change</h3>
          <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 14, lineHeight: 1.6 }}>
            Describe it the way you would to a person. The change goes to the preview site first,
            and stays there until someone publishes it.
          </p>

          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="What needs changing?"
            style={{ width: '100%', minHeight: 96, padding: '10px 12px', border: '1px solid var(--color-border)',
              borderRadius: 6, fontSize: 13.5, fontFamily: 'inherit', resize: 'vertical', marginBottom: 12 }}
          />

          <button type="submit" disabled={sending || !draft.trim()}
            style={{ width: '100%', padding: 10, background: 'var(--color-primary)', color: '#fff', border: 'none',
              borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              opacity: (sending || !draft.trim()) ? 0.6 : 1 }}>
            {sending ? 'Adding…' : 'Ask Claude'}
          </button>

          {error && (
            <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 6,
              fontSize: 13, marginTop: 12 }}>{error}</div>
          )}
        </form>

        <WorkerNotice worker={worker} />

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 7 }}>
            FOR EXAMPLE
          </div>
          {EXAMPLES.map(x => (
            <button key={x} type="button" onClick={() => setDraft(x)}
              style={{ display: 'block', textAlign: 'left', width: '100%', marginBottom: 6, padding: '8px 11px',
                border: '1px dashed var(--color-border)', borderRadius: 6, background: 'transparent',
                cursor: 'pointer', fontSize: 12, color: 'var(--color-text-muted)', fontFamily: 'inherit',
                lineHeight: 1.5 }}>
              {x}
            </button>
          ))}
        </div>
      </div>

      <div ref={box}>
        {jobs.length === 0 ? (
          <div style={{ ...card, padding: 28, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
            Nothing asked for yet.
          </div>
        ) : jobs.map(job => (
          <Job key={job.id} job={job} previewUrl={previewUrl}
            highlighted={job.id === highlight} onCancel={() => cancel(job.id)} />
        ))}
      </div>
    </div>
  );
}

// Work only happens while the worker is running, so silence about it would
// leave someone waiting on a change that nothing is going to pick up.
function WorkerNotice({ worker }) {
  if (!worker) return null;
  if (worker.online) {
    return (
      <div style={{ marginTop: 12, fontSize: 12, color: '#166534', display: 'flex', gap: 7, alignItems: 'center' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16a34a' }} />
        Claude is running and picking up changes
      </div>
    );
  }
  return (
    <div style={{ marginTop: 12, padding: '10px 12px', background: '#fef3c7', color: '#92400e',
      borderRadius: 6, fontSize: 12.5, lineHeight: 1.6 }}>
      {worker.everRun
        ? <>Claude is not running at the moment, so anything you ask for will wait in the list until it is.
            It was last on {new Date(worker.lastSeen).toLocaleString('en-NZ')}.</>
        : <>Claude has not been set up to pick these up yet. Ask Kyle to start the website worker.</>}
    </div>
  );
}

function Job({ job, previewUrl, highlighted, onCancel }) {
  const s = STATUS[job.status] || STATUS.queued;
  return (
    <div style={{ ...card, padding: 16, marginBottom: 12,
      outline: highlighted ? '2px solid var(--color-primary)' : 'none' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, ...s }}>{s.label}</span>
        <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
          {job.createdByName || 'Someone'} · {new Date(job.createdAt).toLocaleString('en-NZ')}
        </span>
        {job.status === 'queued' && (
          <button onClick={onCancel}
            style={{ marginLeft: 'auto', padding: '3px 9px', fontSize: 11.5, borderRadius: 5,
              border: '1px solid var(--color-border)', background: 'transparent', cursor: 'pointer' }}>
            Call it off
          </button>
        )}
      </div>

      <div style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: job.result ? 12 : 0 }}>
        {job.instruction}
      </div>

      {job.result && (
        <div style={{ fontSize: 13.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', paddingTop: 12,
          borderTop: '1px solid var(--color-border)',
          color: job.status === 'failed' ? '#b91c1c' : 'inherit' }}>
          {job.result}
        </div>
      )}

      {job.commits?.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
          {job.commits.map(c => <div key={c.sha}>· {c.message}</div>)}
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noreferrer"
              style={{ display: 'inline-block', marginTop: 6, color: 'var(--color-primary)', fontWeight: 600, fontSize: 12.5 }}>
              Check it on the preview site
            </a>
          )}
        </div>
      )}
    </div>
  );
}
