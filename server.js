require('dotenv').config();
const express      = require('express');
const path         = require('path');
const cors         = require('cors');
const morgan       = require('morgan');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Pool }     = require('pg');
const rateLimit    = require('express-rate-limit');
const { sendWelcomeEmail } = require('./lib/emails');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'hackr-dev-secret-change-in-prod';

// ── DB ──
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false });

async function query(text, params) {
  const client = await pool.connect();
  try   { return await client.query(text, params); }
  finally { client.release(); }
}

async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id         SERIAL PRIMARY KEY,
      email      TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      plan          TEXT NOT NULL DEFAULT 'free',
      sessions_used INTEGER NOT NULL DEFAULT 0,
      is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Migraciones: columnas nuevas en users
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin      BOOLEAN  NOT NULL DEFAULT FALSE`).catch(() => {});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan          TEXT     NOT NULL DEFAULT 'free'`).catch(() => {});
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_used INTEGER  NOT NULL DEFAULT 0`).catch(() => {});
  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id               SERIAL PRIMARY KEY,
      title            TEXT NOT NULL,
      description      TEXT,
      date             TIMESTAMPTZ,
      duration_minutes INTEGER NOT NULL DEFAULT 180,
      max_participants INTEGER NOT NULL DEFAULT 15,
      type             TEXT NOT NULL DEFAULT 'online',
      location         TEXT,
      created_by       INTEGER REFERENCES users(id),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id         SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(session_id, user_id)
    )
  `);
  // Migraciones: columnas nuevas en sessions (schema antiguo → nuevo)
  await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS date             TIMESTAMPTZ`).catch(() => {});
  await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 180`).catch(() => {});
  await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS max_participants INTEGER DEFAULT 15`).catch(() => {});
  await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS location         TEXT`).catch(() => {});
  await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_by       INTEGER REFERENCES users(id)`).catch(() => {});
  // Hacer nullable columnas heredadas del schema antiguo (no requeridas en sesiones nuevas)
  await query(`ALTER TABLE sessions ALTER COLUMN num          DROP NOT NULL`).catch(() => {});
  await query(`ALTER TABLE sessions ALTER COLUMN session_date DROP NOT NULL`).catch(() => {});
  await query(`ALTER TABLE sessions ALTER COLUMN start_time   DROP NOT NULL`).catch(() => {});
  await query(`ALTER TABLE sessions ALTER COLUMN end_time     DROP NOT NULL`).catch(() => {});
  // Eliminar check constraint que solo permite 'weekly' | 'hackathon'
  await query(`ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_type_check`).catch(() => {});
  // Migrar datos: session_date + start_time → date
  await query(`UPDATE sessions SET date = (session_date + start_time)::timestamptz WHERE date IS NULL AND session_date IS NOT NULL AND start_time IS NOT NULL`).catch(() => {});
  // Migrar datos: max_spots → max_participants
  await query(`UPDATE sessions SET max_participants = max_spots WHERE max_spots IS NOT NULL AND (max_participants IS NULL OR max_participants = 15)`).catch(() => {});

  // Migración: user_id en registrations si existía tabla anterior sin FK
  await query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`).catch(() => {});
  console.log('✅ DB tables ready');
}

// ── MIDDLEWARE ──
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));

// ── RATE LIMITS ──
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

// ── AUTH HELPERS ──
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin || false },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}
function setTokenCookie(res, token) {
  res.cookie('hackr_token', token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000
  });
}
function requireAuth(req, res, next) {
  try {
    const token = req.cookies.hackr_token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No autorizado.' });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Sesión expirada.' }); }
}
function optionalAuth(req, res, next) {
  try {
    const token = req.cookies.hackr_token || (req.headers.authorization || '').replace('Bearer ', '');
    if (token) req.user = jwt.verify(token, JWT_SECRET);
  } catch {}
  next();
}

async function requireAdmin(req, res, next) {
  try {
    const token = req.cookies.hackr_token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No autorizado.' });
    const decoded = jwt.verify(token, JWT_SECRET);
    // Verificar en DB siempre (más seguro que confiar solo en el JWT)
    const result = await query('SELECT is_admin FROM users WHERE id = $1', [decoded.id]);
    if (!result.rows[0]?.is_admin) return res.status(403).json({ error: 'Acceso denegado. Se requieren permisos de administrador.' });
    req.user = decoded;
    next();
  } catch { return res.status(401).json({ error: 'Sesión expirada.' }); }
}

