const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const subcontractors = require('../services/subcontractors');

router.use(authenticate);

const clean = v => (v === undefined || v === null ? null : String(v).trim() || null);

// The names they also bill under, one per line in the box.
const aliasList = v => {
  if (Array.isArray(v)) return v.map(a => String(a).trim()).filter(Boolean);
  return String(v || '').split(/[\n,;]+/).map(a => a.trim()).filter(Boolean);
};

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      // How much work has actually come through each of them, so the list is
      // worth looking at rather than a page of names.
      `SELECT sc.*,
              COALESCE(j.jobs, 0)::int AS job_count,
              COALESCE(j.spend_cents, 0)::bigint AS spend_cents,
              j.last_invoice
         FROM subcontractors sc
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT c.job_id) AS jobs,
                  SUM(c.quantity * c.unit_price) AS spend_cents,
                  MAX(COALESCE(s.invoice_date, s.created_at::date)) AS last_invoice
             FROM job_costs c
             JOIN job_cost_scans s ON s.id = c.scan_id
            WHERE c.cost_kind = 'subcontractor'
              AND (LOWER(TRIM(COALESCE(s.supplier, ''))) = LOWER(TRIM(sc.name))
                   OR LOWER(TRIM(COALESCE(s.supplier, ''))) = ANY (
                        SELECT LOWER(TRIM(a)) FROM UNNEST(sc.also_known_as) a))
         ) j ON TRUE
        ORDER BY sc.is_active DESC, LOWER(sc.name)`
    );
    res.json(rows);
  } catch (err) {
    console.error('[subcontractors] list failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Names already seen on documents that are not sub-contractors yet, offered
// when adding one — the name has to match what the invoices actually say, and
// typing it from memory is how it ends up not matching.
router.get('/seen', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.supplier AS name, COUNT(*)::int AS documents,
              MAX(COALESCE(s.invoice_date, s.created_at::date)) AS last_seen
         FROM job_cost_scans s
        WHERE COALESCE(TRIM(s.supplier), '') <> ''
          AND NOT EXISTS (
            SELECT 1 FROM subcontractors sc
             WHERE LOWER(TRIM(sc.name)) = LOWER(TRIM(s.supplier))
                OR LOWER(TRIM(s.supplier)) = ANY (
                     SELECT LOWER(TRIM(a)) FROM UNNEST(sc.also_known_as) a))
        GROUP BY s.supplier
        ORDER BY COUNT(*) DESC, s.supplier
        LIMIT 200`
    );
    res.json(rows);
  } catch (err) {
    console.error('[subcontractors] seen failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

async function save(req, res) {
  const name = clean(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Give them a name — the one their invoices come in under' });

  const fields = [
    name, clean(req.body?.trade), clean(req.body?.contact_name), clean(req.body?.email),
    clean(req.body?.phone), clean(req.body?.gst_number), aliasList(req.body?.also_known_as),
    clean(req.body?.notes), req.body?.is_active !== false,
  ];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [row] } = req.params.id
      ? await client.query(
        `UPDATE subcontractors SET name=$1, trade=$2, contact_name=$3, email=$4, phone=$5,
                gst_number=$6, also_known_as=$7, notes=$8, is_active=$9, updated_at=NOW()
          WHERE id=$10 RETURNING *`,
        [...fields, req.params.id])
      : await client.query(
        `INSERT INTO subcontractors (name, trade, contact_name, email, phone, gst_number,
                                     also_known_as, notes, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        fields);

    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'That sub-contractor no longer exists' });
    }

    // Every invoice they have ever sent moves under the right heading now,
    // rather than only the ones that arrive from here on.
    const moved = await subcontractors.reclassify(client);
    await client.query('COMMIT');
    res.status(req.params.id ? 200 : 201).json({ ...row, reclassified: moved });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({ error: `${name} is already on the list — edit that one instead.` });
    }
    console.error('[subcontractors] save failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
}

router.post('/', requireRole('admin', 'office'), save);
router.put('/:id', requireRole('admin', 'office'), save);

router.delete('/:id', requireRole('admin', 'office'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query('DELETE FROM subcontractors WHERE id=$1', [req.params.id]);
    if (!rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    // Their past invoices go back to being materials, which is what they were
    // before anybody said otherwise.
    const moved = await subcontractors.reclassify(client);
    await client.query('COMMIT');
    res.json({ message: 'Removed', reclassified: moved });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[subcontractors] delete failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

module.exports = router;
