const pool = require('../db/pool');
const { findJobType } = require('../services/jobTypes');
const { normaliseRole } = require('../middleware/auth');
const { getDefaultTheme } = require('../utils/documentThemes');
const { buildJobFormPDF } = require('../utils/jobFormPdf');
const fileStore = require('../services/fileStore');

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

// Whose form this is: the person who completed it, or failing that the person
// who started filling it in. A form nobody has touched has no owner.
function ownerOf(sub) {
  return sub.completed_by || sub.started_by || null;
}

// Admin can remove any form. Everyone else can remove their own — including a
// completed one, which mirrors the rule already used for the Electrical COC.
// A form nobody has started is just an unwanted attachment off the job type,
// so anyone who can attach one can take it off again.
function canDelete(sub, user) {
  if (normaliseRole(user.role) === 'admin') return true;
  const owner = ownerOf(sub);
  if (owner) return owner === user.id;
  return ['admin', 'office'].includes(normaliseRole(user.role));
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
    // Worked out here rather than in the browser: the rule depends on who is
    // asking, and the page shouldn't offer a button the API would refuse.
    res.json(rows.map(r => ({ ...r, can_delete: canDelete(r, req.user) })));
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
         -- Whoever saves first owns the form from then on, so it doesn't change
         -- hands when someone else opens it later.
         started_by = COALESCE(started_by, $4),
         completed_by = CASE WHEN $3 THEN $4 ELSE completed_by END,
         completed_at = CASE WHEN $3 THEN NOW() ELSE completed_at END,
         updated_at = NOW()
       WHERE id=$5 RETURNING *`,
      [answers !== undefined ? JSON.stringify(answers) : null, status || null,
       completing, req.user.id, req.params.submissionId]
    );
    res.json({ ...rows[0], can_delete: canDelete(rows[0], req.user) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function remove(req, res) {
  try {
    const { rows: [existing] } = await pool.query(
      'SELECT status, completed_by, started_by FROM job_form_submissions WHERE id=$1 AND job_id=$2',
      [req.params.submissionId, req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Form not found on this job' });
    if (!canDelete(existing, req.user)) {
      return res.status(403).json({
        error: 'Only an Admin, or the person who filled this form in, can delete it.',
      });
    }
    await pool.query('DELETE FROM job_form_submissions WHERE id=$1', [req.params.submissionId]);
    res.json({ message: 'Form removed' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

// Pulls the photo bytes for every photo field, so the PDF can print them.
// Grouped by field id, in the order they were added.
async function loadFormPhotos(submission) {
  const out = {};
  const photoFields = (submission.fields_snapshot || []).filter(f => f.type === 'photo');
  for (const f of photoFields) {
    const items = Array.isArray((submission.answers || {})[f.id]) ? submission.answers[f.id] : [];
    const buffers = [];
    for (const p of items) {
      try {
        buffers.push(await fileStore.readBytes({ key: p.key, inline: p.inline }));
      } catch {
        // One unreadable photo shouldn't cost the whole document.
      }
    }
    if (buffers.length) out[f.id] = buffers;
  }
  return out;
}

function pdfFileName(job, submission) {
  const jobRef = job?.external_ref
    || (job?.job_number != null ? 'JB' + String(job.job_number).padStart(5, '0') : '');
  return [jobRef, submission.name || 'Form']
    .filter(Boolean).join(' - ').replace(/[^\w.\- ]+/g, '_') + '.pdf';
}

async function downloadPdf(req, res) {
  try {
    const { rows: [submission] } = await pool.query(
      `SELECT s.*, t.name, t.description, u.name AS completed_by_name
         FROM job_form_submissions s
         JOIN form_templates t ON t.id = s.template_id
         LEFT JOIN users u ON u.id = s.completed_by
        WHERE s.id=$1 AND s.job_id=$2`,
      [req.params.submissionId, req.params.id]
    );
    if (!submission) return res.status(404).json({ error: 'Form not found on this job' });

    const { rows: [job] } = await pool.query(
      `SELECT j.job_number, j.external_ref, COALESCE(cs.address, j.site_address) AS site_address,
              c.name AS customer_name
         FROM jobs j
         LEFT JOIN customers c ON c.id = j.customer_id
         LEFT JOIN customer_sites cs ON cs.id = j.site_id
        WHERE j.id=$1`,
      [req.params.id]
    );

    const [theme, photos] = await Promise.all([
      getDefaultTheme(),
      loadFormPhotos(submission),
    ]);
    const pdf = await buildJobFormPDF({ job, submission, theme: theme || {}, photos });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdfFileName(job, submission).replace(/"/g, '')}"`,
    });
    res.send(pdf);
  } catch (err) {
    console.error('Form PDF generation failed:', err);
    res.status(500).json({ error: 'PDF generation failed' });
  }
}

module.exports = { attachDefaultForms, list, attach, save, remove, downloadPdf };
