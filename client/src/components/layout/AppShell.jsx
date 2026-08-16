import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../lib/api';
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
import WebsitePage from '../../pages/website/WebsitePage';
import DekkerHub from '../../pages/hub/DekkerHub';
import InvoiceInboxPage from '../../pages/invoiceInbox/InvoiceInboxPage';
import TodosPage from '../../pages/todos/TodosPage';
import StockPage from '../../pages/stock/StockPage';
import CostsPage from '../../pages/costs/CostsPage';
import SalesPage from '../../pages/reports/SalesPage';
import MarketingPage from '../../pages/reports/MarketingPage';
import styles from './AppShell.module.css';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '⊞', exact: true },
  { to: '/todos', label: 'To-Do List', icon: '☑', badge: 'todos', newBadge: 'todosNew' },
  { to: '/leads', label: 'New Leads', icon: '📥', officeOnly: true, badge: 'leads' },
  { to: '/invoice-inbox', label: 'PDF Check', icon: '🧾', officeOnly: true, badge: 'inbox' },
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
  { to: '/hub', label: 'Dekker Hub', icon: '🏢' },
];

function visibleNavItems(items, role) {
  return items.filter(item =>
    (!item.adminOnly || role === 'admin') &&
    (!item.officeOnly || ['admin', 'office'].includes(role)) &&
    (!item.hideForOperations || role !== 'operations')
  );
}

const ADMIN_ITEMS = [
  { to: '/users', label: 'Users', icon: '👤' },
  { to: '/presenter/admin', label: 'Presenter Setup', icon: '🎛' },
  { to: '/website', label: 'Website', icon: '🌐' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isPresenter = location.pathname === '/presenter';
  const [openLeads, setOpenLeads] = useState(0);
  const [inboxCount, setInboxCount] = useState(0);
  const [dueTodos, setDueTodos] = useState(0);
  const [newTodos, setNewTodos] = useState(0);

  const canSeeLeads = ['admin', 'office'].includes(user?.role);

  const refreshLeadCount = useCallback(() => {
    if (!canSeeLeads) { setOpenLeads(0); return; }
    api.get('/leads/stats')
      .then(r => setOpenLeads(r.data.open_count || 0))
      .catch(() => {});
  }, [canSeeLeads]);

  const refreshInboxCount = useCallback(() => {
    if (!canSeeLeads) { setInboxCount(0); return; }
    api.get('/invoice-inbox/count')
      .then(r => setInboxCount(r.data.count || 0))
      .catch(() => {});
  }, [canSeeLeads]);

  // To-dos are open to every role, so this one isn't gated on canSeeLeads.
  const refreshTodoCount = useCallback(() => {
    api.get('/todos/due-count')
      .then(r => setDueTodos(r.data.count || 0))
      .catch(() => {});
    api.get('/todos/unseen-count')
      .then(r => setNewTodos(r.data.count || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshLeadCount(); refreshInboxCount(); refreshTodoCount();
  }, [refreshLeadCount, refreshInboxCount, refreshTodoCount, location.pathname]);

  useEffect(() => {
    const id = setInterval(() => {
      refreshLeadCount(); refreshInboxCount(); refreshTodoCount();
    }, 120000);
    window.addEventListener('leads-updated', refreshLeadCount);
    window.addEventListener('invoice-inbox-updated', refreshInboxCount);
    window.addEventListener('todos-updated', refreshTodoCount);
    return () => {
      clearInterval(id);
      window.removeEventListener('leads-updated', refreshLeadCount);
      window.removeEventListener('invoice-inbox-updated', refreshInboxCount);
      window.removeEventListener('todos-updated', refreshTodoCount);
    };
  }, [refreshLeadCount, refreshInboxCount, refreshTodoCount]);

  const badgeCounts = { leads: openLeads, inbox: inboxCount, todos: dueTodos, todosNew: newTodos };

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
              {/* Green counts tasks handed to you that you haven't opened;
                  red counts anything whose due date has arrived. */}
              {item.newBadge && badgeCounts[item.newBadge] > 0 && (
                <span className={styles.navBadgeNew} title="New tasks assigned to you">
                  {badgeCounts[item.newBadge]}
                </span>
              )}
              {item.badge && badgeCounts[item.badge] > 0 && (
                <span className={styles.navBadge}>{badgeCounts[item.badge]}</span>
              )}
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
          <Route path="/reports/stock" element={<StockPage />} />
          <Route path="/reports/costs" element={<CostsPage />} />
          <Route path="/reports/sales" element={<SalesPage />} />
          <Route path="/reports/marketing" element={<MarketingPage />} />
          <Route path="/presenter" element={<SalesPresenter />} />
          <Route path="/presenter/admin" element={<PresenterAdmin />} />
          <Route path="/website" element={<WebsitePage />} />
          <Route path="/hub" element={<DekkerHub />} />
          <Route path="/invoice-inbox" element={<InvoiceInboxPage />} />
          <Route path="/todos" element={<TodosPage />} />
          <Route path="/users/*" element={<ComingSoon title="Users" />} />
        </Routes>
      </main>

      {/* Mobile bottom navigation */}
      <nav className={styles.bottomNav}>
        {visibleNavItems([
          { to: '/',          icon: '⊞', label: 'Home',      exact: true },
          { to: '/todos',     icon: '☑', label: 'To-Do' },
          { to: '/jobs',      icon: '🔧', label: 'Jobs' },
          { to: '/schedule',  icon: '📅', label: 'Schedule' },
          { to: '/quotes',    icon: '📋', label: 'Quotes', hideForOperations: true },
          { to: '/customers', icon: '👥', label: 'Customers' },
          { to: '/products',  icon: '🏷', label: 'Price List', hideForOperations: true },
          { to: '/timesheets', icon: '⏱', label: 'Timesheets' },
          // Admin only, matching who can act on what's in here — mainly so
          // receipts can be photographed and filed into Operating Costs on the
          // phone rather than having to get back to a desktop.
          { to: '/reports',   icon: '📊', label: 'Reports', adminOnly: true },
          { to: '/presenter', icon: '🎯', label: 'Presenter', hideForOperations: true },
          { to: '/hub',       icon: '🏢', label: 'Hub' },
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
