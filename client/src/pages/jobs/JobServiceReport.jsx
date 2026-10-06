import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import ServiceReportView from './ServiceReportView';
import { isAdmin } from '../../lib/permissions';
import styles from './ServiceReport.module.css';

// The office's view of the report: the customer's sheet exactly as they see it,
// with the controls that decide what goes on it and who can read it.
//
// Cost and margin sit below the sheet in their own block, outside the part that
// is shared, so there is no version of this screen where the two can be
// confused for one another.

const money = cents => {
  const n = (cents || 0) / 100;
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function JobServiceReport({ jobId, user }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [markup, setMarkup] = useState('');
  const [labourRate, setLabourRate] = useState('');
  const [travelMode, setTravelMode] = useState('');
  const [travelRate, setTravelRate] = useState('');
  const admin = isAdmin(user?.role);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/jobs/${jobId}/service-report`);
      setReport(data);
      setMarkup(String(data.markup_pct));
      if (data.rates) {
        setLabourRate(data.rates.labour_rate == null ? '' : String(data.rates.labour_rate));
        setTravelMode(data.rates.travel_mode || '');
        setTravelRate(data.rates.travel_rate == null ? '' : String(data.rates.travel_rate));
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load the service report');
    } finally { setLoading(false); }
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  const shareUrl = report?.share_path ? `${window.location.origin}${report.share_path}` : null;

  async function share() {
    setBusy(true);
    try {
      const { data } = await api.post(`/jobs/${jobId}/service-report/share`);
      setReport(r => ({ ...r, ...data }));
    } finally { setBusy(false); }
  }

  async function unshare() {
    if (!confirm('Stop the customer’s link working? Sharing again later gives them a new one.')) return;
    setBusy(true);
    try {
      await api.delete(`/jobs/${jobId}/service-report/share`);
      setReport(r => ({ ...r, share_token: null, share_path: null }));
    } finally { setBusy(false); }
  }

  async function saveMarkup() {
    setBusy(true);
    try {
      await api.put(`/jobs/${jobId}/service-report/markup`, { markup_pct: markup === '' ? null : markup });
      await load();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save that markup');
    } finally { setBusy(false); }
  }

  // One field at a time, so a blur on the labour rate never touches travel.
  async function saveRates(changes) {
    setBusy(true);
    setError('');
    try {
      await api.put(`/jobs/${jobId}/service-report/rates`, changes);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save that rate');
    } finally { setBusy(false); }
  }

  function changeTravelMode(mode) {
    setTravelMode(mode);
    // Switching to hourly or fixed starts from the house travel rate rather
    // than an empty box, so the first save is never an accidental $0.
    const rate = mode && travelRate === '' ? String(report.rates?.house_travel_rate ?? 0) : travelRate;
    setTravelRate(mode ? rate : '');
    saveRates(mode ? { travel_mode: mode, travel_rate: rate } : { travel_mode: null, travel_rate: null });
  }

  // The PDF route needs the auth header, so it is fetched and handed to the
  // browser as a blob rather than opened as a link.
  async function downloadPdf() {
    setBusy(true);
    try {
      const res = await api.get(`/jobs/${jobId}/service-report/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `service-report-${(report?.job?.number || 'job').toLowerCase()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setBusy(false); }
  }

  function copyLink() {
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  if (loading) return <div className={styles.empty}>Loading…</div>;
  if (error && !report) return <div className={styles.empty}>{error}</div>;

  return (
    <div>
      <div className={styles.toolbar}>
        <button className={styles.btn} onClick={downloadPdf} disabled={busy}>⬇ Download PDF</button>
        {admin && (
          <label className={styles.markupField}>
            Materials markup
            <input type="number" step="1" value={markup} onChange={e => setMarkup(e.target.value)}
              onBlur={saveMarkup} />
            %
          </label>
        )}
        {admin && report.rates && (
          <>
            <label className={styles.markupField}>
              Labour
              $<input type="number" step="0.01" min="0" value={labourRate}
                placeholder={String(report.rates.house_labour_rate)}
                title="Charge rate per hour for this job. Leave blank for the standard billing rates."
                onChange={e => setLabourRate(e.target.value)}
                onBlur={() => saveRates({ labour_rate: labourRate })} />
              /h
            </label>
            <label className={styles.markupField}>
              Travel
              <select value={travelMode} onChange={e => changeTravelMode(e.target.value)} disabled={busy}>
                <option value="">Standard rate</option>
                <option value="hourly">Hourly</option>
                <option value="fixed">Fixed per trip</option>
              </select>
              {travelMode && (
                <>
                  $<input type="number" step="0.01" min="0" value={travelRate}
                    onChange={e => setTravelRate(e.target.value)}
                    onBlur={() => saveRates({ travel_rate: travelRate === '' ? 0 : travelRate })} />
                  {travelMode === 'hourly' ? '/h' : '/trip'}
                </>
              )}
            </label>
          </>
        )}
        <span className={styles.toolbarSpacer} />
        {!report.share_path ? (
          <button className={styles.btn} onClick={share} disabled={busy}>🔗 Create customer link</button>
        ) : (
          <button className={styles.btn} onClick={unshare} disabled={busy}>Stop sharing</button>
        )}

        {shareUrl && (
          <div className={styles.shareRow}>
            <input className={styles.shareLink} value={shareUrl} readOnly onFocus={e => e.target.select()} />
            <button className={styles.btn} onClick={copyLink}>{copied ? '✓ Copied' : 'Copy link'}</button>
            <a className={styles.btn} href={shareUrl} target="_blank" rel="noreferrer">Open</a>
          </div>
        )}
      </div>

      {error && <div className={styles.empty}>{error}</div>}

      <ServiceReportView report={report} />

      {admin && report.margin && (
        <div className={styles.margin}>
          <div className={styles.marginTitle}>Internal — not on the customer’s copy</div>
          <div className={styles.marginGrid}>
            <div className={styles.marginCell}>
              <span>Cost to us</span><strong>{money(report.margin.cost_cents)}</strong>
            </div>
            <div className={styles.marginCell}>
              <span>Charging</span><strong>{money(report.totals.subtotal_cents)}</strong>
            </div>
            <div className={styles.marginCell}>
              <span>Gross profit</span><strong>{money(report.margin.gross_profit_cents)}</strong>
            </div>
            <div className={styles.marginCell}>
              <span>Margin</span>
              <strong>{report.margin.margin_pct == null ? '—' : `${report.margin.margin_pct.toFixed(1)}%`}</strong>
            </div>
          </div>
          {report.margin.missing_cost_rate && (
            <p className={styles.marginWarn}>
              Someone on this job has no cost rate set, so their hours count as costing nothing —
              the margin above reads better than it is. Set it on their user record.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
