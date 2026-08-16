import { useEffect, useState } from 'react';
import api from '../../lib/api';

const PAGES = ['', 'Home', 'Heating', 'Cooling', 'Ventilation', 'HVAC Servicing', 'Latest Deals', 'Contact Us', 'Whole site'];

const STATUS_STYLE = {
  open: { background: '#dbeafe', color: '#1e40af', label: 'Open' },
  in_progress: { background: '#fef3c7', color: '#92400e', label: 'In progress' },
  done: { background: '#dcfce7', color: '#166534', label: 'Done' },
  dismissed: { background: '#f1f5f9', color: '#475569', label: 'Dismissed' },
};

const card = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
};
const input = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)',
  borderRadius: 6, fontSize: 14, fontFamily: 'inherit',
};
const label = { fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4, color: 'var(--color-text-muted)' };

export default function WebsiteRequests() {
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({ title: '', details: '', page: '' });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showDone, setShowDone] = useState(false);

  const load = () => api.get('/website/requests').then(r => setRequests(r.data)).catch(() => setError('Could not load requests'));
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true); setError(null);
    try {
      let mediaId = null;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        const { data } = await api.post('/website/media', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        mediaId = data.id;
      }
      await api.post('/website/requests', { ...form, mediaId });
      setForm({ title: '', details: '', page: '' }); setFile(null);
      await load();
    } catch (e2) {
      setError(e2.response?.data?.error || 'Could not save that request');
    } finally { setSaving(false); }
  }

  async function setStatus(id, status) {
    await api.patch(`/website/requests/${id}`, { status }).catch(() => {});
    load();
  }

  const visible = requests.filter(r => showDone || ['open', 'in_progress'].includes(r.status));
  const openCount = requests.filter(r => r.status === 'open').length;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 24, alignItems: 'start' }}>
      <form onSubmit={submit} style={{ ...card, padding: 18 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Log a request</h3>
        <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
          Note anything you want changed on the site. This is a list, not a notification —
          Claude picks these up next time you're working together, so mention it in chat if
          it's urgent.
        </p>

        <div style={{ marginBottom: 12 }}>
          <label style={label}>What needs changing? *</label>
          <input style={input} value={form.title} required
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Phone number wrong in the footer" />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={label}>Which page?</label>
          <select style={{ ...input, cursor: 'pointer' }} value={form.page}
            onChange={e => setForm(f => ({ ...f, page: e.target.value }))}>
            {PAGES.map(p => <option key={p} value={p}>{p || 'Not sure / general'}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={label}>Details</label>
          <textarea style={{ ...input, minHeight: 90, resize: 'vertical' }} value={form.details}
            onChange={e => setForm(f => ({ ...f, details: e.target.value }))}
            placeholder="What it says now, and what it should say instead" />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Screenshot (optional)</label>
          <input type="file" accept="image/*" style={{ fontSize: 13 }}
            onChange={e => setFile(e.target.files?.[0] || null)} />
        </div>

        {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>{error}</div>}

        <button type="submit" disabled={saving}
          style={{ width: '100%', padding: '10px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : 'Add to the list'}
        </button>
      </form>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600 }}>
            {openCount} open {openCount === 1 ? 'request' : 'requests'}
          </h3>
          <label style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--color-text-muted)', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
            Show finished
          </label>
        </div>

        {visible.length === 0 ? (
          <div style={{ ...card, padding: 28, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
            Nothing on the list.
          </div>
        ) : visible.map(r => {
          const s = STATUS_STYLE[r.status] || STATUS_STYLE.open;
          return (
            <div key={r.id} style={{ ...card, padding: 16, marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, ...s }}>{s.label}</span>
                    {r.page && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{r.page}</span>}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{r.title}</div>
                  {r.details && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6, marginTop: 4, whiteSpace: 'pre-wrap' }}>{r.details}</p>}
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 6 }}>
                    {r.created_by_name || 'Someone'} · {new Date(r.created_at).toLocaleDateString('en-NZ')}
                  </div>
                </div>

                {r.media_id && (
                  <a href={`/api/public/website/media/${r.media_id}`} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
                    <img src={`/api/public/website/media/${r.media_id}`} alt="Screenshot"
                      style={{ width: 90, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--color-border)' }} />
                  </a>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {['open', 'in_progress', 'done', 'dismissed']
                  .filter(v => v !== r.status)
                  .map(v => (
                    <button key={v} onClick={() => setStatus(r.id, v)}
                      style={{ padding: '5px 11px', fontSize: 12, borderRadius: 5, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer' }}>
                      Mark {STATUS_STYLE[v].label.toLowerCase()}
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
