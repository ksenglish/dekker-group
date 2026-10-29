// Deciding which folder a scanned document belongs in.
//
// Two things say where a document goes, and they are believed in that order:
//
//   the folders themselves — "Statements/Bunnings" is not ambiguous. A folder
//     named for the supplier, sitting under one named for the kind of
//     document, is somebody having already answered this question.
//
//   what has been filed before — every document already in a folder carries
//     the supplier it came from. Months of someone deciding correctly, for
//     free, and it covers the suppliers whose folders are not named tidily.
//
// Acting on it needs more than a guess. A document is filed on its own only
// when the two agree, or when the history is strong enough on its own to be
// worth trusting. Everything else is offered as a suggestion and waits, which
// is still most of the work — the folder is chosen, somebody just says yes.
const pool = require('../db/pool');
const priceListIntake = require('./priceListIntake');

// Supplier names are matched the way the rest of the app matches them: case,
// spacing and punctuation are not a different supplier.
const fold = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// The words a folder might be named for each kind of document. A business
// calls its statements folder "Statements", or "Supplier Statements", and
// either should be recognised without anybody configuring it.
const TYPE_WORDS = {
  statement: ['statement', 'statements'],
  invoice: ['invoice', 'invoices', 'bill', 'bills'],
  credit_note: ['credit', 'credits', 'credit note', 'credit notes'],
  remittance: ['remittance', 'remittances'],
};

// How many past filings of the same supplier and kind it takes before the
// history is trusted on its own. Three is a habit; one is an accident.
const ENOUGH = 3;

// The whole tree, once, with each folder's path spelled out. Small enough that
// reading it per document is cheaper than being clever about it.
async function folderTree(client = pool) {
  const { rows } = await client.query('SELECT id, name, parent_id FROM cost_folders');
  const byId = new Map(rows.map(f => [f.id, f]));
  return rows.map(f => {
    const parts = [];
    let cur = f;
    const seen = new Set();
    // A parent loop would hang this; a folder tree should not have one, but a
    // filing decision is not the place to find out.
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : null;
    }
    return { ...f, path: parts.join(' / '), parentName: f.parent_id ? byId.get(f.parent_id)?.name : null };
  });
}

// A folder named for this supplier, under one named for this kind of document.
function byStructure(folders, supplier, documentType) {
  const want = fold(supplier);
  if (!want) return null;

  const named = folders.filter(f => {
    const name = fold(f.name);
    // "Bunnings" matching a folder called "Bunnings Trade", or the other way
    // round — the same business, filed under whichever name was typed.
    return name === want || name.startsWith(`${want} `) || want.startsWith(`${name} `);
  });
  if (!named.length) return null;

  const words = TYPE_WORDS[documentType] || [];
  if (words.length) {
    const underType = named.find(f => words.includes(fold(f.parentName)));
    if (underType) return { folder: underType, why: `the ${underType.path} folder` };
  }

  // A supplier folder with nothing above it to say what kind of document it
  // holds is only an answer when there is one of them.
  const loose = named.filter(f => !f.parentName || !Object.values(TYPE_WORDS).flat().includes(fold(f.parentName)));
  if (loose.length === 1 && !words.length) return { folder: loose[0], why: `the ${loose[0].path} folder` };
  if (named.length === 1 && !words.length) return { folder: named[0], why: `the ${named[0].path} folder` };
  return null;
}

// Where documents like this one have gone before.
async function byHistory(supplier, documentType, client = pool) {
  if (!fold(supplier)) return null;
  const { rows } = await client.query(
    `SELECT folder_id, COUNT(*)::int AS n
       FROM job_cost_scans
      WHERE folder_id IS NOT NULL
        AND LOWER(TRIM(supplier)) = LOWER(TRIM($1))
        AND ($2::text IS NULL OR document_type IS NULL OR document_type = $2)
      GROUP BY folder_id
      ORDER BY n DESC`,
    [supplier, documentType || null]
  );
  if (!rows.length) return null;
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  const top = rows[0];
  return { folderId: top.folder_id, times: top.n, total, agreement: top.n / total };
}

