const pool = require('../db/pool');

async function list(req, res) {
  const { search, category, active } = req.query;
  const conditions = ['1=1'];
  const params = [];
  let p = 1;

  if (active !== 'false') { conditions.push(`p.is_active = true`); }
  if (category) { conditions.push(`p.category = $${p}`); params.push(category); p++; }
  if (search) {
    conditions.push(`(p.name ILIKE $${p} OR p.description ILIKE $${p} OR p.category ILIKE $${p})`);
    params.push(`%${search}%`); p++;
  }

  try {
    const { rows } = await pool.query(
      `SELECT * FROM products p WHERE ${conditions.join(' AND ')} ORDER BY p.category, p.name`,
      params
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function get(req, res) {
  try {
    const { rows } = await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function create(req, res) {
  const { name, description, category, unit, unit_price } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO products (name, description, category, unit, unit_price)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, description || null, category || null, unit || 'each', Math.round((unit_price || 0) * 100)]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function update(req, res) {
  const { name, description, category, unit, unit_price, is_active } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE products SET name=$1, description=$2, category=$3, unit=$4,
       unit_price=$5, is_active=$6, updated_at=NOW() WHERE id=$7 RETURNING *`,
      [name, description || null, category || null, unit || 'each',
       Math.round((unit_price || 0) * 100), is_active !== false, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
}

async function remove(req, res) {
  try {
    await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

async function importCsv(req, res) {
  // Expects: name, description, category, unit, unit_price (dollars)
  const lines = (req.body.csv || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one product' });

  const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
  const idx = { name: headers.indexOf('name'), description: headers.indexOf('description'),
    category: headers.indexOf('category'), unit: headers.indexOf('unit'), unit_price: headers.indexOf('unit_price') };

  if (idx.name === -1) return res.status(400).json({ error: 'CSV must have a "name" column' });

  const results = { imported: 0, errors: [] };
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const name = cols[idx.name];
    if (!name) continue;
    try {
      await pool.query(
        `INSERT INTO products (name, description, category, unit, unit_price)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`,
        [name, idx.description > -1 ? cols[idx.description] || null : null,
         idx.category > -1 ? cols[idx.category] || null : null,
         idx.unit > -1 ? cols[idx.unit] || 'each' : 'each',
         Math.round(parseFloat(idx.unit_price > -1 ? cols[idx.unit_price] || 0 : 0) * 100)]
      );
      results.imported++;
    } catch (e) { results.errors.push(`Row ${i}: ${e.message}`); }
  }
  res.json(results);
}

async function categories(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND is_active=true ORDER BY category`
    );
    res.json(rows.map(r => r.category));
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
}

module.exports = { list, get, create, update, remove, importCsv, categories };
