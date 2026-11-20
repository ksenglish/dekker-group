// What a priced line costs us.
//
// One definition, used by the quote that shows a margin and by the forecast
// that adds those margins up. Two definitions would be two answers to the same
// question, and the one on the report would be the one nobody could reconcile.
//
// A line linked to something on the Price List costs what that thing costs,
// read live, so the figure on screen is today's. A line typed in by hand —
// labour, an allowance, "supply and install as discussed" — has nothing on the
// Price List to read, and now carries a cost an admin typed against it.
//
// The Price List wins where there is one, because it is the one that keeps
// itself up to date. The typed figure is the answer only where there was no
// answer. And where there is neither, nothing is invented: a margin worked out
// as though the unknown part were all profit is worse than no margin at all,
// so what is unknown is counted and said out loud instead.
const pool = require('../db/pool');

// Where a line's cost came from, so a screen can say. A figure read off the
// Price List and a figure somebody typed in August are both costs, but only
// one of them is still looking after itself.
const FROM_LIST = 'price_list';
const TYPED = 'typed';

// The cost of each line of a quote or a job, as a map of line id to
// { cents, source }. Lines with neither a Price List cost nor a typed one are
// absent rather than zero, because zero is a cost and "we do not know" is not.
async function costOfLines(lineIds) {
  const ids = (lineIds || []).filter(Boolean);
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `SELECT li.id, li.quantity, li.unit_cost_cents, p.cost_price
       FROM line_items li
       LEFT JOIN products p ON p.id = li.product_id
      WHERE li.id = ANY($1::uuid[])`,
    [ids]
  );
  const out = new Map();
  for (const r of rows) {
    const qty = Number(r.quantity) || 0;
    // A product on the list with no cost against it is as unknown as no
    // product at all — the row exists, the number was never filled in. So the
    // typed figure gets its turn in that case too.
    if (r.cost_price > 0) {
      out.set(r.id, { cents: Math.round(qty * r.cost_price), source: FROM_LIST });
    } else if (r.unit_cost_cents != null) {
      out.set(r.id, { cents: Math.round(qty * r.unit_cost_cents), source: TYPED });
    }
  }
  return out;
}

// The cents alone, for the callers that only want the money.
const centsOf = entry => (entry == null ? null : entry.cents);

/** Cost against a set of line items, with what is missing counted. */
function summarise(items, costs) {
  let cost = 0;
  let costed = 0;
  let typed = 0;
  let uncosted = 0;
  let uncostedSell = 0;
  for (const i of items) {
    const found = costs.get(i.id);
    if (found) {
      cost += found.cents;
      costed++;
      if (found.source === TYPED) typed++;
    } else {
      uncosted++;
      uncostedSell += Math.round(Number(i.quantity) * i.unit_price);
    }
  }
  return {
    cost_cents: cost,
    costed_lines: costed,
    // How many of those costs are somebody's typing rather than the Price
    // List's. Both are costs; only one of them keeps itself current, and a
    // margin built mostly on the other is worth knowing about.
    typed_lines: typed,
    uncosted_lines: uncosted,
    // What the uncosted lines sell for, which is how much of the margin below
    // is guesswork. A quote that is half labour says so in one number.
    uncosted_sell_cents: uncostedSell,
  };
}

/**
 * Cost per job, for the jobs given.
 *
 * The job's own line items — the ones that get invoiced — not any quote's
 * copy of them, which is the same rule the job's revenue follows.
 */
async function costOfJobs(jobIds) {
  const ids = (jobIds || []).filter(Boolean);
  if (!ids.length) return new Map();
  // The same rule as a single line: the Price List where there is one, the
  // typed figure where there is not, and nothing counted where there is
  // neither. Written as one expression so the report and the quote cannot
  // drift into two answers.
  const { rows } = await pool.query(
    `WITH priced AS (
       SELECT li.job_id,
              li.quantity * li.unit_price AS revenue_cents,
              CASE WHEN p.cost_price > 0 THEN li.quantity * p.cost_price
                   WHEN li.unit_cost_cents IS NOT NULL THEN li.quantity * li.unit_cost_cents
              END AS cost_cents
         FROM line_items li
         LEFT JOIN products p ON p.id = li.product_id
        WHERE li.job_id = ANY($1::uuid[]) AND li.quote_id IS NULL
     )
     SELECT job_id,
            COUNT(*)::int AS line_count,
            COUNT(cost_cents)::int AS costed_lines,
            COALESCE(SUM(revenue_cents), 0)::bigint AS revenue_cents,
            COALESCE(SUM(cost_cents), 0)::bigint AS cost_cents
       FROM priced
      GROUP BY job_id`,
    [ids]
  );
  const out = new Map();
  for (const r of rows) {
    out.set(r.job_id, {
      revenue_cents: Number(r.revenue_cents),
      cost_cents: Number(r.cost_cents),
      line_count: r.line_count,
      costed_lines: r.costed_lines,
    });
  }
  return out;
}

module.exports = { costOfLines, summarise, costOfJobs, centsOf, FROM_LIST, TYPED };
