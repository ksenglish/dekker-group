require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/db/pool');

async function main() {
  const name = 'Kyle Dekker';
  const email = 'kyle@dekkergroup.co.nz';
  const password = 'admin123';
  const role = 'admin';

  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING RETURNING id, name, email, role',
    [name, email, hash, role]
  );
  if (rows[0]) {
    console.log('Admin user created:', rows[0]);
    console.log('\nLogin with:');
    console.log('  Email:    kyle@dekkergroup.co.nz');
    console.log('  Password: admin123');
    console.log('\nChange your password after first login.');
  } else {
    console.log('User already exists.');
  }
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
