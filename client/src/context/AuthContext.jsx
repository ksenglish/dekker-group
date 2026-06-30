import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { setAccessToken } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const bootstrap = useCallback(async () => {
    try {
      const { data } = await api.post('/auth/refresh');
      setAccessToken(data.accessToken);
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

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
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyOtp, resendOtp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
