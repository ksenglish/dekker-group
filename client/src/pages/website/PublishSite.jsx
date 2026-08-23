import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

// Preview what's been built for the website, then publish it live.
//
// Changes land on a staging branch that Cloudflare builds to its own address.
// Preview opens that; Publish merges it into the live branch, which Cloudflare
// then builds to dekkerair.co.nz.

const card = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
};

const btn = (kind) => ({
  padding: '10px 20px', borderRadius: 6, fontSize: 14, fontWeight: 600,
  cursor: 'pointer', textDecoration: 'none', display: 'inline-block',
  ...(kind === 'primary'
    ? { background: 'var(--color-primary)', color: '#fff', border: 'none' }
    : { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }),
});

export default function PublishSite() {
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.get('/website/publish/status')
    .then(r => setState(r.data))
    .catch(() => setError('Could not check what is waiting to publish'));

  useEffect(() => { load(); }, []);

  async function publish() {
    const count = state?.pending?.length || 0;
    if (!confirm(`Publish ${count} change${count === 1 ? '' : 's'} to ${state.liveUrl}? This is the public website.`)) return;
    setPublishing(true); setError(null);
    try {
      const { data } = await api.post('/website/publish');
      setFlash(data.alreadyUpToDate
        ? 'Nothing to publish — the live site already matches.'
        : 'Published. The site rebuilds in a minute or two.');
      setTimeout(() => setFlash(null), 8000);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not publish');
    } finally { setPublishing(false); }
  }

  if (!state) {
    return <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{error || 'Checking…'}</div>;
  }

  const pending = state.pending || [];
  const canPublish = user?.role === 'admin' && state.configured && pending.length > 0;

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ ...card, padding: 22, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <span style={{
            fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
            background: pending.length ? '#fef3c7' : '#dcfce7',
            color: pending.length ? '#92400e' : '#166534',
          }}>
            {pending.length
              ? `${pending.length} change${pending.length === 1 ? '' : 's'} ready to publish`
              : 'Live site is up to date'}
          </span>
        </div>

        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.7, marginBottom: 18 }}>
          Changes to the website are built to a preview address first. Look at them
          there, and publish when you're happy — the live site rebuilds a minute or
          two later.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a href={state.previewUrl} target="_blank" rel="noreferrer" style={btn()}>
            👁 Preview
          </a>
          <a href={state.liveUrl} target="_blank" rel="noreferrer" style={btn()}>
            🌐 Live site
          </a>
          <button onClick={publish} disabled={!canPublish || publishing}
            style={{ ...btn('primary'), opacity: canPublish && !publishing ? 1 : 0.5, cursor: canPublish && !publishing ? 'pointer' : 'default' }}>
            {publishing ? 'Publishing…' : '🚀 Publish to live site'}
          </button>
        </div>

        {user?.role !== 'admin' && (
          <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 12 }}>
            You can preview changes; publishing to the live site is admin only.
          </p>
        )}
      </div>

      {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 14 }}>{error}</div>}
      {flash && <div style={{ background: '#dcfce7', color: '#166534', padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 14 }}>{flash}</div>}

      {!state.configured && (
        <div style={{ ...card, padding: 18, background: '#fffbeb', borderColor: '#fde68a', fontSize: 13, lineHeight: 1.8 }}>
          <strong>Publishing isn&rsquo;t connected yet.</strong> Preview works, but the Publish
          button needs a GitHub token with permission to push to{' '}
          <code>{state.repo}</code>, set on the server as <code>GITHUB_TOKEN</code>.
          Until then, changes go live by merging the staging branch by hand.
        </div>
      )}

      {state.error && (
        <div style={{ ...card, padding: 18, background: '#fffbeb', borderColor: '#fde68a', fontSize: 13 }}>
          Couldn&rsquo;t read the site&rsquo;s history: {state.error}
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--color-border)', fontSize: 14, fontWeight: 600 }}>
            Waiting to go live
          </div>
          {pending.map(c => (
            <div key={c.sha} style={{ padding: '12px 18px', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: 13.5 }}>{c.message}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3 }}>
                {c.author || 'Unknown'}
                {c.date ? ` · ${new Date(c.date).toLocaleDateString('en-NZ')}` : ''}
                {` · ${c.sha}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {state.behind > 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 14, lineHeight: 1.7 }}>
          The live site is {state.behind} commit{state.behind === 1 ? '' : 's'} ahead of staging
          in places — someone has changed the live branch directly. Worth a look before publishing.
        </p>
      )}
    </div>
  );
}
