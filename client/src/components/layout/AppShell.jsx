import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUnsavedChanges } from '../../context/UnsavedChangesContext';
import api from '../../lib/api';
import GlobalSearch from '../search/GlobalSearch';
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
import LeadForm from '../../pages/leads/LeadForm';
import TimesheetsPage from '../../pages/timesheets/TimesheetsPage';
import ReportsPage from '../../pages/reports/ReportsPage';
import MapPage from '../../pages/map/MapPage';
import SalesPresenter from '../../pages/presenter/SalesPresenter';
import PresenterAdmin from '../../pages/presenter/PresenterAdmin';
import WebsitePage from '../../pages/website/WebsitePage';
import AppUpdatesPage from '../../pages/appconsole/AppUpdatesPage';
import DekkerHub from '../../pages/hub/DekkerHub';
import InvoiceInboxPage from '../../pages/invoiceInbox/InvoiceInboxPage';
import TodosPage from '../../pages/todos/TodosPage';
import StockPage from '../../pages/stock/StockPage';
import CostsPage from '../../pages/costs/CostsPage';
import SalesPage from '../../pages/reports/SalesPage';
import MarketingPage from '../../pages/reports/MarketingPage';
import PriceChangesPage from '../../pages/reports/PriceChangesPage';
import AdminPage from '../../pages/admin/AdminPage';
import { ADMIN_ITEMS } from './adminItems';
import { can } from '../../lib/permissions';
import styles from './AppShell.module.css';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '⊞', exact: true },
  { to: '/todos', label: 'To-Do List', icon: '☑', badge: 'todos', newBadge: 'todosNew' },
  { to: '/leads', label: 'New Leads', icon: '📥', officeOnly: true, needs: 'leads', badge: 'leads' },
  { to: '/invoice-inbox', label: 'PDF Check', icon: '🧾', officeOnly: true, needs: 'invoices', badge: 'inbox' },
  { to: '/customers', label: 'Customers', icon: '👥' },
  { to: '/jobs', label: 'Jobs', icon: '🔧' },
  { to: '/schedule', label: 'Schedule', icon: '📅' },
  { to: '/quotes', label: 'Quotes', icon: '📋', hideForOperations: true, needs: 'quotes.all' },
  { to: '/invoices', label: 'Invoices', icon: '💰', officeOnly: true, needs: 'invoices' },
  { to: '/products', label: 'Price List', icon: '🏷', hideForOperations: true },
  { to: '/map', label: 'Map', icon: '🗺' },
  { to: '/timesheets', label: 'Timesheets', icon: '⏱' },
  { to: '/reports', label: 'Reports', icon: '📊' },
  { to: '/presenter', label: 'Sales Presenter', icon: '🎯', hideForOperations: true },
  { to: '/hub', label: 'Dekker Hub', icon: '🏢' },
];

const ROLE_LABELS = {
  admin: 'Admin', sales: 'Sales', operations: 'Operations',
  subcontractor: 'Subcontractor', office: 'Office', field_tech: 'Field Tech',
};
const roleLabel = role => ROLE_LABELS[role] || role;

// The rail across the bottom of a phone: a shorter list than the desktop
// sidebar, in the order a phone actually gets used, because past about six
// it has to be scrolled sideways and the rest are found by swiping.
const MOBILE_RAIL = [
  { to: '/',          icon: '⊞', label: 'Home',      exact: true },
  { to: '/todos',     icon: '☑', label: 'To-Do', badge: 'todos' },
  // Admin only on mobile, so a new enquiry can be picked up and called
  // back from the phone rather than waiting for someone at a desk.
  { to: '/leads',     icon: '📥', label: 'New Leads', adminOnly: true, needs: 'leads', badge: 'leads' },
  // Same reasoning: a receipt handed over on site can be photographed,
  // read and put on the job without getting back to a desktop.
  { to: '/invoice-inbox', icon: '🧾', label: 'PDF Check', adminOnly: true, needs: 'invoices', badge: 'inbox' },
  { to: '/jobs',      icon: '🔧', label: 'Jobs' },
  { to: '/schedule',  icon: '📅', label: 'Schedule' },
  { to: '/quotes',    icon: '📋', label: 'Quotes', hideForOperations: true, needs: 'quotes.all' },
  { to: '/customers', icon: '👥', label: 'Customers' },
  { to: '/products',  icon: '🏷', label: 'Price List', hideForOperations: true },
  { to: '/timesheets', icon: '⏱', label: 'Timesheets' },
  { to: '/reports',   icon: '📊', label: 'Reports', adminOnly: true, needs: 'reports.all' },
  { to: '/presenter', icon: '🎯', label: 'Presenter', hideForOperations: true },
  { to: '/hub',       icon: '🏢', label: 'Hub' },
  // The admin pages live in the desktop sidebar, which is hidden on a
  // phone. This opens a menu of them instead of adding four more items
  // to a rail that already has to scroll.
  { to: '/admin',     icon: '🛠', label: 'Admin', adminOnly: true },
];

