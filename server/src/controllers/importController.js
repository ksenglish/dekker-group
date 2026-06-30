const pool = require('../db/pool');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

// ── CSV parser ──────────────────────────────────────────────────────────────
// Tradify exports contain quoted fields that span multiple lines (notes,
// schedules, team members), so a naive split('\n') won't work. This parses
// RFC-4180 style CSV: double quotes wrap fields, "" is an escaped quote.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  // Normalise line endings
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }   // escaped quote
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  // Flush trailing field/row
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const clean = v => (v == null ? '' : String(v).trim());
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function nameFromEmail(email) {
  const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  return local.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || email;
}

function slugEmail(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'team-member'}@imported.dekkergroup.local`;
}

// "30/06/2026 11:01" or "29/06/2026 9:40" → Date (DD/MM/YYYY H:mm)
function parseEnteredOn(str) {
  const m = clean(str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, d, mo, y, h, mi] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  return isNaN(date) ? null : date;
}

// Map a Tradify status string to one of our app job statuses
function mapStatus(s) {
  const t = clean(s).toLowerCase();
  if (/cancel|declined|lost|dead/.test(t)) return 'cancelled';
  if (/complete|completed|finished|paid|won/.test(t)) return 'complete';
  if (/invoice/.test(t)) return 'invoiced';
  if (/in[\s-]?progress|sale/.test(t)) return 'in_progress';
  if (/schedul/.test(t)) return 'scheduled';
  if (/quote/.test(t)) return 'quoted';
  return 'new';
}

// Derive a job type from the Tradify status (e.g. "Scheduled - Installation")
function deriveType(status) {
  const t = clean(status);
  const dash = t.indexOf(' - ');
  if (dash > -1) {
    const suffix = t.slice(dash + 3).replace(/-/g, ' ').trim();
    if (suffix) return suffix;
  }
  return 'Installation';
}

// Parse one schedule line:
// "Kyle English - 2026-07-15 09:00 to 2026-07-15 13:30"
// "Michelle Wijlens - 2026-07-01 09:15"
function parseScheduleLine(line) {
  const m = clean(line).match(
    /^(.+?)\s*-\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})(?:\s+to\s+(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}))?/
  );
  if (!m) return null;
  const [, who, date, start, , end] = m;
  return {
    who: clean(who),
    date,
    start: start.padStart(5, '0'),
    end: end ? end.padStart(5, '0') : null,
  };
}

// ── Main import ─────────────────────────────────────────────────────────────
async function importTradify(req, res) {
  const text = req.body.csv;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'No CSV content provided' });
  }

  const rows = parseCsv(text);
  if (rows.length < 2) {
    return res.status(400).json({ error: 'CSV is empty or missing data rows' });
  }

  // Build header index (case-insensitive, trimmed)
  const headers = rows[0].map(h => clean(h).toLowerCase());
  const col = (...names) => {
    for (const n of names) {
      const i = headers.indexOf(n.toLowerCase());
      if (i > -1) return i;
    }
    return -1;
  };
  const idx = {
    jobNumber:  col('job number'),
    customer:   col('customer'),
    email:      col('customer email address(es)', 'customer email address', 'customer email'),
    status:     col('status'),
    address:    col('job address'),
    lat:        col('latitude'),
    lng:        col('longitude'),
    placeId:    col('place id'),
    description:col('description'),
    contact:    col('job contact'),
    phone:      col('job contact phone'),
    mobile:     col('job contact mobile'),
    team:       col('team members'),
    schedule:   col('schedule'),
    notes:      col('notes'),
    time:       col('time'),
    materials:  col('materials'),
    enteredBy:  col('entered by'),
    enteredOn:  col('entered on'),
  };
  if (idx.jobNumber === -1) {
    return res.status(400).json({ error: 'CSV must include a "Job Number" column — is this a Tradify Jobs export?' });
  }

  const result = {
    jobsImported: 0, jobsSkipped: 0, customersCreated: 0,
    usersCreated: 0, schedulesCreated: 0, techsLinked: 0, errors: [],
  };

  const client = await pool.connect();
  // Caches keyed by lowercased token, valid for this import run
  const userCache = new Map();      // token -> user id
  const customerCache = new Map();  // name|email -> customer id
  const placeholderHash = await bcrypt.hash(randomUUID(), 10);

  // Resolve a team-member token (name or email) to a user id, creating an
  // inactive 'undefined' placeholder account when we don't already have them.
  async function resolveUser(token) {
    const key = clean(token).toLowerCase();
    if (!key) return null;
    if (userCache.has(key)) return userCache.get(key);

    let userId = null;
    if (isEmail(key)) {
      const { rows: found } = await client.query('SELECT id FROM users WHERE LOWER(email)=$1', [key]);
      if (found[0]) userId = found[0].id;
      else {
        const { rows: created } = await client.query(
          `INSERT INTO users (name, email, password_hash, role, is_active)
           VALUES ($1,$2,$3,'undefined',false) RETURNING id`,
          [nameFromEmail(key), key, placeholderHash]
        );
        userId = created[0].id; result.usersCreated++;
      }
    } else {
      // Match an existing user by name (real staff like Kyle English, etc.)
      const { rows: found } = await client.query('SELECT id FROM users WHERE LOWER(name)=$1', [key]);
      if (found[0]) userId = found[0].id;
      else {
        const email = slugEmail(token);
        const { rows: created } = await client.query(
          `INSERT INTO users (name, email, password_hash, role, is_active)
           VALUES ($1,$2,$3,'undefined',false)
           ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id`,
          [clean(token), email, placeholderHash]
        );
        userId = created[0].id; result.usersCreated++;
      }
    }
    userCache.set(key, userId);
    return userId;
  }

  async function resolveCustomer(name, email, contact, phone, mobile) {
    const cname = clean(name);
    if (!cname) return null;
    const key = `${cname.toLowerCase()}|${clean(email).toLowerCase()}`;
    if (customerCache.has(key)) return customerCache.get(key);

    const { rows: found } = await client.query(
      'SELECT id FROM customers WHERE LOWER(name)=$1 LIMIT 1', [cname.toLowerCase()]
    );
    let customerId;
    if (found[0]) {
      customerId = found[0].id;
    } else {
      const { rows: created } = await client.query(
        `INSERT INTO customers (name, email, phone, mobile, contact_name)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [cname, clean(email) || null, clean(phone) || null, clean(mobile) || null, clean(contact) || null]
      );
      customerId = created[0].id; result.customersCreated++;
    }
    customerCache.set(key, customerId);
    return customerId;
  }

  try {
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const get = i => (i > -1 ? clean(row[i]) : '');
      const jobRef = get(idx.jobNumber);
      if (!jobRef) continue; // skip blank lines

      try {
        await client.query('BEGIN');

        const customerId = await resolveCustomer(
          get(idx.customer), get(idx.email), get(idx.contact), get(idx.phone), get(idx.mobile)
        );

        // Create a site for the job address so it shows on the map / job detail
        let siteId = null;
        const address = get(idx.address);
        if (customerId && address) {
          const lat = parseFloat(get(idx.lat));
          const lng = parseFloat(get(idx.lng));
          const { rows: site } = await client.query(
            `INSERT INTO customer_sites (customer_id, address, lat, lng)
             VALUES ($1,$2,$3,$4) RETURNING id`,
            [customerId, address, isNaN(lat) ? null : lat, isNaN(lng) ? null : lng]
          );
          siteId = site[0].id;
        }

        const status = mapStatus(get(idx.status));
        const enteredOn = parseEnteredOn(get(idx.enteredOn));
        const lat = parseFloat(get(idx.lat));
        const lng = parseFloat(get(idx.lng));

        const { rows: jobRows } = await client.query(
          `INSERT INTO jobs
             (customer_id, site_id, type, description, status, priority,
              external_ref, external_status, place_id, job_contact, job_contact_phone, job_contact_mobile,
              materials, time_log, source, entered_by, entered_on, imported_at,
              site_address, site_lat, site_lng, created_at)
           VALUES ($1,$2,$3,$4,$5,'medium',
              $6,$7,$8,$9,$10,$11,
              $12,$13,'tradify',$14,$15,NOW(),
              $16,$17,$18, COALESCE($15, NOW()))
           ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL DO NOTHING
           RETURNING id`,
          [
            customerId, siteId, deriveType(get(idx.status)), get(idx.description) || null, status,
            jobRef, get(idx.status) || null, get(idx.placeId) || null,
            get(idx.contact) || null, get(idx.phone) || null, get(idx.mobile) || null,
            get(idx.materials) || null, get(idx.time) || null,
            get(idx.enteredBy) || null, enteredOn,
            address || null, isNaN(lat) ? null : lat, isNaN(lng) ? null : lng,
          ]
        );

        if (!jobRows[0]) {
          // Already imported previously — skip (and roll back the site we just made)
          await client.query('ROLLBACK');
          result.jobsSkipped++;
          continue;
        }
        const jobId = jobRows[0].id;

        // Team members → job_technicians
        const teamTokens = get(idx.team).split('\n').map(clean).filter(Boolean);
        for (const tok of teamTokens) {
          const uid = await resolveUser(tok);
          if (!uid) continue;
          const { rowCount } = await client.query(
            'INSERT INTO job_technicians (job_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [jobId, uid]
          );
          if (rowCount) result.techsLinked++;
        }
        // Set lead_tech_id to the first team member for legacy displays
        if (teamTokens[0]) {
          const leadId = userCache.get(teamTokens[0].toLowerCase());
          if (leadId) await client.query('UPDATE jobs SET lead_tech_id=$1 WHERE id=$2', [leadId, jobId]);
        }

        // Schedule lines → schedules (so they show in the scheduler)
        const schedLines = get(idx.schedule).split('\n').map(clean).filter(Boolean);
        for (const line of schedLines) {
          const sched = parseScheduleLine(line);
          if (!sched) continue;
          const uid = await resolveUser(sched.who);
          if (!uid) continue;
          await client.query(
            `INSERT INTO schedules (job_id, user_id, scheduled_date, start_time, end_time)
             VALUES ($1,$2,$3,$4,$5)`,
            [jobId, uid, sched.date, sched.start || null, sched.end || null]
          );
          // Anyone scheduled should also be a team member on the job
          await client.query(
            'INSERT INTO job_technicians (job_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [jobId, uid]
          );
          result.schedulesCreated++;
        }

        // Notes → a single job note authored by the importing admin (kept verbatim)
        const notes = get(idx.notes);
        if (notes) {
          await client.query(
            `INSERT INTO job_notes (job_id, user_id, content) VALUES ($1,$2,$3)`,
            [jobId, req.user.id, `Imported from Tradify:\n\n${notes}`]
          );
        }

        await client.query('COMMIT');
        result.jobsImported++;
      } catch (rowErr) {
        await client.query('ROLLBACK').catch(() => {});
        result.errors.push(`Job ${jobRef}: ${rowErr.message}`);
      }
    }

    res.json(result);
  } catch (err) {
    console.error('Tradify import failed:', err);
    res.status(500).json({ error: err.message || 'Import failed', ...result });
  } finally {
    client.release();
  }
}

module.exports = { importTradify };
