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

// What a document says it is from, turned into the name already in use.
// Returns null when nothing is recognised, leaving what the scan read alone.
async function resolve({ supplier, gstNumber } = {}) {
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
  return learned;
}

module.exports = { knownSuppliers, resolve, learn, fold };
