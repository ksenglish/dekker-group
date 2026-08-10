const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, requireRole, requireRawRole } = require('../middleware/auth');
const { sendMail } = require('../utils/email');

const LEAD_STATUSES = ['new', 'contacted', 'call_back', 'converted', 'not_interested'];
const SALES_EMAIL = 'sales@dekkergroup.co.nz';

// Timestamp column stamped the first time each status is reached.
const RESULT_STAMP = {
  contacted: 'contacted_at', call_back: 'call_back_at',
  converted: 'converted_at', not_interested: 'not_interested_at',
};

// What picking a call result does. Everything that isn't a win or a refusal
// lands on 'contacted' — we rang, we got somewhere, it's still live.
const CALL_RESULTS = {
  left_voicemail: { label: 'Left Voice Mail', status: 'contacted' },
  no_reply:       { label: 'No Reply',        status: 'contacted' },
  emailed:        { label: 'Emailed',         status: 'contacted' },
  texted:         { label: 'Texted',          status: 'contacted' },
  call_back:      { label: 'Call Back',       status: 'call_back' },
  booked:         { label: 'Booked',          status: 'converted' },
  not_interested: { label: 'Not Interested',  status: 'not_interested' },
};

// A lead is "open" until it's either won or deliberately dropped — that's the
// number the sidebar badge nags with.
const OPEN_STATUSES = ['new', 'contacted', 'call_back'];

