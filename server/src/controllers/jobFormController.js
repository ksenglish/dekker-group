const pool = require('../db/pool');
const { findJobType } = require('../services/jobTypes');

// Put a job type's default forms onto a job. Called on job creation and again
// if the job's type changes — additive either way, so a form someone has
// already started is never pulled out from under them.
//
// `client` so this can run inside the job-creation transaction.
async function attachDefaultForms(client, jobId, typeName) {
  const type = await findJobType(typeName, client);
  if (!type) return 0;
  const ids = [...(type.pre_install_form_ids || []), ...(type.post_install_form_ids || [])];
  if (!ids.length) return 0;

  // Snapshot each template's fields as they are now — see the migration for why.
  const { rows: templates } = await client.query(
    'SELECT id, fields FROM form_templates WHERE id = ANY($1) AND NOT archived', [ids]
  );
  let attached = 0;
  for (const t of templates) {
    const { rowCount } = await client.query(
      `INSERT INTO job_form_submissions (job_id, template_id, fields_snapshot)
       VALUES ($1, $2, $3) ON CONFLICT (job_id, template_id) DO NOTHING`,
      [jobId, t.id, JSON.stringify(t.fields || [])]
    );
    attached += rowCount;
  }
  return attached;
}

async function list(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, t.name, t.description, t.stage, t.archived AS template_archived,
              u.name AS completed_by_name
       FROM job_form_submissions s
       JOIN form_templates t ON t.id = s.template_id
       LEFT JOIN users u ON u.id = s.completed_by
       WHERE s.job_id = $1
       ORDER BY t.sort_order, t.name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

// Attach a form to this job by hand, for the times a job needs one its type
// doesn't include by default.
async function attach(req, res) {
  const { template_id } = req.body;
  if (!template_id) return res.status(400).json({ error: 'template_id is required' });
  try {
    const { rows: [tpl] } = await pool.query('SELECT id, fields FROM form_templates WHERE id=$1', [template_id]);
    if (!tpl) return res.status(404).json({ error: 'Form not found' });
    await pool.query(
      `INSERT INTO job_form_submissions (job_id, template_id, fields_snapshot)
       VALUES ($1,$2,$3) ON CONFLICT (job_id, template_id) DO NOTHING`,
      [req.params.id, template_id, JSON.stringify(tpl.fields || [])]
    );
    const { rows } = await pool.query(
      `SELECT s.*, t.name, t.description, t.stage FROM job_form_submissions s
       JOIN form_templates t ON t.id = s.template_id
       WHERE s.job_id=$1 AND s.template_id=$2`,
      [req.params.id, template_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function save(req, res) {
  const { answers, status } = req.body;
  if (status && !['not_started', 'in_progress', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const { rows: [existing] } = await pool.query(
      'SELECT * FROM job_form_submissions WHERE id=$1 AND job_id=$2',
      [req.params.submissionId, req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Form not found on this job' });

    // Required fields only have to hold up when marking the form complete —
    // a half-finished form still saves, so nobody loses work on site.
    if (status === 'completed') {
      const missing = (existing.fields_snapshot || [])
        .filter(f => f.required && f.type !== 'section')
        .filter(f => {
          const v = (answers || {})[f.id];
          if (f.type === 'checkbox') return v !== true;
          if (f.type === 'photo') return !v || (Array.isArray(v) && v.length === 0);
          return v === undefined || v === null || String(v).trim() === '';
        })
        .map(f => f.label);
      if (missing.length) {
        return res.status(400).json({ error: `Please complete: ${missing.join(', ')}` });
      }
    }

    const completing = status === 'completed' && existing.status !== 'completed';
    const { rows } = await pool.query(
      `UPDATE job_form_submissions SET
         answers = COALESCE($1, answers),
         status = COALESCE($2, status),
         completed_by = CASE WHEN $3 THEN $4 ELSE completed_by END,
         completed_at = CASE WHEN $3 THEN NOW() ELSE completed_at END,
         updated_at = NOW()
       WHERE id=$5 RETURNING *`,
      [answers !== undefined ? JSON.stringify(answers) : null, status || null,
       completing, req.user.id, req.params.submissionId]
    );
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function remove(req, res) {
  try {
    const { rows: [existing] } = await pool.query(
      'SELECT status FROM job_form_submissions WHERE id=$1 AND job_id=$2',
      [req.params.submissionId, req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Form not found on this job' });
    if (existing.status === 'completed') {
      return res.status(400).json({ error: 'This form has been completed and can no longer be removed from the job.' });
    }
    await pool.query('DELETE FROM job_form_submissions WHERE id=$1', [req.params.submissionId]);
    res.json({ message: 'Form removed' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

module.exports = { attachDefaultForms, list, attach, save, remove };
