const pool = require('../db/pool');

// Mirrors the fallback in jobController — the configured list is authoritative
// when it exists.
const DEFAULT_ORDER = ['new', 'quoted', 'scheduled', 'in_progress', 'invoiced', 'complete', 'cancelled'];

async function getStatusOrder() {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key='job_statuses'`);
  const configured = rows[0]?.value;
  if (!Array.isArray(configured) || !configured.length) return DEFAULT_ORDER;
  return configured.map(s => s.key).filter(Boolean);
}

// Full {key, label} config, for callers that need to resolve a status by its
// label text rather than its (possibly relabelled) key.
async function getStatusConfig() {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key='job_statuses'`);
  const configured = rows[0]?.value;
  if (!Array.isArray(configured) || !configured.length) {
    return DEFAULT_ORDER.map(key => ({ key, label: key }));
  }
  return configured;
}

function normaliseLabel(label) {
  return (label || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

// Finds a status by testing its normalised label, e.g.
// findStatusByLabel(config, l => l.includes('site visit')).
function findStatusByLabel(config, test) {
  return (config || []).find(s => test(normaliseLabel(s.label)));
}

// Moves a job forward to `target` only if it's currently earlier in the
// pipeline. Statuses the pipeline doesn't know about are treated as earlier,
// which matches how the client reasons about custom statuses. Cancelled and
// anything at or past the target are left alone.
async function advanceJobStatus(jobId, target) {
  if (!jobId) return false;
  const order = await getStatusOrder();
  const targetIdx = order.indexOf(target);
  if (targetIdx === -1) return false;

  const { rows: [job] } = await pool.query('SELECT status FROM jobs WHERE id=$1', [jobId]);
  if (!job || job.status === 'cancelled' || job.status === target) return false;

  const currentIdx = order.indexOf(job.status);
  if (currentIdx !== -1 && currentIdx >= targetIdx) return false;

  await pool.query('UPDATE jobs SET status=$1, updated_at=NOW() WHERE id=$2', [target, jobId]);
  return true;
}

// Same forward-only move as advanceJobStatus, but resolves the target by its
// label so it survives per-tenant renaming of the underlying keys. No-ops if
// the pipeline has no status matching `test`.
async function advanceJobStatusByLabel(jobId, test) {
  if (!jobId) return false;
  const target = findStatusByLabel(await getStatusConfig(), test);
  if (!target) return false;
  return advanceJobStatus(jobId, target.key);
}

module.exports = {
  getStatusOrder, getStatusConfig, findStatusByLabel,
  advanceJobStatus, advanceJobStatusByLabel,
};
