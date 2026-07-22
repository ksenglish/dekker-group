import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './Users.module.css';

const ROLES = [
  { value: 'admin',         label: 'Admin',         desc: 'Full access — settings, users, all data' },
  { value: 'sales',         label: 'Sales',         desc: 'Customers, Price List, Sales Presenter, own jobs, schedule, quotes & timesheets' },
  { value: 'operations',    label: 'Operations',    desc: 'Same access as Sales — jobs, schedule, customers, quotes & timesheets' },
  { value: 'subcontractor', label: 'Subcontractor', desc: 'Own schedule and own jobs only' },
];

const ROLE_LABEL = {
  admin: 'Admin', sales: 'Sales', operations: 'Operations', subcontractor: 'Subcontractor',
  office: 'Office', field_tech: 'Field Tech', // legacy
  undefined: 'Undefined', // imported team members awaiting a role
};

const ROLE_BADGE = {
  admin: styles.badgeAdmin, sales: styles.badgeSales,
  operations: styles.badgeOps, subcontractor: styles.badgeTech,
  office: styles.badgeOffice, field_tech: styles.badgeTech,
  undefined: styles.badgeUndefined,
};

// Which Schedule diaries (calendars) a user appears under — multi-select,
// e.g. someone doing both sales and operations work belongs to both
const DIARY_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'sales', label: 'Sales' },
  { value: 'operations', label: 'Operations' },
  { value: 'subcontractor', label: 'Subcontractor' },
];

function diariesFromRole(role) {
  if (role === 'admin') return ['admin'];
  if (role === 'sales') return ['sales'];
  if (role === 'operations' || role === 'office') return ['operations'];
  if (role === 'subcontractor' || role === 'field_tech') return ['subcontractor'];
  return [];
}

