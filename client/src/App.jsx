import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { UnsavedChangesProvider } from './context/UnsavedChangesContext';
import LoginPage from './pages/auth/LoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import SetPasswordPage from './pages/auth/SetPasswordPage';
import AppShell from './components/layout/AppShell';
import PublicQuote from './pages/quotes/PublicQuote';
import PublicServiceReport from './pages/jobs/PublicServiceReport';
import Dashboard from './pages/Dashboard';

// Shown while the server is away — a deploy, a restart — rather than the login
// page. Nobody has been signed out; the app simply cannot reach the server to
// say so yet, and it keeps trying on its own.
function Reconnecting() {
  return (
    <div className="page-loading">
      <div>Reconnecting to the server…</div>
      <div style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>
        You are still signed in. This usually clears within a minute.
      </div>
    </div>
  );
}

function PrivateRoute({ children }) {
  const { user, loading, offline } = useAuth();
  if (loading) return <div className="page-loading">Loading…</div>;
  if (!user && offline) return <Reconnecting />;
  return user ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  const { user, loading, offline } = useAuth();
  if (loading) return <div className="page-loading">Loading…</div>;
  // Not sent to the login page either: signing in needs the same server that
  // isn't answering, so a password typed here would only fail.
  if (!user && offline) return <Reconnecting />;
  return user ? <Navigate to="/" replace /> : children;
}

export default function App() {
  return (
    <AuthProvider>
      <UnsavedChangesProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
          <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
          <Route path="/set-password/:token" element={<SetPasswordPage />} />
          <Route path="/q/:token" element={<PublicQuote />} />
          {/* The customer’s live job service report — no login, the token is the key */}
          <Route path="/sr/:token" element={<PublicServiceReport />} />
          <Route path="/*" element={
            <PrivateRoute>
              <AppShell />
            </PrivateRoute>
          } />
        </Routes>
      </BrowserRouter>
      </UnsavedChangesProvider>
    </AuthProvider>
  );
}
