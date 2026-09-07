import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DealsEditor from './DealsEditor';
import WebsiteRequests from './WebsiteRequests';
import CalculatorPricing from './CalculatorPricing';
import PublishSite from './PublishSite';
import styles from './Website.module.css';

const TABS = ['Preview & Publish', 'Latest Deals', 'Calculator Pricing', 'Change Requests'];

export default function WebsitePage() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get('tab') || TABS[0]);

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Website</h1>
        <p className={styles.pageSubtitle}>
          Manage what dekkerair.co.nz shows, and keep a list of changes to make
        </p>
      </div>

      <div className={styles.tabBar}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`${styles.tabBtn} ${tab === t ? styles.tabBtnActive : ''}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Preview & Publish' && <PublishSite />}
      {tab === 'Latest Deals' && <DealsEditor />}
      {tab === 'Calculator Pricing' && <CalculatorPricing />}
      {tab === 'Change Requests' && <WebsiteRequests />}
    </div>
  );
}
