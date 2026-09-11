import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DealsEditor from './DealsEditor';
import WebsiteRequests from './WebsiteRequests';
import CalculatorPricing from './CalculatorPricing';
import PublishSite from './PublishSite';
import WebsiteAgent from './WebsiteAgent';
import styles from './Website.module.css';

// Ask Claude leads, because it is now the way most changes get made — the
// editors after it are for the ones that are quicker to type than to describe.
const TABS = ['Ask Claude', 'Preview & Publish', 'Latest Deals', 'Calculator Pricing', 'Change Requests'];

export default function WebsitePage() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get('tab') || TABS[0]);
  // Set when a logged change request is handed over, so the Ask Claude tab
  // opens with that job picked out rather than on a list of everything.
  const [openJob, setOpenJob] = useState(null);

  function handOff(jobId) {
    setOpenJob(jobId);
    setTab('Ask Claude');
  }

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

      {tab === 'Ask Claude' && <WebsiteAgent openJob={openJob} />}
      {tab === 'Preview & Publish' && <PublishSite />}
      {tab === 'Latest Deals' && <DealsEditor />}
      {tab === 'Calculator Pricing' && <CalculatorPricing />}
      {tab === 'Change Requests' && <WebsiteRequests onHandOff={handOff} />}
    </div>
  );
}
