import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ADMIN_ITEMS } from '../../components/layout/adminItems';
import styles from './Admin.module.css';

// The admin pages live in the desktop sidebar, which is hidden on a phone —
// so on mobile there was no way to reach Users, Presenter Setup, Website or
// Settings at all. This is the menu the mobile "Admin" tab opens.
//
// It is a real route rather than a popup sheet so the phone's back button
// works, and so a link to it can be shared or bookmarked.
export default function AdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // The route is registered for everyone, so it has to turn away non-admins
  // itself — the nav item being hidden is presentation, not a permission.
  if (user?.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Admin</h1>
        <p className={styles.pageSubtitle}>Setup and settings for the app</p>
      </div>

      <div className={styles.grid}>
        {ADMIN_ITEMS.map(item => (
          <button key={item.to} className={styles.card} onClick={() => navigate(item.to)}>
            <span className={styles.cardIcon}>{item.icon}</span>
            <span className={styles.cardText}>
              <span className={styles.cardLabel}>{item.label}</span>
              <span className={styles.cardDesc}>{item.description}</span>
            </span>
            <span className={styles.cardChevron}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
