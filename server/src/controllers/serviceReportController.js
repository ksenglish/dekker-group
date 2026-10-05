// The live job service report.
//
// A charge-up job accrues for weeks before anyone sends an invoice, and until
// now the customer had to ring up and ask where it was at. This is that answer
// as a page: the scope of works off the job, every hour clocked with the times
// worked, every supplier line, and what it all comes to.
//
// Everything on it is charge-out, not cost. Labour is at the billing rate the
// hour was logged against; materials are the supplier price plus the markup for
// this job. The customer never sees what Dekker paid, and the report matches
// the invoice that follows it. The margin only ever leaves the server for an
// admin asking for it by name.
const pool = require('../db/pool');
const { buildPDF } = require('../utils/pdf');
const { getThemeById, getDefaultTheme } = require('../utils/documentThemes');
const { findJobType } = require('../services/jobTypes');

const GST_RATE = 0.15;
const DEFAULT_MARKUP_PCT = 30;

const DEFAULT_BILLING_RATES = [
  { id: 'labour', label: 'Labour', rate: 95 },
  { id: 'travel', label: 'Travel', rate: 0 },
];

async function getBillingRates() {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key='billing_rates'`);
  const value = rows[0]?.value;
  return Array.isArray(value) && value.length ? value : DEFAULT_BILLING_RATES;
}

const rateOf = (entry, rates) => rates.find(r => r.id === entry.billing_rate_id) || null;

// The branding a job documents itself with. A job type carries the theme its
// quotes and invoices use, so the service report uses the same one and the
// customer gets three documents that look like they came from one company.
async function themeForJob(job) {
  const type = await findJobType(job.type);
  if (type?.theme_id) {
    const theme = await getThemeById(type.theme_id);
    if (theme) return theme;
  }
  return getDefaultTheme();
}

// The scope of works is rich text from the job description editor. The screen
// renders it as markup; the PDF needs it flattened — but flattened with its
// shape intact, since it is nearly always a list of what was agreed. The
// shared htmlToText collapses everything to one line, which would run eight
// bullet points together into a paragraph.
function scopeToText(html) {
  if (!html) return '';
  if (!/<\/?[a-z][^>]*>/i.test(html)) return String(html);
  return String(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '\u2022 ')
    .replace(/<\/(li|p|div|ul|ol|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n{3,} */g, '\n\n')
    .replace(/ *\n */g, '\n')
    .trim();
}

// Money is integer cents excluding GST everywhere in this app, and stays that
// way here — the rounding happens once, on each line, so the totals are the sum
// of what is printed rather than a number nobody can reproduce.
const centsFromRate = (hours, rate) => Math.round(hours * (parseFloat(rate) || 0) * 100);

async function buildReport(jobId) {
  const { rows: [job] } = await pool.query(
    `SELECT j.id, j.job_number, j.external_ref, j.description, j.status, j.type,
            j.site_address, j.created_at, j.service_report_token, j.service_report_markup_pct,
            c.name AS customer_name, c.company AS customer_company,
            c.email AS customer_email, c.phone AS customer_phone,
            c.address_street, c.address_city, c.address_region,
            c.address_postcode, c.address_country,
            s.address AS site_address_full, s.label AS site_label
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN customer_sites s ON s.id = j.site_id
      WHERE j.id = $1`,
    [jobId]
  );
  if (!job) return null;

  const [theme, rates, timeRes, costRes] = await Promise.all([
    themeForJob(job),
    getBillingRates(),
    pool.query(
      `SELECT t.id, t.date, t.hours, t.start_time, t.end_time, t.billing_rate_id, t.description,
              u.name AS user_name
         FROM timesheets t
         LEFT JOIN users u ON u.id = t.user_id
        WHERE t.job_id = $1
        ORDER BY t.date, t.start_time NULLS LAST, t.created_at`,
      [jobId]
    ),
    pool.query(
      `SELECT c.id, c.description, c.quantity, c.unit_price, c.created_at,
              s.supplier, s.invoice_date
         FROM job_costs c
         LEFT JOIN job_cost_scans s ON s.id = c.scan_id
        WHERE c.job_id = $1
        ORDER BY c.created_at, c.sort_order`,
      [jobId]
    ),
  ]);

  // ── Labour ────────────────────────────────────────────────────────────────
  // One line per entry, not per person: the times clocked in and out are the
  // point, and rolling a day up would throw them away.
  const labour = timeRes.rows.map(e => {
    const hours = parseFloat(e.hours) || 0;
    const rate = rateOf(e, rates);
    const hourlyRate = rate ? parseFloat(rate.rate) || 0 : 0;
    return {
      id: e.id,
      user_name: e.user_name || 'Unassigned',
      date: e.date,
      start_time: e.start_time,
      end_time: e.end_time,
      hours,
      // An entry with no rate chosen is still worked time: it shows, at nothing,
      // rather than quietly vanishing from the hours the customer is reading.
      rate_label: rate ? rate.label : 'Not yet rated',
      rate: hourlyRate,
      charge_cents: centsFromRate(hours, hourlyRate),
      note: e.description || null,
    };
  });

  // ── Materials ─────────────────────────────────────────────────────────────
  const markupPct = job.service_report_markup_pct == null
    ? DEFAULT_MARKUP_PCT
    : parseFloat(job.service_report_markup_pct) || 0;
  const markupFactor = 1 + markupPct / 100;

  const materials = costRes.rows.map(c => {
    const quantity = parseFloat(c.quantity) || 0;
    // A credit note is a negative line and stays negative all the way through,
    // so money coming back comes off what the customer owes.
    const unitChargeCents = Math.round(c.unit_price * markupFactor);
    return {
      id: c.id,
      description: c.description,
      supplier: c.supplier || null,
      date: c.invoice_date || c.created_at,
      quantity,
      unit_price_cents: unitChargeCents,
      total_cents: Math.round(unitChargeCents * quantity),
    };
  });

  const labourCents = labour.reduce((s, l) => s + l.charge_cents, 0);
  const materialsCents = materials.reduce((s, m) => s + m.total_cents, 0);
  const subtotalCents = labourCents + materialsCents;
  const gstCents = Math.round(subtotalCents * GST_RATE);

  return {
    job: {
      id: job.id,
      number: job.external_ref || (job.job_number ? `JB${String(job.job_number).padStart(5, '0')}` : null),
      status: job.status,
      type: job.type,
      // The job's own description is the scope of works. One field, written
      // once, rather than a second one to keep in step with it.
      scope: job.description || '',
      address: job.site_address_full || job.site_address || '',
      started_at: job.created_at,
    },
    customer: {
      name: job.customer_name || '',
      company: job.customer_company || '',
      email: job.customer_email || '',
      phone: job.customer_phone || '',
      address: [job.address_street, job.address_city, job.address_region,
                job.address_postcode, job.address_country].filter(Boolean).join(', '),
    },
    // The same block the public quote page draws its header from, so the two
    // documents carry one letterhead.
    company: {
      name: theme.companyName,
      logo: theme.logoBase64,
      logoSize: theme.logoSize,
      logoPosition: theme.logoPosition,
      contactPosition: theme.contactPosition,
      contactDetails: theme.contactDetails,
      gstNumber: theme.gstNumber || '',
      brandColour: theme.brandColour,
    },
    // Kept out of the body the client renders: the PDF builder wants the whole
    // theme, and the logo alone is a large string nobody on screen needs twice.
    _theme: theme,
    labour,
    materials,
    markup_pct: markupPct,
    totals: {
      labour_hours: Math.round(labour.reduce((s, l) => s + l.hours, 0) * 100) / 100,
      labour_cents: labourCents,
      materials_cents: materialsCents,
      subtotal_cents: subtotalCents,
      gst_cents: gstCents,
      total_cents: subtotalCents + gstCents,
    },
    generated_at: new Date().toISOString(),
  };
}

// What it cost Dekker, against what it is being charged at. Admin only, and
// never part of the report body itself — it is assembled separately so there is
// no path by which it can reach the public page.
async function buildMargin(jobId, report) {
  const [{ rows: costRows }, { rows: timeRows }] = await Promise.all([
    pool.query('SELECT quantity, unit_price FROM job_costs WHERE job_id = $1', [jobId]),
    pool.query(
      `SELECT t.hours, u.cost_rate FROM timesheets t
       LEFT JOIN users u ON u.id = t.user_id WHERE t.job_id = $1`,
      [jobId]
    ),
  ]);
  const materialsCost = costRows.reduce(
    (s, c) => s + Math.round(c.unit_price * (parseFloat(c.quantity) || 0)), 0);
  const labourCost = timeRows.reduce(
    (s, t) => s + centsFromRate(parseFloat(t.hours) || 0, t.cost_rate || 0), 0);
  const cost = materialsCost + labourCost;
  const profit = report.totals.subtotal_cents - cost;
  return {
    materials_cost_cents: materialsCost,
    labour_cost_cents: labourCost,
    cost_cents: cost,
    gross_profit_cents: profit,
    margin_pct: report.totals.subtotal_cents > 0
      ? Math.round((profit / report.totals.subtotal_cents) * 10000) / 100
      : null,
    // Named rather than implied: someone with no cost rate on their user record
    // costs nothing, which flatters the margin until it is said out loud.
    missing_cost_rate: timeRows.some(t => !t.cost_rate),
  };
}

// ── The internal view ────────────────────────────────────────────────────────

async function get(req, res) {
  try {
    const report = await buildReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Job not found' });
    const { rows: [j] } = await pool.query(
      'SELECT service_report_token FROM jobs WHERE id = $1', [req.params.id]);
    const { _theme, ...rest } = report;
    const body = {
      ...rest,
      share_token: j.service_report_token,
      share_path: j.service_report_token ? `/sr/${j.service_report_token}` : null,
    };
    if (req.user.role === 'admin') body.margin = await buildMargin(req.params.id, report);
    res.json(body);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

// Sharing is deliberate: a token is only minted when someone asks for a link.
async function share(req, res) {
  try {
    const { rows } = await pool.query(
      `UPDATE jobs
          SET service_report_token = COALESCE(service_report_token, gen_random_uuid())
        WHERE id = $1
        RETURNING service_report_token`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
    res.json({
      share_token: rows[0].service_report_token,
      share_path: `/sr/${rows[0].service_report_token}`,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

// Revoking mints nothing: the old link stops working immediately, and sharing
// again later produces a new one rather than reviving the one that was pulled.
async function unshare(req, res) {
  try {
    const { rowCount } = await pool.query(
      'UPDATE jobs SET service_report_token = NULL WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Job not found' });
    res.json({ share_token: null, share_path: null });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function setMarkup(req, res) {
  const raw = req.body?.markup_pct;
  const pct = raw === null || raw === '' ? null : Number(raw);
  if (pct !== null && (!Number.isFinite(pct) || pct < -100 || pct > 1000)) {
    return res.status(400).json({ error: 'Markup must be a percentage between -100 and 1000' });
  }
  try {
    const { rowCount } = await pool.query(
      'UPDATE jobs SET service_report_markup_pct = $1 WHERE id = $2', [pct, req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Job not found' });
    res.json({ markup_pct: pct == null ? DEFAULT_MARKUP_PCT : pct, is_default: pct == null });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

// ── The customer's copy ──────────────────────────────────────────────────────

async function publicGet(req, res) {
  try {
    const { rows: [j] } = await pool.query(
      'SELECT id FROM jobs WHERE service_report_token = $1', [req.params.token]);
    // The same 404 whether the link never existed or has been revoked — there
    // is nothing to be learned by guessing tokens.
    if (!j) return res.status(404).json({ error: 'This report is no longer available' });
    const report = await buildReport(j.id);
    const { _theme, ...rest } = report;
    res.json(rest);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

// ── The PDF ──────────────────────────────────────────────────────────────────
//
// Built through the same branded document builder the quotes and invoices use,
// so it arrives looking like everything else the customer has had. Labour and
// materials become one table with a heading row for each, since that is what
// the builder draws and what an invoice looks like.
async function renderPdf(report) {
  const theme = report._theme || await getDefaultTheme();
  const items = [];

  const fmtDate = d => (d
    ? new Date(d).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
    : '');
  const fmtTime = t => (t
    ? new Date(t).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '')
    : null);

  if (report.labour.length) {
    items.push({ description: 'LABOUR', quantity: '', unit_price: 0, _heading: true });
    for (const l of report.labour) {
      const span = fmtTime(l.start_time) && fmtTime(l.end_time)
        ? `${fmtTime(l.start_time)}–${fmtTime(l.end_time)}`
        : 'hours logged';
      items.push({
        description: `${l.user_name} · ${fmtDate(l.date)} · ${span} · ${l.rate_label}`,
        quantity: l.hours,
        unit_price: Math.round(l.rate * 100),
      });
    }
  }

  if (report.materials.length) {
    items.push({ description: 'MATERIALS', quantity: '', unit_price: 0, _heading: true });
    for (const m of report.materials) {
      items.push({
        description: m.supplier ? `${m.description} (${m.supplier})` : m.description,
        quantity: m.quantity,
        unit_price: m.unit_price_cents,
      });
    }
  }

  return buildPDF({
    type: 'Service Report',
    // The badge the invoice layout draws: this is a live document, and saying
    // so on the page is better than leaving a blank box or a stale status.
    status: 'live',
    number: report.job.number || 'Service Report',
    customer: {
      name: report.customer.name, company: report.customer.company,
      email: report.customer.email, phone: report.customer.phone,
      address: report.job.address,
    },
    jobNumber: report.job.number || '', jobAddress: report.job.address,
    items,
    subtotal: report.totals.subtotal_cents,
    gst: report.totals.gst_cents,
    total: report.totals.total_cents,
    notes: report.job.scope ? `SCOPE OF WORKS\n${scopeToText(report.job.scope)}` : '',
    paymentTerms: theme.paymentTerms || '',
    terms: '',
    issuedAt: report.generated_at,
    theme,
  });
}

function pdfFilename(report) {
  return `service-report-${(report.job.number || 'job').toLowerCase()}.pdf`;
}

async function downloadPdf(req, res) {
  try {
    const report = await buildReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Job not found' });
    const pdf = await renderPdf(report);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdfFilename(report)}"`,
    });
    res.send(pdf);
  } catch (err) { console.error(err); res.status(500).json({ error: 'PDF generation failed' }); }
}

async function publicPdf(req, res) {
  try {
    const { rows: [j] } = await pool.query(
      'SELECT id FROM jobs WHERE service_report_token = $1', [req.params.token]);
    if (!j) return res.status(404).json({ error: 'This report is no longer available' });
    const report = await buildReport(j.id);
    const pdf = await renderPdf(report);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdfFilename(report)}"`,
    });
    res.send(pdf);
  } catch (err) { console.error(err); res.status(500).json({ error: 'PDF generation failed' }); }
}

module.exports = {
  get, share, unshare, setMarkup, downloadPdf, publicGet, publicPdf,
  buildReport, buildMargin, DEFAULT_MARKUP_PCT,
};
