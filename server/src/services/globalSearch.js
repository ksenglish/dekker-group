// One search box over the whole app: a customer, a job, a quote, an invoice,
// a day's work.
//
// Written for somebody talking to their phone in a ute, which is a harder
// problem than typing. Speech arrives as a sentence, not a search term —
// "show me the Hulley job", "open quote three seven seven" — and the number
// comes back spelled however the phone felt like spelling it. So the query is
// cleaned up first: the asking words come off the front, the kind of thing
// being looked for is noticed and used to sort, and anything that could be a
// reference number is pulled out and matched as a number as well as text.
const pool = require('../db/pool');
const { can } = require('../utils/permissions');

// What people say before the thing they actually want.
const ASKING = /^(?:ok(?:ay)?|hey|please|can you|could you|i want to|i need to|let's|lets)?\s*(?:show|find|open|go|jump|take|bring|search|look)?\s*(?:me|to|up|for|at|me to)?\s+/i;

// The words for each kind of thing, so "the Hulley job" ranks jobs first and
// "Hulley invoice" ranks invoices first. The word is then dropped, because it
// is not part of the name being looked for.
const KINDS = [
  ['customers', /\b(customer|client|account|contact)s?\b/i],
  ['jobs', /\b(job|site|work)s?\b/i],
  ['quotes', /\b(quote|quotation|estimate)s?\b/i],
  ['invoices', /\b(invoice|bill)s?\b/i],
  ['appointments', /\b(appointment|booking|schedule|diary|visit|install(?:ation)?)s?\b/i],
];

// Speech sometimes writes a reference out in words. Single digits only, since
// that is how a number is read aloud to somebody — "three seven seven", not
// "three hundred and seventy seven". Deliberately not "twenty": "twenty three"
// would come out as 203, and a phone transcribes that as "23" anyway.
const DIGITS = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};
// A run of two or more of them together, and nothing else.
const SPOKEN_NUMBER = new RegExp(
  `\\b(?:${Object.keys(DIGITS).join('|')})(?:\\s+(?:${Object.keys(DIGITS).join('|')}))+\\b`, 'gi');

