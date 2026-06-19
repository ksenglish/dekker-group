import { useState, useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import styles from './OfflineBanner.module.css';

export default function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);

  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  useEffect(() => {
    const on  = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  if (!offline && !needRefresh) return null;

  return (
    <div className={styles.bannerWrap}>
      {offline && (
        <div className={`${styles.banner} ${styles.offline}`}>
          <span>⚡ You're offline — showing cached data</span>
        </div>
      )}
      {needRefresh && !offline && (
        <div className={`${styles.banner} ${styles.update}`}>
          <span>🔄 A new version is available</span>
          <button onClick={() => updateServiceWorker(true)}>Update now</button>
        </div>
      )}
    </div>
  );
}
