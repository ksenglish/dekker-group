import { useState, useEffect } from 'react';
import api from '../../lib/api';
import styles from './Quotes.module.css';
import { overlayClose } from '../../lib/overlayClose';

// Raises a quote that has no job behind it — pricing a customer up before any
// work is opened. There's no job to inherit a customer from here, so one has
// to be picked: it's what the quote is addressed to, emailed to, and later
// invoiced against. The job (and its number) comes later, from the quote
// itself, once the work is actually won.
export default function NewQuoteModal({ onClose, onCreated }) {
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [themes, setThemes] = useState([]);
  const [themeId, setThemeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/customers', { params: { limit: 500 } }),
      api.get('/settings/themes'),
    ]).then(([custRes, themeRes]) => {
      setCustomers(custRes.data.customers || []);
      const active = (themeRes.data || []).filter(t => !t.archived);
      setThemes(active);
      setThemeId(active.find(t => t.isDefault)?.id || active[0]?.id || '');
    }).catch(() => setError('Failed to load customers')).finally(() => setLoading(false));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!customerId) return;
    setCreating(true); setError('');
    try {
      const { data } = await api.post('/quotes', {
        customer_id: customerId,
        theme_id: themeId || undefined,
      });
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create quote');
      setCreating(false);
    }
  }

  const fieldStyle = { padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 14 };

  return (
    <div className={styles.overlay} {...overlayClose(onClose)}>
      <div className={styles.modal} style={{ maxWidth: 480 }}>
        <div className={styles.modalHeader}>
          <h2>New Quote</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        {loading ? (
          <div className={styles.loading}>Loading…</div>
        ) : (
          <form onSubmit={handleCreate}>
            <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {error && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 14px', borderRadius: 'var(--radius)', fontSize: 13 }}>{error}</div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>Customer *</label>
                <select value={customerId} onChange={e => setCustomerId(e.target.value)} required style={fieldStyle}>
                  <option value="">— Select a customer —</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>
                  ))}
                </select>
              </div>

              {themes.length > 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 500 }}>Document Theme</label>
                  <select value={themeId} onChange={e => setThemeId(e.target.value)} style={fieldStyle}>
                    {themes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}

              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                This quote won't have a job number. You can create a job from it — or link it to an
                existing job — from the quote itself.
              </span>
            </div>

            <div className={styles.modalFooter} style={{ marginTop: 20 }}>
              <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
              <button type="submit" className={styles.btnPrimary} disabled={creating || !customerId}>
                {creating ? 'Creating…' : 'Create Quote'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
