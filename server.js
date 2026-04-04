'use strict';
require('dotenv').config();

const express   = require('express');
const path      = require('path');
const { Pool }  = require('pg');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const morgan    = require('morgan');
const { sendConfirmation, sendAdminNotification,
        sendSessionConfirmation, sendSessionAdminNotification } = require('./lib/emails');

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

    CREATE TABLE IF NOT EXISTS sessions (
      id           SERIAL PRIMARY KEY,
      type         TEXT        NOT NULL CHECK (type IN ('weekly','hackathon')),
      num          TEXT        NOT NULL,
      title        TEXT        NOT NULL,
      description  TEXT        NOT NULL DEFAULT '',
      session_date DATE        NOT NULL,
      start_time   TEXT        NOT NULL,
      end_time     TEXT        NOT NULL,
      max_spots    INT         NOT NULL DEFAULT 15,
      format       JSONB       NOT NULL DEFAULT '[]',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(session_date);

    CREATE TABLE IF NOT EXISTS registrations (
      id         SERIAL PRIMARY KEY,
      session_id INT         NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      email      TEXT        NOT NULL,
      name       TEXT,
      ip         TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(session_id, email)
    );
    CREATE INDEX IF NOT EXISTS idx_registrations_session ON registrations(session_id);
    CREATE INDEX IF NOT EXISTS idx_registrations_email   ON registrations(email);
  `);
  console.log('✅  Database ready');
  await seedSessions();
}

async function seedSessions() {
  const { rows } = await pool.query('SELECT COUNT(*) AS c FROM sessions');
  if (+rows[0].c > 0) return;

  const data = [
    { type:'weekly',    num:'#01',   title:'Kick-off de la comunidad',        desc:'Primera sesión oficial. Presentaciones, declaramos objetivos, sprints con cámaras encendidas y la primera ronda de demos.',                                                               date:'2026-04-03', start:'19:00', end:'22:00', spots:15, fmt:['10 min check-in','2h 20min sprint','30 min demos'] },
    { type:'weekly',    num:'#02',   title:'Sesión Semanal',                  desc:'Check-in grupal, sprint de 2h20 con cámaras encendidas y 5 min de demo por persona. Llegás con tu objetivo, te vas con algo hecho.',                                                     date:'2026-04-10', start:'19:00', end:'22:00', spots:15, fmt:['10 min check-in','2h 20min sprint','30 min demos'] },
    { type:'weekly',    num:'#03',   title:'Sesión Semanal',                  desc:'Seguimos el ritmo. Esta semana más gente del waitlist entra al grupo.',                                                                                                                    date:'2026-04-17', start:'19:00', end:'22:00', spots:15, fmt:['10 min check-in','2h 20min sprint','30 min demos'] },
    { type:'hackathon', num:'HK·01', title:'Build in 1 Day: de 0 a lanzado', desc:'El objetivo: lanzar algo real antes de las 20:00. Mañana de ideación, tarde de sprint intenso, cierre con demos y feedback del grupo.',                                                   date:'2026-04-19', start:'10:00', end:'20:00', spots:20, fmt:['Mañana: ideación','Tarde: sprint duro','18:00 demos + feedback'] },
    { type:'weekly',    num:'#04',   title:'Sesión Semanal',                  desc:'Una semana más de construcción. Se suman nuevos builders al grupo.',                                                                                                                        date:'2026-04-24', start:'19:00', end:'22:00', spots:15, fmt:['10 min check-in','2h 20min sprint','30 min demos'] },
    { type:'weekly',    num:'#05',   title:'Sesión Semanal',                  desc:'Segunda semana de mayo. El proyecto avanza sesión a sesión.',                                                                                                                               date:'2026-05-08', start:'19:00', end:'22:00', spots:15, fmt:['10 min check-in','2h 20min sprint','30 min demos'] },
    { type:'weekly',    num:'#06',   title:'Sesión Semanal',                  desc:'Formato estándar. Declarás tu objetivo, sprinteás, mostrás.',                                                                                                                              date:'2026-05-15', start:'19:00', end:'22:00', spots:15, fmt:['10 min check-in','2h 20min sprint','30 min demos'] },
    { type:'hackathon', num:'HK·02', title:'Hackathon × Platanus Ventures',  desc:'En colaboración con Platanus Ventures. Los mejores proyectos reciben feedback directo del equipo de inversión. Las ideas más interesantes entran en su radar.',                            date:'2026-05-17', start:'10:00', end:'20:00', spots:25, fmt:['Mañana: ideación','Tarde: sprint duro','18:30 demos ante Platanus'] },
    { type:'weekly',    num:'#07',   title:'Sesión Semanal',                  desc:'Penúltima sesión del mes. Seguimos construyendo.',                                                                                                                                           date:'2026-05-22', start:'19:00', end:'22:00', spots:15, fmt:['10 min check-in','2h 20min sprint','30 min demos'] },
    { type:'weekly',    num:'#08',   title:'Sesión Semanal',                  desc:'Cierre de mayo. ¿Cuánto construiste este mes?',                                                                                                                                             date:'2026-05-29', start:'19:00', end:'22:00', spots:15, fmt:['10 min check-in','2h 20min sprint','30 min demos'] },
  ];

  for (const s of data) {
    await pool.query(
      `INSERT INTO sessions (type, num, title, description, session_date, start_time, end_time, max_spots, format)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [s.type, s.num, s.title, s.desc, s.date, s.start, s.end, s.spots, JSON.stringify(s.fmt)]
    );
  }
  console.log('✅  Sessions seeded');
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

const sessionRegLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Esperá 15 minutos.' },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function toDateStr(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.slice(0, 10);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) AS total FROM waitlist');
    res.json({ status: 'ok', waitlist: +rows[0].total, ts: new Date().toISOString() });
  } catch {
    res.status(500).json({ status: 'error' });
  }
});

// ── Waitlist ──────────────────────────────────────────────────────────────────

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
    if (err.code !== '23505') {
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
    message: isNew ? 'Email registrado. Revisá tu bandeja 📬' : 'Ya estabas anotado.',
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

// ── Sessions ──────────────────────────────────────────────────────────────────

app.get('/api/sessions', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        s.id, s.type, s.num, s.title, s.description,
        s.session_date, s.start_time, s.end_time, s.max_spots, s.format,
        COALESCE(COUNT(r.id), 0)::int                          AS registered_count,
        (s.max_spots - COALESCE(COUNT(r.id), 0))::int          AS spots_remaining
      FROM sessions s
      LEFT JOIN registrations r ON r.session_id = s.id
      GROUP BY s.id
      ORDER BY s.session_date, s.start_time
    `);

    const today = new Date().toISOString().slice(0, 10);
    const sessions = rows.map(s => {
      const dateStr = toDateStr(s.session_date);
      let status;
      if (dateStr < today)              status = 'past';
      else if (dateStr === today)       status = 'live';
      else if (s.spots_remaining <= 0)  status = 'full';
      else                              status = 'open';
      return { ...s, session_date: dateStr, status };
    });

    res.json(sessions);
  } catch (err) {
    console.error('[sessions] fetch error:', err);
    res.status(500).json({ error: 'Error al cargar sesiones.' });
  }
});

app.post('/api/sessions/:id/register', sessionRegLimiter, async (req, res) => {
  const sessionId = +req.params.id;
  if (!sessionId || isNaN(sessionId)) {
    return res.status(400).json({ error: 'Sesión inválida.' });
  }

  const { email, name } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email inválido.' });
  }

  const trimmedEmail = email.trim().toLowerCase();
  const trimmedName  = name ? name.trim().slice(0, 100) : null;
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;

  // Verify session exists and has available spots
  const sessionRes = await pool.query(`
    SELECT s.*,
      (s.max_spots - COALESCE(COUNT(r.id), 0))::int AS spots_remaining
    FROM sessions s
    LEFT JOIN registrations r ON r.session_id = s.id
    WHERE s.id = $1
    GROUP BY s.id
  `, [sessionId]);

  if (!sessionRes.rows.length) {
    return res.status(404).json({ error: 'Sesión no encontrada.' });
  }

  const session = sessionRes.rows[0];
  const today      = new Date().toISOString().slice(0, 10);
  const sessionDate = toDateStr(session.session_date);

  if (sessionDate < today) {
    return res.status(400).json({ error: 'Esta sesión ya terminó.' });
  }
  if (session.spots_remaining <= 0) {
    return res.status(400).json({ error: 'Esta sesión está completa. Anotate al waitlist.', full: true });
  }

  let isNew = false;
  try {
    await pool.query(
      'INSERT INTO registrations (session_id, email, name, ip) VALUES ($1, $2, $3, $4)',
      [sessionId, trimmedEmail, trimmedName, ip]
    );
    isNew = true;
  } catch (err) {
    if (err.code !== '23505') {
      console.error('[db] registration error:', err);
      return res.status(500).json({ error: 'Error interno. Intentá de nuevo.' });
    }
  }

  if (isNew) {
    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*) AS total FROM registrations WHERE session_id = $1', [sessionId]
    );
    const total = +countRows[0].total;
    const sessionData = { ...session, session_date: sessionDate };
    Promise.all([
      sendSessionConfirmation(trimmedEmail, trimmedName, sessionData),
      sendSessionAdminNotification(trimmedEmail, trimmedName, sessionData, total),
    ]).catch(() => {});
  }

  return res.status(isNew ? 201 : 200).json({
    ok: true,
    message: isNew ? 'Lugar reservado. Revisá tu bandeja.' : 'Ya estabas registrado en esta sesión.',
  });
});

// Admin: create session
app.post('/api/admin/sessions', async (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers['x-admin-key'] !== secret) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  const { type, num, title, description, session_date, start_time, end_time, max_spots, format } = req.body;
  if (!type || !num || !title || !session_date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Requeridos: type, num, title, session_date, start_time, end_time' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO sessions (type, num, title, description, session_date, start_time, end_time, max_spots, format)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [type, num, title, description || '', session_date, start_time, end_time, max_spots || 15, JSON.stringify(format || [])]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[admin] create session error:', err);
    res.status(500).json({ error: 'Error al crear sesión.' });
  }
});

// Admin: export registrations per session
app.get('/api/admin/registrations', async (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.query.key !== secret) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  const { rows } = await pool.query(`
    SELECT r.email, r.name, r.created_at, r.ip,
           s.num, s.title, s.session_date
    FROM registrations r
    JOIN sessions s ON s.id = r.session_id
    ORDER BY s.session_date, r.created_at
  `);
  const csv = ['sesion_num,sesion_titulo,fecha_sesion,email,nombre,registrado_en,ip']
    .concat(rows.map(r =>
      `${r.num},"${r.title}",${toDateStr(r.session_date)},${r.email},${r.name || ''},${r.created_at},${r.ip || ''}`
    ))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="hackr-registrations.csv"');
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
      if (!process.env.ADMIN_SECRET)   console.warn('⚠️   ADMIN_SECRET not set — admin endpoints disabled');
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
