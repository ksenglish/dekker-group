import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './Settings.module.css';

const TABS = ['My Account', 'Security', 'Quote Theme', 'Terms & Conditions', 'Email', 'Email Templates', 'Billing Rates', 'Job Types & Templates', 'Integrations'];

// ── Sortable job status row (drag to reorder) ─────────────────────────────────
function SortableStatusRow({ s, onLabelChange, onColorChange, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.key });
  const style = {
    transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1,
    display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
    background: '#f8fafc', borderRadius: 6, border: '1px solid var(--color-border)',
  };
  return (
    <div ref={setNodeRef} style={style}>
      <span {...listeners} {...attributes} style={{ cursor: 'grab', color: 'var(--color-text-muted)', fontSize: 16, touchAction: 'none' }} title="Drag to reorder">⠿</span>
      <input type="color" value={s.color} onChange={e => onColorChange(s.key, e.target.value)}
        style={{ width: 36, height: 28, padding: 0, border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', background: 'none' }} />
      <input value={s.label} onChange={e => onLabelChange(s.key, e.target.value)}
        style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 14, fontWeight: 500 }} />
      <input value={s.color} onChange={e => onColorChange(s.key, e.target.value)}
        style={{ width: 90, padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 12, fontFamily: 'monospace' }} />
      {s.protected
        ? <span style={{ fontSize: 14, width: 20, textAlign: 'center' }} title="Built-in status — drives automation elsewhere, can't be deleted">🔒</span>
        : <button onClick={() => onDelete(s.key)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16, lineHeight: 1, width: 20 }}>✕</button>}
    </div>
  );
}

