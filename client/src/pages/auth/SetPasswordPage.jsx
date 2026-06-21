import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import styles from './Auth.module.css';

export default function SetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading | ready | done | invalid
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/auth/reset-token/${token}`)
      .then(r => { setUserName(r.data.name); setStatus('ready'); })
      .catch(() => setStatus('invalid'));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setSaving(true); setError('');
    try {
      await api.post('/auth/set-password', { token, password });
      setStatus('done');
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <img src="/favicon.png" alt="" className={styles.logoMark} />
          <span className={styles.logoText}>Dekker App</span>
        </div>

        {status === 'loading' && <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>Verifying link…</p>}

        {status === 'invalid' && (
          <div className={styles.errorBanner}>
            <strong>This link has expired or is invalid.</strong><br />
            <span style={{ fontSize: 13 }}>Ask an admin to resend the invite.</span>
          </div>
        )}

        {status === 'done' && (
          <div className={styles.successBanner}>
            <strong>Password set!</strong> Redirecting you to login…
          </div>
        )}

        {status === 'ready' && (
          <>
            <h2 className={styles.title}>Set your password</h2>
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
              Welcome, {userName}. Choose a password to activate your account.
            </p>
            <form onSubmit={handleSubmit} className={styles.form}>
              {error && <div className={styles.errorBanner}>{error}</div>}
              <div className={styles.field}>
                <label>New Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters" autoFocus />
              </div>
              <div className={styles.field}>
                <label>Confirm Password</label>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat your password" />
              </div>
              <button type="submit" className={styles.submitBtn} disabled={saving}>
                {saving ? 'Setting password…' : 'Set Password & Log In'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
