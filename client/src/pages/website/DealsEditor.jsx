import { useEffect, useRef, useState } from 'react';
import api from '../../lib/api';

const SITE_URL = 'https://dekkerair.co.nz';

const SERVICES = [
  { value: '', label: 'No service page link' },
  { value: 'heating', label: 'Heating' },
  { value: 'cooling', label: 'Cooling' },
  { value: 'ventilation', label: 'Ventilation' },
  { value: 'hvac-servicing', label: 'HVAC Servicing' },
];

const card = {
  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)', overflow: 'hidden',
};
const input = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)',
  borderRadius: 6, fontSize: 14, fontFamily: 'inherit',
};
const label = { fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4, color: 'var(--color-text-muted)' };
const btn = (kind) => ({
  padding: '9px 18px', borderRadius: 6, fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer',
  ...(kind === 'primary' ? { background: 'var(--color-primary)', color: '#fff' }
    : kind === 'danger' ? { background: '#fee2e2', color: '#b91c1c' }
      : { background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }),
});

const blankDeal = () => ({
  id: `deal-${Date.now()}`,
  badge: 'Special', title: '', price: '', priceNote: 'installed',
  image: '', imageAlt: '', hook: '', body: '', terms: 'T&Cs apply.',
  service: '', expires: '',
});

