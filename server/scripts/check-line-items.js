const pool = require('../src/db/pool');
async function run() {
  const { rows } = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='line_items'");
  console.log(rows.map(r => r.column_name).join(', '));
  pool.end();
}
run().catch(e => { console.error(e.message); pool.end(); });
