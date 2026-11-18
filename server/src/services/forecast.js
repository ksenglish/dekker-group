// What the diary is worth.
//
// A job is worth whatever it was priced at, but it is not earned on the day it
// is sold or the day it is invoiced — it is earned across the days it is
// booked to be done. A $20,000 job booked over five days is $4,000 a day, and
// if two of those days fall in November and three in December then November is
// owed $8,000 of it and December $12,000. That is the whole idea: it turns a
// diary into a revenue forecast.
//
// Kept apart from the query that feeds it because this is the part that has to
// be right. The arithmetic is checkable on paper, and a forecast nobody can
// check on paper is a forecast nobody will act on.

/**
 * A total split across n days, exactly.
 *
 * Thirds of a dollar do not exist. Splitting $20,000 three ways and rounding
 * each share gives $6,666.67 three times, which is a cent more than there was
 * — and a forecast whose months do not add up to the jobs in it is one nobody
 * will trust twice. So each day gets the difference between two running
 * totals, which cannot drift: the cents land on the earliest days and the
 * whole always comes back to the whole.
 */
function spread(totalCents, days) {
  const n = Math.max(0, Math.floor(days));
  if (!n) return [];
  const total = Math.round(totalCents);
  const out = [];
  let taken = 0;
  for (let i = 1; i <= n; i++) {
    const upto = Math.round((total * i) / n);
    out.push(upto - taken);
    taken = upto;
  }
  return out;
}

// A DATE column comes back from pg as a Date at UTC midnight. Read with the
// UTC getters it is the day that was written down; read any other way it is
// the day before, somewhere else in the world.
function dayKey(value) {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

// The Monday of that week. Weeks run Monday to Sunday here, which is how a
// work diary is read and not how JavaScript numbers its days.
function mondayOf(key) {
  const d = new Date(`${key}T00:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return dayKey(d);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** Which column of the report a given day falls in, and what to call it. */
function bucketOf(key, group) {
  const [y, m, d] = key.split('-');
  if (group === 'month') {
    return { key: `${y}-${m}`, label: `${MONTHS[Number(m) - 1]} ${y}` };
  }
  if (group === 'week') {
    const monday = mondayOf(key);
    const [wy, wm, wd] = monday.split('-');
    return { key: monday, label: `Week of ${Number(wd)} ${MONTHS[Number(wm) - 1].slice(0, 3)} ${wy}` };
  }
  return {
    key,
    label: `${Number(d)} ${MONTHS[Number(m) - 1].slice(0, 3)} ${y}`,
  };
}

/**
 * The forecast.
 *
 * `jobs` are the jobs with at least one day booked in the window, each with
 * every day it is booked — including the ones outside the window, because
 * those are what make the daily rate right. A job booked five days is $4,000 a
 * day whether or not the report is only looking at November.
 *
 * `from` and `to` are the window, as YYYY-MM-DD, and days outside it are
 * counted for the rate and then left out of the totals.
 */
function forecast({ jobs = [], from, to, group = 'month' } = {}) {
  const buckets = new Map();
  const seen = [];
  let unpriced = 0;

  for (const job of jobs) {
    const days = [...new Set((job.days || []).map(dayKey))].sort();
    if (!days.length) continue;

    const revenue = Math.round(job.revenue_cents || 0);
    const cost = Math.round(job.cost_cents || 0);
    if (!revenue) unpriced++;

    const perDayRevenue = spread(revenue, days.length);
    const perDayCost = spread(cost, days.length);
    // How much of this job's price has a cost behind it. A job quoted mostly
    // as labour, or typed in by hand, has no cost on the Price List to read —
    // and a margin worked out as if it were all profit is worse than no margin
    // at all, so what is missing is counted and said.
    const costed = !!job.costed_lines && job.costed_lines === job.line_count;

    let inWindow = 0;
    days.forEach((day, i) => {
      if (from && day < from) return;
      if (to && day > to) return;
      const { key, label } = bucketOf(day, group);
      if (!buckets.has(key)) {
        buckets.set(key, {
          key, label, revenue_cents: 0, cost_cents: 0, days: 0, job_ids: new Set(),
          fully_costed: true,
        });
      }
      const b = buckets.get(key);
      b.revenue_cents += perDayRevenue[i];
      b.cost_cents += perDayCost[i];
      b.days += 1;
      b.job_ids.add(job.job_id);
      if (!costed) b.fully_costed = false;
      inWindow += perDayRevenue[i];
    });

    if (inWindow || days.some(d => (!from || d >= from) && (!to || d <= to))) {
      seen.push({
        job_id: job.job_id,
        job_number: job.job_number,
        external_ref: job.external_ref,
        customer_name: job.customer_name,
        description: job.description,
        status: job.status,
        revenue_cents: revenue,
        cost_cents: cost,
        booked_days: days.length,
        per_day_cents: days.length ? Math.round(revenue / days.length) : 0,
        in_window_cents: inWindow,
        first_day: days[0],
        last_day: days[days.length - 1],
        fully_costed: costed,
      });
    }
  }

  const rows = [...buckets.values()]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map(b => ({
      ...b,
      jobs: b.job_ids.size,
      job_ids: undefined,
      margin_cents: b.revenue_cents - b.cost_cents,
    }));

  const totals = rows.reduce((t, r) => ({
    revenue_cents: t.revenue_cents + r.revenue_cents,
    cost_cents: t.cost_cents + r.cost_cents,
    margin_cents: t.margin_cents + r.margin_cents,
    days: t.days + r.days,
  }), { revenue_cents: 0, cost_cents: 0, margin_cents: 0, days: 0 });

  return {
    group,
    from: from || null,
    to: to || null,
    rows,
    totals: { ...totals, jobs: seen.length },
    jobs: seen.sort((a, b) => b.in_window_cents - a.in_window_cents),
    // Jobs booked in with nothing priced on them yet. They are real days in
    // the diary contributing nothing to the forecast, and that is worth
    // knowing rather than quietly reading as a thin month.
    unpriced_jobs: unpriced,
  };
}

module.exports = { forecast, spread, bucketOf, dayKey, mondayOf };