// What was asked for, pulled apart into the bits a query can use.
function parse(raw) {
  let text = String(raw || '').trim().replace(ASKING, '').trim();

  // "job number one six four six" → "job number 1646". A run of two or more,
  // so "one off repair" and a customer called Seven keep their meaning.
  text = text.replace(SPOKEN_NUMBER,
    phrase => phrase.split(/\s+/).map(w => DIGITS[w.toLowerCase()]).join(''));

  let kind = null;
  for (const [name, re] of KINDS) {
    if (re.test(text)) {
      kind = kind || name;
      text = text.replace(re, ' ');
    }
  }

  // "number", "no", "#" sit between the word and the digits and mean nothing.
  text = text.replace(/\b(number|no\.?|#)\b/gi, ' ')
    .replace(/\bthe\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?!,]+$/, '');

  // A reference, however it was written: JB01646, jb 1646, QT-0377, or just
  // the digits on their own.
  const ref = /^(?:(jb|qt|inv)\s*-?\s*)?0*(\d{1,8})$/i.exec(text.replace(/\s+/g, ' '));
  return {
    text,
    kind,
    prefix: ref?.[1]?.toLowerCase() || null,
    number: ref ? Number(ref[2]) : null,
  };
}

const LIMIT = 6;

async function search(rawQuery, user) {
  const q = parse(rawQuery);
  if (q.text.length < 2 && q.number === null) return { query: q.text, groups: [] };

  const like = `%${q.text}%`;
  const num = q.number;

  // What this person is allowed to see. The same rules the list pages use, so
  // search cannot become a way around them.
  const allJobs = can(user, 'jobs.all');
  const allQuotes = can(user, 'quotes.all');
  const mine = user.id;

  const [customers, jobs, quotes, invoices, appointments] = await Promise.all([
    pool.query(
      `SELECT c.id, c.name, c.company, c.phone, c.email
         FROM customers c
        WHERE c.name ILIKE $1 OR c.company ILIKE $1 OR c.email ILIKE $1
           OR regexp_replace(COALESCE(c.phone,''), '[^0-9]', '', 'g')
               LIKE '%' || regexp_replace($2, '[^0-9]', '', 'g') || '%'
              AND regexp_replace($2, '[^0-9]', '', 'g') <> ''
        ORDER BY (c.name ILIKE $3) DESC, c.name
        LIMIT $4`,
      [like, q.text, `${q.text}%`, LIMIT]
    ),
    pool.query(
      `SELECT j.id, j.job_number, j.external_ref, j.status, j.type,
              regexp_replace(regexp_replace(COALESCE(j.description,''), '<[^>]+>', ' ', 'g'), '\\s+', ' ', 'g') AS description,
              c.name AS customer_name,
              COALESCE(s.address, j.site_address) AS site_address
         FROM jobs j
         LEFT JOIN customers c ON c.id = j.customer_id
         LEFT JOIN customer_sites s ON s.id = j.site_id
        WHERE (
                ($5::int IS NOT NULL AND j.job_number = $5)
             OR (($5::int IS NULL OR $6) AND (
                   c.name ILIKE $1
                OR j.external_ref ILIKE $1
                OR COALESCE(s.address, j.site_address) ILIKE $1
                OR regexp_replace(regexp_replace(COALESCE(j.description,''), '<[^>]+>', ' ', 'g'), '\\s+', ' ', 'g') ILIKE $1
                OR ('JB' || LPAD(j.job_number::text, 5, '0')) ILIKE $1))
              )
          -- Kept outside the match, deliberately: a job number that was not
          -- theirs to see would otherwise be found by guessing the number.
          AND ($3 OR EXISTS (SELECT 1 FROM job_technicians jt WHERE jt.job_id = j.id AND jt.user_id = $4))
        ORDER BY (j.job_number = COALESCE($5, -1)) DESC, j.created_at DESC
        LIMIT $2`,
      [like, LIMIT, allJobs, mine, num, q.text.length >= 2]
    ),
    pool.query(
      `SELECT q.id, q.quote_number, q.status, q.total, q.job_id,
              c.name AS customer_name, j.job_number
         FROM quotes q
         LEFT JOIN customers c ON c.id = q.customer_id
         LEFT JOIN jobs j ON j.id = q.job_id
        WHERE (
                ($5::int IS NOT NULL AND q.quote_number = $5)
             OR (($5::int IS NULL OR $6) AND (
                   c.name ILIKE $1
                OR ('QT-' || LPAD(q.quote_number::text, 4, '0')) ILIKE $1))
              )
          AND ($3 OR EXISTS (SELECT 1 FROM job_technicians jt WHERE jt.job_id = q.job_id AND jt.user_id = $4))
        ORDER BY (q.quote_number = COALESCE($5, -1)) DESC, q.created_at DESC
        LIMIT $2`,
      [like, LIMIT, allQuotes, mine, num, q.text.length >= 2]
    ),
    can(user, 'invoices')
      ? pool.query(
        `SELECT i.id, i.invoice_number, i.status, i.total, i.due_date,
                c.name AS customer_name
           FROM invoices i
           LEFT JOIN customers c ON c.id = i.customer_id
          WHERE (
                  ($3::int IS NOT NULL AND i.invoice_number = $3)
               OR (($3::int IS NULL OR $4) AND (
                     c.name ILIKE $1
                  OR i.xero_invoice_number ILIKE $1
                  OR ('INV-' || LPAD(i.invoice_number::text, 4, '0')) ILIKE $1))
                )
          ORDER BY (i.invoice_number = COALESCE($3, -1)) DESC, i.created_at DESC
          LIMIT $2`,
        [like, LIMIT, num, q.text.length >= 2]
      )
      : { rows: [] },
    // Appointments are looked for by who they are with or where they are, and
    // the ones still to come matter more than the ones already done.
    pool.query(
      `SELECT s.id, s.job_id, s.scheduled_date, s.start_time,
              u.name AS who, c.name AS customer_name, j.job_number,
              COALESCE(cs.address, j.site_address) AS site_address
         FROM schedules s
         JOIN jobs j ON j.id = s.job_id
         LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN customers c ON c.id = j.customer_id
         LEFT JOIN customer_sites cs ON cs.id = j.site_id
        WHERE (c.name ILIKE $1 OR u.name ILIKE $1
               OR COALESCE(cs.address, j.site_address) ILIKE $1
               OR ($4::int IS NOT NULL AND j.job_number = $4))
          -- Somebody who can only see their own diary sees only their own.
          AND ($2 OR s.user_id = $3)
        ORDER BY (s.scheduled_date >= CURRENT_DATE) DESC,
                 ABS(s.scheduled_date - CURRENT_DATE)
        LIMIT $5`,
      [like, can(user, 'schedule.all'), mine, num, LIMIT]
    ),
  ]);

  const money = c => `$${((c || 0) / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const jobLabel = j => j.external_ref || `JB${String(j.job_number).padStart(5, '0')}`;

  const groups = [
    {
      kind: 'customers', label: 'Customers',
      items: customers.rows.map(c => ({
        id: c.id, title: c.name,
        subtitle: [c.company, c.phone, c.email].filter(Boolean).join(' · '),
        to: `/customers/${c.id}`,
      })),
    },
    {
      kind: 'jobs', label: 'Jobs',
      items: jobs.rows.map(j => ({
        id: j.id, title: jobLabel(j),
        subtitle: [j.customer_name, j.site_address, j.description?.slice(0, 60)]
          .filter(Boolean).join(' · '),
        badge: j.status, to: `/jobs/${j.id}`,
      })),
    },
    {
      kind: 'quotes', label: 'Quotes',
      items: quotes.rows.map(q2 => ({
        id: q2.id, title: `QT-${String(q2.quote_number).padStart(4, '0')}`,
        subtitle: [q2.customer_name, money(q2.total)].filter(Boolean).join(' · '),
        badge: q2.status, to: `/quotes/${q2.id}`,
      })),
    },
    {
      kind: 'invoices', label: 'Invoices',
      items: invoices.rows.map(i => ({
        id: i.id, title: `INV-${String(i.invoice_number).padStart(4, '0')}`,
        subtitle: [i.customer_name, money(i.total)].filter(Boolean).join(' · '),
        badge: i.status, to: `/invoices/${i.id}`,
      })),
    },
    {
      kind: 'appointments', label: 'Appointments',
      items: appointments.rows.map(s => ({
        id: s.id,
        title: new Date(`${String(s.scheduled_date).slice(0, 10)}T12:00:00`)
          .toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' }),
        subtitle: [s.who, s.customer_name, s.site_address].filter(Boolean).join(' · '),
        to: `/jobs/${s.job_id}`,
      })),
    },
  ].filter(g => g.items.length);

  // What was asked for comes first. "the Hulley job" and "Hulley" find the
  // same things; the first one knows which of them was meant.
  if (q.kind) groups.sort((a, b) => (b.kind === q.kind) - (a.kind === q.kind));

  return { query: q.text, kind: q.kind, groups };
}

module.exports = { search, parse };
