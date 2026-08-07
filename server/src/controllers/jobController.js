const pool = require('../db/pool');
const { normaliseRole } = require('../middleware/auth');
const { getTheme } = require('./settingsController');
const { buildElectricalCocPDF } = require('../utils/electricalCocPdf');
const { sendMail } = require('../utils/email');
const { OFFICE_RECORDS_EMAIL } = require('../utils/recordsEmail');
const { sanitizeHtml } = require('../utils/sanitizeHtml');

async function list(req, res) {
  const { search = '', status, tech, customer, from, to, sort, page = 1, limit = 100 } = req.query;
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];
  let p = 1;
  let techParamIndex = null;

  if (search) {
    // job_number is an integer (1001) but the app shows it as "JB01001", so a
    // search for the number the user can actually see has to match the
    // formatted form too — matching the raw column alone never hits.
    // Mirrors formatJobNumber() on the client.
    // Descriptions hold rich text, so tags are stripped before matching —
    // otherwise "span" or "style" hits every formatted job while text split
    // across a tag boundary is missed.
    conditions.push(`(
      regexp_replace(regexp_replace(j.description, '<[^>]+>', ' ', 'g'), '\\s+', ' ', 'g') ILIKE $${p}
      OR c.name ILIKE $${p}
      OR j.job_number::text ILIKE $${p}
      OR ('JB' || LPAD(j.job_number::text, 5, '0')) ILIKE $${p}
      OR j.external_ref ILIKE $${p}
    )`);
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
    ? 'ORDER BY sch.scheduled_date ASC NULLS LAST, sch.start_time ASC NULLS LAST'
    : 'ORDER BY j.created_at DESC';

  // The displayed date/time must come from the appointment the user is
  // actually looking at. Extra params (not referenced by the count query, so
  // they live on their own array) drive a lateral that picks:
  //   - only appointments inside the filtered date range, so a job with an
  //     earlier booking doesn't report that other date, and
  //   - the selected technician's appointment ahead of a colleague's, so a job
  //     two people attend at different times shows the viewer their own time.
  const techIdx = p; const fromIdx = p + 1; const toIdx = p + 2;
  const listParams = [...params, tech || null, from || null, to || null, limit, offset];
  const scheduleLateral = `
       LEFT JOIN LATERAL (
         SELECT s2.scheduled_date, s2.start_time
         FROM schedules s2
         WHERE s2.job_id = j.id
           AND ($${fromIdx}::date IS NULL OR s2.scheduled_date >= $${fromIdx}::date)
           AND ($${toIdx}::date   IS NULL OR s2.scheduled_date <= $${toIdx}::date)
         ORDER BY ($${techIdx}::uuid IS NOT NULL AND s2.user_id = $${techIdx}::uuid) DESC,
                  s2.scheduled_date ASC, s2.start_time ASC NULLS LAST
         LIMIT 1
       ) sch ON TRUE`;

  try {
    const { rows } = await pool.query(
      `SELECT j.id, j.job_number, j.external_ref, j.type, j.status, j.priority, j.description,
              j.created_at,
              sch.scheduled_date AS scheduled_date,
              sch.start_time AS scheduled_time,
              c.id AS customer_id, c.name AS customer_name,
              c.mobile AS customer_mobile, c.phone AS customer_phone,
              -- Jobs without a linked customer site keep their address on the
              -- job itself, so fall back to it rather than showing a blank.
              COALESCE(s.address, j.site_address) AS site_address,
              s.lat AS site_lat, s.lng AS site_lng,
              COALESCE(
                (SELECT STRING_AGG(u.name, ', ' ORDER BY u.name)
                 FROM job_technicians jt JOIN users u ON u.id=jt.user_id
                 WHERE jt.job_id=j.id),
                (SELECT u.name FROM users u WHERE u.id=j.lead_tech_id)
              ) AS tech_name
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN customer_sites s ON s.id = j.site_id
       ${scheduleLateral}
       ${where}
       ${orderBy}
       LIMIT $${p + 3} OFFSET $${p + 4}`,
      listParams
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
              (SELECT COUNT(*) FROM job_attachments a WHERE a.job_id=j.id AND a.category='pre_install') AS attachment_count,
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

    const items = await pool.query('SELECT * FROM line_items WHERE job_id = $1 AND quote_id IS NULL ORDER BY created_at', [req.params.id]);
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
      [customer_id || null, site_id || null, type, sanitizeHtml(description) || null,
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
      [customer_id || null, site_id || null, type, sanitizeHtml(description) || null,
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
    await client.query('DELETE FROM line_items WHERE job_id=$1 AND quote_id IS NULL', [req.params.id]);
    for (const item of items) {
      if (!item.description) continue;
      await client.query(
        'INSERT INTO line_items (job_id, description, quantity, unit_price, product_id, product_name) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.params.id, item.description, item.quantity || 1, Math.round((item.unit_price || 0) * 100), item.product_id || null, item.product_name || null]
      );
    }
    await client.query('COMMIT');
    const { rows } = await pool.query('SELECT * FROM line_items WHERE job_id=$1 AND quote_id IS NULL ORDER BY created_at', [req.params.id]);
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

// Authors edit their own notes only. A note is displayed under someone's name,
// so nobody else — admin included — gets to change the words attributed to them.
// The user_id check is in the WHERE clause, so a mismatch simply matches no row.
async function updateNote(req, res) {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE job_notes SET content=$1, updated_at=NOW()
       WHERE id=$2 AND job_id=$3 AND user_id=$4
       RETURNING id, job_id, user_id, content, created_at, updated_at`,
      [content.trim(), req.params.noteId, req.params.id, req.user.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'Note not found, or it was written by someone else' });
    }
    const note = rows[0];
    note.author_name = req.user.name;
    res.json(note);
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


function cocJobNumber(job) {
  if (job.external_ref) return job.external_ref;
  if (job.job_number != null) return 'JB' + String(job.job_number).padStart(5, '0');
  return job.id.slice(0, 8).toUpperCase();
}

// "<Reference / Certificate ID No.> - <Site Address>.pdf", with anything a
// filesystem would object to flattened out.
function cocFileName(job, form) {
  const reference = (form.reference_no || '').trim() || cocJobNumber(job);
  const site = (form.location_details || job.site_address || '').trim().replace(/\s*\n\s*/g, ', ');
  const raw = site ? `${reference} - ${site}` : reference;
  const safe = raw.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
  return `${safe || 'Electrical COC'}.pdf`;
}

async function getCocPhotos(jobId) {
  const { rows } = await pool.query(
    'SELECT id, data_base64, mime_type, caption, sort_order FROM job_coc_photos WHERE job_id=$1 ORDER BY sort_order, created_at',
    [jobId]
  );
  return rows;
}

// Files the signed certificate with the electrician and the office. Best
// effort — a mail failure must never lose the saved form.
async function emailCocForRecords({ job, form, photos, theme, recipientEmail }) {
  const to = [recipientEmail, OFFICE_RECORDS_EMAIL].filter(Boolean);
  const unique = [...new Set(to.map(e => e.toLowerCase()))];
  if (!unique.length) return false;
  const pdf = await buildElectricalCocPDF({ job, form, theme, photos });
  const jobNo = cocJobNumber(job);
  await sendMail({
    to: unique.join(', '),
    subject: `Electrical COC - ${jobNo}`,
    html: `<p>Electrical Certificate of Compliance for job <strong>${jobNo}</strong> is attached.</p>
<p>Certificate reference: ${form.reference_no || '—'}<br>
Site: ${(form.location_details || job.site_address || '—').replace(/\n/g, ', ')}<br>
Certified by: ${form.coc_certifier_signature || '—'}</p>
<p>Retain this document for a minimum of 7 years.</p>`,
    attachments: [{ filename: cocFileName(job, form), content: pdf, contentType: 'application/pdf' }],
  });
  return true;
}

// Has any quote on this job actually reached the customer? Checks the quote
// record and the activity log together — sent_at is the direct signal, and the
// quote_sent activity covers anything sent before that column was populated.
async function getQuoteDelivery(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT q.id, q.quote_number, q.status, q.sent_at, q.delivery_status,
              EXISTS (
                SELECT 1 FROM activity_log a
                WHERE a.entity_type='quote' AND a.entity_id=q.id AND a.type='quote_sent'
              ) AS has_sent_activity
       FROM quotes q WHERE q.job_id=$1 ORDER BY q.created_at DESC`,
      [req.params.id]
    );
    const isDelivered = q =>
      !!q.sent_at || (q.delivery_status && q.delivery_status !== 'unsent') || q.has_sent_activity;
    const delivered = rows.filter(isDelivered);
    res.json({
      quote_count: rows.length,
      delivered_count: delivered.length,
      delivered: delivered.length > 0,
      latest_delivered_at: delivered[0]?.sent_at || null,
    });
  } catch (err) {
    console.error('[job] quote delivery check failed:', err.message);
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
    if (!rows[0]) return res.json(null);
    res.json({ ...rows[0], photos: await getCocPhotos(req.params.id) });
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

    // Photos are sent as the full set each save, so replace rather than merge.
    if (Array.isArray(f.photos)) {
      await pool.query('DELETE FROM job_coc_photos WHERE job_id=$1', [req.params.id]);
      for (const [i, p] of f.photos.entries()) {
        if (!p?.data_base64) continue;
        await pool.query(
          'INSERT INTO job_coc_photos (job_id, data_base64, mime_type, caption, sort_order) VALUES ($1,$2,$3,$4,$5)',
          [req.params.id, p.data_base64, p.mime_type || null, (p.caption || '').slice(0, 255) || null, i]
        );
      }
    }

    const saved = rows[0];
    const photos = await getCocPhotos(req.params.id);

    // File it away the first time it's signed. Later edits don't resend.
    let emailed = false;
    if (saved.coc_certifier_signature && !saved.emailed_at) {
      try {
        const { rows: [job] } = await pool.query(
          `SELECT j.*, c.name AS customer_name FROM jobs j LEFT JOIN customers c ON c.id=j.customer_id WHERE j.id=$1`,
          [req.params.id]
        );
        const theme = await getTheme();
        emailed = await emailCocForRecords({
          job, form: saved, photos, theme, recipientEmail: req.user.email,
        });
        if (emailed) {
          await pool.query('UPDATE job_electrical_coc SET emailed_at=NOW() WHERE job_id=$1', [req.params.id]);
          saved.emailed_at = new Date().toISOString();
        }
      } catch (mailErr) {
        // The certificate is saved either way — surface it without failing.
        console.error('[coc] record-keeping email failed:', mailErr.message);
      }
    }

    res.json({ ...saved, photos, emailed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

// Manual resend, for when the automatic one failed or a fresh copy is wanted.
async function emailElectricalCoc(req, res) {
  try {
    const { rows: [job] } = await pool.query(
      `SELECT j.*, c.name AS customer_name FROM jobs j LEFT JOIN customers c ON c.id=j.customer_id WHERE j.id=$1`,
      [req.params.id]
    );
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const { rows: [form] } = await pool.query('SELECT * FROM job_electrical_coc WHERE job_id=$1', [req.params.id]);
    if (!form) return res.status(404).json({ error: 'Form has not been completed yet' });
    const theme = await getTheme();
    await emailCocForRecords({
      job, form, photos: await getCocPhotos(req.params.id), theme, recipientEmail: req.user.email,
    });
    await pool.query('UPDATE job_electrical_coc SET emailed_at=NOW() WHERE job_id=$1', [req.params.id]);
    res.json({ message: `Sent to ${req.user.email} and ${OFFICE_RECORDS_EMAIL}` });
  } catch (err) {
    console.error('[coc]', err.message);
    res.status(500).json({ error: err.message || 'Failed to send certificate' });
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
    const photos = await getCocPhotos(req.params.id);
    const pdf = await buildElectricalCocPDF({ job, form, theme, photos });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${cocFileName(job, form).replace(/"/g, '')}"`,
    });
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'PDF generation failed' });
  }
}

// Admin, or the person who completed it — a signed certificate has already
// been emailed to them and the office, so the record survives the delete.
async function deleteElectricalCoc(req, res) {
  try {
    const { rows: [form] } = await pool.query('SELECT completed_by FROM job_electrical_coc WHERE job_id=$1', [req.params.id]);
    if (!form) return res.status(404).json({ error: 'Form not found' });
    if (normaliseRole(req.user.role) !== 'admin' && form.completed_by !== req.user.id) {
      return res.status(403).json({ error: 'Only Admin or the person who completed this form can delete it' });
    }
    await pool.query('DELETE FROM job_electrical_coc WHERE job_id=$1', [req.params.id]);
    await pool.query('DELETE FROM job_coc_photos WHERE job_id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  list, get, create, update, updateStatus, remove, updateLineItems, listNotes, createNote, updateNote, deleteNote,
  getOpForm, saveOpForm, getQuoteDelivery, getElectricalCoc, saveElectricalCoc, downloadElectricalCocPdf, emailElectricalCoc, deleteElectricalCoc,
};
