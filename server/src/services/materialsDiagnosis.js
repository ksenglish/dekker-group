// Why the materials list is empty.
//
// "Nothing on the list yet" is true of several quite different situations and
// tells you which of them you are in: none. A quote that was never accepted, a
// quote accepted before this feature existed, and a quote whose lines were all
// typed in by hand look identical on screen — so the only way to find out is
// to ask somebody to go and read the database, which is what happened.
//
// This works out which it is and says so. It only runs when the list is empty,
// so it costs nothing the rest of the time.
const pool = require('../db/pool');

async function diagnose(jobId) {
  const { rows: quotes } = await pool.query(
    `SELECT id, quote_number, status FROM quotes WHERE job_id = $1 ORDER BY created_at`,
    [jobId]
  );
  if (!quotes.length) {
    return {
      reason: 'no_quotes',
      message: 'No quote on this job yet. The list fills in when one is accepted.',
    };
  }

  const accepted = quotes.filter(q => q.status === 'accepted');
  if (!accepted.length) {
    return {
      reason: 'none_accepted',
      message: `This job has ${quotes.length} quote${quotes.length === 1 ? '' : 's'}, ` +
        'but none accepted yet. The list fills in when one is.',
    };
  }

  const label = q => (q.quote_number ? `QT-${String(q.quote_number).padStart(4, '0')}` : 'the quote');

  // There is an accepted quote, so the question is what is on it. Counting the
  // three kinds of line separately, because each means something different
  // about what to do next.
  const { rows: [counts] } = await pool.query(
    `SELECT
       COUNT(*)::int AS lines,
       COUNT(*) FILTER (WHERE product_id IS NOT NULL)::int AS with_product,
       COUNT(*) FILTER (WHERE proposal_id IS NOT NULL)::int AS from_proposal
     FROM line_items WHERE quote_id = ANY($1::uuid[])`,
    [accepted.map(q => q.id)]
  );

  if (!counts || counts.lines === 0) {
    return {
      reason: 'quote_empty',
      message: `${label(accepted[0])} is accepted but has no line items on it.`,
      rebuildable: true,
    };
  }

  // Lines from a proposal are only orderable if that proposal still holds the
  // products its price was built from.
  if (counts.from_proposal > 0) {
    const { rows: [pp] } = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM job_proposal_products pp
        WHERE pp.proposal_id IN (
          SELECT DISTINCT proposal_id FROM line_items
           WHERE quote_id = ANY($1::uuid[]) AND proposal_id IS NOT NULL)
          AND pp.quantity > 0`,
      [accepted.map(q => q.id)]
    );
    if (pp.n > 0) {
      // Everything needed is there, which means the list simply was not built
      // — most likely the quote was accepted before this existed.
      return {
        reason: 'not_built',
        message: `${label(accepted[0])} is accepted and its proposal has ${pp.n} ` +
          `material${pp.n === 1 ? '' : 's'} on it, but the list was never built. ` +
          'Rebuild from the quote to fill it in.',
        rebuildable: true,
      };
    }
    return {
      reason: 'proposal_has_no_products',
      message: `${label(accepted[0])} came from a proposal, but that proposal has no ` +
        'materials priced on it — only labour, or nothing at all. There is nothing to order.',
    };
  }

  if (counts.with_product > 0) {
    return {
      reason: 'not_built',
      message: `${label(accepted[0])} is accepted and has ${counts.with_product} ` +
        `product line${counts.with_product === 1 ? '' : 's'}, but the list was never built. ` +
        'Rebuild from the quote to fill it in.',
      rebuildable: true,
    };
  }

  return {
    reason: 'nothing_orderable',
    message: `${label(accepted[0])} is accepted, but none of its ${counts.lines} ` +
      'lines came from the price list — they were typed straight onto the quote. ' +
      'Only products picked from the price list can be ordered, so add what you need by hand.',
  };
}

module.exports = { diagnose };
