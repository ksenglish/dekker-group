// What a priced line costs us.
//
// One definition, used by the quote that shows a margin and by the forecast
// that adds those margins up. Two definitions would be two answers to the same
// question, and the one on the report would be the one nobody could reconcile.
//
// A line linked to something on the Price List costs what that thing costs.
// A line typed in by hand — labour, an allowance, "supply and install as
// discussed" — has no cost on the Price List to read, and is not guessed at.
// Nothing here invents a number: a margin worked out as though the unknown
// part were all profit is worse than no margin at all, so what is unknown is
// counted and said out loud instead.
const pool = require('../db/pool');

// The cost of each line of a quote or a job, as a map of line id to cents.
// Lines with nothing linked are absent rather than zero, because zero is a
// cost and "we do not know" is not.
async function costOfLines(lineIds) {
  const ids = (lineIds || []).filter(Boolean);
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `SELECT li.id, li.quantity, p.cost_price
       FROM line_items li
       JOIN products p ON p.id = li.product_id
      WHERE li.id = ANY($1::uuid[])`,
    [ids]
  );
  const out = new Map();
  for (const r of rows) {
    // A product on the list with no cost against it is as unknown as no
    // product at all — the row exists, the number was never filled in.
    if (!(r.cost_price > 0)) continue;
    out.set(r.id, Math.round(Number(r.quantity) * r.cost_price));
  }
  return out;
}

/** Cost against a set of line items, with what is missing counted. */
function summarise(items, costs) {
  let cost = 0;
  let costed = 0;
  let uncosted = 0;
  let uncostedSell = 0;
  for (const i of items) {
    if (costs.has(i.id)) {
      cost += costs.get(i.id);
      costed++;
    } else {
      uncosted++;
      uncostedSell += Math.round(Number(i.quantity) * i.unit_price);
    }
  }
  return {
    cost_cents: cost,
    costed_lines: costed,
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
  const { rows } = await pool.query(
    `SELECT li.job_id,
            COUNT(*)::int AS line_count,
            COUNT(p.id) FILTER (WHERE p.cost_price > 0)::int AS costed_lines,
            COALESCE(SUM(li.quantity * li.unit_price), 0)::bigint AS revenue_cents,
            COALESCE(SUM(li.quantity * p.cost_price) FILTER (WHERE p.cost_price > 0), 0)::bigint AS cost_cents
       FROM line_items li
       LEFT JOIN products p ON p.id = li.product_id
      WHERE li.job_id = ANY($1::uuid[]) AND li.quote_id IS NULL
      GROUP BY li.job_id`,
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

module.exports = { costOfLines, summarise, costOfJobs };
