import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import styles from './Jobs.module.css';

export default function TradifyImport() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [rowCount, setRowCount] = useState(0);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [backfill, setBackfill] = useState(null);
  const [backfilling, setBackfilling] = useState(false);

  if (user?.role !== 'admin') {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>Only admins can import jobs.</div>
      </div>
    );
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError(''); setResult(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result;
      setCsv(text);
      // Rough row estimate (header line + data) — final count comes from the server
      const lines = text.split('\n').filter(l => /^JB?\d|^[A-Z]{1,3}\d/.test(l.trim()));
      setRowCount(lines.length);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function runImport() {
    if (!csv) return;
    setImporting(true); setError(''); setResult(null);
    try {
      const { data } = await api.post('/jobs/import/tradify', { csv });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed. Please check the file and try again.');
    } finally {
      setImporting(false);
    }
  }

  // Jobs imported before the importer handled labour hours still have their
  // Tradify time sitting unread on the job. This converts what's already in the
  // database — no fresh export needed.
  async function runTimeBackfill(dryRun) {
    setBackfilling(true); setError(''); setBackfill(null);
    try {
      const { data } = await api.post(`/jobs/import/tradify-time${dryRun ? '?dryRun=true' : ''}`);
      setBackfill(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not import labour hours.');
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.breadcrumb}>
        <Link to="/jobs">Jobs</Link><span>›</span><span>Import from Tradify</span>
      </div>

      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Import Jobs from Tradify</h1>
          <p className={styles.pageSubtitle}>
            Upload your Tradify <strong>Jobs CSV export</strong> to bring your job history into the app.
          </p>
        </div>
      </div>

      <div className={styles.card} style={{ padding: 24, maxWidth: 760 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>How it works</h2>
        <ul style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.7, margin: '0 0 20px 18px' }}>
          <li>Each Tradify job is created with its customer, address, description and status.</li>
          <li>Scheduled times are added to the <strong>Schedule</strong> so you can see when jobs took place.</li>
          <li>Team members already in the app are linked to their jobs.</li>
          <li>Any team member <strong>not</strong> in the app is added to <strong>Users</strong> as
            <strong> Inactive</strong> with role <strong>Undefined</strong> — ready to invite later.</li>
          <li>Labour hours from the <strong>Time</strong> column become timesheet entries on each
            job's <strong>Time</strong> tab, credited to the person who logged them.</li>
          <li>Running the import again is safe: jobs already imported are skipped, not duplicated.</li>
        </ul>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          padding: '10px 18px', background: 'var(--color-primary)', color: 'white',
          borderRadius: 'var(--radius)', fontSize: 14, fontWeight: 500 }}>
          📂 Choose CSV file
          <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFile} />
        </label>

        {fileName && (
          <div style={{ marginTop: 16, fontSize: 13 }}>
            <strong>{fileName}</strong>
            {rowCount > 0 && <span style={{ color: 'var(--color-text-muted)' }}> · ~{rowCount} jobs detected</span>}
          </div>
        )}

        {csv && !result && (
          <div style={{ marginTop: 20 }}>
            <button className={styles.btnPrimary} onClick={runImport} disabled={importing}>
              {importing ? 'Importing… please wait' : `Import ${rowCount > 0 ? rowCount + ' jobs' : 'jobs'}`}
            </button>
            {importing && (
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
                Large imports can take a minute. Please don't close this tab.
              </p>
            )}
          </div>
        )}

        {error && (
          <div style={{ marginTop: 20, padding: '12px 16px', background: '#fef2f2',
            border: '1px solid #fecaca', borderRadius: 'var(--radius)', color: '#dc2626', fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Labour hours for jobs imported before the importer handled them. */}
        <div style={{ marginTop: 28, paddingTop: 24, borderTop: '1px solid var(--color-border)' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Labour hours for jobs already imported</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.7, marginBottom: 16 }}>
            Jobs imported earlier kept their Tradify time as text on the job but never showed it on
            the Time tab. This converts what's already stored — you don't need another export.
            Check it first with a dry run; it reports what it would do without saving anything.
            Running it more than once won't duplicate entries.
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className={styles.btnSecondary} onClick={() => runTimeBackfill(true)} disabled={backfilling}>
              {backfilling ? 'Checking…' : 'Dry run'}
            </button>
            <button className={styles.btnPrimary} onClick={() => runTimeBackfill(false)} disabled={backfilling}>
              {backfilling ? 'Importing…' : 'Import labour hours'}
            </button>
          </div>

          {backfill && (
            <div style={{ marginTop: 18, padding: '16px 20px', borderRadius: 'var(--radius)',
              background: backfill.dryRun ? '#fffbeb' : '#f0fdf4',
              border: `1px solid ${backfill.dryRun ? '#fde68a' : '#bbf7d0'}` }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
                {backfill.dryRun
                  ? `Dry run — nothing saved. ${backfill.timeEntriesCreated} entries would be created.`
                  : `${backfill.timeEntriesCreated} labour entries imported.`}
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.8 }}>
                <div>Jobs scanned: <strong>{backfill.jobsScanned}</strong> · with time recorded: <strong>{backfill.jobsWithTime}</strong></div>
                <div>Labour hours: <strong>{backfill.labourHours}</strong></div>
                {backfill.duplicatesSkipped > 0 && <div>Already imported: <strong>{backfill.duplicatesSkipped}</strong></div>}
                {backfill.usersCreated > 0 && <div>New team members created: <strong>{backfill.usersCreated}</strong></div>}
                {backfill.people?.length > 0 && <div>People: {backfill.people.join(', ')}</div>}
              </div>

              {backfill.mismatched?.length > 0 && (
                <details style={{ marginTop: 12, fontSize: 12.5 }}>
                  <summary style={{ cursor: 'pointer', color: '#92400e' }}>
                    {backfill.mismatched.length} entr{backfill.mismatched.length === 1 ? 'y' : 'ies'} where the
                    stated duration doesn't match the start and end times
                  </summary>
                  <ul style={{ margin: '8px 0 0 18px', lineHeight: 1.7 }}>
                    {backfill.mismatched.slice(0, 30).map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </details>
              )}

              {backfill.unparsed?.length > 0 && (
                <details style={{ marginTop: 12, fontSize: 12.5 }}>
                  <summary style={{ cursor: 'pointer', color: '#92400e' }}>
                    {backfill.unparsed.length} bit{backfill.unparsed.length === 1 ? '' : 's'} of time text
                    couldn't be read (click to view)
                  </summary>
                  <ul style={{ margin: '8px 0 0 18px', lineHeight: 1.7 }}>
                    {backfill.unparsed.slice(0, 30).map((u, i) => <li key={i}>{u}</li>)}
                  </ul>
                </details>
              )}

              {backfill.errors?.length > 0 && (
                <details style={{ marginTop: 12, fontSize: 12.5 }}>
                  <summary style={{ cursor: 'pointer', color: '#dc2626' }}>
                    {backfill.errors.length} job{backfill.errors.length === 1 ? '' : 's'} had problems
                  </summary>
                  <ul style={{ margin: '8px 0 0 18px', lineHeight: 1.7 }}>
                    {backfill.errors.slice(0, 30).map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

        {result && (
          <div style={{ marginTop: 24 }}>
            <div style={{ padding: '16px 20px', background: '#f0fdf4', border: '1px solid #bbf7d0',
              borderRadius: 'var(--radius)', marginBottom: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#166534', marginBottom: 10 }}>
                ✓ Import complete
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <Stat label="Jobs imported" value={result.jobsImported} />
                <Stat label="Already imported (skipped)" value={result.jobsSkipped} />
                <Stat label="Customers created" value={result.customersCreated} />
                <Stat label="Scheduled appointments" value={result.schedulesCreated} />
                <Stat label="Team members added" value={result.usersCreated} />
                <Stat label="Job assignments" value={result.techsLinked} />
                <Stat label="Labour entries" value={result.timeEntriesCreated ?? 0} />
                <Stat label="Labour hours" value={Math.round((result.labourHoursImported ?? 0) * 10) / 10} />
              </div>
            </div>

            {result.errors?.length > 0 && (
              <details style={{ marginBottom: 16 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
                  {result.errors.length} row{result.errors.length !== 1 ? 's' : ''} had problems (click to view)
                </summary>
                <ul style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '8px 0 0 18px', lineHeight: 1.6 }}>
                  {result.errors.slice(0, 50).map((e, i) => <li key={i}>{e}</li>)}
                  {result.errors.length > 50 && <li>…and {result.errors.length - 50} more</li>}
                </ul>
              </details>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button className={styles.btnPrimary} onClick={() => navigate('/jobs')}>View Jobs</button>
              <button className={styles.btnSecondary} onClick={() => navigate('/schedule')}>View Schedule</button>
              {result.usersCreated > 0 && (
                <button className={styles.btnSecondary} onClick={() => navigate('/users')}>Review New Users</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value ?? 0}</div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</div>
    </div>
  );
}
