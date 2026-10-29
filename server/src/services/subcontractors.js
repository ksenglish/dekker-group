// Who is a sub-contractor, and what that changes.
//
// Deciding this once, here, because three different places need the same
// answer and they must not disagree: the Costs tab totals them apart, the
// price list refuses their lines, and an invoice arriving with a job number
// has to land under the right heading without anybody sorting it by hand.
//
// Matched the way a person would, in order of how sure it makes you:
//
//   the GST number   The only thing on an invoice that identifies a business
//                    beyond argument. Punctuation ignored, since 24-882-403
//                    and 24882403 are the same number.
//
//   the name         Exactly, ignoring case and spacing. Sub-contractor names
//                    come off the scan already canonicalised by the supplier
//                    memory, so this is comparing settled names rather than
//                    whatever one PDF happened to say.
//
//   a known alias    The other names they bill under. A one-man band invoices
//                    as his own name one month and his company's the next.
//
// Nothing fuzzy on purpose. Guessing wrong in one direction puts a merchant's
// materials under labour; in the other it puts a sparky's hours on the price
// list. Both are worse than asking somebody to add the name.
const pool = require('../db/pool');

const norm = v => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const digits = v => String(v ?? '').replace(/[^0-9]/g, '');

// The sub-contractor this document is from, or null.
async function resolve({ supplier, gstNumber } = {}, client = pool) {
  const gst = digits(gstNumber);
  if (gst) {
    const { rows } = await client.query(
      `SELECT * FROM subcontractors
        WHERE is_active
          AND REGEXP_REPLACE(COALESCE(gst_number, ''), '[^0-9]', '', 'g') = $1
        LIMIT 1`,
      [gst]
    );
    if (rows[0]) return rows[0];
  }

  const name = norm(supplier);
  if (!name) return null;

  const { rows } = await client.query(
    `SELECT * FROM subcontractors
      WHERE is_active
        AND (LOWER(TRIM(name)) = $1
             OR EXISTS (
               SELECT 1 FROM UNNEST(also_known_as) a
                WHERE LOWER(TRIM(a)) = $1))
      ORDER BY created_at
      LIMIT 1`,
    [name]
  );
  return rows[0] || null;
}

// What kind of cost a document from this supplier is. The one function the
// rest of the app calls, so nowhere has to know how the decision is made.
async function kindFor({ supplier, gstNumber } = {}, client = pool) {
  const hit = await resolve({ supplier, gstNumber }, client);
  return hit ? 'subcontractor' : 'material';
}

// Put existing costs under the right heading after the list changes.
//
// Without this, adding a sub-contractor who has been invoicing for two years
// leaves every one of those invoices filed as materials, and the Costs tab
// would be wrong about every job they ever worked on. Run on save and on
// delete, so the answer is always the one the list gives now.
//
// Only touches documents: a line somebody typed in by hand against no document
// keeps whatever it was given, because nothing here knows better than they did.
async function reclassify(client = pool) {
  const { rows: subs } = await client.query(
    'SELECT name, gst_number, also_known_as FROM subcontractors WHERE is_active');

  const names = [];
  const gsts = [];
  for (const s of subs) {
    names.push(norm(s.name));
    for (const a of s.also_known_as || []) if (norm(a)) names.push(norm(a));
    if (digits(s.gst_number)) gsts.push(digits(s.gst_number));
  }

  // Postgres cannot match against an empty array with = ANY, and an empty list
  // here means "nobody is a sub-contractor", which is a real state the first
  // time somebody deletes the only one.
  const nameList = names.length ? names : [''];
  const gstList = gsts.length ? gsts : [''];

  const { rowCount: scansChanged } = await client.query(
    `UPDATE job_cost_scans SET cost_kind = CASE
        WHEN LOWER(TRIM(COALESCE(supplier, ''))) = ANY($1::text[])
          OR (COALESCE(supplier_gst_number, '') <> ''
              AND REGEXP_REPLACE(COALESCE(supplier_gst_number, ''), '[^0-9]', '', 'g') = ANY($2::text[]))
        THEN 'subcontractor' ELSE 'material' END
      WHERE cost_kind <> CASE
        WHEN LOWER(TRIM(COALESCE(supplier, ''))) = ANY($1::text[])
          OR (COALESCE(supplier_gst_number, '') <> ''
              AND REGEXP_REPLACE(COALESCE(supplier_gst_number, ''), '[^0-9]', '', 'g') = ANY($2::text[]))
        THEN 'subcontractor' ELSE 'material' END`,
    [nameList, gstList]
  );

  const { rowCount: linesChanged } = await client.query(
    `UPDATE job_costs c SET cost_kind = s.cost_kind
       FROM job_cost_scans s
      WHERE s.id = c.scan_id AND c.cost_kind <> s.cost_kind`
  );

  return { scans: scansChanged, lines: linesChanged };
}

module.exports = { resolve, kindFor, reclassify, norm };
