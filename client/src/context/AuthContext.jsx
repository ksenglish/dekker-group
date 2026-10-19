import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { setAccessToken, refreshSession, isAuthRefusal } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Set when the server could not be reached at all, as opposed to telling us
  // the session is over. The app is still signed in; it just can't prove it
  // yet, so the screen says so instead of showing a login box that would make
  // anyone type a password they don't need to.
  const [offline, setOffline] = useState(false);

  const bootstrap = useCallback(async () => {
    try {
      const data = await refreshSession();
      setAccessToken(data.accessToken);
      setUser(data.user);
      setOffline(false);
    } catch (err) {
      // Only the server saying no means log in again. Anything else is the
      // server being away — a deploy, a restart — and the cookie is still
      // good, so the session is kept and this retries instead.
      if (isAuthRefusal(err)) { setUser(null); setOffline(false); }
      else setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  // While the server is away, keep trying quietly in the background. A restart
  // is back within a minute, and this picks it up without anyone reloading.
  useEffect(() => {
    if (!offline) return undefined;
    const t = setInterval(bootstrap, 10000);
    return () => clearInterval(t);
  }, [offline, bootstrap]);

  // Returns { requires_otp, otp_token } if 2FA is needed, or sets user on success
  async function login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    if (data.requires_otp) {
      return { requires_otp: true, otp_token: data.otp_token };
    }
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }

  async function verifyOtp(otpToken, code) {
    const { data } = await api.post('/auth/verify-otp', { otp_token: otpToken, code });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }

  async function resendOtp(otpToken) {
    const { data } = await api.post('/auth/resend-otp', { otp_token: otpToken });
    return data.otp_token;
  }

  async function logout() {
    await api.post('/auth/logout').catch(() => {});
    setAccessToken(null);
    setUser(null);
    setOffline(false);
  }

  return (
    <AuthContext.Provider value={{ user, loading, offline, login, verifyOtp, resendOtp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
