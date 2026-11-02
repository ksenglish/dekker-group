// Where every line on one document went.
//
// Filing a receipt used to be one press, and that press turned its lines into
// a figure in the operating-cost report and nothing else. Which is how a drill
// bought at Mitre 10 ends up on the price list, in the costs, and in no van,
// no warehouse and no tool register — nobody can find it and nobody knows it
// is missing.
//
// So each line gets a destination. A location takes the same stock movement
// scanning it in would, a job takes it as a cost, and "used up" is a decision
// somebody made rather than a line nobody looked at.
//
// Used from two places, on purpose: PDF Check, where a document is dealt with
// before it is filed, and Reports → Costs, where the ones already filed are
// gone back over. The same panel in both, because it is the same question.
import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { formatJobNumber } from '../../lib/formatJobNumber';
import styles from './LinePlacement.module.css';

export default function LinePlacement({ scanId, locations, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Which line is having a job picked for it, and what has been typed.
  const [jobFor, setJobFor] = useState(null);
  const [jobQuery, setJobQuery] = useState('');
  const [jobHits, setJobHits] = useState([]);
  // Tools are the exception worth asking about, so the choice sits on the row
  // rather than inside a form nobody opens.
  const [asTool, setAsTool] = useState({});
  // Fetched here when the page did not pass them, so the panel can be dropped
  // onto a page without that page having to know about stock.
  const [ownLocations, setOwnLocations] = useState(null);

  const load = useCallback(() => {
    api.get(`/invoice-inbox/${scanId}/lines`)
      .then(r => setData(r.data))
      .catch(() => setError('Could not read the lines on this document'));
  }, [scanId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (locations) return;
    api.get('/stock/locations').then(r => setOwnLocations(r.data)).catch(() => setOwnLocations([]));
  }, [locations]);

  async function place(body) {
    setBusy(true); setError('');
    try {
      await api.post(`/invoice-inbox/${scanId}/lines/place`, body);
      setJobFor(null); setJobQuery(''); setJobHits([]);
      load();
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not place that');
    } finally { setBusy(false); }
  }

  async function undo(index) {
    setBusy(true); setError('');
    try {
      await api.delete(`/invoice-inbox/${scanId}/lines/${index}/place`);
      load();
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not undo that');
    } finally { setBusy(false); }
  }

  async function searchJobs(q) {
    setJobQuery(q);
    if (q.trim().length < 2) { setJobHits([]); return; }
    try {
      const { data: hits } = await api.get('/jobs', { params: { search: q.trim() } });
      const list = Array.isArray(hits) ? hits : hits.jobs || [];
      setJobHits(list.slice(0, 8));
    } catch { setJobHits([]); }
  }

  if (!data) return <div className={styles.placeLoading}>Reading the lines…</div>;

  const places = locations || ownLocations || [];
  const waiting = data.lines.filter(l => l.placeable && !l.placement);
  const warehouse = places.find(l => l.type === 'warehouse');
  // Freight, rounding, the document total. Named rather than hidden, because a
  // line that simply vanished from the list is exactly the complaint.
  const skipped = data.lines.filter(l => !l.placeable);

  // Everything still waiting, to one place, in one press. A twelve-line
  // delivery that all went on the same van should not be twelve decisions.
  const placeRest = (destination, locationId) => place({
    placements: waiting.map(l => ({
      line_index: l.index,
      destination,
      location_id: locationId || null,
      stock_kind: asTool[l.index] ? 'tool' : 'material',
    })),
  });

  return (
    <div className={styles.placePanel}>
      <div className={styles.placeHead}>
        <strong>Where did it go?</strong>
        <span className={data.missing.length ? styles.placeLeft : styles.placeDone}>
          {data.total === 0
            ? 'Nothing on this document needs placing'
            : `${data.placed} of ${data.total} placed`}
        </span>
        {!data.scan.placement_required && data.missing.length > 0 && (
          <span className={styles.placeOptional}>
            Arrived before this step — it can still be filed without placing.
          </span>
        )}
      </div>

      {error && <div className={styles.linkError}>{error}</div>}

      {data.lines.filter(l => l.placeable).map(line => {
        const p = line.placement;
        return (
          <div key={line.index} className={styles.placeRow}>
            <div className={styles.placeWhat}>
              <div className={styles.placeName}>{line.description}</div>
              <div className={styles.placeMeta}>
                {line.quantity} × ${Number(line.unit_price).toFixed(2)}
                {line.sku ? ` · ${line.sku}` : ''}
              </div>
            </div>

            {p ? (
              <div className={styles.placeDoneRow}>
                <span className={styles.placeBadge}>
                  {p.destination === 'location' ? `→ ${p.location_name}`
                    : p.destination === 'job' ? `→ ${formatJobNumber(p) || 'job'}`
                    : '→ used up'}
                  {p.stock_kind === 'tool' ? ' · tool' : ''}
                </span>
                <button className={styles.placeUndo} disabled={busy}
                  onClick={() => undo(line.index)}>Change</button>
              </div>
            ) : jobFor === line.index ? (
              <div className={styles.placeJob}>
                <input autoFocus className={styles.searchInput} value={jobQuery}
                  placeholder="Job number or customer…"
                  onChange={e => searchJobs(e.target.value)} />
                {jobHits.map(j => (
                  <button key={j.id} className={styles.pickerItem} disabled={busy}
                    onClick={() => place({ line_index: line.index, destination: 'job', job_id: j.id })}>
                    {formatJobNumber(j)} · {j.customer_name || 'No customer'}
                  </button>
                ))}
                <button className={styles.btnCancel} onClick={() => setJobFor(null)}>Cancel</button>
              </div>
            ) : (
              <div className={styles.placeOptions}>
                <label className={styles.placeTool}
                  title="Counted apart from stock, and never charged to a job">
                  <input type="checkbox" checked={!!asTool[line.index]} disabled={busy}
                    onChange={e => setAsTool(t => ({ ...t, [line.index]: e.target.checked }))} />
                  Tool
                </label>
                {places.filter(l => l.is_active !== false).map(l => (
                  <button key={l.id} className={styles.placeBtn} disabled={busy}
                    onClick={() => place({
                      line_index: line.index,
                      destination: 'location',
                      location_id: l.id,
                      stock_kind: asTool[line.index] ? 'tool' : 'material',
                    })}>
                    {l.type === 'warehouse' ? '🏭' : '🚚'} {l.name}
                  </button>
                ))}
                <button className={styles.placeBtn} disabled={busy}
                  onClick={() => { setJobFor(line.index); setJobQuery(''); setJobHits([]); }}>
                  🔧 A job…
                </button>
                <button className={styles.placeBtnQuiet} disabled={busy}
                  onClick={() => place({ line_index: line.index, destination: 'not_stock' })}>
                  Used up
                </button>
              </div>
            )}
          </div>
        );
      })}

      {waiting.length > 1 && (
        <div className={styles.placeAll}>
          <span>All {waiting.length} remaining to:</span>
          {warehouse && (
            <button className={styles.placeBtn} disabled={busy}
              onClick={() => placeRest('location', warehouse.id)}>🏭 {warehouse.name}</button>
          )}
          {places.filter(l => l.type === 'van' && l.is_active !== false).map(l => (
            <button key={l.id} className={styles.placeBtn} disabled={busy}
              onClick={() => placeRest('location', l.id)}>🚚 {l.name}</button>
          ))}
          <button className={styles.placeBtnQuiet} disabled={busy}
            onClick={() => placeRest('not_stock')}>Used up</button>
        </div>
      )}

      {skipped.length > 0 && (
        <div className={styles.placeSkipped}>
          Nothing to place on {skipped.length === 1 ? 'this line' : `these ${skipped.length} lines`}:{' '}
          {skipped.map(l => l.description || '(blank)').join(', ')} — freight, fees and
          totals are charges rather than things, so they are counted in the cost
          and nowhere else.
        </div>
      )}

      {data.total > 0 && data.missing.length === 0 && (
        <div className={styles.placeAllDone}>
          Every line is accounted for — this can be filed or linked now.
        </div>
      )}
    </div>
  );
}