export default function SettingsPage() {
  const [searchParams] = useSearchParams();
  // Supports deep-linking to a tab, e.g. /settings?tab=Integrations from the Xero OAuth callback
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'My Account');
  const [theme, setTheme] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const fileRef = useRef();

  // Email / SMTP state
  const [email, setEmail] = useState({ provider: 'smtp', host: 'smtp-relay.brevo.com', port: 587, user: '', pass: '', from: '', fromName: 'Dekker Group' });
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailStatus, setEmailStatus] = useState(null);
  const setEmailField = (k, v) => setEmail(s => ({ ...s, [k]: v }));

  useEffect(() => {
    api.get('/settings').then(r => setTheme(r.data));
    api.get('/settings/email').then(r => setEmail(s => ({ ...s, ...r.data }))).catch(() => {});
  }, []);

  async function saveEmail() {
    setEmailSaving(true); setEmailStatus(null);
    try {
      await api.put('/settings/email', email);
      setEmailSaved(true); setTimeout(() => setEmailSaved(false), 3000);
    } catch (e) { setEmailStatus({ ok: false, message: e.response?.data?.error || 'Save failed' }); }
    finally { setEmailSaving(false); }
  }

  async function testEmail() {
    setEmailTesting(true); setEmailStatus(null);
    try {
      const { data } = await api.post('/settings/email/test', email);
      setEmailStatus(data);
    } catch (e) { setEmailStatus({ ok: false, message: e.response?.data?.message || 'Test failed' }); }
    finally { setEmailTesting(false); }
  }

  function set(key, val) {
    setTheme(t => ({ ...t, [key]: val }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { data } = await api.put('/settings', theme);
      setTheme(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert(err.response?.data?.error || `Save failed: ${err.message}`);
    } finally { setSaving(false); }
  }

  async function handlePreview() {
    setPreviewing(true);
    try {
      // Save first, then download a sample PDF
      await api.put('/settings', theme);
      const res = await api.get('/settings/preview-pdf', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      alert(err.response?.data?.error || 'Preview failed');
    } finally { setPreviewing(false); }
  }

  function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) { alert('Logo must be under 500KB'); return; }
    const reader = new FileReader();
    reader.onload = ev => set('logoBase64', ev.target.result);
    reader.readAsDataURL(file);
  }

  if (!theme) return <div className={styles.page}><div className={styles.loading}>Loading…</div></div>;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Settings</h1>
          <p className={styles.pageSubtitle}>Manage your company branding and document templates</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={handlePreview} disabled={previewing}>
            {previewing ? 'Generating…' : '👁 Preview PDF'}
          </button>
          <button className={styles.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className={styles.layout}>
        {/* Tab sidebar */}
        <div className={styles.tabList}>
          {TABS.map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`${styles.tabBtn} ${activeTab === t ? styles.tabBtnActive : ''}`}>
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className={styles.content}>
          {activeTab === 'My Account' && <MyAccountTab />}

          {activeTab === 'Security' && <SecurityTab />}

          {activeTab === 'Quote Theme' && (
            <div className={styles.section}>
              {/* Logo */}
              <div className={styles.card}>
                <div className={styles.cardHeader}><h2>Logo</h2></div>
                <div className={styles.cardBody}>
                  <div className={styles.logoRow}>
                    {theme.logoBase64 ? (
                      <div className={styles.logoPreview}>
                        <img src={theme.logoBase64} alt="Logo preview" />
                        <button className={styles.removeLogo} onClick={() => set('logoBase64', '')}>Remove</button>
                      </div>
                    ) : (
                      <div className={styles.logoPlaceholder}>No logo — company name text will be used</div>
                    )}
                    <div>
                      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml"
                        style={{ display: 'none' }} onChange={handleLogoUpload} />
                      <button className={styles.btnSecondary} onClick={() => fileRef.current.click()}>
                        {theme.logoBase64 ? 'Replace Logo' : 'Upload Logo'}
                      </button>
                      <p className={styles.hint}>PNG or JPG, max 500KB. Appears in the PDF header.</p>
                    </div>
                  </div>

                  {/* Logo size */}
                  <div className={styles.field} style={{ marginTop: 20 }}>
                    <label>Logo Size</label>
                    <div className={styles.segmentedControl}>
                      {['small', 'medium', 'large'].map(sz => (
                        <button key={sz} type="button"
                          className={`${styles.segmentBtn} ${(theme.logoSize || 'medium') === sz ? styles.segmentBtnActive : ''}`}
                          onClick={() => set('logoSize', sz)}>
                          {sz.charAt(0).toUpperCase() + sz.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Logo position */}
                  <div className={styles.field} style={{ marginTop: 16 }}>
                    <label>Logo Position</label>
                    <div className={styles.segmentedControl}>
                      {[['left', 'Left'], ['right', 'Right']].map(([val, lbl]) => (
                        <button key={val} type="button"
                          className={`${styles.segmentBtn} ${(theme.logoPosition || 'left') === val ? styles.segmentBtnActive : ''}`}
                          onClick={() => set('logoPosition', val)}>
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Company details position */}
                  <div className={styles.field} style={{ marginTop: 16 }}>
                    <label>Company Details Position</label>
                    <div className={styles.segmentedControl}>
                      {[['left', 'Left'], ['right', 'Right']].map(([val, lbl]) => (
                        <button key={val} type="button"
                          className={`${styles.segmentBtn} ${(theme.contactPosition || 'right') === val ? styles.segmentBtnActive : ''}`}
                          onClick={() => set('contactPosition', val)}>
                          {lbl}
                        </button>
                      ))}
                    </div>
                    <span className={styles.hint}>Where website, email, phone, and location appear in the header</span>
                  </div>
                </div>
              </div>

              {/* Company details */}
              <div className={styles.card}>
                <div className={styles.cardHeader}><h2>Company Details</h2></div>
                <div className={styles.cardBody}>
                  <div className={styles.formGrid}>
                    <div className={styles.field}>
                      <label>Company Name</label>
                      <input value={theme.companyName} onChange={e => set('companyName', e.target.value)}
                        placeholder="DEKKER GROUP" />
                      <span className={styles.hint}>Shown in the header when no logo is uploaded</span>
                    </div>
                    <div className={styles.field}>
                      <label>Tagline</label>
                      <input value={theme.tagline} onChange={e => set('tagline', e.target.value)}
                        placeholder="HVAC Installation & Field Services" />
                    </div>
                    <div className={styles.field}>
                      <label>Website</label>
                      <input value={theme.website} onChange={e => set('website', e.target.value)}
                        placeholder="dekkergroup.co.nz" />
                    </div>
                    <div className={styles.field}>
                      <label>Email</label>
                      <input type="email" value={theme.email} onChange={e => set('email', e.target.value)}
                        placeholder="kyle@dekkergroup.co.nz" />
                    </div>
                    <div className={styles.field}>
                      <label>Phone</label>
                      <input value={theme.phone} onChange={e => set('phone', e.target.value)}
                        placeholder="+64 21 123 456" />
                    </div>
                    <div className={styles.field}>
                      <label>Location</label>
                      <input value={theme.location} onChange={e => set('location', e.target.value)}
                        placeholder="New Zealand" />
                    </div>
                    <div className={styles.field}>
                      <label>GST Number</label>
                      <input value={theme.gstNumber} onChange={e => set('gstNumber', e.target.value)}
                        placeholder="123-456-789" />
                      <span className={styles.hint}>Shown on quotes and invoices</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Branding */}
              <div className={styles.card}>
                <div className={styles.cardHeader}><h2>Branding</h2></div>
                <div className={styles.cardBody}>
                  <div className={styles.field}>
                    <label>Brand Colour</label>
                    <div className={styles.colourRow}>
                      <input type="color" value={theme.brandColour}
                        onChange={e => set('brandColour', e.target.value)}
                        className={styles.colourPicker} />
                      <input value={theme.brandColour} onChange={e => set('brandColour', e.target.value)}
                        className={styles.colourHex} placeholder="#1e40af" maxLength={7} />
                      <div className={styles.colourSwatch} style={{ background: theme.brandColour }} />
                    </div>
                    <span className={styles.hint}>Used for the header bar, table headers, totals, and accents</span>
                  </div>

                  <div className={styles.colourPresets}>
                    <span className={styles.hint}>Presets:</span>
                    {[
                      { label: 'Blue',   hex: '#1e40af' },
                      { label: 'Navy',   hex: '#1e3a5f' },
                      { label: 'Green',  hex: '#166534' },
                      { label: 'Slate',  hex: '#334155' },
                      { label: 'Red',    hex: '#991b1b' },
                      { label: 'Orange', hex: '#c2410c' },
                      { label: 'Black',  hex: '#000000' },
                      { label: 'White',  hex: '#ffffff' },
                    ].map(p => (
                      <button key={p.hex} className={styles.presetBtn}
                        style={{ background: p.hex, outline: theme.brandColour === p.hex ? '2px solid #6366f1' : 'none',
                          border: p.hex === '#ffffff' ? '1px solid #d1d5db' : 'none' }}
                        onClick={() => { set('brandColour', p.hex); if (p.hex === '#ffffff') set('transparentHeader', true); }}
                        title={p.label} />
                    ))}
                  </div>

                  <div className={styles.toggleRow} style={{ marginTop: 16 }}>
                    <label className={styles.toggleLabel}>
                      <input type="checkbox" checked={!!theme.transparentHeader}
                        onChange={e => set('transparentHeader', e.target.checked)} />
                      <span>Transparent header</span>
                    </label>
                    <span className={styles.hint}>Removes the coloured background — text and logo appear on white</span>
                  </div>
                </div>
              </div>

              {/* Quote Expiry */}
              <div className={styles.card}>
                <div className={styles.cardHeader}><h2>Quote Expiry</h2></div>
                <div className={styles.cardBody}>
                  <div className={styles.field}>
                    <label>Default Expiry (days)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input type="number" min="0" max="365" step="1"
                        value={theme.quoteExpiryDays ?? 30}
                        onChange={e => set('quoteExpiryDays', Math.max(0, parseInt(e.target.value) || 0))}
                        style={{ width: 90 }} />
                      <span style={{ fontSize: 13, color: '#64748b' }}>
                        {(theme.quoteExpiryDays ?? 30) === 0
                          ? 'No expiry date will be set'
                          : `Quotes expire ${theme.quoteExpiryDays ?? 30} days after creation`}
                      </span>
                    </div>
                    <span className={styles.hint}>Set to 0 to create quotes with no expiry date. The expiry date is shown on the PDF and the customer's quote link.</span>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className={styles.card}>
                <div className={styles.cardHeader}><h2>Footer Text</h2></div>
                <div className={styles.cardBody}>
                  <div className={styles.formGrid}>
                    <div className={styles.field}>
                      <label>Footer Line 1</label>
                      <input value={theme.footerLine1} onChange={e => set('footerLine1', e.target.value)}
                        placeholder="Thank you for your business." />
                    </div>
                    <div className={styles.field}>
                      <label>Footer Line 2</label>
                      <input value={theme.footerLine2} onChange={e => set('footerLine2', e.target.value)}
                        placeholder="Dekker Group · New Zealand · GST registered" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Live preview */}
              <div className={styles.card}>
                <div className={styles.cardHeader}><h2>Header Preview</h2></div>
                <div className={styles.cardBody}>
                  {(() => {
                    const subCol = theme.transparentHeader ? '#64748b' : 'rgba(255,255,255,0.85)';
                    const logoSizePx = { small: 28, medium: 42, large: 56 }[theme.logoSize || 'medium'] || 42;
                    const logoOnLeft = (theme.logoPosition || 'left') === 'left';
                    const contactOnLeft = (theme.contactPosition || 'right') === 'left';
                    const logoBlock = (
                      <div style={{ order: logoOnLeft ? 1 : 3 }}>
                        {theme.logoBase64
                          ? <img src={theme.logoBase64} alt="logo" style={{ height: logoSizePx, maxWidth: logoSizePx * 2.8, objectFit: 'contain', display: 'block' }} />
                          : <div>
                              <div className={styles.previewName} style={{ color: theme.transparentHeader ? theme.brandColour : 'white' }}>{theme.companyName || 'COMPANY NAME'}</div>
                              <div className={styles.previewTagline} style={{ color: subCol }}>{theme.tagline}</div>
                            </div>
                        }
                      </div>
                    );
                    const contactBlock = (
                      <div style={{ order: contactOnLeft ? 1 : 3, textAlign: contactOnLeft ? 'left' : 'right', fontSize: 10, color: subCol, lineHeight: 1.6 }}>
                        {[theme.website, theme.email, theme.phone, theme.location].filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
                      </div>
                    );
                    return (
                      <div className={styles.pdfPreview} style={{
                        background: theme.transparentHeader ? 'transparent' : theme.brandColour,
                        border: theme.transparentHeader ? '1px dashed #d1d5db' : 'none',
                        justifyContent: 'space-between', gap: 12,
                      }}>
                        {logoOnLeft === contactOnLeft
                          ? <>{logoBlock}<div style={{ flex: 1 }} />{contactBlock}</>
                          : <>{logoBlock}{contactBlock}</>
                        }
                      </div>
                    );
                  })()}
                  <p className={styles.hint} style={{ marginTop: 8 }}>
                    Click <strong>Preview PDF</strong> above to download a full sample document.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Email' && (
            <div className={styles.section}>
              <div className={styles.card}>
                <div className={styles.cardHeader}><h2>Email Settings</h2></div>
                <div className={styles.cardBody}>
                  <div className={styles.resendBanner}>
                    <div className={styles.resendIcon}>✉</div>
                    <div>
                      <strong>SMTP Email — works with Gmail, Brevo, or any SMTP provider</strong>
                      <p style={{ marginTop: 4 }}>
                        <strong>Recommended: Brevo (free, 300 emails/day)</strong> — no DNS setup needed.
                        Sign up at <strong>brevo.com</strong> → SMTP &amp; API → copy the SMTP credentials below.
                      </p>
                      <p style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
                        Brevo SMTP host: <code>smtp-relay.brevo.com</code> · Port: <code>587</code> · Username: your Brevo login email · Password: the key from their dashboard.
                      </p>
                    </div>
                  </div>
                  <div className={styles.formGrid} style={{ marginTop: 20 }}>
                    <div className={styles.field}>
                      <label>SMTP Host</label>
                      <input value={email.host} onChange={e => setEmailField('host', e.target.value)} placeholder="smtp-relay.brevo.com" />
                    </div>
                    <div className={styles.field}>
                      <label>Port</label>
                      <select value={email.port} onChange={e => setEmailField('port', parseInt(e.target.value))}>
                        <option value={587}>587 (TLS — recommended)</option>
                        <option value={465}>465 (SSL)</option>
                        <option value={25}>25</option>
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>Username / Login</label>
                      <input type="email" value={email.user} onChange={e => setEmailField('user', e.target.value)} placeholder="kyle@dekkergroup.co.nz" />
                    </div>
                    <div className={styles.field}>
                      <label>Password / API Key</label>
                      <input type="password" value={email.pass} onChange={e => setEmailField('pass', e.target.value)} placeholder="SMTP password or API key" style={{ fontFamily: 'monospace' }} />
                    </div>
                    <div className={styles.field}>
                      <label>From Name</label>
                      <input value={email.fromName} onChange={e => setEmailField('fromName', e.target.value)} placeholder="Dekker Group" />
                    </div>
                    <div className={styles.field}>
                      <label>From Email</label>
                      <input type="email" value={email.from} onChange={e => setEmailField('from', e.target.value)} placeholder="kyle@dekkergroup.co.nz" />
                    </div>
                  </div>
                  {emailStatus && (
                    <div className={emailStatus.ok ? styles.successMsg : styles.errorMsg} style={{ marginTop: 16 }}>
                      {emailStatus.message}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                    <button className={styles.btnSecondary} onClick={testEmail} disabled={emailTesting || !email.user}>
                      {emailTesting ? 'Testing…' : 'Test Connection'}
                    </button>
                    <button className={styles.btnPrimary} onClick={saveEmail} disabled={emailSaving}>
                      {emailSaving ? 'Saving…' : emailSaved ? '✓ Saved' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Email Templates' && <EmailTemplatesTab />}

          {activeTab === 'Billing Rates' && <BillingRatesTab />}

          {activeTab === 'Integrations' && <IntegrationsTab />}

          {activeTab === 'Job Types & Templates' && (
            <JobTypesTab />
          )}

          {activeTab === 'Terms & Conditions' && (
            <div className={styles.section}>
              <div className={styles.card}>
                <div className={styles.cardHeader}><h2>Terms &amp; Conditions</h2></div>
                <div className={styles.cardBody}>
                  <div className={styles.field}>
                    <label>Quote Terms & Conditions</label>
                    <textarea rows={12} value={theme.quoteTerms || ''}
                      onChange={e => set('quoteTerms', e.target.value)}
                      placeholder="Enter your standard terms and conditions for quotes…&#10;&#10;e.g. Payment terms, warranty, cancellation policy, etc."
                      className={styles.termsArea} />
                    <span className={styles.hint}>These terms will appear on all quote PDFs below the line items.</span>
                  </div>
                  <div className={styles.field} style={{ marginTop: 20 }}>
                    <label>Invoice Terms & Conditions</label>
                    <textarea rows={12} value={theme.invoiceTerms || ''}
                      onChange={e => set('invoiceTerms', e.target.value)}
                      placeholder="Enter your standard terms and conditions for invoices…&#10;&#10;e.g. Payment due date, late payment fees, bank account details, etc."
                      className={styles.termsArea} />
                    <span className={styles.hint}>These terms will appear on all invoice PDFs below the line items.</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MyAccountTab() {
  const { user } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [status, setStatus] = useState(''); // '' | 'saving' | 'saved' | 'error'
  const [msg, setMsg] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.currentPassword) { setMsg('Enter your current password.'); setStatus('error'); return; }
    if (form.newPassword.length < 8) { setMsg('New password must be at least 8 characters.'); setStatus('error'); return; }
    if (form.newPassword !== form.confirmPassword) { setMsg('New passwords do not match.'); setStatus('error'); return; }
    setStatus('saving'); setMsg('');
    try {
      await api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setStatus('saved'); setMsg('Password updated successfully.');
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setStatus('error'); setMsg(err.response?.data?.error || 'Failed to update password.');
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.card}>
        <div className={styles.cardHeader}><h2>Your Profile</h2></div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label>Name</label>
              <input value={user?.name || ''} disabled style={{ background: '#f8fafc' }} />
            </div>
            <div className={styles.field}>
              <label>Email</label>
              <input value={user?.email || ''} disabled style={{ background: '#f8fafc' }} />
            </div>
            <div className={styles.field}>
              <label>Role</label>
              <input value={{ admin: 'Admin', sales: 'Sales', operations: 'Operations', subcontractor: 'Subcontractor', office: 'Office', field_tech: 'Field Tech' }[user?.role] || user?.role || ''} disabled style={{ background: '#f8fafc' }} />
            </div>
          </div>
          <p className={styles.hint} style={{ marginTop: 8 }}>Contact an Admin to update your name, email, or role.</p>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}><h2>Change Password</h2></div>
        <div className={styles.cardBody}>
          {status === 'error' && <div className={styles.error} style={{ marginBottom: 16 }}>{msg}</div>}
          {status === 'saved' && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', padding: '10px 14px', borderRadius: 'var(--radius)', fontSize: 13, marginBottom: 16 }}>{msg}</div>}
          <form onSubmit={handleSubmit}>
            <div className={styles.formGrid} style={{ maxWidth: 480 }}>
              <div className={styles.field} style={{ gridColumn: '1/-1' }}>
                <label>Current Password</label>
                <input type="password" value={form.currentPassword} onChange={e => set('currentPassword', e.target.value)} placeholder="Enter your current password" />
              </div>
              <div className={styles.field}>
                <label>New Password</label>
                <input type="password" value={form.newPassword} onChange={e => set('newPassword', e.target.value)} placeholder="At least 8 characters" />
              </div>
              <div className={styles.field}>
                <label>Confirm New Password</label>
                <input type="password" value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} placeholder="Repeat new password" />
              </div>
            </div>
            <button type="submit" className={styles.btnPrimary} disabled={status === 'saving'} style={{ marginTop: 16 }}>
              {status === 'saving' ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function parseDevice(ua = '') {
  if (!ua) return 'Unknown device';
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Browser';
}

const STATUS_STYLES = {
  success:          { bg: '#f0fdf4', color: '#166534', label: 'Signed in' },
  failed_password:  { bg: '#fef2f2', color: '#991b1b', label: 'Wrong password' },
  failed_otp:       { bg: '#fef2f2', color: '#991b1b', label: 'Wrong code' },
  locked:           { bg: '#fff7ed', color: '#92400e', label: 'Account locked' },
};

function SecurityTab() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/auth/login-history')
      .then(r => setHistory(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function fmt(ts) {
    const d = new Date(ts);
    return d.toLocaleString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className={styles.section}>
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2>Two-Factor Authentication</h2>
        </div>
        <div className={styles.cardBody}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>🔒</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#15803d' }}>Email OTP is enabled for all accounts</div>
              <div style={{ fontSize: 13, color: '#166534', marginTop: 2, lineHeight: 1.5 }}>
                Every sign-in requires a 6-digit code sent to your email address after your password is verified.
                Codes expire after 10 minutes and accounts lock after {5} failed attempts.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2>Recent Sign-in Activity</h2>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Your last 20 login events</span>
        </div>
        <div className={styles.cardBody} style={{ padding: 0 }}>
          {loading && <div style={{ padding: 24, color: 'var(--color-text-muted)', fontSize: 14 }}>Loading…</div>}
          {!loading && history.length === 0 && (
            <div style={{ padding: 24, color: 'var(--color-text-muted)', fontSize: 14 }}>No login history yet.</div>
          )}
          {!loading && history.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: '#f8fafc' }}>
                  {['Date & Time', 'Status', 'Device', 'IP Address'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-muted)', fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((row, i) => {
                  const s = STATUS_STYLES[row.status] || STATUS_STYLES.success;
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '10px 16px', whiteSpace: 'nowrap', color: 'var(--color-text)' }}>{fmt(row.created_at)}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{ background: s.bg, color: s.color, padding: '2px 8px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>
                          {s.label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px', color: 'var(--color-text-muted)' }}>{parseDevice(row.user_agent)}</td>
                      <td style={{ padding: '10px 16px', color: 'var(--color-text-muted)', fontFamily: 'monospace', fontSize: 12 }}>{row.ip_address || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function newRateId() {
  return 'rate_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function BillingRatesTab() {
  const [rates, setRates] = useState([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/settings/billing-rates').then(r => setRates(r.data));
  }, []);

  function setLabel(id, val) {
    setRates(rs => rs.map(r => r.id === id ? { ...r, label: val } : r));
    setSaved(false);
  }

  function setRate(id, val) {
    setRates(rs => rs.map(r => r.id === id ? { ...r, rate: parseFloat(val) || 0 } : r));
    setSaved(false);
  }

  function addRate() {
    setRates(rs => [...rs, { id: newRateId(), label: '', rate: 0 }]);
    setSaved(false);
  }

  function deleteRate(id) {
    if (!confirm('Delete this billing rate? Timesheet entries already using it will keep showing its old label.')) return;
    setRates(rs => rs.filter(r => r.id !== id));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      await api.put('/settings/billing-rates', rates.filter(r => r.label.trim()));
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch { alert('Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Billing Rates</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Hourly rates (NZD, excl. GST)</p>
        </div>
        <div style={{ padding: '20px' }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 20 }}>
            Set hourly charge-out rates for each billing category. These are used to calculate job costs in timesheets and reports,
            and are offered as options when logging time on a job.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rates.map(r => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 160px 1fr 32px', alignItems: 'center', gap: 16, padding: '12px 16px', background: '#f8fafc', borderRadius: 8 }}>
                <input
                  value={r.label}
                  onChange={e => setLabel(r.id, e.target.value)}
                  placeholder="Rate name"
                  style={{ padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 14, outline: 'none', fontFamily: 'inherit', fontWeight: 500 }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>$</span>
                  <input
                    type="number" min="0" step="0.50"
                    value={r.rate || ''}
                    onChange={e => setRate(r.id, e.target.value)}
                    placeholder="0.00"
                    style={{ width: 100, padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
                  />
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>/hr</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {r.rate > 0 ? `$${(r.rate * 1.15).toFixed(2)}/hr incl. GST` : ''}
                </div>
                <button onClick={() => deleteRate(r.id)} title="Delete rate" style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 16,
                  color: 'var(--color-text-muted)', padding: 4, justifySelf: 'center',
                }}>✕</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
            <button onClick={addRate} style={{
              padding: '8px 16px', background: 'none', color: 'var(--color-primary)',
              border: '1px solid var(--color-primary)', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500, cursor: 'pointer'
            }}>
              + Add Rate
            </button>
            <button onClick={save} disabled={saving} style={{
              padding: '9px 20px', background: 'var(--color-primary)', color: 'white',
              border: 'none', borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 500, cursor: 'pointer'
            }}>
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Rates'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IntegrationsTab() {
  const [xeroStatus, setXeroStatus] = useState(null); // { connected, tenant_name, connected_at, default_account_code, default_tax_type }
  const [xeroLoading, setXeroLoading] = useState(true);
  const [xeroFlash, setXeroFlash] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [taxRates, setTaxRates] = useState([]);
  const [defaultAccountCode, setDefaultAccountCode] = useState('');
  const [defaultTaxType, setDefaultTaxType] = useState('');
  const [xeroSaving, setXeroSaving] = useState(false);
  const [xeroSaved, setXeroSaved] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  function loadXeroStatus() {
    setXeroLoading(true);
    return api.get('/settings/xero').then(r => {
      setXeroStatus(r.data);
      setDefaultAccountCode(r.data.default_account_code || '');
      setDefaultTaxType(r.data.default_tax_type || '');
      if (r.data.connected) {
        api.get('/xero/accounts').then(res => setAccounts(res.data)).catch(() => {});
        api.get('/xero/tax-rates').then(res => setTaxRates(res.data)).catch(() => {});
      }
    }).finally(() => setXeroLoading(false));
  }

  useEffect(() => {
    loadXeroStatus();
    const params = new URLSearchParams(window.location.search);
    const xero = params.get('xero');
    if (xero === 'connected') setXeroFlash('Connected to Xero.');
    else if (xero === 'error') setXeroFlash('Failed to connect to Xero — please try again.');
    if (xero) {
      params.delete('xero');
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveXeroDefaults() {
    setXeroSaving(true);
    try {
      await api.put('/settings/xero', { default_account_code: defaultAccountCode, default_tax_type: defaultTaxType });
      setXeroSaved(true); setTimeout(() => setXeroSaved(false), 3000);
    } finally { setXeroSaving(false); }
  }

  async function disconnectXero() {
    if (!confirm('Disconnect Dekker App from Xero?')) return;
    setDisconnecting(true);
    try {
      await api.post('/xero/disconnect');
      await loadXeroStatus();
    } finally { setDisconnecting(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Xero</h2>
        </div>
        <div style={{ padding: 24 }}>
          {xeroFlash && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13,
              background: xeroFlash.startsWith('Failed') ? '#fef2f2' : '#f0fdf4',
              border: `1px solid ${xeroFlash.startsWith('Failed') ? '#fecaca' : '#bbf7d0'}`,
              color: xeroFlash.startsWith('Failed') ? '#dc2626' : '#15803d' }}>
              {xeroFlash}
            </div>
          )}
          {xeroLoading ? (
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</p>
          ) : !xeroStatus?.connected ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 14 }}>
                Not connected. Connect Dekker App to Xero to push invoices, pull payment status back, and keep customer contacts in sync.
              </p>
              <a href="/api/xero/connect" className={styles.btnPrimary} style={{ display: 'inline-block', textDecoration: 'none' }}>
                Connect to Xero
              </a>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 20 }}>
                <span style={{ fontSize: 20 }}>✓</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#15803d' }}>Connected — {xeroStatus.tenant_name}</div>
                  {xeroStatus.connected_at && (
                    <div style={{ fontSize: 13, color: '#16a34a' }}>
                      Since {new Date(xeroStatus.connected_at).toLocaleDateString('en-NZ')}
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Default account code</label>
                  <select value={defaultAccountCode} onChange={e => setDefaultAccountCode(e.target.value)}>
                    <option value="">Select an account…</option>
                    {accounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Default tax rate</label>
                  <select value={defaultTaxType} onChange={e => setDefaultTaxType(e.target.value)}>
                    <option value="">Select a tax rate…</option>
                    {taxRates.map(r => <option key={r.taxType} value={r.taxType}>{r.name}</option>)}
                  </select>
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
                Used for every line item when an invoice is pushed to Xero.
              </p>

              <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                <button className={styles.btnSecondary} onClick={disconnectXero} disabled={disconnecting}>
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
                <button className={styles.btnPrimary} onClick={saveXeroDefaults} disabled={xeroSaving || !defaultAccountCode || !defaultTaxType}>
                  {xeroSaving ? 'Saving…' : xeroSaved ? '✓ Saved' : 'Save'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Other Integrations</h2>
        </div>
        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
            <span style={{ fontSize: 20 }}>🗺</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#15803d' }}>Map — OpenStreetMap (Free)</div>
              <div style={{ fontSize: 13, color: '#16a34a' }}>No API key required. Powered by Leaflet + OpenStreetMap.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const EMAIL_PLACEHOLDERS = [
  ['{{customer_name}}', 'Customer full name'],
  ['{{customer_first_name}}', 'Customer first name'],
  ['{{customer_company}}', 'Customer company'],
  ['{{company_name}}', 'Your company name'],
  ['{{sender_name}}', 'The staff member sending it'],
  ['{{quote_number}}', 'e.g. QT-0033'],
  ['{{quote_total}}', 'e.g. $1,234.56'],
  ['{{job_number}}', 'e.g. JB00885'],
  ['{{accept_link}}', 'Link for the customer to view & accept the quote'],
];

function EmailTemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | template object
  const EMPTY = { name: '', subject: '', body: '', is_default: false };
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function load() {
    api.get('/email-templates', { params: { category: 'quote' } }).then(r => setTemplates(r.data)).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  function openNew() { setForm(EMPTY); setErr(''); setEditing('new'); }
  function openEdit(t) { setForm({ name: t.name, subject: t.subject, body: t.body, is_default: t.is_default }); setErr(''); setEditing(t); }

  async function save() {
    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) {
      return setErr('Name, subject and body are all required');
    }
    setSaving(true); setErr('');
    try {
      if (editing === 'new') await api.post('/email-templates', { ...form, category: 'quote' });
      else await api.put(`/email-templates/${editing.id}`, form);
      setEditing(null);
      load();
    } catch (e) { setErr(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  }

  async function remove(t) {
    if (!confirm(`Delete the "${t.name}" template?`)) return;
    await api.delete(`/email-templates/${t.id}`);
    load();
  }

  return (
    <div className={styles.section}>
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h2>Quote Email Templates</h2>
          <button className={styles.btnPrimary} onClick={openNew}>+ New Template</button>
        </div>
        <div className={styles.cardBody}>
          <p className={styles.hint} style={{ marginBottom: 12 }}>
            These appear in the template picker when clicking "Email to Customer" on a quote. The default template loads automatically, and can be swapped or edited before sending.
          </p>
          {templates.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No templates yet.</p>}
          {templates.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '12px', background: '#f8fafc', borderRadius: 6, border: '1px solid var(--color-border)', marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {t.name}
                  {t.is_default && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: '#166534', background: '#f0fdf4', padding: '2px 8px', borderRadius: 99 }}>Default</span>}
                </div>
                <div style={{ fontSize: 13, marginTop: 4, color: 'var(--color-text-muted)' }}>{t.subject}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button className={styles.btnSecondary} onClick={() => openEdit(t)}>Edit</button>
                <button className={styles.btnSecondary} style={{ color: '#dc2626' }} onClick={() => remove(t)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => e.target === e.currentTarget && setEditing(null)}>
          <div style={{ background: 'white', borderRadius: 10, padding: 28, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>{editing === 'new' ? 'New Email Template' : 'Edit Email Template'}</h3>
            {err && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 14 }}>{err}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Template Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Follow-up Quote Email"
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Subject *</label>
                <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Your quote from {{company_name}}"
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Body *</label>
                <textarea rows={8} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  placeholder={'Hi {{customer_first_name}},\n\nPlease find your quote attached…'}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid var(--color-border)', borderRadius: 6, padding: '10px 12px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Available placeholders</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
                  {EMAIL_PLACEHOLDERS.map(([tok, desc]) => (
                    <div key={tok} style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                      <code style={{ color: 'var(--color-primary)' }}>{tok}</code> — {desc}
                    </div>
                  ))}
                </div>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_default} onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} />
                Use as the default quote email template
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
              <button className={styles.btnSecondary} onClick={() => setEditing(null)}>Cancel</button>
              <button className={styles.btnPrimary} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : editing === 'new' ? 'Create Template' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function JobTypesTab() {
  const [jobTypes, setJobTypes] = useState([]);
  const [newType, setNewType] = useState('');
  const [templates, setTemplates] = useState([]);
  const [editingTpl, setEditingTpl] = useState(null); // null | 'new' | template object
  const EMPTY_TPL = { name: '', type: '', description: '', priority: 'medium', is_recurring: false, recurrence_interval: 'annual' };
  const [tplForm, setTplForm] = useState(EMPTY_TPL);

  const [statuses, setStatuses] = useState([]);
  const [savingStatuses, setSavingStatuses] = useState(false);
  const [statusesSaved, setStatusesSaved] = useState(false);
  const [newStatusLabel, setNewStatusLabel] = useState('');
  const statusSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    api.get('/settings/job-types').then(r => setJobTypes(r.data)).catch(() => {});
    api.get('/settings/job-templates').then(r => setTemplates(r.data)).catch(() => {});
    api.get('/settings/job-statuses').then(r => setStatuses(r.data)).catch(() => {});
  }, []);

  function setStatusLabel(key, label) {
    setStatuses(ss => ss.map(s => s.key === key ? { ...s, label } : s));
    setStatusesSaved(false);
  }

  function setStatusColor(key, color) {
    setStatuses(ss => ss.map(s => s.key === key ? { ...s, color } : s));
    setStatusesSaved(false);
  }

  function slugifyStatus(label) {
    const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'status';
    let key = base, n = 2;
    while (statuses.some(s => s.key === key)) { key = `${base}_${n}`; n++; }
    return key;
  }

  function addStatus() {
    const label = newStatusLabel.trim();
    if (!label) return;
    setStatuses(ss => [...ss, { key: slugifyStatus(label), label, color: '#64748b', protected: false }]);
    setNewStatusLabel('');
    setStatusesSaved(false);
  }

  async function deleteStatus(key) {
    try {
      const { data } = await api.get('/jobs', { params: { status: key, limit: 1 } });
      if (data.total > 0) {
        alert(`${data.total} job${data.total === 1 ? '' : 's'} currently ${data.total === 1 ? 'has' : 'have'} this status. Move ${data.total === 1 ? 'it' : 'them'} to a different status first.`);
        return;
      }
    } catch { /* if the check itself fails, fall through — the server still rejects deleting protected keys */ }
    if (!confirm('Delete this status?')) return;
    setStatuses(ss => ss.filter(s => s.key !== key));
    setStatusesSaved(false);
  }

  function handleStatusDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setStatuses(ss => {
      const oldIdx = ss.findIndex(s => s.key === active.id);
      const newIdx = ss.findIndex(s => s.key === over.id);
      return arrayMove(ss, oldIdx, newIdx);
    });
    setStatusesSaved(false);
  }

  async function saveStatuses() {
    setSavingStatuses(true);
    try {
      const { data } = await api.put('/settings/job-statuses', statuses);
      setStatuses(data);
      setStatusesSaved(true);
      setTimeout(() => setStatusesSaved(false), 3000);
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to save statuses');
    } finally { setSavingStatuses(false); }
  }

  async function addType() {
    const t = newType.trim();
    if (!t || jobTypes.includes(t)) return;
    const updated = [...jobTypes, t];
    await api.put('/settings/job-types', updated);
    setJobTypes(updated);
    setNewType('');
  }

  async function removeType(t) {
    if (!confirm(`Remove job type "${t}"?`)) return;
    const updated = jobTypes.filter(x => x !== t);
    await api.put('/settings/job-types', updated);
    setJobTypes(updated);
  }

  async function saveTpl() {
    if (!tplForm.name.trim()) return;
    if (editingTpl === 'new') {
      const { data } = await api.post('/settings/job-templates', tplForm);
      setTemplates(t => [...t, data]);
    } else {
      const { data } = await api.put(`/settings/job-templates/${editingTpl.id}`, tplForm);
      setTemplates(t => t.map(x => x.id === data.id ? data : x));
    }
    setEditingTpl(null);
    setTplForm(EMPTY_TPL);
  }

  async function deleteTpl(id) {
    if (!confirm('Delete this template?')) return;
    await api.delete(`/settings/job-templates/${id}`);
    setTemplates(t => t.filter(x => x.id !== id));
  }

  function openEdit(tpl) {
    setTplForm({ name: tpl.name, type: tpl.type || '', description: tpl.description || '',
      priority: tpl.priority || 'medium', is_recurring: tpl.is_recurring || false,
      recurrence_interval: tpl.recurrence_interval || 'annual' });
    setEditingTpl(tpl);
  }

  return (
    <div className={styles.section}>
      {/* Job Types */}
      <div className={styles.card}>
        <div className={styles.cardHeader}><h2>Job Types</h2></div>
        <div className={styles.cardBody}>
          <p className={styles.hint} style={{ marginBottom: 12 }}>
            These types appear in the Job Type dropdown when creating or editing a job.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {jobTypes.map(t => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f8fafc', borderRadius: 6, border: '1px solid var(--color-border)' }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{t}</span>
                <button onClick={() => removeType(t)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={newType} onChange={e => setNewType(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addType()}
              placeholder="New job type…"
              style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 13 }} />
            <button className={styles.btnPrimary} onClick={addType} disabled={!newType.trim()}>Add</button>
          </div>
        </div>
      </div>

      {/* Job Statuses */}
      <div className={styles.card} style={{ marginTop: 24 }}>
        <div className={styles.cardHeader}><h2>Job Statuses</h2></div>
        <div className={styles.cardBody}>
          <p className={styles.hint} style={{ marginBottom: 12 }}>
            Drag to reorder, recolour, or rename any status — the order here sets the order of the pipeline on a job's
            page. 🔒 statuses drive automation elsewhere (quoting, invoicing, recurring jobs, the timer) so they can't
            be deleted, but you can add your own statuses alongside them for anything else you want to track.
          </p>
          <DndContext sensors={statusSensors} collisionDetection={closestCenter} onDragEnd={handleStatusDragEnd}>
            <SortableContext items={statuses.map(s => s.key)} strategy={verticalListSortingStrategy}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {statuses.map(s => (
                  <SortableStatusRow key={s.key} s={s} onLabelChange={setStatusLabel} onColorChange={setStatusColor} onDelete={deleteStatus} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input value={newStatusLabel} onChange={e => setNewStatusLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addStatus()}
              placeholder="New status name…"
              style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', fontSize: 13 }} />
            <button className={styles.btnSecondary} onClick={addStatus} disabled={!newStatusLabel.trim()}>+ Add Status</button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className={styles.btnPrimary} onClick={saveStatuses} disabled={savingStatuses}>
              {savingStatuses ? 'Saving…' : 'Save Statuses'}
            </button>
            {statusesSaved && <span style={{ color: '#16a34a', fontSize: 13, fontWeight: 500 }}>✓ Saved</span>}
          </div>
        </div>
      </div>

      {/* Job Templates */}
      <div className={styles.card} style={{ marginTop: 24 }}>
        <div className={styles.cardHeader}>
          <h2>Job Templates</h2>
          <button className={styles.btnPrimary} onClick={() => { setTplForm(EMPTY_TPL); setEditingTpl('new'); }}>+ New Template</button>
        </div>
        <div className={styles.cardBody}>
          <p className={styles.hint} style={{ marginBottom: 12 }}>
            Templates pre-fill job details. Select them from the "New Job from Template" button on the Jobs page.
          </p>
          {templates.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No templates yet.</p>}
          {templates.map(tpl => (
            <div key={tpl.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '12px', background: '#f8fafc', borderRadius: 6, border: '1px solid var(--color-border)', marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{tpl.name}</div>
                {tpl.type && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{tpl.type} · {tpl.priority} priority{tpl.is_recurring ? ` · ${tpl.recurrence_interval}` : ''}</div>}
                {tpl.description && <div style={{ fontSize: 13, marginTop: 4, color: 'var(--color-text)' }}>{tpl.description}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button className={styles.btnSmall} onClick={() => openEdit(tpl)}>Edit</button>
                <button className={styles.btnSmall} style={{ color: '#dc2626' }} onClick={() => deleteTpl(tpl.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Template edit modal */}
      {editingTpl !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => e.target === e.currentTarget && setEditingTpl(null)}>
          <div style={{ background: 'white', borderRadius: 10, padding: 28, width: 480, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>{editingTpl === 'new' ? 'New Template' : 'Edit Template'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[['Template Name *', 'name', 'text', 'e.g. Annual Heat Pump Service'],
                ['Job Type', 'type', 'text', 'e.g. Service'],
                ['Description', 'description', 'textarea', 'Pre-filled job description…']].map(([lbl, key, t, ph]) => (
                <div key={key}>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>{lbl}</label>
                  {t === 'textarea'
                    ? <textarea rows={3} value={tplForm[key]} onChange={e => setTplForm(f => ({ ...f, [key]: e.target.value }))} placeholder={ph}
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
                    : <input value={tplForm[key]} onChange={e => setTplForm(f => ({ ...f, [key]: e.target.value }))} placeholder={ph}
                        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
                  }
                </div>
              ))}
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Priority</label>
                <select value={tplForm.priority} onChange={e => setTplForm(f => ({ ...f, priority: e.target.value }))}
                  style={{ padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13 }}>
                  {['low','medium','high'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={tplForm.is_recurring} onChange={e => setTplForm(f => ({ ...f, is_recurring: e.target.checked }))} />
                Recurring job
              </label>
              {tplForm.is_recurring && (
                <select value={tplForm.recurrence_interval} onChange={e => setTplForm(f => ({ ...f, recurrence_interval: e.target.value }))}
                  style={{ padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13 }}>
                  {[['monthly','Monthly'],['quarterly','Quarterly'],['biannual','Every 6 months'],['annual','Annual']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
              <button className={styles.btnSecondary} onClick={() => setEditingTpl(null)}>Cancel</button>
              <button className={styles.btnPrimary} onClick={saveTpl} disabled={!tplForm.name.trim()}>
                {editingTpl === 'new' ? 'Create Template' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
