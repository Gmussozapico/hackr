'use strict';
require('dotenv').config();

const express   = require('express');
const path      = require('path');
const { Pool }  = require('pg');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const morgan    = require('morgan');
const { sendConfirmation, sendAdminNotification } = require('./lib/emails');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Database ──────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id         SERIAL PRIMARY KEY,
      email      TEXT        NOT NULL UNIQUE,
      ip         TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_waitlist_email   ON waitlist(email);
    CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at);
  `);
  console.log('✅  Database ready');
}

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(morgan('tiny'));

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const waitlistLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Esperá 15 minutos.' },
});

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) AS total FROM waitlist');
    res.json({ status: 'ok', waitlist: +rows[0].total, ts: new Date().toISOString() });
  } catch {
    res.status(500).json({ status: 'error' });
  }
});

app.post('/api/waitlist', waitlistLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email inválido.' });
  }

  const trimmed = email.trim().toLowerCase();
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;

  let isNew = false;
  try {
    await pool.query('INSERT INTO waitlist (email, ip) VALUES ($1, $2)', [trimmed, ip]);
    isNew = true;
  } catch (err) {
    if (err.code !== '23505') { // unique_violation
      console.error('[db] insert error:', err);
      return res.status(500).json({ error: 'Error interno. Intentá de nuevo.' });
    }
  }

  if (isNew) {
    const { rows } = await pool.query('SELECT COUNT(*) AS total FROM waitlist');
    const total = +rows[0].total;
    Promise.all([
      sendConfirmation(trimmed),
      sendAdminNotification(trimmed, total),
    ]).catch(() => {});
  }

  return res.status(isNew ? 201 : 200).json({
    ok: true,
    message: isNew
      ? 'Email registrado. Revisá tu bandeja 📬'
      : 'Ya estabas anotado.',
  });
});

app.get('/api/waitlist/count', async (_req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*) AS total FROM waitlist');
  res.json({ total: +rows[0].total });
});

app.get('/api/waitlist/export', async (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.query.key !== secret) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  const { rows } = await pool.query(
    'SELECT email, created_at, ip FROM waitlist ORDER BY created_at ASC'
  );
  const csv = ['email,fecha,ip']
    .concat(rows.map(r => `${r.email},${r.created_at},${r.ip || ''}`))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="hackr-waitlist.csv"');
  res.send(csv);
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
initDb()
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`✅  Hackr running on http://localhost:${PORT}`);
      if (!process.env.RESEND_API_KEY) console.warn('⚠️   RESEND_API_KEY not set — emails disabled');
      if (!process.env.ADMIN_EMAIL)    console.warn('⚠️   ADMIN_EMAIL not set — admin notifications disabled');
      if (!process.env.ADMIN_SECRET)   console.warn('⚠️   ADMIN_SECRET not set — /export endpoint disabled');
    });
    process.on('SIGTERM', () => {
      console.log('SIGTERM — shutting down gracefully...');
      server.close(() => { pool.end(); process.exit(0); });
    });
  })
  .catch(err => {
    console.error('❌  Failed to connect to database:', err.message);
    process.exit(1);
  });
