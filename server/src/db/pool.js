const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Managed Postgres and the proxies in front of it hang up idle connections
  // without telling the client, and a socket that has been quietly dropped is
  // indistinguishable from a live one until a query is sent down it — which is
  // where "Connection terminated unexpectedly" comes from. Keepalives hold the
  // socket open, and retiring idle clients well inside the server's own window
  // means the pool lets go of them before the far end does.
  keepAlive: true,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// A client sitting idle in the pool can fail at any time — the database
// restarts, a proxy times it out, the network blips. That is a normal event,
// not a fatal one: pg discards the broken client and the next query gets a
// fresh one. Exiting here turned a single dropped connection into the whole
// API going down, which is exactly what happened.
pool.on('error', (err) => {
  console.error('Idle database client error (connection discarded):', err.message);
});

module.exports = pool;
