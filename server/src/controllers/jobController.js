const pool = require('../db/pool');
const { normaliseRole } = require('../middleware/auth');
const { getTheme } = require('./settingsController');
const { buildElectricalCocPDF } = require('../utils/electricalCocPdf');

async function list(req, res) {
  const { search = '', status, tech, customer, from, to, sort, page = 1, limit = 100 } = req.query;
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];
  let p = 1;
  let techParamIndex = null;

  if (search) {
    conditions.push(`(j.description ILIKE $${p} OR c.name ILIKE $${p} OR j.job_number::text ILIKE $${p} OR j.external_ref ILIKE $${p})`);
    params.push(`%${search}%`); p++;
  }
  if (status) { conditions.push(`j.status = $${p}`); params.push(status); p++; }
  if (tech) {
    conditions.push(`EXISTS (SELECT 1 FROM job_technicians jt WHERE jt.job_id=j.id AND jt.user_id=$${p})`);
    params.push(tech); techParamIndex = p; p++;
  }
  if (customer) { conditions.push(`j.customer_id = $${p}`); params.push(customer); p++; }
  if (from || to) {
    if (techParamIndex) {
      // Scoped to a specific person — match their own schedule entries in
      // the range, not just whichever technician's appointment is earliest.
      const dateConds = [];
      if (from) { dateConds.push(`s.scheduled_date >= $${p}`); params.push(from); p++; }
      if (to)   { dateConds.push(`s.scheduled_date <= $${p}`); params.push(to); p++; }
      conditions.push(`EXISTS (SELECT 1 FROM schedules s WHERE s.job_id=j.id AND s.user_id=$${techParamIndex} AND ${dateConds.join(' AND ')})`);
    } else {
      if (from) { conditions.push(`(SELECT MIN(s.scheduled_date) FROM schedules s WHERE s.job_id=j.id) >= $${p}`); params.push(from); p++; }
      if (to)   { conditions.push(`(SELECT MIN(s.scheduled_date) FROM schedules s WHERE s.job_id=j.id) <= $${p}`); params.push(to); p++; }
    }
  }

  // Non-admin users only see jobs they're assigned to
  if (normaliseRole(req.user.role) !== 'admin') {
    conditions.push(`EXISTS (SELECT 1 FROM job_technicians jt WHERE jt.job_id=j.id AND jt.user_id=$${p})`);
    params.push(req.user.id); p++;
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const orderBy = sort === 'scheduled'
    ? 'ORDER BY scheduled_date ASC NULLS LAST, scheduled_time ASC NULLS LAST'
    : 'ORDER BY j.created_at DESC';

  try {
    const { rows } = await pool.query(
      `SELECT j.id, j.job_number, j.external_ref, j.type, j.status, j.priority, j.description,
              j.created_at,
              (SELECT MIN(s.scheduled_date) FROM schedules s WHERE s.job_id=j.id) AS scheduled_date,
              (SELECT s.start_time FROM schedules s WHERE s.job_id=j.id ORDER BY s.scheduled_date LIMIT 1) AS scheduled_time,
              c.id AS customer_id, c.name AS customer_name,
              s.address AS site_address, s.lat AS site_lat, s.lng AS site_lng,
              COALESCE(
                (SELECT STRING_AGG(u.name, ', ' ORDER BY u.name)
                 FROM job_technicians jt JOIN users u ON u.id=jt.user_id
                 WHERE jt.job_id=j.id),
                (SELECT u.name FROM users u WHERE u.id=j.lead_tech_id)
              ) AS tech_name
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN customer_sites s ON s.id = j.site_id
       ${where}
       ${orderBy}
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset]
    );
    const total = await pool.query(
      `SELECT COUNT(*) FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id ${where}`,
      params
    );
    res.json({ jobs: rows, total: parseInt(total.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function get(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT j.*,
              c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
              c.mobile AS customer_mobile, c.contact_name AS customer_contact_name,
              c.address_street AS customer_address_street, c.address_city AS customer_address_city,
              c.address_region AS customer_address_region, c.address_postcode AS customer_address_postcode,
              c.address_country AS customer_address_country,
              s.address AS site_address, s.label AS site_label,
              (SELECT MIN(sc.scheduled_date) FROM schedules sc WHERE sc.job_id=j.id) AS scheduled_date,
              (SELECT COUNT(*) FROM job_attachments a WHERE a.job_id=j.id) AS attachment_count,
              -- True once any Post Install Form is completed — OR in new form
              -- tables here as the library grows beyond just Electrical COC.
              EXISTS (SELECT 1 FROM job_electrical_coc f WHERE f.job_id=j.id) AS has_completed_forms
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN customer_sites s ON s.id = j.site_id
       WHERE j.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Job not found' });

    const items = await pool.query('SELECT * FROM line_items WHERE job_id = $1 ORDER BY created_at', [req.params.id]);
    const notes = await pool.query(
      `SELECT n.*, u.name AS author_name FROM job_notes n JOIN users u ON u.id = n.user_id
       WHERE n.job_id = $1 ORDER BY n.created_at DESC`,
      [req.params.id]
    );
    const techs = await pool.query(
      `SELECT u.id, u.name FROM job_technicians jt JOIN users u ON u.id=jt.user_id WHERE jt.job_id=$1 ORDER BY u.name`,
      [req.params.id]
    );

    res.json({ ...rows[0], line_items: items.rows, notes: notes.rows, technicians: techs.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

function nextRecurrenceDate(from, interval) {
  const d = new Date(from || Date.now());
  if (interval === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (interval === 'quarterly') d.setMonth(d.getMonth() + 3);
  else if (interval === 'biannual') d.setMonth(d.getMonth() + 6);
  else d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split('T')[0];
}

async function saveTechnicians(client, jobId, techIds) {
  await client.query('DELETE FROM job_technicians WHERE job_id=$1', [jobId]);
  for (const uid of (techIds || [])) {
    if (uid) await client.query(
      'INSERT INTO job_technicians (job_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [jobId, uid]
    );
  }
}

async function create(req, res) {
  const { customer_id, site_id, type, description, tech_ids, is_recurring, recurrence_interval, parent_job_id } = req.body;
  if (!type) return res.status(400).json({ error: 'Job type is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const nextDate = is_recurring ? nextRecurrenceDate(null, recurrence_interval) : null;
    const { rows } = await client.query(
      `INSERT INTO jobs (customer_id, site_id, type, description, priority, lead_tech_id, is_recurring, recurrence_interval, recurrence_next_date, parent_job_id)
       VALUES ($1,$2,$3,$4,'medium',$5,$6,$7,$8,$9) RETURNING *`,
      [customer_id || null, site_id || null, type, description || null,
       (tech_ids?.[0]) || null,
       !!is_recurring, recurrence_interval || null, nextDate, parent_job_id || null]
    );
    // Non-admin creators are auto-assigned so they can see the job they created
    const finalTechIds = normaliseRole(req.user.role) !== 'admin'
      ? [...new Set([...(tech_ids || []), req.user.id])]
      : (tech_ids || []);
    await saveTechnicians(client, rows[0].id, finalTechIds);
    await client.query('COMMIT');
    res.status(201).json({ ...rows[0], technicians: finalTechIds.map(id => ({ id })) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

async function update(req, res) {
  const { customer_id, site_id, type, description, tech_ids, status, is_recurring, recurrence_interval } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const nextDate = is_recurring ? nextRecurrenceDate(null, recurrence_interval) : null;
    const { rows } = await client.query(
      `UPDATE jobs SET customer_id=$1, site_id=$2, type=$3, description=$4,
       lead_tech_id=$5, status=COALESCE($6, status),
       is_recurring=$7, recurrence_interval=$8, recurrence_next_date=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [customer_id || null, site_id || null, type, description || null,
       (tech_ids?.[0]) || null, status || null,
       !!is_recurring, recurrence_interval || null, nextDate, req.params.id]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Job not found' }); }
    await saveTechnicians(client, req.params.id, tech_ids);
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

async function updateStatus(req, res) {
  const { status } = req.body;
  // Cancelling a job is Admin-only — Sales/Operations can move a job through
  // the rest of the pipeline, but not cancel it.
  if (status === 'cancelled' && normaliseRole(req.user.role) !== 'admin') {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  try {
    // Validate against the live, admin-configurable status list (settings
    // key 'job_statuses') rather than a fixed array, so custom statuses
    // added in Settings are accepted here too.
    const { rows: settingsRows } = await pool.query(`SELECT value FROM settings WHERE key='job_statuses'`);
    const configured = settingsRows[0]?.value || ['new', 'quoted', 'scheduled', 'in_progress', 'invoiced', 'complete', 'cancelled'].map(key => ({ key }));
    const validKeys = configured.map(s => s.key);
    if (!validKeys.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const { rows } = await pool.query(
      'UPDATE jobs SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    if (status === 'complete' && rows[0]?.is_recurring && rows[0]?.recurrence_interval) {
      const j = rows[0];
      const nextDue = nextRecurrenceDate(j.recurrence_next_date || j.due_date, j.recurrence_interval);
      const { rows: newJob } = await pool.query(
        `INSERT INTO jobs (customer_id, site_id, type, description, priority, lead_tech_id, due_date, is_recurring, recurrence_interval, recurrence_next_date, parent_job_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,'new') RETURNING id`,
        [j.customer_id, j.site_id, j.type, j.description, j.priority, j.lead_tech_id,
         j.recurrence_next_date, j.recurrence_interval,
         nextRecurrenceDate(j.recurrence_next_date, j.recurrence_interval), j.id]
      );
      // Copy technicians to next recurring job
      await pool.query(
        `INSERT INTO job_technicians (job_id, user_id)
         SELECT $1, user_id FROM job_technicians WHERE job_id=$2 ON CONFLICT DO NOTHING`,
        [newJob[0].id, j.id]
      );
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function remove(req, res) {
  try {
    await pool.query('DELETE FROM jobs WHERE id=$1', [req.params.id]);
    res.json({ message: 'Job deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateLineItems(req, res) {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Items must be an array' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM line_items WHERE job_id=$1', [req.params.id]);
    for (const item of items) {
      if (!item.description) continue;
      await client.query(
        'INSERT INTO line_items (job_id, description, quantity, unit_price, product_id) VALUES ($1,$2,$3,$4,$5)',
        [req.params.id, item.description, item.quantity || 1, Math.round((item.unit_price || 0) * 100), item.product_id || null]
      );
    }
    await client.query('COMMIT');
    const { rows } = await pool.query('SELECT * FROM line_items WHERE job_id=$1 ORDER BY created_at', [req.params.id]);
    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
}

async function listNotes(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT n.*, u.name AS author_name FROM job_notes n JOIN users u ON u.id = n.user_id
       WHERE n.job_id=$1 ORDER BY n.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function createNote(req, res) {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO job_notes (job_id, user_id, content) VALUES ($1,$2,$3)
       RETURNING id, job_id, user_id, content, created_at`,
      [req.params.id, req.user.id, content.trim()]
    );
    const note = rows[0];
    note.author_name = req.user.name;
    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function deleteNote(req, res) {
  try {
    await pool.query('DELETE FROM job_notes WHERE id=$1 AND job_id=$2', [req.params.noteId, req.params.id]);
    res.json({ message: 'Note deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function getOpForm(req, res) {
  try {
    const { rows } = await pool.query('SELECT * FROM job_op_forms WHERE job_id=$1', [req.params.id]);
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function saveOpForm(req, res) {
  const { site_safety_confirmed, work_completed_to_spec, customer_walkthrough_done, notes, technician_name } = req.body;
  if (!technician_name?.trim()) return res.status(400).json({ error: 'Technician name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO job_op_forms (job_id, site_safety_confirmed, work_completed_to_spec, customer_walkthrough_done, notes, technician_name, completed_by, signed_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
       ON CONFLICT (job_id) DO UPDATE SET
         site_safety_confirmed=$2, work_completed_to_spec=$3, customer_walkthrough_done=$4,
         notes=$5, technician_name=$6, completed_by=$7, updated_at=NOW()
       RETURNING *`,
      [req.params.id, !!site_safety_confirmed, !!work_completed_to_spec, !!customer_walkthrough_done, notes || null, technician_name.trim(), req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function getElectricalCoc(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, u.name AS completed_by_name
       FROM job_electrical_coc c LEFT JOIN users u ON u.id = c.completed_by
       WHERE c.job_id=$1`,
      [req.params.id]
    );
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

// Anyone onsite can fill the form in for the first time; once it exists,
// only Admin or the person who originally completed it may change it.
async function saveElectricalCoc(req, res) {
  const f = req.body;
  try {
    const { rows: existingRows } = await pool.query('SELECT completed_by FROM job_electrical_coc WHERE job_id=$1', [req.params.id]);
    const existing = existingRows[0];
    if (existing && req.user.role !== 'admin' && existing.completed_by !== req.user.id) {
      return res.status(403).json({ error: 'Only Admin or the person who completed this form can edit it' });
    }
    const { rows } = await pool.query(
      `INSERT INTO job_electrical_coc (
         job_id, reference_no, location_details, contact_details, electrical_worker_name,
         licence_number, phone_email, supervised_persons,
         work_type, risk_level, high_risk_detail, compliance_part,
         additional_standards_required, additional_standards_detail, work_date_range,
         fittings_safe, supply_system_type, earthing_correctly_rated,
         parts_scope, parts_scope_detail,
         relies_on_manual, manual_identify, manual_link,
         relies_on_certified_design, design_identify, design_link,
         relies_on_sdoc, sdoc_identify, sdoc_link,
         satisfactorily_tested, description_of_work,
         test_polarity, test_insulation_resistance, test_earth_continuity, test_bonding, test_fault_loop_impedance, test_other,
         coc_certifier_signature, coc_signed_date,
         esc_certifier_name, esc_licence_number, esc_certifier_signature, esc_issue_date, esc_connection_date,
         completed_by, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45, NOW()
       )
       ON CONFLICT (job_id) DO UPDATE SET
         reference_no=$2, location_details=$3, contact_details=$4, electrical_worker_name=$5,
         licence_number=$6, phone_email=$7, supervised_persons=$8,
         work_type=$9, risk_level=$10, high_risk_detail=$11, compliance_part=$12,
         additional_standards_required=$13, additional_standards_detail=$14, work_date_range=$15,
         fittings_safe=$16, supply_system_type=$17, earthing_correctly_rated=$18,
         parts_scope=$19, parts_scope_detail=$20,
         relies_on_manual=$21, manual_identify=$22, manual_link=$23,
         relies_on_certified_design=$24, design_identify=$25, design_link=$26,
         relies_on_sdoc=$27, sdoc_identify=$28, sdoc_link=$29,
         satisfactorily_tested=$30, description_of_work=$31,
         test_polarity=$32, test_insulation_resistance=$33, test_earth_continuity=$34, test_bonding=$35, test_fault_loop_impedance=$36, test_other=$37,
         coc_certifier_signature=$38, coc_signed_date=$39,
         esc_certifier_name=$40, esc_licence_number=$41, esc_certifier_signature=$42, esc_issue_date=$43, esc_connection_date=$44,
         updated_at=NOW()
       RETURNING *`,
      [
        req.params.id, f.reference_no || null, f.location_details || null, f.contact_details || null, f.electrical_worker_name || null,
        f.licence_number || null, f.phone_email || null, f.supervised_persons || null,
        f.work_type || null, f.risk_level || null, f.high_risk_detail || null, f.compliance_part || null,
        f.additional_standards_required ?? null, f.additional_standards_detail || null, f.work_date_range || null,
        f.fittings_safe ?? null, f.supply_system_type || null, f.earthing_correctly_rated ?? null,
        f.parts_scope || null, f.parts_scope_detail || null,
        f.relies_on_manual ?? null, f.manual_identify || null, f.manual_link || null,
        f.relies_on_certified_design ?? null, f.design_identify || null, f.design_link || null,
        f.relies_on_sdoc ?? null, f.sdoc_identify || null, f.sdoc_link || null,
        f.satisfactorily_tested ?? null, f.description_of_work || null,
        f.test_polarity || null, f.test_insulation_resistance || null, f.test_earth_continuity || null, f.test_bonding || null, f.test_fault_loop_impedance || null, f.test_other || null,
        f.coc_certifier_signature || null, f.coc_signed_date || null,
        f.esc_certifier_name || null, f.esc_licence_number || null, f.esc_certifier_signature || null, f.esc_issue_date || null, f.esc_connection_date || null,
        req.user.id,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function downloadElectricalCocPdf(req, res) {
  try {
    const { rows: [job] } = await pool.query(
      `SELECT j.*, c.name AS customer_name FROM jobs j LEFT JOIN customers c ON c.id=j.customer_id WHERE j.id=$1`,
      [req.params.id]
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const { rows: [form] } = await pool.query('SELECT * FROM job_electrical_coc WHERE job_id=$1', [req.params.id]);
    if (!form) return res.status(404).json({ error: 'Form has not been completed yet' });
    const theme = await getTheme();
    const pdf = await buildElectricalCocPDF({ job, form, theme });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="electrical-coc-${job.id.slice(0, 8)}.pdf"` });
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'PDF generation failed' });
  }
}

async function deleteElectricalCoc(req, res) {
  try {
    await pool.query('DELETE FROM job_electrical_coc WHERE job_id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  list, get, create, update, updateStatus, remove, updateLineItems, listNotes, createNote, deleteNote,
  getOpForm, saveOpForm, getElectricalCoc, saveElectricalCoc, downloadElectricalCocPdf, deleteElectricalCoc,
};