function DealRow({ deal, index, total, onChange, onMove, onDelete, onUpload, uploading }) {
  const [open, setOpen] = useState(!deal.title);
  const fileRef = useRef(null);
  const set = (k, v) => onChange({ ...deal, [k]: v });

  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        borderBottom: open ? '1px solid var(--color-border)' : 'none',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button onClick={() => onMove(index, -1)} disabled={index === 0} title="Move up"
            style={{ ...btn(), padding: '0 6px', fontSize: 11, opacity: index === 0 ? 0.3 : 1 }}>▲</button>
          <button onClick={() => onMove(index, 1)} disabled={index === total - 1} title="Move down"
            style={{ ...btn(), padding: '0 6px', fontSize: 11, opacity: index === total - 1 ? 0.3 : 1 }}>▼</button>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{deal.title || 'Untitled deal'}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            {[deal.price, deal.expires ? `ends ${deal.expires}` : 'no expiry'].filter(Boolean).join(' · ')}
          </div>
        </div>

        <button onClick={() => setOpen(o => !o)} style={btn()}>{open ? 'Close' : 'Edit'}</button>
        <button onClick={() => onDelete(index)} style={btn('danger')}>Delete</button>
      </div>

      {open && (
        <div style={{ padding: 16, display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div><label style={label}>Badge</label>
              <input style={input} value={deal.badge || ''} onChange={e => set('badge', e.target.value)} placeholder="Winter deal" /></div>
            <div><label style={label}>Price</label>
              <input style={input} value={deal.price || ''} onChange={e => set('price', e.target.value)} placeholder="From $1,695" /></div>
            <div><label style={label}>Price note</label>
              <input style={input} value={deal.priceNote || ''} onChange={e => set('priceNote', e.target.value)} placeholder="installed" /></div>
          </div>

          <div><label style={label}>Title *</label>
            <input style={input} value={deal.title || ''} onChange={e => set('title', e.target.value)} placeholder="Rinnai high wall heat pump" /></div>

          <div><label style={label}>Hook — the one-line pitch</label>
            <input style={input} value={deal.hook || ''} onChange={e => set('hook', e.target.value)} /></div>

          <div><label style={label}>Body</label>
            <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} value={deal.body || ''} onChange={e => set('body', e.target.value)} /></div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div><label style={label}>Terms</label>
              <input style={input} value={deal.terms || ''} onChange={e => set('terms', e.target.value)} /></div>
            <div><label style={label}>Links to</label>
              <select style={{ ...input, cursor: 'pointer' }} value={deal.service || ''} onChange={e => set('service', e.target.value)}>
                {SERVICES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select></div>
            <div><label style={label}>Ends (blank = no expiry)</label>
              <input type="date" style={input} value={deal.expires || ''} onChange={e => set('expires', e.target.value)} /></div>
          </div>

          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{
              width: 120, height: 120, flexShrink: 0, borderRadius: 8, overflow: 'hidden',
              border: '1px solid var(--color-border)', background: '#f8fafc',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {deal.image
                ? <img src={deal.image.startsWith('/api/') ? deal.image : `${SITE_URL}${deal.image}`}
                    alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>No image</span>}
            </div>

            <div style={{ flex: 1 }}>
              <label style={label}>Image</label>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(index, f); e.target.value = ''; }} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ ...btn(), marginBottom: 8 }}>
                {uploading ? 'Uploading…' : 'Upload image'}
              </button>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                Converted to WebP and resized automatically. A square image works best.
              </p>
              <label style={label}>Image description (for screen readers)</label>
              <input style={input} value={deal.imageAlt || ''} onChange={e => set('imageAlt', e.target.value)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DealsEditor() {
  const [deals, setDeals] = useState(null);
  const [meta, setMeta] = useState({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(null);
  const [uploadingIndex, setUploadingIndex] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  const load = () => api.get('/website/content/deals').then(r => {
    setDeals(r.data.draft || []);
    setMeta(r.data);
    setDirty(false);
  });

  useEffect(() => { load().catch(() => setError('Could not load the deals')); }, []);

  const say = (msg) => { setFlash(msg); setTimeout(() => setFlash(null), 3000); };
  const edit = (next) => { setDeals(next); setDirty(true); setError(null); };

  const updateAt = (i, deal) => edit(deals.map((d, n) => (n === i ? deal : d)));
  const move = (i, dir) => {
    const next = [...deals];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    edit(next);
  };
  const remove = (i) => {
    if (!confirm(`Delete "${deals[i].title || 'this deal'}"? It disappears from the website when you publish.`)) return;
    edit(deals.filter((_, n) => n !== i));
  };

  async function uploadImage(i, file) {
    setUploadingIndex(i);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/website/media', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      updateAt(i, { ...deals[i], image: data.url, imageAlt: deals[i].imageAlt || deals[i].title || '' });
      say(`Uploaded — ${data.width}×${data.height}, ${(data.bytes / 1024).toFixed(0)}KB`);
    } catch (e) {
      setError(e.response?.data?.error || 'That image could not be processed');
    } finally { setUploadingIndex(null); }
  }

  async function save() {
    setBusy('save'); setError(null);
    try {
      const { data } = await api.put('/website/content/deals', { value: deals });
      setMeta(data); setDirty(false); say('Draft saved');
    } catch (e) { setError(e.response?.data?.error || 'Could not save'); }
    finally { setBusy(null); }
  }

  async function publish() {
    if (dirty) { setError('Save your draft before publishing.'); return; }
    if (!confirm('Publish these deals to dekkerair.co.nz? They go live immediately.')) return;
    setBusy('publish'); setError(null);
    try {
      const { data } = await api.post('/website/content/deals/publish');
      setMeta(data); say('Published — live on the website now');
    } catch (e) { setError(e.response?.data?.error || 'Could not publish'); }
    finally { setBusy(null); }
  }

  async function discard() {
    if (!confirm('Discard your unpublished edits and go back to what is live?')) return;
    setBusy('discard');
    try {
      await api.post('/website/content/deals/revert');
      await load(); say('Edits discarded');
    } catch { setError('Could not discard'); }
    finally { setBusy(null); }
  }

  if (!deals) return <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{error || 'Loading…'}</div>;

  const unpublished = dirty || meta.hasUnpublishedChanges;
  const previewUrl = meta.previewToken ? `${SITE_URL}/deals?preview=${meta.previewToken}` : null;

  return (
    <div>
      <div style={{ ...card, padding: '14px 18px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
          background: unpublished ? '#fef3c7' : '#dcfce7',
          color: unpublished ? '#92400e' : '#166534',
        }}>
          {unpublished ? 'Unpublished changes' : 'Live and up to date'}
        </span>

        {meta.publishedAt && (
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Last published {new Date(meta.publishedAt).toLocaleString('en-NZ')}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={save} disabled={busy || !dirty} style={{ ...btn(), opacity: busy || !dirty ? 0.5 : 1 }}>
            {busy === 'save' ? 'Saving…' : 'Save draft'}
          </button>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noreferrer" style={{ ...btn(), textDecoration: 'none', display: 'inline-block' }}>
              Preview
            </a>
          )}
          <button onClick={discard} disabled={busy || !unpublished} style={{ ...btn(), opacity: busy || !unpublished ? 0.5 : 1 }}>
            Discard
          </button>
          <button onClick={publish} disabled={busy || !unpublished} style={{ ...btn('primary'), opacity: busy || !unpublished ? 0.5 : 1 }}>
            {busy === 'publish' ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>

      {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 14 }}>{error}</div>}
      {flash && <div style={{ background: '#dcfce7', color: '#166534', padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 14 }}>{flash}</div>}

      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16, lineHeight: 1.7 }}>
        Edits are saved as a draft. <strong>Preview</strong> shows them on the real site without
        anyone else seeing them; <strong>Publish</strong> makes them live. A deal with an end date
        disappears from the site by itself the day after it passes.
      </p>

      {deals.map((deal, i) => (
        <DealRow key={deal.id || i} deal={deal} index={i} total={deals.length}
          onChange={d => updateAt(i, d)} onMove={move} onDelete={remove}
          onUpload={uploadImage} uploading={uploadingIndex === i} />
      ))}

      <button onClick={() => edit([...deals, blankDeal()])} style={{ ...btn(), marginTop: 6 }}>
        + Add a deal
      </button>
    </div>
  );
}
