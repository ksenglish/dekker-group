require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');
const pool = require('./db/pool');
const { runMigrations } = require('./db/migrate');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const customerRoutes = require('./routes/customers');
const jobRoutes = require('./routes/jobs');
const scheduleRoutes = require('./routes/schedules');
const quoteRoutes = require('./routes/quotes');
const invoiceRoutes = require('./routes/invoices');
const settingsRoutes = require('./routes/settings');
const productRoutes = require('./routes/products');
const timesheetRoutes = require('./routes/timesheets');
const reportRoutes = require('./routes/reports');
const scanRoutes = require('./routes/scan');
const presenterRoutes = require('./routes/presenter');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(compression()); // gzip all responses — cuts bandwidth 60-80%
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // same-origin / non-browser requests
    const raw = process.env.CLIENT_URL || '';
    // CLIENT_URL from Render's fromService may come without protocol — normalise
    const allowed = raw.startsWith('http') ? raw : raw ? `https://${raw}` : null;
    if (
      origin === 'http://localhost:5173' ||
      origin === 'http://localhost:3001' ||
      (allowed && origin === allowed) ||
      origin.endsWith('.pages.dev') ||
      origin.endsWith('.onrender.com')
    ) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/products', productRoutes);
app.use('/api/timesheets', timesheetRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/presenter', presenterRoutes);

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

// Serve built React app in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist');
  // Hashed assets (JS/CSS/images) are safe to cache for 1 year
  app.use('/assets', express.static(path.join(clientDist, 'assets'), {
    maxAge: '1y', immutable: true,
  }));
  // Everything else (index.html, sw.js) must revalidate
  app.use(express.static(clientDist, { maxAge: 0 }));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

async function start() {
  if (process.env.NODE_ENV === 'production') {
    console.log('Running migrations…');
    await runMigrations();
  }
  app.listen(PORT, () => {
    console.log(`Dekker Group server running on http://localhost:${PORT}`);
  });
}

// Catch unhandled async errors in route handlers (Express 4 doesn't catch these automatically)
app.use((err, req, res, next) => {
  console.error('Unhandled route error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

start().catch(err => { console.error('Startup failed:', err); process.exit(1); });