// The other way: a menu, holding every section the desktop sidebar holds,
// in the order the desktop lists them. Nothing is dropped for want of room,
// because a menu has as much room as it needs.
const MOBILE_MENU = [...NAV_ITEMS, { to: '/admin', icon: '🛠', label: 'Admin', adminOnly: true }];

// What to put in the rail. The server decides what anyone can actually open;
// this only keeps people out of sections that would refuse them.
//
// `needs` names a grant from the Users page, and holding it opens the item
// whatever the role rules say — which is the whole point of granting it.
function visibleNavItems(items, user) {
  const role = user?.role;
  return items.filter(item =>
    (item.needs && can(user, item.needs)) || (
      (!item.adminOnly || role === 'admin') &&
      (!item.officeOnly || ['admin', 'office'].includes(role)) &&
      (!item.hideForOperations || role !== 'operations')
    )
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const { confirmLeave } = useUnsavedChanges();
  const navigate = useNavigate();
  const location = useLocation();

  // A page holding unsaved work (the quote editor) gets to ask first.
  function guardNav(e) {
    if (!confirmLeave()) e.preventDefault();
  }
  const isPresenter = location.pathname === '/presenter';
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Shut on the way to anywhere. Each item closes it on its own press, but a
  // link inside a page, the back button and the search panel all navigate too.
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  const [openLeads, setOpenLeads] = useState(0);
  const [inboxCount, setInboxCount] = useState(0);
  const [dueTodos, setDueTodos] = useState(0);
  const [newTodos, setNewTodos] = useState(0);

  // Ctrl-K anywhere, the way every other tool does it. Not while somebody is
  // typing into something else — the shortcut is for reaching the search, not
  // for interrupting a quote being written.
  useEffect(() => {
    function onKey(e) {
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) return;
      const t = e.target;
      if (t?.isContentEditable || /^(input|textarea|select)$/i.test(t?.tagName || '')) return;
      e.preventDefault();
      setSearchOpen(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The two badge counts, gated the same way their sections are so a granted
  // person gets the count and nobody else fetches a 403.
  const officeRole = ['admin', 'office'].includes(user?.role);
  const canSeeLeads = officeRole || can(user, 'leads');
  const canSeeInbox = officeRole || can(user, 'invoices');

  const refreshLeadCount = useCallback(() => {
    if (!canSeeLeads) { setOpenLeads(0); return; }
    api.get('/leads/stats')
      .then(r => setOpenLeads(r.data.open_count || 0))
      .catch(() => {});
  }, [canSeeLeads]);

  const refreshInboxCount = useCallback(() => {
    if (!canSeeInbox) { setInboxCount(0); return; }
    api.get('/invoice-inbox/count')
      .then(r => setInboxCount(r.data.count || 0))
      .catch(() => {});
  }, [canSeeInbox]);

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

  // Which way this person gets around on a phone. Set when their account is
  // made; anyone whose account predates the setting is on the rail, which is
  // what they have always had.
  const menuNav = user?.mobile_nav === 'menu';
  const mobileItems = visibleNavItems(menuNav ? MOBILE_MENU : MOBILE_RAIL, user);
  // Everything waiting, on one number, so a closed menu is not a place for
  // work to go unnoticed.
  const menuBadgeTotal = mobileItems.reduce(
    (sum, item) => sum + (item.badge ? badgeCounts[item.badge] || 0 : 0), 0);

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

        <button className={styles.searchBtn} onClick={() => setSearchOpen(true)}>
          <span className={styles.navIcon}>🔍</span>
          Search
          <kbd className={styles.kbd}>Ctrl K</kbd>
        </button>

        <nav className={styles.nav}>
          {/* sales/operations deliberately excluded from officeOnly items — unlike
              most of the app they don't get office-equivalent access to those tabs. */}
          {visibleNavItems(NAV_ITEMS, user).map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              onClick={guardNav}
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
                  onClick={guardNav}
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
              <span className={styles.userRole}>{roleLabel(user?.role)}</span>
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
          <Route path="/leads/new" element={<LeadForm />} />
          <Route path="/leads/:id/edit" element={<LeadForm />} />
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
          <Route path="/reports/price-changes" element={<PriceChangesPage />} />
          <Route path="/presenter" element={<SalesPresenter />} />
          <Route path="/presenter/admin" element={<PresenterAdmin />} />
          <Route path="/website" element={<WebsitePage />} />
          <Route path="/app-updates" element={<AppUpdatesPage />} />
          <Route path="/hub" element={<DekkerHub />} />
          <Route path="/invoice-inbox" element={<InvoiceInboxPage />} />
          <Route path="/todos" element={<TodosPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/users/*" element={<ComingSoon title="Users" />} />
        </Routes>
      </main>

      {/* Mobile navigation, either way round. */}
      {menuNav ? (
        <>
          {/* Only opens. Closing lives in the menu's own header, because a
              floating button over a scrolling list sits on top of whichever
              item happens to be under it. */}
          {!menuOpen && (
            <button className={styles.navMenuBtn} onClick={() => setMenuOpen(true)}
              aria-label="Open the menu">
              <span className={styles.navMenuIcon}>☰</span>
              {/* Anything waiting is worth knowing about before the menu is
                  opened, since behind a menu is where it would be missed. */}
              {menuBadgeTotal > 0 && (
                <span className={styles.navMenuBadge}>{menuBadgeTotal}</span>
              )}
            </button>
          )}

          {menuOpen && (
            <>
              <div className={styles.navMenuScrim} onClick={() => setMenuOpen(false)} />
              <nav className={styles.navMenu}>
                <div className={styles.navMenuHead}>
                  <div>
                    <strong>{user?.name}</strong>
                    <span>{roleLabel(user?.role)}</span>
                  </div>
                  <button className={styles.navMenuClose} onClick={() => setMenuOpen(false)}
                    aria-label="Close the menu">✕</button>
                </div>
                {mobileItems.map(item => (
                  <NavLink key={item.to} to={item.to} end={item.exact}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `${styles.navMenuItem} ${isActive ? styles.navMenuItemActive : ''}`
                    }>
                    <span className={styles.navMenuItemIcon}>{item.icon}</span>
                    <span className={styles.navMenuItemLabel}>{item.label}</span>
                    {item.badge && badgeCounts[item.badge] > 0 && (
                      <span className={styles.navBadge}>{badgeCounts[item.badge]}</span>
                    )}
                  </NavLink>
                ))}
                <button className={styles.navMenuLogout} onClick={() => { setMenuOpen(false); handleLogout(); }}>
                  Sign out
                </button>
              </nav>
            </>
          )}
        </>
      ) : (
        <nav className={styles.bottomNav}>
          {mobileItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.exact}
              className={({ isActive }) =>
                `${styles.bottomNavItem} ${isActive ? styles.bottomNavItemActive : ''}`
              }>
              <span className={styles.bottomNavIcon}>
                {item.icon}
                {item.badge && badgeCounts[item.badge] > 0 && (
                  <span className={styles.bottomNavBadge}>{badgeCounts[item.badge]}</span>
                )}
              </span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      )}

      {/* On a phone the sidebar is gone, and this is the thing most worth
          reaching with a thumb: say a name instead of typing a job number. */}
      <button className={`${styles.searchFab} ${menuNav ? styles.searchFabLow : ''}`}
        onClick={() => setSearchOpen(true)}
        aria-label="Search, or say what you are looking for">🔍</button>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
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
