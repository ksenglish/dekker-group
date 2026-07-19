import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Dashboard from '../../pages/Dashboard';
import CustomerList from '../../pages/customers/CustomerList';
import CustomerDetail from '../../pages/customers/CustomerDetail';
import JobList from '../../pages/jobs/JobList';
import JobDetail from '../../pages/jobs/JobDetail';
import TradifyImport from '../../pages/jobs/TradifyImport';
import SchedulePage from '../../pages/schedule/SchedulePage';
import QuoteList from '../../pages/quotes/QuoteList';
import QuoteDetail from '../../pages/quotes/QuoteDetail';
import InvoiceList from '../../pages/invoices/InvoiceList';
import InvoiceDetail from '../../pages/invoices/InvoiceDetail';
import SettingsPage from '../../pages/settings/SettingsPage';
import ProductList from '../../pages/products/ProductList';
import UsersPage from '../../pages/users/UsersPage';
import LeadsPage from '../../pages/leads/LeadsPage';
import TimesheetsPage from '../../pages/timesheets/TimesheetsPage';
import ReportsPage from '../../pages/reports/ReportsPage';
import MapPage from '../../pages/map/MapPage';
import SalesPresenter from '../../pages/presenter/SalesPresenter';
import PresenterAdmin from '../../pages/presenter/PresenterAdmin';
import styles from './AppShell.module.css';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '⊞', exact: true },
  { to: '/leads', label: 'New Leads', icon: '📥', officeOnly: true },
  { to: '/customers', label: 'Customers', icon: '👥' },
  { to: '/jobs', label: 'Jobs', icon: '🔧' },
  { to: '/schedule', label: 'Schedule', icon: '📅' },
  { to: '/quotes', label: 'Quotes', icon: '📋', hideForOperations: true },
  { to: '/invoices', label: 'Invoices', icon: '💰', officeOnly: true },
  { to: '/products', label: 'Price List', icon: '🏷', hideForOperations: true },
  { to: '/map', label: 'Map', icon: '🗺' },
  { to: '/timesheets', label: 'Timesheets', icon: '⏱' },
  { to: '/reports', label: 'Reports', icon: '📊' },
  { to: '/presenter', label: 'Sales Presenter', icon: '🎯', hideForOperations: true },
];

function visibleNavItems(items, role) {
  return items.filter(item =>
    (!item.officeOnly || ['admin', 'office'].includes(role)) &&
    (!item.hideForOperations || role !== 'operations')
  );
}

const ADMIN_ITEMS = [
  { to: '/users', label: 'Users', icon: '👤' },
  { to: '/presenter/admin', label: 'Presenter Setup', icon: '🎛' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isPresenter = location.pathname === '/presenter';

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  if (isPresenter) return (
    <Routes>
      <Route path="/presenter" element={<SalesPresenter />} />
    </Routes>
  );

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <img src="/favicon.png" alt="Dekker" className={styles.brandMark} />
          <span className={styles.brandName}>Dekker App</span>
        </div>

        <nav className={styles.nav}>
          {/* sales/operations deliberately excluded from officeOnly items — unlike
              most of the app they don't get office-equivalent access to those tabs. */}
          {visibleNavItems(NAV_ITEMS, user?.role).map(item => (
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
              <span className={styles.userRole}>{{
                admin: 'Admin', sales: 'Sales', operations: 'Operations',
                subcontractor: 'Subcontractor', office: 'Office', field_tech: 'Field Tech',
              }[user?.role] || user?.role}</span>
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
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/customers" element={<CustomerList />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/jobs" element={<JobList />} />
          <Route path="/jobs/import" element={<TradifyImport />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/quotes" element={<QuoteList />} />
          <Route path="/quotes/:id" element={<QuoteDetail />} />
          <Route path="/invoices" element={<InvoiceList />} />
          <Route path="/invoices/:id" element={<InvoiceDetail />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/products" element={<ProductList />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/timesheets" element={<TimesheetsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/presenter" element={<SalesPresenter />} />
          <Route path="/presenter/admin" element={<PresenterAdmin />} />
          <Route path="/users/*" element={<ComingSoon title="Users" />} />
        </Routes>
      </main>

      {/* Mobile bottom navigation */}
      <nav className={styles.bottomNav}>
        {visibleNavItems([
          { to: '/',          icon: '⊞', label: 'Home',      exact: true },
          { to: '/jobs',      icon: '🔧', label: 'Jobs' },
          { to: '/schedule',  icon: '📅', label: 'Schedule' },
          { to: '/quotes',    icon: '📋', label: 'Quotes', hideForOperations: true },
          { to: '/customers', icon: '👥', label: 'Customers' },
          { to: '/products',  icon: '🏷', label: 'Price List', hideForOperations: true },
          { to: '/presenter', icon: '🎯', label: 'Presenter', hideForOperations: true },
        ], user?.role).map(item => (
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
