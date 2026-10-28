import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import ScanFlow from '../stock/ScanFlow';
import styles from './Jobs.module.css';

const fmtQty = q => {
  const n = Number(q || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

const fmtMoney = cents => (Number(cents || 0) / 100).toLocaleString('en-NZ', {
  style: 'currency', currency: 'NZD', minimumFractionDigits: 2,
});

// How long it has been out, in the words somebody would use standing in a yard.
const sinceWords = iso => {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days`;
  return `${Math.floor(days / 7)} weeks`;
};

// The tools signed out to this job.
//
// Separate from Costs on purpose. A tool is not used up and is never charged to
// the job — it came off a van, it is here, and at some point it has to go back.
// Costs answers "what did this job cost us"; this answers "what of ours is
// sitting on that site", which is the question somebody asks on the Friday a
// job finishes and nobody can find the laser level.
export default function JobTools({ jobId, jobLabel, readonly = false }) {
  const [tools, setTools] = useState(null);
  const [locations, setLocations] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [returning, setReturning] = useState(null);   // id of the row going back
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([
      api.get(`/stock/jobs/${jobId}/tools`),
      api.get('/stock/locations'),
    ]).then(([t, l]) => {
      setTools(t.data);
      setLocations(l.data);
    }).catch(() => setTools([]));
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  async function sendBack(row, locationId) {
    setBusy(true);
    setError('');
    try {
      await api.post('/stock/return-tool', {
        product_id: row.id, job_id: jobId, to_location_id: locationId, quantity: row.quantity,
      });
      setReturning(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not book that tool back in.');
    } finally { setBusy(false); }
  }

  if (!tools) return <div className={styles.emptySmall}>Loading…</div>;

  const totalValue = tools.reduce((t, r) => t + Number(r.value_cents || 0), 0);

  return (
    <>
      <div className={styles.toolsHead}>
        <div>
          <div className={styles.toolsTitle}>Tools on this job</div>
          <div className={styles.toolsHint}>
            Ours, out on site. Tools are never charged to the job — this says where
            they are, not what they cost.
          </div>
        </div>
        {!readonly && (
          <button className={styles.btnPrimary} onClick={() => { setError(''); setScanning(true); }}>
            + Take a tool to this job
          </button>
        )}
      </div>

      {error && <div className={styles.scanError}>{error}</div>}

      {tools.length === 0 ? (
        <div className={styles.emptySmall}>
          No tools are signed out to this job. Use the button above to take one off a
          van or out of the warehouse — scan it, or pick it off the price list.
        </div>
      ) : (
        <table className={styles.toolsTable}>
          <thead>
            <tr>
              <th>Tool</th>
              <th className={styles.toolsNum}>Qty</th>
              <th>Out since</th>
              <th>Came from</th>
              <th className={styles.toolsNum}>Value at cost</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tools.map(row => (
              <tr key={row.id}>
                <td className={styles.toolsName}>{row.name}</td>
                <td className={styles.toolsNum} data-label="Qty">{fmtQty(row.quantity)}</td>
                <td className={styles.toolsMuted} data-label="Out since">{sinceWords(row.out_since)}</td>
                <td className={styles.toolsMuted} data-label="Came from">{row.came_from || '—'}</td>
                <td className={styles.toolsNum} data-label="Value at cost">{fmtMoney(row.value_cents)}</td>
                <td className={styles.toolsActions}>
                  {readonly ? null : returning === row.id ? (
                    <>
                      <span className={styles.toolsMuted}>Back to</span>
                      {/* The van it came off is offered first: that is where it
                          goes back nine times out of ten. */}
                      {[...locations]
                        .sort((a, b) => (b.id === row.came_from_id) - (a.id === row.came_from_id))
                        .map(l => (
                          <button key={l.id} className={styles.btnSmallPrimary} disabled={busy}
                            onClick={() => sendBack(row, l.id)}>{l.name}</button>
                        ))}
                      <button className={styles.btnSmall} disabled={busy}
                        onClick={() => setReturning(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className={styles.btnSmall}
                      onClick={() => { setError(''); setReturning(row.id); }}>
                      ↩ Book back in
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>{tools.length} tool{tools.length === 1 ? '' : 's'} out</td>
              <td className={styles.toolsNum}>{fmtMoney(totalValue)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}

      {scanning && (
        <ScanFlow
          mode="take"
          jobId={jobId}
          jobLabel={jobLabel}
          locations={locations}
          onClose={() => { setScanning(false); load(); }}
          onUsed={() => load()}
        />
      )}
    </>
  );
}
