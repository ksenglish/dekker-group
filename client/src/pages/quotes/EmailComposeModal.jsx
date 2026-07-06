import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import styles from './Quotes.module.css';

// Compose-before-send modal for the quote "Email to Customer" button — loads a
// saved, personalised template (with {{placeholders}} already resolved for this
// quote), lets the user switch templates or edit freely, then sends on confirm.
export default function EmailComposeModal({ quoteId, customerEmail, onClose, onSent }) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/email-templates', { params: { category: 'quote' } }),
      api.get(`/quotes/${quoteId}/email-preview`),
    ]).then(([tplRes, previewRes]) => {
      setTemplates(tplRes.data);
      setTemplateId(previewRes.data.templateId || '');
      setSubject(previewRes.data.subject);
      setBody(previewRes.data.body);
    }).catch(() => setError('Failed to load email template')).finally(() => setLoading(false));
  }, [quoteId]);

  async function selectTemplate(id) {
    setTemplateId(id);
    setSwitching(true);
    try {
      const { data } = await api.get(`/quotes/${quoteId}/email-preview`, { params: { templateId: id } });
      setSubject(data.subject);
      setBody(data.body);
    } catch { setError('Failed to load that template'); }
    finally { setSwitching(false); }
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    setSending(true); setError('');
    try {
      await api.post(`/quotes/${quoteId}/email`, { subject, body });
      onSent(customerEmail);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send email');
      setSending(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal} style={{ maxWidth: 620 }}>
        <div className={styles.modalHeader}>
          <h2>Email Quote to Customer</h2>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        {loading ? (
          <div className={styles.loading}>Loading template…</div>
        ) : (
          <form onSubmit={handleSend}>
            <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {error && <div className={styles.error} style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 14px', borderRadius: 'var(--radius)', fontSize: 13 }}>{error}</div>}

              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 500 }}>Template</label>
                  <select value={templateId} onChange={e => selectTemplate(e.target.value)}
                    disabled={switching}
                    style={{ padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 14 }}>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>
                    ))}
                  </select>
                </div>
                <button type="button" className={styles.btnSecondary} onClick={() => navigate('/settings')}>
                  Manage Templates
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>To</label>
                <input value={customerEmail} disabled
                  style={{ padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 14, background: '#f8fafc', color: 'var(--color-text-muted)' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>Subject</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} required
                  style={{ padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 14 }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>Message</label>
                <textarea rows={10} value={body} onChange={e => setBody(e.target.value)} required
                  style={{ padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }} />
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>The quote PDF is attached automatically.</span>
              </div>
            </div>

            <div className={styles.modalFooter} style={{ marginTop: 20 }}>
              <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
              <button type="submit" className={styles.btnPrimary} disabled={sending || switching}>
                {sending ? 'Sending…' : '✉ Send Email'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