// ══════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Todos los campos son requeridos.' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Email inválido.' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, plan, sessions_used, created_at',
      [name.trim(), email.trim().toLowerCase(), hash]
    );
    const user = result.rows[0];

    // Also add to waitlist
    try { await query('INSERT INTO waitlist (email) VALUES ($1) ON CONFLICT DO NOTHING', [user.email]); } catch {}

    // Welcome email (non-blocking)
    sendWelcomeEmail(user.email, user.name).catch(err => console.error('Email error:', err));

    const token = signToken(user);
    setTokenCookie(res, token);
    return res.status(201).json({ user: { id: user.id, name: user.name, email: user.email, plan: user.plan } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos.' });

  try {
    const result = await query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas.' });

    const token = signToken(user);
    setTokenCookie(res, token);
    return res.json({ user: { id: user.id, name: user.name, email: user.email, plan: user.plan } });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('hackr_token');
  return res.json({ ok: true });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const result = await query('SELECT id, name, email, plan, sessions_used, is_admin, created_at FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// ══════════════════════════════════════
// SESSIONS ROUTES
// ══════════════════════════════════════

// GET /api/sessions
app.get('/api/sessions', optionalAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT s.*,
        COUNT(r.id) AS registered,
        (s.max_participants - COUNT(r.id)) AS available
      FROM sessions s
      LEFT JOIN registrations r ON r.session_id = s.id
      WHERE s.date IS NULL OR s.date >= NOW() - INTERVAL '1 hour'
      GROUP BY s.id
      ORDER BY s.date ASC NULLS LAST
      LIMIT 20
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error('Sessions error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// GET /api/sessions/:id
app.get('/api/sessions/:id', optionalAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT s.*, COUNT(r.id) AS registered
      FROM sessions s
      LEFT JOIN registrations r ON r.session_id = s.id
      WHERE s.id = $1
      GROUP BY s.id
    `, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Sesión no encontrada.' });
    return res.json(result.rows[0]);
  } catch { return res.status(500).json({ error: 'Error interno.' }); }
});

// POST /api/sessions/:id/register
app.post('/api/sessions/:id/register', requireAuth, async (req, res) => {
  const sessionId = parseInt(req.params.id);
  const userId = req.user.id;
  try {
    // Check session exists and has spots
    const sResult = await query(`
      SELECT s.*, COUNT(r.id) AS registered
      FROM sessions s
      LEFT JOIN registrations r ON r.session_id = s.id
      WHERE s.id = $1
      GROUP BY s.id
    `, [sessionId]);
    const session = sResult.rows[0];
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada.' });
    if (parseInt(session.registered) >= session.max_participants) {
      return res.status(400).json({ error: 'La sesión está llena.' });
    }

    await query('INSERT INTO registrations (session_id, user_id) VALUES ($1, $2)', [sessionId, userId]);
    await query('UPDATE users SET sessions_used = sessions_used + 1 WHERE id = $1', [userId]);
    return res.status(201).json({ ok: true, message: 'Reserva confirmada.' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya estás registrado en esta sesión.' });
    console.error('Register session error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// GET /api/sessions/my — user's sessions (debe ir ANTES de /:id)
app.get('/api/sessions/my', requireAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT s.*, COUNT(r2.id) AS registered
      FROM sessions s
      INNER JOIN registrations r ON r.session_id = s.id AND r.user_id = $1
      LEFT JOIN registrations r2 ON r2.session_id = s.id
      GROUP BY s.id
      ORDER BY s.date DESC NULLS LAST
    `, [req.user.id]);
    return res.json(result.rows);
  } catch { return res.status(500).json({ error: 'Error interno.' }); }
});

// POST /api/sessions — crear sesión (solo admin)
app.post('/api/sessions', requireAdmin, async (req, res) => {
  const { title, description, date, duration_minutes, max_participants, type, location } = req.body;
  if (!title) return res.status(400).json({ error: 'Título requerido.' });
  try {
    const result = await query(
      'INSERT INTO sessions (title, description, date, duration_minutes, max_participants, type, location, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [title, description || '', date || null, duration_minutes || 180, max_participants || 15, type || 'online', location || null, req.user.id]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create session error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// PUT /api/sessions/:id — editar sesión (solo admin)
app.put('/api/sessions/:id', requireAdmin, async (req, res) => {
  const { title, description, date, duration_minutes, max_participants, type, location } = req.body;
  if (!title) return res.status(400).json({ error: 'Título requerido.' });
  try {
    const result = await query(
      `UPDATE sessions SET title=$1, description=$2, date=$3, duration_minutes=$4,
       max_participants=$5, type=$6, location=$7 WHERE id=$8 RETURNING *`,
      [title, description || '', date || null, duration_minutes || 180, max_participants || 15, type || 'online', location || null, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Sesión no encontrada.' });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Update session error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// DELETE /api/sessions/:id — eliminar sesión (solo admin)
app.delete('/api/sessions/:id', requireAdmin, async (req, res) => {
  try {
    const result = await query('DELETE FROM sessions WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Sesión no encontrada.' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Delete session error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// ══════════════════════════════════════
// WAITLIST ROUTES
// ══════════════════════════════════════

// POST /api/waitlist
app.post('/api/waitlist', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email inválido.' });
  }
  try {
    await query('INSERT INTO waitlist (email) VALUES ($1) ON CONFLICT DO NOTHING', [email.trim().toLowerCase()]);
    return res.status(201).json({ ok: true, message: 'Email registrado.' });
  } catch (err) {
    console.error('Waitlist error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// GET /api/waitlist/count
app.get('/api/waitlist/count', async (req, res) => {
  try {
    const result = await query('SELECT COUNT(*) AS total FROM waitlist');
    return res.json({ total: parseInt(result.rows[0].total) });
  } catch { return res.status(500).json({ total: 0 }); }
});

// GET /api/waitlist/export (admin)
app.get('/api/waitlist/export', async (req, res) => {
  const secret = process.env.ADMIN_SECRET || 'hackr-admin';
  if (req.query.key !== secret) return res.status(401).json({ error: 'No autorizado.' });
  try {
    const result = await query('SELECT email, created_at FROM waitlist ORDER BY created_at ASC');
    const csv = ['email,fecha'].concat(result.rows.map(r => `${r.email},${r.created_at}`)).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="hackr-waitlist.csv"');
    return res.send(csv);
  } catch { return res.status(500).json({ error: 'Error interno.' }); }
});

// ══════════════════════════════════════
// ADMIN ROUTES
// ══════════════════════════════════════

// POST /api/admin/promote — promover usuario a admin (requiere ADMIN_SECRET)
app.post('/api/admin/promote', async (req, res) => {
  const { email, secret } = req.body;
  const ADMIN_SECRET = process.env.ADMIN_SECRET || 'hackr-admin';
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Clave incorrecta.' });
  try {
    const result = await query(
      'UPDATE users SET is_admin = TRUE WHERE LOWER(email) = LOWER($1) RETURNING id, name, email, is_admin',
      [email.trim()]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Usuario no encontrado. Asegúrate de registrarte primero.' });
    return res.json({ ok: true, user: result.rows[0] });
  } catch (err) {
    console.error('Promote error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// GET /api/admin/sessions — todas las sesiones (incluyendo pasadas)
app.get('/api/admin/sessions', requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT s.*, COUNT(r.id) AS registered
      FROM sessions s
      LEFT JOIN registrations r ON r.session_id = s.id
      GROUP BY s.id
      ORDER BY s.date DESC NULLS LAST, s.created_at DESC
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error('Admin sessions error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// GET /api/admin/sessions/:id/participants — participantes de una sesión
app.get('/api/admin/sessions/:id/participants', requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT u.id, u.name, u.email, u.plan, r.created_at AS registered_at
      FROM registrations r
      JOIN users u ON u.id = r.user_id
      WHERE r.session_id = $1
      ORDER BY r.created_at ASC
    `, [req.params.id]);
    return res.json(result.rows);
  } catch (err) {
    console.error('Participants error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// GET /api/admin/users — todos los usuarios
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await query(`
      SELECT id, name, email, plan, sessions_used, is_admin, created_at
      FROM users ORDER BY created_at DESC
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error('Admin users error:', err);
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// GET /api/admin/stats — resumen general
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [users, sessions, registrations, waitlist] = await Promise.all([
      query('SELECT COUNT(*) FROM users'),
      query('SELECT COUNT(*) FROM sessions'),
      query('SELECT COUNT(*) FROM registrations'),
      query('SELECT COUNT(*) FROM waitlist'),
    ]);
    return res.json({
      users:         parseInt(users.rows[0].count),
      sessions:      parseInt(sessions.rows[0].count),
      registrations: parseInt(registrations.rows[0].count),
      waitlist:      parseInt(waitlist.rows[0].count),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error interno.' });
  }
});

// ── CATCH-ALL ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── START ──
initDB().then(() => {
  app.listen(PORT, () => console.log(`✅ Hackr running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err);
  // Start anyway for non-DB features
  app.listen(PORT, () => console.log(`⚠️  Hackr running (no DB) on http://localhost:${PORT}`));
});