function UserModal({ user, currentUserId, onSave, onClose }) {
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    role: user?.role || 'operations',
    diaries: user ? (user.diaries || []) : diariesFromRole('operations'),
    default_billing_rate_id: user?.default_billing_rate_id || '',
    licence_number: user?.licence_number || '',
    mobile: user?.mobile || '',
    password: '',
    confirmPassword: '',
    is_active: user?.is_active !== false,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [billingRates, setBillingRates] = useState([]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isNew = !user;

  useEffect(() => {
    api.get('/settings/billing-rates').then(r => setBillingRates(r.data)).catch(() => {});
  }, []);

  function toggleDiary(d) {
    setForm(f => ({
      ...f,
      diaries: f.diaries.includes(d) ? f.diaries.filter(x => x !== d) : [...f.diaries, d],
    }));
  }

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return setErr('Name and email are required');
    if (isNew && !form.password) return setErr('Password is required for new users');
    if (form.password && form.password !== form.confirmPassword) return setErr('Passwords do not match');
    if (form.password && form.password.length < 8) return setErr('Password must be at least 8 characters');
    setSaving(true); setErr('');
    try {
      const payload = {
        name: form.name, email: form.email, role: form.role, diaries: form.diaries,
        default_billing_rate_id: form.default_billing_rate_id || null, is_active: form.is_active,
        licence_number: form.licence_number || null, mobile: form.mobile || null,
      };
      if (form.password) payload.password = form.password;
      const { data } = user
        ? await api.put(`/users/${user.id}`, payload)
        : await api.post('/users', payload);
      onSave(data);
    } catch (e) { setErr(e.response?.data?.error || 'Save failed'); setSaving(false); }
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2>{isNew ? 'Add Team Member' : 'Edit User'}</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={save} className={styles.modalBody}>
          {err && <div className={styles.error}>{err}</div>}
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label>Full Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. John Smith" />
            </div>
            <div className={styles.field}>
              <label>Email *</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="john@dekkergroup.co.nz" />
            </div>
            <div className={styles.field} style={{ gridColumn: '1/-1' }}>
              <label>Role</label>
              <div className={styles.roleCards}>
                {ROLES.map(r => (
                  <div key={r.value}
                    className={`${styles.roleCard} ${form.role === r.value ? styles.roleCardActive : ''}`}
                    onClick={() => {
                      set('role', r.value);
                      // For new users, suggest the matching diary — stays editable below
                      if (isNew) set('diaries', diariesFromRole(r.value));
                    }}>
                    <div className={styles.roleCardTitle}>{r.label}</div>
                    <div className={styles.roleCardDesc}>{r.desc}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.field} style={{ gridColumn: '1/-1' }}>
              <label>Schedule Diaries</label>
              <p className={styles.hint}>Which calendars this person appears under on the Schedule — select all that apply.</p>
              <div className={styles.diaryChecks}>
                {DIARY_OPTIONS.map(d => (
                  <label key={d.value} className={styles.diaryCheck}>
                    <input type="checkbox" checked={form.diaries.includes(d.value)} onChange={() => toggleDiary(d.value)} />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>
            <div className={styles.field} style={{ gridColumn: '1/-1' }}>
              <label>Default Billing Rate</label>
              <p className={styles.hint}>Pre-selected when this person logs time on a job — they can still change it per entry.</p>
              <select value={form.default_billing_rate_id} onChange={e => set('default_billing_rate_id', e.target.value)}>
                <option value="">No default</option>
                {billingRates.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label>Licence Number</label>
              <p className={styles.hint}>Registration / practising licence number — pre-fills onsite compliance forms (e.g. Electrical COC).</p>
              <input value={form.licence_number} onChange={e => set('licence_number', e.target.value)} placeholder="e.g. 123456" />
            </div>
            <div className={styles.field}>
              <label>Mobile</label>
              <p className={styles.hint}>Pre-fills the phone field on onsite compliance forms.</p>
              <input value={form.mobile} onChange={e => set('mobile', e.target.value)} placeholder="e.g. 021 123 4567" />
            </div>
            <div className={styles.field}>
              <label>{isNew ? 'Password *' : 'New Password'}</label>
              <input type="password" value={form.password} onChange={e => set('password', e.target.value)}
                placeholder={isNew ? 'Min 8 characters' : 'Leave blank to keep current'} />
            </div>
            <div className={styles.field}>
              <label>{isNew ? 'Confirm Password *' : 'Confirm New Password'}</label>
              <input type="password" value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)}
                placeholder="Re-enter password" />
            </div>
            {user && user.id !== currentUserId && (
              <div className={styles.field} style={{ gridColumn: '1/-1', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
                <label htmlFor="is_active" style={{ marginBottom: 0 }}>Account active (user can log in)</label>
              </div>
            )}
          </div>
          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? 'Saving…' : isNew ? 'Create User' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(null); // userId

  useEffect(() => {
    api.get('/users').then(r => setUsers(r.data)).finally(() => setLoading(false));
  }, []);

  async function sendInvite(u) {
    setInviting(u.id);
    try {
      await api.post(`/users/${u.id}/invite`);
      alert(`Invite sent to ${u.email}`);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to send invite');
    } finally {
      setInviting(null);
    }
  }

  async function unlockAccount(u) {
    try {
      await api.post(`/users/${u.id}/unlock`);
      alert(`${u.name}'s account has been unlocked.`);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to unlock account');
    }
  }

  async function deleteUser(u) {
    if (!confirm(`Remove ${u.name}? This cannot be undone.`)) return;
    await api.delete(`/users/${u.id}`);
    setUsers(us => us.filter(x => x.id !== u.id));
  }

  function onSaved(u) {
    setUsers(us => {
      const idx = us.findIndex(x => x.id === u.id);
      if (idx > -1) { const n = [...us]; n[idx] = u; return n; }
      return [...us, u];
    });
    setEditing(null); setAdding(false);
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Team Members</h1>
          <p className={styles.pageSubtitle}>{users.length} user{users.length !== 1 ? 's' : ''}</p>
        </div>
        <button className={styles.btnPrimary} onClick={() => setAdding(true)}>+ Add User</button>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : (
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
            <span>Status</span>
            <span>Member Since</span>
            <span></span>
          </div>
          {users.map(u => (
            <div key={u.id} className={`${styles.tableRow} ${!u.is_active ? styles.inactive : ''}`}>
              <div className={styles.nameCell}>
                <div className={styles.avatar}>{u.name.charAt(0).toUpperCase()}</div>
                <div>
                  <div className={styles.userName}>{u.name} {u.id === currentUser.id && <span className={styles.youBadge}>You</span>}</div>
                </div>
              </div>
              <div className={styles.emailCell}>{u.email}</div>
              <div><span className={`${styles.badge} ${ROLE_BADGE[u.role] || styles.badgeTech}`}>{ROLE_LABEL[u.role] || u.role}</span></div>
              <div><span className={`${styles.badge} ${u.is_active ? styles.badgeActive : styles.badgeInactive}`}>{u.is_active ? 'Active' : 'Inactive'}</span></div>
              <div className={styles.dateCell}>{new Date(u.created_at).toLocaleDateString('en-NZ')}</div>
              <div className={styles.actions}>
                <button className={styles.btnInvite} onClick={() => sendInvite(u)} disabled={inviting === u.id}>
                  {inviting === u.id ? 'Sending…' : '✉ Invite'}
                </button>
                <button className={styles.btnUnlock} onClick={() => unlockAccount(u)} title="Unlock account">🔓</button>
                <button className={styles.btnIcon} onClick={() => setEditing(u)} title="Edit">✏</button>
                {u.id !== currentUser.id && (
                  <button className={styles.btnIcon} onClick={() => deleteUser(u)} title="Delete">🗑</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <UserModal
          user={editing}
          currentUserId={currentUser.id}
          onSave={onSaved}
          onClose={() => { setAdding(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
