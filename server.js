const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares ──
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Database setup ──
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'waitlist.db');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS waitlist (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    email     TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ── Routes ──

// POST /api/waitlist — register email
app.post('/api/waitlist', (req, res) => {
  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email inválido.' });
  }

  const trimmed = email.trim().toLowerCase();

  try {
    const stmt = db.prepare('INSERT INTO waitlist (email) VALUES (?)');
    stmt.run(trimmed);
    return res.status(201).json({ ok: true, message: 'Email registrado correctamente.' });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      // Already registered — treat as success from UX perspective
      return res.status(200).json({ ok: true, message: 'Ya estabas anotado.' });
    }
    console.error('DB error:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// GET /api/waitlist/count — public count
app.get('/api/waitlist/count', (req, res) => {
  const row = db.prepare('SELECT COUNT(*) as total FROM waitlist').get();
  res.json({ total: row.total });
});

// GET /api/waitlist/export?key=SECRET — CSV download (admin only)
app.get('/api/waitlist/export', (req, res) => {
  const secret = process.env.ADMIN_SECRET || 'hackr-admin';
  if (req.query.key !== secret) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  const rows = db.prepare('SELECT email, created_at FROM waitlist ORDER BY created_at ASC').all();
  const csv = ['email,fecha'].concat(rows.map(r => `${r.email},${r.created_at}`)).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="hackr-waitlist.csv"');
  res.send(csv);
});

// Catch-all → serve landing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──
app.listen(PORT, () => {
  console.log(`✅ Hackr server running on http://localhost:${PORT}`);
});