// Where this document should go, and how sure that is.
//
// Returns { folderId, confident, why } — or null when there is nothing worth
// saying, which is the honest answer for a supplier nobody has filed before
// and whose name matches no folder.
async function suggest({ supplier, documentType }, client = pool) {
  if (!fold(supplier)) return null;

  const folders = await folderTree(client);
  const structural = byStructure(folders, supplier, documentType);
  const history = await byHistory(supplier, documentType, client);

  // Both point the same way: as sure as this gets.
  if (structural && history && structural.folder.id === history.folderId) {
    return {
      folderId: structural.folder.id,
      confident: true,
      why: `${structural.why}, where the last ${history.times} went`,
    };
  }

  // The folders say so plainly, and nothing contradicts them.
  if (structural && !history) {
    return { folderId: structural.folder.id, confident: true, why: structural.why };
  }

  // They disagree. A settled habit beats a folder name — the people doing the
  // filing know something the tree does not — and a person should look, since
  // one of the two is wrong. But one stray document is not a habit, and must
  // not veto an unambiguous folder for ever.
  if (structural && history) {
    const settled = history.times >= ENOUGH && history.agreement >= 0.8;
    if (!settled) {
      return {
        folderId: structural.folder.id,
        confident: true,
        why: structural.why,
      };
    }
    const folder = folders.find(f => f.id === history.folderId);
    return {
      folderId: history.folderId,
      confident: false,
      why: `${history.times} of the last ${history.total} went to ${folder?.path || 'this folder'}, `
        + `though ${structural.why} looks like a match too`,
    };
  }

  if (history) {
    const folder = folders.find(f => f.id === history.folderId);
    const settled = history.times >= ENOUGH && history.agreement >= 0.8;
    return {
      folderId: history.folderId,
      confident: settled,
      why: settled
        ? `${history.times} of the last ${history.total} from this supplier went to ${folder?.path || 'this folder'}`
        : `${history.times} went to ${folder?.path || 'this folder'} — not enough to be sure yet`,
    };
  }

  return null;
}

// File it where it belongs, or write down where it probably belongs.
//
// Only ever touches a document still waiting in PDF Check: one already filed,
// linked to a job, or deleted has had a decision made about it and this is not
// the place to change it.
async function fileScan(scanId, client = pool) {
  const { rows: [scan] } = await client.query(
    `SELECT id, supplier, document_type, status, folder_id, parsed_items, cost_kind
       FROM job_cost_scans WHERE id = $1`,
    [scanId]
  );
  if (!scan || scan.status !== 'unmatched' || scan.folder_id) return { filed: false, reason: 'not_waiting' };

  const pick = await suggest(
    { supplier: scan.supplier, documentType: scan.document_type }, client);
  if (!pick) return { filed: false, reason: 'no_idea' };

  if (!pick.confident) {
    await client.query(
      'UPDATE job_cost_scans SET suggested_folder_id = $1, filed_because = $2 WHERE id = $3',
      [pick.folderId, pick.why, scanId]
    );
    return { filed: false, reason: 'suggested', folderId: pick.folderId, why: pick.why };
  }

  await client.query(
    `UPDATE job_cost_scans
        SET folder_id = $1, status = 'filed', filed_automatically = true,
            filed_at = NOW(), filed_because = $2, suggested_folder_id = NULL
      WHERE id = $3 AND status = 'unmatched'`,
    [pick.folderId, pick.why, scanId]
  );

  // Filed by the app rather than by hand, but it bought the same things, so it
  // reaches the price list the same way — tools included, when the folder it
  // landed in is the Tools one.
  const added = await priceListIntake.intakeFromScan(
    { ...scan, folder_id: pick.folderId }, { client });

  return { filed: true, folderId: pick.folderId, why: pick.why, priceList: added };
}

// Every document still waiting, put away or labelled with where it should go.
// Run when this is first turned on, and whenever a new folder makes a backlog
// filable that was not before.
async function fileWaiting({ limit = 500 } = {}) {
  const { rows } = await pool.query(
    `SELECT id FROM job_cost_scans
      WHERE status = 'unmatched' AND folder_id IS NULL AND supplier IS NOT NULL
      ORDER BY created_at
      LIMIT $1`,
    [limit]
  );
  const out = { looked: rows.length, filed: 0, suggested: 0, stumped: 0, products_added: 0 };
  for (const r of rows) {
    const result = await fileScan(r.id);
    if (result.filed) out.filed++;
    else if (result.reason === 'suggested') out.suggested++;
    else out.stumped++;
    // Said out loud, because putting a backlog away can put a few hundred rows
    // on the price list and that should not be a surprise.
    out.products_added += result.priceList?.created.length || 0;
  }
  return out;
}

module.exports = { suggest, fileScan, fileWaiting, folderTree, fold };
