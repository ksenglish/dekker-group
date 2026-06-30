import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import styles from './Auth.module.css';

export default function LoginPage() {
  const { login, verifyOtp, resendOtp } = useAuth();
  const navigate = useNavigate();

  // Step 1: password
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Step 2: OTP
  const [step, setStep] = useState('password'); // 'password' | 'otp'
  const [otpToken, setOtpToken] = useState('');
  const [otpEmail, setOtpEmail] = useState('');
  const [code, setCode] = useState('');
  const [resendStatus, setResendStatus] = useState(''); // '' | 'sending' | 'sent'
  const codeRef = useRef(null);

  useEffect(() => {
    if (step === 'otp') codeRef.current?.focus();
  }, [step]);

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(form.email, form.password);
      if (result?.requires_otp) {
        setOtpToken(result.otp_token);
        setOtpEmail(form.email);
        setStep('otp');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpSubmit(e) {
    e?.preventDefault();
    if (code.length !== 6) return;
    setError('');
    setLoading(true);
    try {
      await verifyOtp(otpToken, code);
      navigate('/');
    } catch (err) {
      const data = err.response?.data;
      if (data?.force_restart) {
        setStep('password');
        setCode('');
        setOtpToken('');
        setError(data.error || 'Please sign in again.');
      } else {
        setError(data?.error || 'Invalid code. Please try again.');
        setCode('');
        codeRef.current?.focus();
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResendStatus('sending');
    setError('');
    try {
      const newToken = await resendOtp(otpToken);
      setOtpToken(newToken);
      setResendStatus('sent');
      setCode('');
      codeRef.current?.focus();
      setTimeout(() => setResendStatus(''), 4000);
    } catch (err) {
      const data = err.response?.data;
      if (data?.force_restart) {
        setStep('password');
        setCode('');
        setError('Session expired — please sign in again.');
      } else {
        setError(data?.error || 'Could not resend code.');
        setResendStatus('');
      }
    }
  }

  function handleCodeChange(e) {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(val);
    if (val.length === 6) {
      // Auto-submit when 6 digits are entered
      setTimeout(() => handleOtpSubmit(), 0);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <img src="/favicon.png" alt="Dekker" className={styles.logoMark} />
          <span className={styles.logoText}>Dekker App</span>
        </div>

        {/* ── Step 1: Password ── */}
        {step === 'password' && (
          <>
            <h1 className={styles.title}>Sign in to your account</h1>
            {error && <div className={styles.errorBanner}>{error}</div>}
            <form onSubmit={handlePasswordSubmit} className={styles.form}>
              <div className={styles.field}>
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                />
              </div>
              <div className={styles.forgotRow}>
                <Link to="/forgot-password">Forgot password?</Link>
              </div>
              <button type="submit" className={styles.submitBtn} disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </>
        )}

        {/* ── Step 2: OTP ── */}
        {step === 'otp' && (
          <>
            <div className={styles.otpHeader}>
              <div className={styles.otpIcon}>✉</div>
              <h1 className={styles.title} style={{ marginBottom: 6 }}>Check your email</h1>
              <p className={styles.otpSubtitle}>
                We sent a 6-digit code to <strong>{otpEmail}</strong>.<br />
                Enter it below to complete sign-in.
              </p>
            </div>

            {error && <div className={styles.errorBanner}>{error}</div>}
            {resendStatus === 'sent' && (
              <div className={styles.successBanner}>A new code has been sent.</div>
            )}

            <form onSubmit={handleOtpSubmit} className={styles.form}>
              <div className={styles.field}>
                <label htmlFor="otp-code">Verification code</label>
                <input
                  id="otp-code"
                  ref={codeRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={6}
                  value={code}
                  onChange={handleCodeChange}
                  className={styles.otpInput}
                />
              </div>
              <button
                type="submit"
                className={styles.submitBtn}
                disabled={loading || code.length !== 6}
              >
                {loading ? 'Verifying…' : 'Verify'}
              </button>
            </form>

            <div className={styles.otpFooter}>
              <span className={styles.otpFooterText}>Didn't get a code?</span>
              <button
                className={styles.otpResendBtn}
                onClick={handleResend}
                disabled={resendStatus === 'sending'}
              >
                {resendStatus === 'sending' ? 'Sending…' : 'Send again'}
              </button>
              <span className={styles.otpFooterDot}>·</span>
              <button
                className={styles.otpResendBtn}
                onClick={() => { setStep('password'); setCode(''); setError(''); }}
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
