import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './Users.module.css';

const ROLES = [
  { value: 'admin',     label: 'Admin',      desc: 'Full access including settings and user management' },
  { value: 'office',    label: 'Office',      desc: 'Can manage jobs, quotes, invoices and customers' },
  { value: 'field_tech',label: 'Field Tech',  desc: 'Can view jobs and log time — read only' },
];

const ROLE_BADGE = { admin: styles.badgeAdmin, office: styles.badgeOffice, field_tech: styles.badgeTech };

function UserModal({ user, currentUserId, onSave, onClose }) {
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    role: user?.role || 'field_tech',
    password: '',
    confirmPassword: '',
    is_active: user?.is_active !== false,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isNew = !user;

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return setErr('Name and email are required');
    if (isNew && !form.password) return setErr('Password is required for new users');
    if (form.password && form.password !== form.confirmPassword) return setErr('Passwords do not match');
    if (form.password && form.password.length < 8) return setErr('Password must be at least 8 characters');
    setSaving(true); setErr('');
    try {
      const payload = { name: form.name, email: form.email, role: form.role, is_active: form.is_active };
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
                    onClick={() => set('role', r.value)}>
                    <div className={styles.roleCardTitle}>{r.label}</div>
                    <div className={styles.roleCardDesc}>{r.desc}</div>
                  </div>
                ))}
              </div>
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

  useEffect(() => {
    api.get('/users').then(r => setUsers(r.data)).finally(() => setLoading(false));
  }, []);

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
              <div><span className={`${styles.badge} ${ROLE_BADGE[u.role]}`}>{ROLES.find(r => r.value === u.role)?.label || u.role}</span></div>
              <div><span className={`${styles.badge} ${u.is_active ? styles.badgeActive : styles.badgeInactive}`}>{u.is_active ? 'Active' : 'Inactive'}</span></div>
              <div className={styles.dateCell}>{new Date(u.created_at).toLocaleDateString('en-NZ')}</div>
              <div className={styles.actions}>
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
