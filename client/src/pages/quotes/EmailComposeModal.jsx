import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import styles from './Quotes.module.css';
import { overlayClose } from '../../lib/overlayClose';

// Compose-before-send modal for the quote "Email to Customer" button — loads a
// saved, personalised template (with {{placeholders}} already resolved for this
// quote), lets the user switch templates or edit freely, then sends on confirm.
export default function EmailComposeModal({
  quoteId, jobId, customerEmail, customerExtraEmails = [], onClose, onSent,
}) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [jobAttachments, setJobAttachments] = useState([]);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState([]);

  // Everybody at this customer who could get it, with the main address first
  // and ticked. A quote that used to go to one address still goes to that one
  // unless somebody says otherwise.
  const allEmails = [customerEmail, ...(customerExtraEmails || [])]
    .map(e => String(e || '').trim())
    .filter((e, i, list) => e && list.findIndex(x => x.toLowerCase() === e.toLowerCase()) === i);
  const [sendTo, setSendTo] = useState(() => (customerEmail ? [customerEmail] : []));

  function toggleEmail(address) {
    setSendTo(list => (list.includes(address)
      ? list.filter(e => e !== address)
      : [...list, address]));
  }

  useEffect(() => {
    Promise.all([
      api.get('/email-templates', { params: { category: 'quote' } }),
      api.get(`/quotes/${quoteId}/email-preview`),
      jobId ? api.get(`/jobs/${jobId}/attachments`) : Promise.resolve({ data: [] }),
    ]).then(([tplRes, previewRes, attRes]) => {
      setTemplates(tplRes.data);
      setTemplateId(previewRes.data.templateId || '');
      setSubject(previewRes.data.subject);
      setBody(previewRes.data.body);
      setJobAttachments(attRes.data);
    }).catch(() => setError('Failed to load email template')).finally(() => setLoading(false));
  }, [quoteId, jobId]);

  function toggleAttachment(id) {
    setSelectedAttachmentIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  }

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
    if (!sendTo.length) { setError('Pick at least one address to send to.'); return; }
    setSending(true); setError('');
    try {
      await api.post(`/quotes/${quoteId}/email`, {
        subject, body, attachment_ids: selectedAttachmentIds, email_to: sendTo,
      });
      onSent(sendTo.join(', '));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send email');
      setSending(false);
    }
  }

  return (
    <div className={styles.overlay} {...overlayClose(onClose)}>
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
                {allEmails.length > 1 ? (
                  // More than one person at this customer wants it. Each gets
                  // their own message rather than a copy of somebody else's,
                  // so an open can be traced to the address that opened it.
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4,
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '8px 12px' }}>
                    {allEmails.map(address => (
                      <label key={address} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, cursor: 'pointer' }}>
                        <input type="checkbox" checked={sendTo.includes(address)} onChange={() => toggleEmail(address)} />
                        {address}
                        {address === customerEmail && (
                          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>main</span>
                        )}
                      </label>
                    ))}
                  </div>
                ) : (
                  <input value={customerEmail || ''} disabled
                    style={{ padding: '9px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 14, background: '#f8fafc', color: 'var(--color-text-muted)' }} />
                )}
                {allEmails.length > 1 && sendTo.length === 0 && (
                  <span style={{ fontSize: 12, color: '#b91c1c' }}>Pick at least one address.</span>
                )}
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

              {jobAttachments.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 500 }}>Also attach</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflowY: 'auto',
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: '8px 12px' }}>
                    {jobAttachments.map(a => (
                      <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={selectedAttachmentIds.includes(a.id)} onChange={() => toggleAttachment(a.id)} />
                        {a.filename}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className={styles.modalFooter} style={{ marginTop: 20 }}>
              <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
              <button type="submit" className={styles.btnPrimary} disabled={sending || switching || !sendTo.length}>
                {sending ? 'Sending…' : '✉ Send Email'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
