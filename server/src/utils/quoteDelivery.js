// What counts as a quote the customer has actually received.
//
// A draft sitting on the job is not a quote as far as the workflow is
// concerned — it has not reached anyone. Three separate signals can show a
// quote went out, because they were added at different times and older quotes
// only carry the earlier ones:
//
//   sent_at          set when the quote is emailed
//   delivery_status  'sent' / 'opened' / etc, 'unsent' meaning it never went
//   quote_sent       an activity log entry, the oldest of the three
//
// This lives in one place because two things depend on it and they have to
// agree: the prompt a rep gets when stopping a site-visit timer, and the sweep
// that moves jobs on when no timer was ever used. If those two drifted apart,
// a job could be told it has a quote by one and not by the other.
function quoteDeliveredSql(alias = 'q') {
  return `(
    ${alias}.sent_at IS NOT NULL
    OR (${alias}.delivery_status IS NOT NULL AND ${alias}.delivery_status <> 'unsent')
    OR EXISTS (
      SELECT 1 FROM activity_log a
       WHERE a.entity_type = 'quote' AND a.entity_id = ${alias}.id AND a.type = 'quote_sent'
    )
  )`;
}

module.exports = { quoteDeliveredSql };
