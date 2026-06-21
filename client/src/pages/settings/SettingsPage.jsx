import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './Settings.module.css';

const TABS = ['My Account', 'Quote Theme', 'Terms & Conditions', 'Email', 'Job Types & Templates'];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('My Account');
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

function JobTypesTab() {
  const [jobTypes, setJobTypes] = useState([]);
  const [newType, setNewType] = useState('');
  const [templates, setTemplates] = useState([]);
  const [editingTpl, setEditingTpl] = useState(null); // null | 'new' | template object
  const EMPTY_TPL = { name: '', type: '', description: '', priority: 'medium', is_recurring: false, recurrence_interval: 'annual' };
  const [tplForm, setTplForm] = useState(EMPTY_TPL);

  useEffect(() => {
    api.get('/settings/job-types').then(r => setJobTypes(r.data)).catch(() => {});
    api.get('/settings/job-templates').then(r => setTemplates(r.data)).catch(() => {});
  }, []);

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
