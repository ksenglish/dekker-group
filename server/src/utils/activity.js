const pool = require('../db/pool');

async function logActivity({ type, entity_type, entity_id, user_id, message, meta }) {
  try {
    await pool.query(
      `INSERT INTO activity_log (type, entity_type, entity_id, user_id, message, meta)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [type, entity_type || null, entity_id || null, user_id || null, message, meta ? JSON.stringify(meta) : null]
    );
  } catch { /* non-critical — don't break the main action */ }
}

module.exports = { logActivity };
