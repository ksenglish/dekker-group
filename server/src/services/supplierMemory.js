// What the scanner knows about who it buys from.
//
// A supplier's name is often the one thing on an invoice that isn't text — it
// is the logo at the top. The scan comes back with nothing, someone types
// "Bunnings", and the next identical document asks them again.
//
// So the correction is kept, and used three ways:
//
//   • the names already on file go into the prompt, so the scan picks the one
//     it recognises rather than inventing a spelling;
//   • the GST number printed on the document is remembered against the name,
//     so a document with no readable supplier at all is still recognised;
//   • what the scan read is remembered too, so "BUNNINGS TRADE" and "Bunnings
//     Mt Maunganui" stop becoming separate suppliers.
const pool = require('../db/pool');

// Keys are matched on what they mean, not on how they were typed: case, runs
// of spaces, and the dashes in a GST number all stop mattering.
const foldAlias = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const foldGst = s => String(s || '').replace(/[^0-9a-z]/gi, '').toLowerCase();
const fold = (type, value) => (type === 'gst_number' ? foldGst(value) : foldAlias(value));

// The names offered to the scan. Ones corrected by hand come first — they are
// the ones someone cared enough to fix — then suppliers already seen on
// documents, then the price list. Capped because this goes in every prompt.
async function knownSuppliers(limit = 60) {
  try {
    const { rows } = await pool.query(
      `SELECT supplier, SUM(weight)::int AS weight FROM (
         SELECT supplier, times_seen * 10 AS weight FROM supplier_identities
         UNION ALL
         SELECT supplier, 2 FROM job_cost_scans WHERE supplier IS NOT NULL AND TRIM(supplier) <> ''
         UNION ALL
         SELECT supplier, 1 FROM products WHERE supplier IS NOT NULL AND TRIM(supplier) <> ''
       ) s
       GROUP BY supplier
       ORDER BY weight DESC, supplier
       LIMIT $1`,
      [limit]
    );
    return rows.map(r => r.supplier);
  } catch {
    // A scan is still worth having without the list, so a lookup that fails
    // (an old database, a dropped connection) must not take it down with it.
    return [];
  }
}

// A GST number somebody entered against a supplier in Settings.
//
// Waiting to be taught by correction only works when a document arrives with
// both a readable GST number and a wrong name. A receipt whose logo is an
// image and whose GST number the scan missed teaches nothing, so correcting
// it changes nothing about the next one. Typing the number in once breaks
// that circle.
async function bySuppliersTable(gstNumber) {
  const want = foldGst(gstNumber);
  if (!want) return null;
  try {
    const { rows } = await pool.query(
      `SELECT name FROM suppliers
        WHERE gst_number IS NOT NULL
          AND LOWER(REGEXP_REPLACE(gst_number, '[^0-9A-Za-z]', '', 'g')) = $1
        LIMIT 1`,
      [want]
    );
    return rows[0]?.name || null;
  } catch { return null; }
}

// What a document says it is from, turned into the name already in use.
// Returns null when nothing is recognised, leaving what the scan read alone.
async function resolve({ supplier, gstNumber } = {}) {
  // Typed by a person beats anything inferred, so it is asked first.
  const typed = await bySuppliersTable(gstNumber);
  if (typed) return typed;

  const keys = [];
  if (foldGst(gstNumber)) keys.push(['gst_number', foldGst(gstNumber)]);
  if (foldAlias(supplier)) keys.push(['alias', foldAlias(supplier)]);
  if (!keys.length) return null;
  try {
    const { rows } = await pool.query(
      `SELECT key_type, supplier FROM supplier_identities
        WHERE (key_type, key_value) IN (${keys.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')})`,
      keys.flat()
    );
    if (!rows.length) return null;
    // The GST number is the stronger of the two: an alias is only ever how one
    // document happened to be read, but a GST number identifies the business.
    return (rows.find(r => r.key_type === 'gst_number') || rows[0]).supplier;
  } catch { return null; }
}

// Remember that this document is from this supplier. Called when a name is
// typed or corrected by hand, which is the only time we know we are right.
async function learn({ supplier, gstNumber, readAs } = {}) {
  const name = String(supplier || '').trim().slice(0, 255);
  if (!name) return 0;
  const keys = [];
  if (foldGst(gstNumber)) keys.push(['gst_number', foldGst(gstNumber)]);
  // Only worth remembering what the scan read if it read something different —
  // a name that already matches teaches nothing.
  if (foldAlias(readAs) && foldAlias(readAs) !== foldAlias(name)) keys.push(['alias', foldAlias(readAs)]);
  let learned = 0;
  for (const [type, value] of keys) {
    try {
      await pool.query(
        `INSERT INTO supplier_identities (key_type, key_value, supplier)
         VALUES ($1, $2, $3)
         ON CONFLICT (key_type, key_value) DO UPDATE
            SET supplier = EXCLUDED.supplier,
                times_seen = supplier_identities.times_seen + 1,
                updated_at = NOW()`,
        [type, value, name]
      );
      learned++;
    } catch { /* never let remembering a name break saving the costs */ }
  }

  // And put the number on the supplier itself where that row has none, so
  // Settings shows what the scanner has worked out rather than looking empty
  // beside a scanner that plainly knows. Never overwrites a number somebody
  // typed: a person correcting one document is weaker evidence than a person
  // sitting down and entering the supplier's details.
  if (foldGst(gstNumber)) {
    try {
      await pool.query(
        `UPDATE suppliers SET gst_number = $1, updated_at = NOW()
          WHERE LOWER(TRIM(name)) = LOWER(TRIM($2)) AND gst_number IS NULL`,
        [String(gstNumber).trim(), name]
      );
    } catch { /* same again: a name is not worth a failed save */ }
  }
  return learned;
}

// Put what is known now against the documents already in.
//
// Teaching the scanner only helps the next document. The ones already filed
// under no supplier at all stay that way, and on a busy month that is most
// of the Costs report. So everything it has learned since — a GST number
// typed in Settings included — can be applied backwards in one go.
//
// Only ever fills a blank. A name already on a document was put there by
// somebody or read off the page, and neither is ours to overwrite.
async function applyToExisting() {
  const out = { named: 0, no_gst_number: 0, still_unknown: 0 };
  const { rows } = await pool.query(
    `SELECT id, supplier_gst_number FROM job_cost_scans
      WHERE (supplier IS NULL OR TRIM(supplier) = '')`
  );
  for (const row of rows) {
    if (!foldGst(row.supplier_gst_number)) { out.no_gst_number++; continue; }
    const name = await resolve({ gstNumber: row.supplier_gst_number });
    if (!name) { out.still_unknown++; continue; }
    await pool.query(
      `UPDATE job_cost_scans SET supplier = $1 WHERE id = $2
         AND (supplier IS NULL OR TRIM(supplier) = '')`,
      [name, row.id]);
    out.named++;
  }
  out.looked = rows.length;
  return out;
}

module.exports = { knownSuppliers, resolve, learn, applyToExisting, fold };
