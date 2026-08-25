-- The quote editor used to autosave every 1.5s while typing, and each save
-- wrote a "Quote modified" entry — enough of them to bury the events that
-- actually matter (approved / sent / opened / accepted) in the activity log.
--
-- Autosave is gone and modifications are now only logged once a quote has been
-- approved, so this clears the backlog under the same rule: keep any
-- modification recorded after the quote was approved (a real audit trail of
-- changes made while it was in front of the customer), drop the rest.
--
-- Deliberately narrow: only type='quote_modified', and only rows that fail the
-- new rule. No other activity type is touched.
DELETE FROM activity_log a
 WHERE a.type = 'quote_modified'
   AND NOT EXISTS (
     SELECT 1 FROM quotes q
      WHERE q.id = a.entity_id
        AND q.approved_at IS NOT NULL
        AND a.created_at >= q.approved_at
   );
