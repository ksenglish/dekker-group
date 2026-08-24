// Job types used to be a plain list of names in settings ('job_types'). They
// now carry defaults with them — which document theme quotes/invoices should
// use, and which forms to put on the job — so each entry is an object.
//
// Everything reads through here so the old string-array shape keeps working:
// existing installs (and the seeded default) are upgraded on read rather than
// needing a data migration, and jobs.type still stores the plain name.

const pool = require('../db/pool');

const DEFAULT_JOB_TYPES = ['Installation', 'Service', 'Inspection', 'Repair', 'Quote Only'];

function normaliseOne(entry) {
  if (typeof entry === 'string') {
    return { name: entry, theme_id: null, pre_install_form_ids: [], post_install_form_ids: [] };
  }
  return {
    name: String(entry?.name || '').trim(),
    theme_id: entry?.theme_id || null,
    pre_install_form_ids: Array.isArray(entry?.pre_install_form_ids) ? entry.pre_install_form_ids : [],
    post_install_form_ids: Array.isArray(entry?.post_install_form_ids) ? entry.post_install_form_ids : [],
  };
}

function normalise(value) {
  const list = Array.isArray(value) && value.length ? value : DEFAULT_JOB_TYPES;
  return list.map(normaliseOne).filter(t => t.name);
}

// `client` lets this join an existing transaction (job creation runs in one).
async function getJobTypes(client = pool) {
  const { rows } = await client.query(`SELECT value FROM settings WHERE key='job_types'`);
  return normalise(rows[0]?.value);
}

async function findJobType(name, client = pool) {
  if (!name) return null;
  const types = await getJobTypes(client);
  const wanted = String(name).trim().toLowerCase();
  return types.find(t => t.name.toLowerCase() === wanted) || null;
}

// Names only — for the dropdowns and filters that predate the config shape.
async function getJobTypeNames(client = pool) {
  return (await getJobTypes(client)).map(t => t.name);
}

module.exports = { DEFAULT_JOB_TYPES, normalise, getJobTypes, getJobTypeNames, findJobType };
