import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Dashboard from '../../pages/Dashboard';
import CustomerList from '../../pages/customers/CustomerList';
import CustomerDetail from '../../pages/customers/CustomerDetail';
import JobList from '../../pages/jobs/JobList';
import JobDetail from '../../pages/jobs/JobDetail';
import SchedulePage from '../../pages/schedule/SchedulePage';
import QuoteList from '../../pages/quotes/QuoteList';
import QuoteDetail from '../../pages/quotes/QuoteDetail';
import InvoiceList from '../../pages/invoices/InvoiceList';
import InvoiceDetail from '../../pages/invoices/InvoiceDetail';
import SettingsPage from '../../pages/settings/SettingsPage';
import ProductList from '../../pages/products/ProductList';
import UsersPage from '../../pages/users/UsersPage';
import TimesheetsPage from '../../pages/timesheets/TimesheetsPage';
import styles from './AppShell.module.css';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '⊞', exact: true },
  { to: '/customers', label: 'Customers', icon: '👥' },
  { to: '/jobs', label: 'Jobs', icon: '🔧' },
  { to: '/schedule', label: 'Schedule', icon: '📅' },
  { to: '/quotes', label: 'Quotes', icon: '📋' },
  { to: '/invoices', label: 'Invoices', icon: '💰' },
  { to: '/products', label: 'Price List', icon: '🏷' },
  { to: '/timesheets', label: 'Timesheets', icon: '⏱' },
];

const ADMIN_ITEMS = [
  { to: '/users', label: 'Users', icon: '👤' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>DG</div>
          <span className={styles.brandName}>Dekker Group</span>
        </div>

        <nav className={styles.nav}>
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
              }
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}

          {user?.role === 'admin' && (
            <>
              <div className={styles.navDivider}>Admin</div>
              {ADMIN_ITEMS.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
                  }
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.userInfo}>
            <div className={styles.userAvatar}>
              {user?.name?.charAt(0).toUpperCase()}
            </div>
            <div className={styles.userDetails}>
              <span className={styles.userName}>{user?.name}</span>
              <span className={styles.userRole}>{user?.role?.replace('_', ' ')}</span>
            </div>
          </div>
          <button className={styles.logoutBtn} onClick={handleLogout} title="Sign out">
            ⎋
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/customers" element={<CustomerList />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/jobs" element={<JobList />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/quotes" element={<QuoteList />} />
          <Route path="/quotes/:id" element={<QuoteDetail />} />
          <Route path="/invoices" element={<InvoiceList />} />
          <Route path="/invoices/:id" element={<InvoiceDetail />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/products" element={<ProductList />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/timesheets" element={<TimesheetsPage />} />
          <Route path="/users/*" element={<ComingSoon title="Users" />} />
        </Routes>
      </main>

      {/* Mobile bottom navigation */}
      <nav className={styles.bottomNav}>
        {[
          { to: '/',         icon: '⊞', label: 'Home',     exact: true },
          { to: '/jobs',     icon: '🔧', label: 'Jobs' },
          { to: '/schedule', icon: '📅', label: 'Schedule' },
          { to: '/quotes',   icon: '📋', label: 'Quotes' },
          { to: '/customers',icon: '👥', label: 'Customers' },
        ].map(item => (
          <NavLink key={item.to} to={item.to} end={item.exact}
            className={({ isActive }) =>
              `${styles.bottomNavItem} ${isActive ? styles.bottomNavItemActive : ''}`
            }>
            <span className={styles.bottomNavIcon}>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function ComingSoon({ title }) {
  return (
    <div style={{ padding: 40 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>{title}</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>Coming in the next build step.</p>
    </div>
  );
}
