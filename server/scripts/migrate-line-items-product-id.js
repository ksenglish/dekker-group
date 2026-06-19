const pool = require('../src/db/pool');
async function run() {
  await pool.query('ALTER TABLE line_items ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL');
  console.log('done');
  pool.end();
}
run().catch(e => { console.error(e.message); pool.end(); });
