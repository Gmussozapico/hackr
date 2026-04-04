'use strict';
require('dotenv').config();

const express   = require('express');
const path      = require('path');
const Database  = require('better-sqlite3');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const morgan    = require('morgan');
const { sendConfirmation, sendAdminNotification } = require('./lib/emails');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Logging ──────────────────────────────────────────────────────────────────
app.use(morgan('tiny'));

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const waitlistLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Esperá 15 minutos.' },
});

// ── Database ──────────────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'waitlist.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS waitlist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    ip         TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_waitlist_email   ON waitlist(email);
  CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at);
`);

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check (Railway / uptime monitors)
app.get('/health', (_req, res) => {
  try {
    const { total } = db.prepare('SELECT COUNT(*) as total FROM waitlist').get();
    res.json({ status: 'ok', waitlist: total, ts: new Date().toISOString() });
  } catch {
    res.status(500).json({ status: 'error' });
  }
});

// POST /api/waitlist — register email
app.post('/api/waitlist', waitlistLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email inválido.' });
  }

  const trimmed = email.trim().toLowerCase();
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;

  let isNew = false;
  try {
    db.prepare('INSERT INTO waitlist (email, ip) VALUES (?, ?)').run(trimmed, ip);
    isNew = true;
  } catch (err) {
    if (err.code !== 'SQLITE_CONSTRAINT_UNIQUE') {
      console.error('[db] insert error:', err);
      return res.status(500).json({ error: 'Error interno. Intentá de nuevo.' });
    }
  }

  if (isNew) {
    const { total } = db.prepare('SELECT COUNT(*) as total FROM waitlist').get();
    // Fire-and-forget — don't block the response
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

// GET /api/waitlist/count
app.get('/api/waitlist/count', (_req, res) => {
  const { total } = db.prepare('SELECT COUNT(*) as total FROM waitlist').get();
  res.json({ total });
});

// GET /api/waitlist/export?key=SECRET
app.get('/api/waitlist/export', (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.query.key !== secret) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  const rows = db
    .prepare('SELECT email, created_at, ip FROM waitlist ORDER BY created_at ASC')
    .all();
  const csv = ['email,fecha,ip']
    .concat(rows.map(r => `${r.email},${r.created_at},${r.ip || ''}`))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="hackr-waitlist.csv"');
  res.send(csv);
});

// Catch-all → landing
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`✅  Hackr running on http://localhost:${PORT}`);
  if (!process.env.RESEND_API_KEY) console.warn('⚠️   RESEND_API_KEY not set — emails disabled');
  if (!process.env.ADMIN_EMAIL)    console.warn('⚠️   ADMIN_EMAIL not set — admin notifications disabled');
  if (!process.env.ADMIN_SECRET)   console.warn('⚠️   ADMIN_SECRET not set — /export endpoint disabled');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM — shutting down gracefully...');
  server.close(() => { db.close(); process.exit(0); });
});