// Website forms send one address string; manual entry collects the same
// structured parts as a customer. Keep `address` populated either way so
// existing display and email code works unchanged.
function composeAddress(f) {
  if (f.address && String(f.address).trim()) return String(f.address);
  return [f.address_street, f.address_city, f.address_region, f.address_postcode]
    .filter(v => v && String(v).trim()).join(', ') || null;
}

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function leadEmailHtml(lead) {
  const row = (label, value) => value
    ? `<tr><td style="padding:6px 12px;color:#64748b;white-space:nowrap;">${label}</td><td style="padding:6px 12px;font-weight:600;">${esc(value)}</td></tr>`
    : '';
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;">
      <h2 style="color:#1e40af;">New Website Lead</h2>
      <table style="border-collapse:collapse;background:#f8fafc;border-radius:8px;width:100%;">
        ${row('Name', lead.name)}
        ${row('Phone', lead.phone)}
        ${row('Email', lead.email)}
        ${row('Address', lead.address)}
        ${row('Service Required', lead.service_required)}
        ${row('Source', lead.source)}
      </table>
      ${lead.message ? `<p style="margin-top:16px;"><strong>Message:</strong></p><p style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;white-space:pre-wrap;">${esc(lead.message)}</p>` : ''}
      <p style="margin-top:20px;font-size:13px;color:#64748b;">
        This lead has been added to the <a href="https://dekker-group.onrender.com/leads">New Leads</a> tab in Dekker App.
      </p>
    </div>`;
}

// Shared by the webhooks and manual entry: validate, store, and email the lead.
// `notify` is off for manual entry — whoever typed it in already knows.
async function createLead(f, res, { notify = true, entryMethod = 'website', userId = null } = {}) {
  const { name, email, phone, mobile, service_required, message, source } = f;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (!email && !phone && !mobile) return res.status(400).json({ error: 'email or phone is required' });

  const clip = (v, n) => (v ? String(v).slice(0, n) : null);
  try {
    const { rows } = await pool.query(
      `INSERT INTO leads (name, email, phone, mobile, address, service_required, message, source,
                          contact_name, company, address_street, address_city, address_region,
                          address_postcode, address_country, entry_method, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [clip(name, 255), clip(email, 255), clip(phone, 50), clip(mobile, 50),
       clip(composeAddress(f), 1000), clip(service_required, 255), clip(message, 5000), clip(source, 255),
       clip(f.contact_name, 255), clip(f.company, 255), clip(f.address_street, 1000),
       clip(f.address_city, 255), clip(f.address_region, 255), clip(f.address_postcode, 20),
       clip(f.address_country, 100), entryMethod, userId]
    );
    const lead = rows[0];

    // Notify sales — a failed email must never lose the lead itself
    if (notify) {
      sendMail({
        to: SALES_EMAIL,
        subject: `New Lead — ${lead.name}${lead.source ? ` (${lead.source})` : ''}`,
        html: leadEmailHtml(lead),
        text: `New website lead\nName: ${lead.name}\nPhone: ${lead.phone || '-'}\nEmail: ${lead.email || '-'}\nAddress: ${lead.address || '-'}\nService: ${lead.service_required || '-'}\nSource: ${lead.source || '-'}\nMessage: ${lead.message || '-'}`,
      }).catch(err => console.error('Lead email failed:', err.message));
    }

    res.status(201).json({ ok: true, id: lead.id, lead });
  } catch (err) {
    console.error('Lead create error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

// ── Public webhook — website contact forms POST here (no login required) ──────
router.post('/webhook', async (req, res) => {
  const { website, ...fields } = req.body || {};
  // `website` is a honeypot field: real visitors never fill it, bots do.
  // Return 201 so the bot thinks it worked, but store nothing.
  if (website) return res.status(201).json({ ok: true });
  await createLead(fields, res);
});

// ── Wix Automations adapter ───────────────────────────────────────────────────
// Wix's "Send HTTP request" action posts the entire form-submitted trigger
// payload: { formId, formName, submissions: [{ label, value }], ... }.
// Fields are matched by label so form field order never matters.
const WIX_FORM_SOURCES = {
  '681bc4c5-2943-4868-b658-6f6a2e17f17b': 'Dekker Air-Website-Main Page',    // Dekker Air - Contact Us
  '4f120313-b74f-40e1-8f56-55be0dec95bb': 'Dekker Air-Website-Heating',      // Dekker Air - Heating
  'a50ceca7-83b2-47aa-81d8-eeb4452266ab': 'Dekker Air-Website-Cooling',      // Dekker Air - Cooling
  '84abb054-3e9f-4512-9c21-4b3ac80fc7ab': 'Dekker Air-Website-HVAC Service', // Dekker Air - HVAC Service
  'd3e79d0f-0b8f-4a33-a8c4-8ace6ddd5fbe': 'Dekker Air-Website-Ventilation',  // Dekker Air - Ventilation Form
};

router.post('/webhook/wix', async (req, res) => {
  // Wix may wrap the trigger payload in an envelope — unwrap the common shapes
  let body = req.body || {};
  if (!body.submissions && body.data && typeof body.data === 'object') body = body.data;
  if (!body.submissions && body.payload && typeof body.payload === 'object') body = body.payload;

  const { formId, formName } = body;
  let submissions = body.submissions;
  // submissions can be an array of { label, value } or an object map of label -> value
  if (submissions && !Array.isArray(submissions) && typeof submissions === 'object') {
    submissions = Object.entries(submissions).map(([label, value]) => ({ label, value }));
  }
  if (!Array.isArray(submissions)) {
    console.error('Wix webhook: unrecognised payload shape:', JSON.stringify(req.body).slice(0, 1500));
    return res.status(400).json({ error: 'submissions array is required' });
  }

  const val = re => {
    const v = submissions.find(s => re.test(s.label || ''))?.value;
    if (v == null) return null;
    return Array.isArray(v) ? v.join(', ') : String(v);
  };
  const first = val(/first\s*name/i);
  const last = val(/last\s*name/i);
  const name = [first, last].filter(Boolean).join(' ') || val(/^name/i);

  await createLead({
    name,
    email: val(/e-?mail/i),
    phone: val(/phone|mobile/i),
    address: val(/address/i),
    service_required: val(/interested|service|choose an issue/i),
    message: val(/message|tell us|anything else|enquiry|more about/i),
    source: WIX_FORM_SOURCES[formId] || (formName ? `${formName} (Website)` : 'Website'),
  }, res);
});

// ── Authenticated endpoints (admin + office staff) ────────────────────────────
// Once we've actually spoken to someone they're a contact worth keeping,
// whatever the enquiry turns into — so the customer record is created the
// moment a lead leaves 'new', not when it converts. Idempotent: a lead that
// already has a customer keeps it.
async function ensureCustomer(client, lead) {
  if (lead.customer_id) return lead.customer_id;

  const { rows } = await client.query(
    `INSERT INTO customers (name, contact_name, company, email, phone, mobile, lead_source,
                            address_street, address_city, address_region, address_postcode, address_country)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [lead.name, lead.contact_name, lead.company, lead.email, lead.phone, lead.mobile, lead.source,
     lead.address_street, lead.address_city, lead.address_region, lead.address_postcode,
     lead.address_country || 'New Zealand']
  );
  const customerId = rows[0].id;

  if (lead.address) {
    await client.query(
      'INSERT INTO customer_sites (customer_id, address) VALUES ($1,$2)',
      [customerId, lead.address]
    );
  }
  await client.query('UPDATE leads SET customer_id = $1 WHERE id = $2', [customerId, lead.id]);
  return customerId;
}

// Converting means the work is booked, so it opens a job. Idempotent for the
// same reason — re-marking a lead as booked must not open a second job.
async function ensureJob(client, lead, customerId) {
  if (lead.job_id) return lead.job_id;

  const { rows } = await client.query(
    `INSERT INTO jobs (customer_id, type, description, priority, status)
     VALUES ($1,$2,$3,'medium','new') RETURNING id`,
    [
      customerId,
      lead.service_required || 'Enquiry',
      [lead.service_required, lead.message].filter(Boolean).join(' — ') || null,
    ]
  );
  const jobId = rows[0].id;
  await client.query('UPDATE leads SET job_id = $1 WHERE id = $2', [jobId, lead.id]);
  return jobId;
}

router.use(authenticate);

router.get('/', requireRawRole('admin', 'office'), async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = '';
  if (status && LEAD_STATUSES.includes(status)) { where = 'WHERE l.status = $1'; params.push(status); }
  try {
    const { rows } = await pool.query(
      `SELECT l.*, c.name AS customer_name
       FROM leads l LEFT JOIN customers c ON c.id = l.customer_id
       ${where} ORDER BY l.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Manual entry — same fields as adding a new customer, so a phone enquiry is
// tracked identically to a website one.
router.post('/', requireRawRole('admin', 'office'), async (req, res) => {
  await createLead(
    { ...req.body, source: req.body.source || 'Manual Entry' },
    res,
    { notify: false, entryMethod: 'manual', userId: req.user.id }
  );
});

// Conversion timing, for the "how fast do we action leads" report.
router.get('/stats', requireRawRole('admin', 'office'), async (req, res) => {
  try {
    const { rows: [s] } = await pool.query(`
      SELECT
        COUNT(*)                                                    AS total_count,
        COUNT(*) FILTER (WHERE status='new')                        AS new_count,
        COUNT(*) FILTER (WHERE status='contacted')                  AS contacted_count,
        COUNT(*) FILTER (WHERE status='call_back')                  AS call_back_count,
        COUNT(*) FILTER (WHERE status='converted')                  AS converted_count,
        COUNT(*) FILTER (WHERE status='not_interested')             AS not_interested_count,
        COUNT(*) FILTER (WHERE status = ANY($1))                    AS open_count,
        COUNT(*) FILTER (WHERE entry_method='manual')               AS manual_count,
        COUNT(*) FILTER (WHERE entry_method='website')              AS website_count,
        AVG(EXTRACT(EPOCH FROM (resulted_at  - created_at)))        AS avg_secs_to_result,
        AVG(EXTRACT(EPOCH FROM (converted_at - created_at)))        AS avg_secs_to_convert
      FROM leads`, [OPEN_STATUSES]);
    const num = v => (v == null ? null : Number(v));
    res.json({
      total_count:      Number(s.total_count),
      new_count:        Number(s.new_count),
      contacted_count:  Number(s.contacted_count),
      call_back_count:  Number(s.call_back_count),
      converted_count:  Number(s.converted_count),
      not_interested_count: Number(s.not_interested_count),
      open_count:       Number(s.open_count),
      manual_count:     Number(s.manual_count),
      website_count:    Number(s.website_count),
      avg_secs_to_result:  num(s.avg_secs_to_result),
      avg_secs_to_convert: num(s.avg_secs_to_convert),
      conversion_rate: Number(s.total_count) > 0
        ? Number(s.converted_count) / Number(s.total_count) : null,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.patch('/:id/status', requireRawRole('admin', 'office'), async (req, res) => {
  const { status } = req.body;
  if (!LEAD_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [lead] } = await client.query('SELECT * FROM leads WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!lead) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Lead not found' }); }

    // Moving a lead off 'new' by hand counts as contact just as much as
    // recording a call result does, so the customer record is created here too.
    let customerId = lead.customer_id;
    let jobId = lead.job_id;
    if (status !== 'new') customerId = await ensureCustomer(client, lead);
    if (status === 'converted') jobId = await ensureJob(client, lead, customerId);

    // COALESCE everywhere so the stamps record the *first* time a lead reached
    // each stage — re-marking it later must not restart the clock.
    const sets = ['status=$1', 'updated_at=NOW()'];
    const params = [status, req.params.id];
    const stamp = RESULT_STAMP[status];
    if (stamp) sets.push(`${stamp} = COALESCE(${stamp}, NOW())`);
    if (status !== 'call_back') sets.push('call_back_on = NULL');
    if (status !== 'new') {
      sets.push('resulted_at = COALESCE(resulted_at, NOW())');
      params.push(req.user.id);
      sets.push(`resulted_by = COALESCE(resulted_by, $${params.length})`);
    }
    const { rows } = await client.query(
      `UPDATE leads SET ${sets.join(', ')} WHERE id=$2 RETURNING *`, params
    );
    await client.query('COMMIT');
    res.json({ ...rows[0], customer_id: customerId, job_id: jobId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err); res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// Edit a lead's details after it's been saved. Available at any stage — a
// phone number taken down wrong shouldn't need the lead converting first.
router.put('/:id', requireRawRole('admin', 'office'), async (req, res) => {
  const f = req.body || {};
  if (!f.name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE leads SET
         name=$1, contact_name=$2, company=$3, email=$4, phone=$5, mobile=$6,
         service_required=$7, message=$8, source=COALESCE($9, source), address=$10,
         address_street=$11, address_city=$12, address_region=$13,
         address_postcode=$14, address_country=$15, updated_at=NOW()
       WHERE id=$16 RETURNING *`,
      [f.name.trim(), f.contact_name || null, f.company || null, f.email || null,
       f.phone || null, f.mobile || null, f.service_required || null, f.message || null,
       f.source || null, f.address || null, f.address_street || null, f.address_city || null,
       f.address_region || null, f.address_postcode || null, f.address_country || 'New Zealand',
       req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Lead not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Record the outcome of a call. This is the main way a lead moves: the result
// picked decides the status, so nobody has to remember which status goes with
// "left a voicemail".
router.post('/:id/result', requireRawRole('admin', 'office'), async (req, res) => {
  const { result, call_back_on } = req.body || {};
  const mapped = CALL_RESULTS[result];
  if (!mapped) return res.status(400).json({ error: 'Unknown call result' });
  if (result === 'call_back' && !call_back_on) {
    return res.status(400).json({ error: 'Pick a date to call back on' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [lead] } = await client.query('SELECT * FROM leads WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!lead) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Lead not found' }); }

    // Every outcome here means we've made contact, so the customer record is
    // created now regardless of which way the lead goes.
    const customerId = await ensureCustomer(client, lead);
    const jobId = mapped.status === 'converted'
      ? await ensureJob(client, lead, customerId)
      : lead.job_id;

    const stamp = RESULT_STAMP[mapped.status];
    const sets = [
      'status=$1', 'last_result=$2', 'updated_at=NOW()',
      'resulted_at = COALESCE(resulted_at, NOW())',
      'resulted_by = COALESCE(resulted_by, $3)',
      // Cleared unless this result sets one, so a lead that moves on doesn't
      // keep an old call-back date hanging off it.
      `call_back_on = ${result === 'call_back' ? '$5::date' : 'NULL'}`,
    ];
    if (stamp) sets.push(`${stamp} = COALESCE(${stamp}, NOW())`);

    const params = [mapped.status, result, req.user.id, req.params.id];
    if (result === 'call_back') params.push(call_back_on);

    const { rows } = await client.query(
      `UPDATE leads SET ${sets.join(', ')} WHERE id=$4 RETURNING *`, params
    );
    await client.query('COMMIT');
    res.json({ ...rows[0], customer_id: customerId, job_id: jobId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally { client.release(); }
});

// Kept for the existing "convert" action — now opens a job rather than just a
// customer, so converted means booked work.
router.post('/:id/convert', requireRawRole('admin', 'office'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [lead] } = await client.query('SELECT * FROM leads WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!lead) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Lead not found' }); }
    if (lead.job_id) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'This lead already has a job' }); }

    const customerId = await ensureCustomer(client, lead);
    const jobId = await ensureJob(client, lead, customerId);

    await client.query(
      `UPDATE leads SET status='converted', last_result='booked', updated_at=NOW(),
              converted_at = COALESCE(converted_at, NOW()),
              resulted_at  = COALESCE(resulted_at, NOW()),
              resulted_by  = COALESCE(resulted_by, $2),
              call_back_on = NULL
       WHERE id=$1`,
      [lead.id, req.user.id]
    );
    await client.query('COMMIT');
    res.json({ customer_id: customerId, job_id: jobId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM leads WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
