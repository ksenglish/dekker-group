import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { formatJobNumber } from '../../lib/formatJobNumber';
import { toLocalDateStr } from '../../lib/date';
import styles from './Reports.module.css';
import own from './Forecast.module.css';

// What the diary is worth.
//
// Every other revenue report in here looks backwards: what was invoiced, what
// was paid, what was sold. This one looks at work that has not happened yet
// and asks what it will be worth when it does — which is the question anybody
// deciding whether to take on another job is actually asking.
//
// A job is earned across the days it is booked, not on the day it is sold. A
// $20,000 job booked over five days is $4,000 a day, and if two of those days
// are in November then November is owed $8,000 of it. The arithmetic is on the
// server, in services/forecast.js, where it can be checked on paper.

const money = cents => (cents / 100).toLocaleString('en-NZ', {
  style: 'currency', currency: 'NZD', minimumFractionDigits: 0, maximumFractionDigits: 0,
});
const exact = cents => (cents / 100).toLocaleString('en-NZ', {
  style: 'currency', currency: 'NZD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const GROUPS = [
  { value: 'day', label: 'By day' },
  { value: 'week', label: 'By week' },
  { value: 'month', label: 'By month' },
];

// Where the window starts and ends for each way of looking at it. A forecast
// is about what is coming, so these run forwards from today rather than back.
function windowFor(span) {
  const today = new Date();
  const start = new Date(today);
  const end = new Date(today);
  if (span === 'month') { end.setMonth(end.getMonth() + 1); }
  else if (span === 'quarter') { end.setMonth(end.getMonth() + 3); }
  else if (span === 'year') { end.setMonth(end.getMonth() + 12); }
  else if (span === 'back') { start.setMonth(start.getMonth() - 3); end.setMonth(end.getMonth() + 3); }
  return { from: toLocalDateStr(start), to: toLocalDateStr(end) };
}

const SPANS = [
  { value: 'month', label: 'Next month' },
  { value: 'quarter', label: 'Next 3 months' },
  { value: 'year', label: 'Next 12 months' },
  { value: 'back', label: '3 back, 3 forward' },
  { value: 'range', label: 'Date range' },
];

export default function ForecastPage() {
  const [span, setSpan] = useState('quarter');
  const [group, setGroup] = useState('month');
  const initial = windowFor('quarter');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Moving the period moves the dates; picking Date range leaves them alone so
  // whatever was typed stays typed.
  useEffect(() => {
    if (span === 'range') return;
    const w = windowFor(span);
    setFrom(w.from);
    setTo(w.to);
  }, [span]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api.get('/reports/forecast', { params: { from, to, group } })
      .then(r => { if (live) setData(r.data); })
      .catch(() => { if (live) setError('Could not load the forecast.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [from, to, group]);

  const rows = useMemo(() => data?.rows || [], [data]);
  // The tallest period, which every bar is drawn as a fraction of.
  const peak = useMemo(
    () => Math.max(1, ...rows.map(r => r.revenue_cents)),
    [rows]);
  const showsCost = !!data?.shows_cost;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <Link to="/reports" className={styles.backLink}>← Reports</Link>
          <h1 className={styles.pageTitle}>Forecast</h1>
          <p className={styles.pageSubtitle}>
            Revenue booked in the diary, spread across the days each job is booked
          </p>
        </div>
      </div>

      <div className={styles.dateRange}>
        <label>Period:</label>
        <div className={styles.periodToggle}>
          {SPANS.map(s => (
            <button key={s.value}
              className={`${styles.periodBtn} ${span === s.value ? styles.periodBtnActive : ''}`}
              onClick={() => setSpan(s.value)}>
              {s.label}
            </button>
          ))}
        </div>
        {span === 'range' && (
          <>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={styles.dateInput} />
            <span>to</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className={styles.dateInput} />
          </>
        )}
        <div className={styles.periodToggle} style={{ marginLeft: 'auto' }}>
          {GROUPS.map(g => (
            <button key={g.value}
              className={`${styles.periodBtn} ${group === g.value ? styles.periodBtnActive : ''}`}
              onClick={() => setGroup(g.value)}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className={styles.card}><p className={own.note}>{error}</p></div>}
      {loading && !data && <div className={styles.card}><p className={own.note}>Loading…</p></div>}

      {data && (
        <>
          <div className={own.totals}>
            <div className={own.tile}>
              <span>Booked revenue</span>
              <strong>{money(data.totals.revenue_cents)}</strong>
              <em>excluding GST</em>
            </div>
            {showsCost && (
              <>
                <div className={own.tile}>
                  <span>Cost</span>
                  <strong>{money(data.totals.cost_cents)}</strong>
                  <em>off the Price List</em>
                </div>
                <div className={own.tile}>
                  <span>Margin</span>
                  <strong>{money(data.totals.margin_cents)}</strong>
                  <em>
                    {data.totals.revenue_cents > 0
                      ? `${Math.round((data.totals.margin_cents / data.totals.revenue_cents) * 100)}% of revenue`
                      : '—'}
                  </em>
                </div>
              </>
            )}
            <div className={own.tile}>
              <span>Days booked</span>
              <strong>{data.totals.days}</strong>
              <em>{data.totals.jobs} {data.totals.jobs === 1 ? 'job' : 'jobs'}</em>
            </div>
          </div>

          {data.unpriced_jobs > 0 && (
            <p className={own.warn}>
              {data.unpriced_jobs} {data.unpriced_jobs === 1 ? 'job is' : 'jobs are'} booked in with
              nothing priced on {data.unpriced_jobs === 1 ? 'it' : 'them'} yet, so{' '}
              {data.unpriced_jobs === 1 ? 'it adds' : 'they add'} days to the diary and nothing to
              the forecast. A thin month here may be a quote that has not been written.
            </p>
          )}

          <div className={styles.card}>
            <div className={showsCost ? `${own.head} ${own.headCost}` : own.head}>
              <div>{group === 'day' ? 'Day' : group === 'week' ? 'Week' : 'Month'}</div>
              <div className={own.num}>Revenue</div>
              {showsCost && <div className={own.num}>Cost</div>}
              {showsCost && <div className={own.num}>Margin</div>}
              <div className={own.num}>Days</div>
              <div className={own.num}>Jobs</div>
              <div />
            </div>
            {rows.length === 0 ? (
              <p className={own.note}>Nothing booked in the diary for this period.</p>
            ) : rows.map(r => (
              <div key={r.key} className={showsCost ? `${own.row} ${own.rowCost}` : own.row}>
                <div className={own.label}>{r.label}</div>
                <div className={own.num}><strong>{money(r.revenue_cents)}</strong></div>
                {showsCost && <div className={own.num}>{money(r.cost_cents)}</div>}
                {showsCost && (
                  <div className={own.num}>
                    {money(r.margin_cents)}
                    {r.revenue_cents > 0 && (
                      <em className={own.pct}>
                        {Math.round((r.margin_cents / r.revenue_cents) * 100)}%
                        {!r.fully_costed && <span title="Some lines in this period are not Price List products, so their cost is unknown and counted as margin."> *</span>}
                      </em>
                    )}
                  </div>
                )}
                <div className={own.num}>{r.days}</div>
                <div className={own.num}>{r.jobs}</div>
                {/* The shape of the months, so a quiet one is visible without
                    reading the figures. */}
                <div className={own.barCell}>
                  <span className={own.bar} style={{ width: `${(r.revenue_cents / peak) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>

          {showsCost && rows.some(r => !r.fully_costed) && (
            <p className={own.note}>
              * Some lines in these jobs are not Price List products — labour, allowances, anything
              typed by hand — so there is no cost to read against them and nothing is guessed. The
              margin shown counts those as though they were all profit, which makes it the best
              case rather than the likely one.
            </p>
          )}

          <div className={styles.card}>
            <div className={own.jobsHead}>
              <h2>The jobs behind it</h2>
              <span>{data.jobs.length} booked in this period</span>
            </div>
            {data.jobs.length === 0 ? (
              <p className={own.note}>Nothing booked.</p>
            ) : (
              <div className={own.jobTable}>
                <div className={own.jobHeadRow}>
                  <div>Job</div>
                  <div>Customer</div>
                  <div className={own.num}>Value</div>
                  <div className={own.num}>Days</div>
                  <div className={own.num}>Per day</div>
                  <div className={own.num}>In this period</div>
                </div>
                {data.jobs.map(j => (
                  <Link key={j.job_id} to={`/jobs/${j.job_id}`} className={own.jobRow}>
                    <div className={own.jobNo}>{formatJobNumber(j) || 'Job'}</div>
                    <div className={own.jobCustomer}>{j.customer_name || '—'}</div>
                    <div className={own.num}>{exact(j.revenue_cents)}</div>
                    <div className={own.num}>{j.booked_days}</div>
                    <div className={own.num}>{exact(j.per_day_cents)}</div>
                    <div className={own.num}><strong>{exact(j.in_window_cents)}</strong></div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <p className={own.note}>
            Revenue is each job’s own line items excluding GST, spread evenly across every
            operations day it is booked in the diary — including days outside this period, which is
            what keeps two days of a five-day job worth two fifths of it. Site visits are not
            counted as working days. Cancelled jobs are left out.
          </p>
        </>
      )}
    </div>
  );
}
