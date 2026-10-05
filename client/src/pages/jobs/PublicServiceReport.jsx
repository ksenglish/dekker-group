import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import ServiceReportView from './ServiceReportView';
import styles from './ServiceReport.module.css';

// The customer's copy, opened from a link in an email. No login: the token in
// the URL is what grants access, and the office can pull it at any time.
//
// It refreshes itself while the page is open, because the whole point is to
// watch a job accrue — someone who leaves it up on a second screen should see
// this morning's hours appear without reloading.

const REFRESH_MS = 60_000;
// Same base the public quote page uses: this is served from the app's own
// origin, so a relative path reaches the API wherever it is deployed.
const API = import.meta.env.VITE_API_BASE_URL ? `${import.meta.env.VITE_API_BASE_URL}/api` : '/api';

export default function PublicServiceReport() {
  const { token } = useParams();
  const [report, setReport] = useState(null);
  const [state, setState] = useState('loading');   // loading | ok | gone | error
  const [downloading, setDownloading] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    let live = true;

    async function load() {
      try {
        const { data } = await axios.get(`${API}/jobs/service-report/public/${token}`);
        if (!live) return;
        setReport(data);
        setState('ok');
      } catch (err) {
        if (!live) return;
        setState(err.response?.status === 404 ? 'gone' : 'error');
      }
    }

    load();
    // Polling rather than anything cleverer: one small request a minute on a
    // page one customer has open is not worth a socket.
    timer.current = setInterval(load, REFRESH_MS);
    return () => { live = false; clearInterval(timer.current); };
  }, [token]);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const res = await axios.get(`${API}/jobs/service-report/public/${token}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `service-report-${(report?.job?.number || 'job').toLowerCase()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* the button simply does nothing if it cannot be built */ }
    finally { setDownloading(false); }
  }

  if (state === 'loading') {
    return <div className={styles.publicPage}><div className={styles.publicState}>Loading your report…</div></div>;
  }
  if (state === 'gone') {
    return (
      <div className={styles.publicPage}>
        <div className={styles.publicState}>
          <h2>This report is no longer available</h2>
          <p>The link may have been withdrawn. Please get in touch with us for an up-to-date copy.</p>
        </div>
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className={styles.publicPage}>
        <div className={styles.publicState}>
          <h2>Something went wrong</h2>
          <p>We could not load this report just now. Please try again in a moment.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.publicPage}>
      <div className={styles.publicActions}>
        <button className={styles.btn} onClick={downloadPdf} disabled={downloading}>
          {downloading ? 'Preparing…' : '⬇ Download PDF'}
        </button>
      </div>
      <div className={styles.publicSheet}>
        <ServiceReportView report={report} />
      </div>
    </div>
  );
}
