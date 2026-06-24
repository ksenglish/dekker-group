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
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
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

start().catch(err => { console.error('Startup failed:', err); process.exit(1); });
