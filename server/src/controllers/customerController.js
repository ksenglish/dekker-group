const pool = require('../db/pool');

const FIELDS = 'name, company, contact_name, phone, mobile, email, lead_source, address_street, address_city, address_region, address_postcode, address_country';

function addressLine(c) {
  return [c.address_street, c.address_city, c.address_region, c.address_postcode].filter(Boolean).join(', ');
}

// Keep the customer's default site address matching their own address, so
// editing a customer's address updates the site that jobs default to. Other
// sites are left alone — users can still pick those when creating a job.
async function syncPrimarySite(customer) {
  const addr = addressLine(customer);
  if (!addr) return; // address cleared — leave any existing site as-is rather than blanking it
  const { rowCount } = await pool.query(
    'UPDATE customer_sites SET address=$1 WHERE customer_id=$2 AND is_primary',
    [addr, customer.id]
  );
  // No default site yet (customer created without an address, or their only
  // sites were added manually) — create one now.
  if (rowCount === 0) {
    await pool.query(
      'INSERT INTO customer_sites (customer_id, address, label, is_primary) VALUES ($1, $2, $3, true)',
      [customer.id, addr, 'Primary']
    );
  }
}

async function list(req, res) {
  const { search = '', page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.company, c.contact_name, c.phone, c.mobile, c.email,
              c.lead_source, c.address_street, c.address_city, c.address_region,
              c.address_postcode, c.address_country, c.created_at,
              COUNT(DISTINCT j.id) AS job_count,
              COUNT(DISTINCT s.id) AS site_count
       FROM customers c
       LEFT JOIN jobs j ON j.customer_id = c.id
       LEFT JOIN customer_sites s ON s.customer_id = c.id
       WHERE c.name ILIKE $1 OR c.company ILIKE $1 OR c.email ILIKE $1
          OR c.phone ILIKE $1 OR c.mobile ILIKE $1 OR c.address_street ILIKE $1
       GROUP BY c.id
       ORDER BY c.name
       LIMIT $2 OFFSET $3`,
      [`%${search}%`, limit, offset]
    );
    const total = await pool.query(
      `SELECT COUNT(*) FROM customers
       WHERE name ILIKE $1 OR company ILIKE $1 OR email ILIKE $1
          OR phone ILIKE $1 OR mobile ILIKE $1 OR address_street ILIKE $1`,
      [`%${search}%`]
    );
    res.json({ customers: rows, total: parseInt(total.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function get(req, res) {
  try {
    const { rows } = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Customer not found' });
    const sites = await pool.query('SELECT * FROM customer_sites WHERE customer_id = $1 ORDER BY label', [req.params.id]);
    const jobs = await pool.query(
      `SELECT j.id, j.job_number, j.external_ref, j.type, j.status, j.priority, j.due_date, j.description,
              u.name AS lead_tech_name
       FROM jobs j LEFT JOIN users u ON u.id = j.lead_tech_id
       WHERE j.customer_id = $1 ORDER BY j.created_at DESC LIMIT 20`,
      [req.params.id]
    );
    // Alternative details picked up when a lead was merged in — a second name
    // on the account, a partner's mobile, a different site address.
    const contacts = await pool.query(
      `SELECT cc.*, u.name AS created_by_name
       FROM customer_contacts cc LEFT JOIN users u ON u.id = cc.created_by
       WHERE cc.customer_id = $1 ORDER BY cc.created_at DESC`,
      [req.params.id]
    );
    res.json({ ...rows[0], sites: sites.rows, recent_jobs: jobs.rows, contacts: contacts.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function create(req, res) {
  const { name, company, contact_name, phone, mobile, email, lead_source,
          address_street, address_city, address_region, address_postcode, address_country } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO customers (name, company, contact_name, phone, mobile, email, lead_source,
         address_street, address_city, address_region, address_postcode, address_country)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [name, company || null, contact_name || null, phone || null, mobile || null,
       email || null, lead_source || null,
       address_street || null, address_city || null, address_region || null,
       address_postcode || null, address_country || 'New Zealand']
    );
    // Auto-create the default site from the customer's own address. It stays
    // in sync with that address on every later update (see syncPrimarySite).
    if (address_street) {
      await pool.query(
        'INSERT INTO customer_sites (customer_id, address, label, is_primary) VALUES ($1, $2, $3, true)',
        [rows[0].id, addressLine(rows[0]), 'Primary']
      );
    }
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function update(req, res) {
  const { name, company, contact_name, phone, mobile, email, lead_source,
          address_street, address_city, address_region, address_postcode, address_country } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE customers SET name=$1, company=$2, contact_name=$3, phone=$4, mobile=$5,
         email=$6, lead_source=$7, address_street=$8, address_city=$9,
         address_region=$10, address_postcode=$11, address_country=$12, updated_at=NOW()
       WHERE id=$13 RETURNING *`,
      [name, company || null, contact_name || null, phone || null, mobile || null,
       email || null, lead_source || null,
       address_street || null, address_city || null, address_region || null,
       address_postcode || null, address_country || 'New Zealand', req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Customer not found' });
    await syncPrimarySite(rows[0]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function remove(req, res) {
  try {
    await pool.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
    res.json({ message: 'Customer deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function listSites(req, res) {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM customer_sites WHERE customer_id = $1 ORDER BY is_primary DESC, label',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function createSite(req, res) {
  const { address, label } = req.body;
  if (!address) return res.status(400).json({ error: 'Address is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO customer_sites (customer_id, address, label) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, address, label || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function updateSite(req, res) {
  const { address, label } = req.body;
  if (!address?.trim()) return res.status(400).json({ error: 'Address is required' });
  try {
    const { rows: [existing] } = await pool.query(
      'SELECT * FROM customer_sites WHERE id=$1 AND customer_id=$2',
      [req.params.siteId, req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Site not found' });
    // The default site mirrors the customer's own address — editing it here
    // would just be overwritten the next time the customer is saved.
    if (existing.is_primary && address.trim() !== existing.address) {
      return res.status(400).json({
        error: "This is the customer's default site — edit the customer's address to change it.",
      });
    }
    const { rows } = await pool.query(
      'UPDATE customer_sites SET address=$1, label=$2 WHERE id=$3 AND customer_id=$4 RETURNING *',
      [address.trim(), label || null, req.params.siteId, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function deleteSite(req, res) {
  try {
    const { rows: [site] } = await pool.query(
      'SELECT * FROM customer_sites WHERE id=$1 AND customer_id=$2',
      [req.params.siteId, req.params.id]
    );
    if (!site) return res.status(404).json({ error: 'Site not found' });
    if (site.is_primary) {
      return res.status(400).json({
        error: "The customer's default site can't be deleted — it follows their address.",
      });
    }
    // jobs.site_id has no ON DELETE rule, so deleting a site still in use
    // would fail as a raw FK violation. Check first and explain instead.
    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*) FROM jobs WHERE site_id=$1', [req.params.siteId]
    );
    if (parseInt(count) > 0) {
      return res.status(400).json({
        error: `This site is used by ${count} job${count === '1' ? '' : 's'} — reassign ${count === '1' ? 'it' : 'them'} to another site first.`,
      });
    }
    await pool.query('DELETE FROM customer_sites WHERE id=$1 AND customer_id=$2', [req.params.siteId, req.params.id]);
    res.json({ message: 'Site deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function listNotes(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT n.*, u.name AS author_name FROM customer_notes n
       JOIN users u ON u.id = n.user_id
       WHERE n.customer_id = $1 ORDER BY n.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

async function createNote(req, res) {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Note content is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO customer_notes (customer_id, user_id, content) VALUES ($1, $2, $3)
       RETURNING id, customer_id, user_id, content, created_at`,
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
    await pool.query('DELETE FROM customer_notes WHERE id=$1 AND customer_id=$2', [req.params.noteId, req.params.id]);
    res.json({ message: 'Note deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

// Maps Tradify CSV column names → our field names
function mapTradifyRow(row) {
  // Support both Tradify exports and our own simple format
  const g = (keys) => {
    for (const k of keys) {
      const v = row[k] || row[k.toLowerCase()] || row[k.replace(/ /g,'_').toLowerCase()];
      if (v) return v.trim();
    }
    return '';
  };
  const street   = g(['Physical Address Street', 'address_street', 'address', 'street']);
  const city     = g(['Physical Address City', 'address_city', 'city']);
  const region   = g(['Physical Address Region', 'address_region', 'region']);
  const postcode = g(['Physical Address Postal Code', 'address_postcode', 'postcode', 'postal_code']);
  const country  = g(['Physical Address Country', 'address_country', 'country']) || 'New Zealand';
  const custName = g(['Customer Name', 'name']);
  const contactName = g(['Contact Name', 'contact_name']);
  return {
    name:            custName,
    contact_name:    contactName && contactName !== custName ? contactName : null,
    phone:           g(['Phone Number', 'phone']),
    mobile:          g(['Mobile Number', 'mobile']),
    email:           g(['Email Address', 'email']),
    lead_source:     g(['Lead Source', 'lead_source']),
    address_street:  street,
    address_city:    city,
    address_region:  region,
    address_postcode: postcode,
    address_country: country,
  };
}

async function importCsv(req, res) {
  const { rows: csvRows } = req.body;
  if (!Array.isArray(csvRows) || csvRows.length === 0) {
    return res.status(400).json({ error: 'No data provided' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let imported = 0;
    for (const rawRow of csvRows) {
      const r = mapTradifyRow(rawRow);
      if (!r.name) continue;
      const { rows } = await client.query(
        `INSERT INTO customers (name, company, contact_name, phone, mobile, email, lead_source,
           address_street, address_city, address_region, address_postcode, address_country)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT DO NOTHING RETURNING id, address_street, address_city, address_region, address_postcode`,
        [r.name, rawRow.company || rawRow.Company || null, r.contact_name,
         r.phone || null, r.mobile || null, r.email || null, r.lead_source || null,
         r.address_street || null, r.address_city || null, r.address_region || null,
         r.address_postcode || null, r.address_country]
      );
      if (rows[0] && r.address_street) {
        const addr = [r.address_street, r.address_city, r.address_region, r.address_postcode].filter(Boolean).join(', ');
        await client.query(
          'INSERT INTO customer_sites (customer_id, address, label, is_primary) VALUES ($1, $2, $3, true)',
          [rows[0].id, addr, 'Primary']
        );
      }
      imported++;
    }
    await client.query('COMMIT');
    res.json({ imported });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  } finally {
    client.release();
  }
}

const DEFAULT_LEAD_SOURCES = [
  'Inbound Web Lead', 'Referral', 'Google', 'Facebook', 'Instagram',
  'Flyer / Letterbox', 'Repeat Customer', 'Tradify Import', 'Other',
];

async function getLeadSources(req, res) {
  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key='lead_sources'`);
    const custom = rows[0]?.value || [];
    const all = [...new Set([...DEFAULT_LEAD_SOURCES, ...custom])];
    res.json(all);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function addLeadSource(req, res) {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key='lead_sources'`);
    const current = rows[0]?.value || [];
    const trimmed = name.trim();
    if ([...DEFAULT_LEAD_SOURCES, ...current].includes(trimmed)) {
      return res.json([...new Set([...DEFAULT_LEAD_SOURCES, ...current])]);
    }
    const updated = [...current, trimmed];
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('lead_sources', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
      [JSON.stringify(updated)]
    );
    res.json([...new Set([...DEFAULT_LEAD_SOURCES, ...updated])]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

// Every table that points at a customer. Enumerated rather than discovered at
// runtime so a new one has to be added here deliberately — a table missed by a
// merge would orphan its rows against a customer that no longer exists.
const CUSTOMER_REFERENCES = [
  { table: 'jobs',              column: 'customer_id', label: 'jobs' },
  { table: 'quotes',            column: 'customer_id', label: 'quotes' },
  { table: 'invoices',          column: 'customer_id', label: 'invoices' },
  { table: 'customer_sites',    column: 'customer_id', label: 'sites' },
  { table: 'customer_notes',    column: 'customer_id', label: 'notes' },
  { table: 'customer_contacts', column: 'customer_id', label: 'contacts' },
  { table: 'email_log',         column: 'customer_id', label: 'emails' },
  { table: 'leads',             column: 'customer_id', label: 'leads' },
];

const digitsOnly = v => String(v ?? '').replace(/\D/g, '');
const sameText = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const addressOf = r => [r.address_street, r.address_city, r.address_postcode]
  .filter(v => v && String(v).trim()).join(', ');

// Fold one customer into another: all history moves across, the surviving
// record keeps its own details, and anything that disagreed is preserved as a
// secondary contact rather than lost. The absorbed record is then removed —
// leaving it behind is what created the confusion this fixes.
//
// :id survives. The customer named in the body is the one absorbed.
async function merge(req, res) {
  const targetId = req.params.id;
  const sourceId = req.body?.merge_id;
  if (!sourceId) return res.status(400).json({ error: 'Choose a customer to merge in' });
  if (sourceId === targetId) return res.status(400).json({ error: 'A customer cannot be merged into itself' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Locked in a stable order so two merges running at once can't deadlock.
    const { rows: both } = await client.query(
      'SELECT * FROM customers WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [[targetId, sourceId]]
    );
    const target = both.find(c => c.id === targetId);
    const source = both.find(c => c.id === sourceId);
    if (!target || !source) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Sites move rather than being merged or de-duplicated: jobs point at a
    // site by id, so removing one as a duplicate would break those jobs.
    const moved = {};
    for (const ref of CUSTOMER_REFERENCES) {
      const { rowCount } = await client.query(
        `UPDATE ${ref.table} SET ${ref.column} = $1 WHERE ${ref.column} = $2`,
        [targetId, sourceId]
      );
      if (rowCount > 0) moved[ref.label] = rowCount;
    }

    // Blanks on the survivor are filled from the absorbed record — new
    // information, nothing overwritten.
    await client.query(
      `UPDATE customers SET
         contact_name = COALESCE(NULLIF(contact_name,''), $2),
         company      = COALESCE(NULLIF(company,''), $3),
         email        = COALESCE(NULLIF(email,''), $4),
         mobile       = COALESCE(NULLIF(mobile,''), $5),
         phone        = COALESCE(NULLIF(phone,''), $6),
         lead_source  = COALESCE(NULLIF(lead_source,''), $7),
         address_street   = COALESCE(NULLIF(address_street,''), $8),
         address_city     = COALESCE(NULLIF(address_city,''), $9),
         address_region   = COALESCE(NULLIF(address_region,''), $10),
         address_postcode = COALESCE(NULLIF(address_postcode,''), $11),
         xero_contact_id  = COALESCE(xero_contact_id, $12),
         updated_at = NOW()
       WHERE id = $1`,
      [targetId, source.contact_name, source.company, source.email, source.mobile,
       source.phone, source.lead_source, source.address_street, source.address_city,
       source.address_region, source.address_postcode, source.xero_contact_id]
    );

    // Compared against the survivor as it was before that fill, so a field we
    // have only just populated isn't reported as disagreeing with itself.
    const conflict = (a, b, same = sameText) =>
      a && String(a).trim() && b && String(b).trim() && !same(a, b) ? String(a).trim() : null;
    const secondary = {
      name:    conflict(source.contact_name || source.name, target.contact_name || target.name),
      mobile:  conflict(source.mobile, target.mobile, (x, y) => digitsOnly(x) === digitsOnly(y)),
      phone:   conflict(source.phone, target.phone, (x, y) => digitsOnly(x) === digitsOnly(y)),
      email:   conflict(source.email, target.email),
      address: conflict(addressOf(source), addressOf(target)),
    };
    let secondaryContactId = null;
    if (Object.values(secondary).some(Boolean)) {
      const { rows: [contact] } = await client.query(
        `INSERT INTO customer_contacts (customer_id, name, mobile, phone, email, address, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [targetId, secondary.name, secondary.mobile, secondary.phone, secondary.email,
         secondary.address, `Merged from "${source.name}"`, req.user.id]
      );
      secondaryContactId = contact.id;
    }

    // Safe now that nothing points at it — every reference was reassigned above.
    await client.query('DELETE FROM customers WHERE id = $1', [sourceId]);
    await client.query('COMMIT');

    res.json({
      customer_id: targetId,
      merged_name: source.name,
      moved,
      secondary_contact_id: secondaryContactId,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[customer] merge failed:', err);
    res.status(500).json({ error: `Could not merge: ${err.message}` });
  } finally {
    client.release();
  }
}

module.exports = { list, get, create, update, remove, listSites, createSite, updateSite, deleteSite, listNotes, createNote, deleteNote, importCsv, getLeadSources, addLeadSource, merge };
