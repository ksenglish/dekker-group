const pool = require('../src/db/pool');
async function run() {
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier VARCHAR(255)`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS media_base64 TEXT`);
  console.log('done');
  pool.end();
}
run().catch(e => { console.error(e.message); pool.end(); });
