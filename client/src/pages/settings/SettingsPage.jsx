import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import styles from './Settings.module.css';

const TABS = ['Quote Theme', 'Terms & Conditions', 'Email'];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('Quote Theme');
  const [theme, setTheme] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const fileRef = useRef();

  // SMTP state
  const [smtp, setSmtp] = useState({ host: '', port: '587', secure: false, user: '', pass: '', from: '', fromName: 'Dekker Group' });
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpSaved, setSmtpSaved] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpStatus, setSmtpStatus] = useState(null);
  const setSmtpField = (k, v) => setSmtp(s => ({ ...s, [k]: v }));

  useEffect(() => {
    api.get('/settings').then(r => setTheme(r.data));
    api.get('/settings/smtp').then(r => setSmtp(s => ({ ...s, ...r.data }))).catch(() => {});
  }, []);

  async function saveSmtp() {
    setSmtpSaving(true); setSmtpStatus(null);
    try {
      await api.put('/settings/smtp', smtp);
      setSmtpSaved(true); setTimeout(() => setSmtpSaved(false), 3000);
    } catch (e) { setSmtpStatus({ ok: false, message: e.response?.data?.error || 'Save failed' }); }
    finally { setSmtpSaving(false); }
  }

  async function testSmtp() {
    setSmtpTesting(true); setSmtpStatus(null);
    try {
      await api.put('/settings/smtp', smtp); // save first
      const { data } = await api.post('/settings/smtp/test');
      setSmtpStatus(data);
    } catch (e) { setSmtpStatus({ ok: false, message: e.response?.data?.message || 'Test failed' }); }
    finally { setSmtpTesting(false); }
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
                  <div className={styles.pdfPreview} style={{
                    background: theme.transparentHeader ? 'transparent' : theme.brandColour,
                    border: theme.transparentHeader ? '1px dashed #d1d5db' : 'none',
                  }}>
                    {theme.logoBase64 ? (
                      <img src={theme.logoBase64} alt="logo" className={styles.previewLogo} />
                    ) : (
                      <div>
                        <div className={styles.previewName} style={{ color: theme.transparentHeader ? theme.brandColour : 'white' }}>
                          {theme.companyName || 'COMPANY NAME'}
                        </div>
                        <div className={styles.previewTagline} style={{ color: theme.transparentHeader ? '#64748b' : 'rgba(255,255,255,0.8)' }}>
                          {theme.tagline}
                        </div>
                      </div>
                    )}
                    <div className={styles.previewContact} style={{ color: theme.transparentHeader ? '#64748b' : 'rgba(255,255,255,0.85)' }}>
                      {[theme.website, theme.email, theme.phone, theme.location].filter(Boolean).map((l, i) => (
                        <div key={i}>{l}</div>
                      ))}
                    </div>
                  </div>
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
                <div className={styles.cardHeader}><h2>SMTP Email Settings</h2></div>
                <div className={styles.cardBody}>
                  <p className={styles.hint} style={{ marginBottom: 16 }}>
                    Configure your outgoing email server so quotes and invoices can be emailed directly to customers.
                    Common providers: Gmail (smtp.gmail.com:587), Outlook (smtp.office365.com:587).
                  </p>
                  <div className={styles.formGrid}>
                    <div className={styles.field}>
                      <label>From Name</label>
                      <input value={smtp.fromName} onChange={e => setSmtpField('fromName', e.target.value)} placeholder="Dekker Group" />
                    </div>
                    <div className={styles.field}>
                      <label>From Email</label>
                      <input type="email" value={smtp.from} onChange={e => setSmtpField('from', e.target.value)} placeholder="kyle@dekkergroup.co.nz" />
                    </div>
                    <div className={styles.field}>
                      <label>SMTP Host</label>
                      <input value={smtp.host} onChange={e => setSmtpField('host', e.target.value)} placeholder="smtp.gmail.com" />
                    </div>
                    <div className={styles.field}>
                      <label>SMTP Port</label>
                      <input type="number" value={smtp.port} onChange={e => setSmtpField('port', e.target.value)} placeholder="587" />
                    </div>
                    <div className={styles.field}>
                      <label>Username</label>
                      <input value={smtp.user} onChange={e => setSmtpField('user', e.target.value)} placeholder="kyle@dekkergroup.co.nz" />
                    </div>
                    <div className={styles.field}>
                      <label>Password / App Password</label>
                      <input type="password" value={smtp.pass} onChange={e => setSmtpField('pass', e.target.value)} placeholder="••••••••" />
                    </div>
                    <div className={styles.field} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                      <input type="checkbox" id="smtpSecure" checked={!!smtp.secure} onChange={e => setSmtpField('secure', e.target.checked)} />
                      <label htmlFor="smtpSecure" style={{ marginBottom: 0 }}>Use SSL (port 465)</label>
                    </div>
                  </div>
                  {smtpStatus && (
                    <div className={smtpStatus.ok ? styles.successMsg : styles.errorMsg} style={{ marginTop: 16 }}>
                      {smtpStatus.ok ? '✓ ' : '✕ '}{smtpStatus.message}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                    <button className={styles.btnSecondary} onClick={testSmtp} disabled={smtpTesting || !smtp.host}>
                      {smtpTesting ? 'Testing…' : 'Test Connection'}
                    </button>
                    <button className={styles.btnPrimary} onClick={saveSmtp} disabled={smtpSaving}>
                      {smtpSaving ? 'Saving…' : smtpSaved ? '✓ Saved' : 'Save Email Settings'}
                    </button>
                  </div>
                  <p className={styles.hint} style={{ marginTop: 12 }}>
                    For Gmail: enable 2FA and use an <strong>App Password</strong> (not your regular password).
                    Go to Google Account → Security → App Passwords.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Terms & Conditions' && (
            <div className={styles.section}>
              <div className={styles.card}>
                <div className={styles.cardHeader}><h2>Terms & Conditions</h2></div>
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
