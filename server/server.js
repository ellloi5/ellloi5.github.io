// Simple leaderboard + account server
// Uses SQLite for persistence, bcrypt for password hashing, JWT for auth.
// Run: npm install, node server.js

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'replace_this_with_a_real_secret';
const JWT_EXPIRES = '7d';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data.sqlite');

const db = new sqlite3.Database(DB_FILE);

// initialize tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    time_ms INTEGER NOT NULL,
    date TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_leaderboard_time ON leaderboard(time_ms)`);
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

// helper: create token
function createToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// Auth middleware
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Register
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (username.length < 2 || username.length > 24) return res.status(400).json({ error: 'username length 2..24' });
  if (password.length < 5) return res.status(400).json({ error: 'password too short' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    db.run(`INSERT INTO users(username, password_hash, created_at) VALUES(?,?,?)`, [username, hash, now], function(err) {
      if (err) {
        if (err && err.code === 'SQLITE_CONSTRAINT') return res.status(409).json({ error: 'username_taken' });
        console.error(err);
        return res.status(500).json({ error: 'db_error' });
      }
      const user = { id: this.lastID, username };
      const token = createToken(user);
      res.json({ ok: true, token, user: { id: user.id, username } });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  db.get(`SELECT id, username, password_hash FROM users WHERE username = ?`, [username], async (err, row) => {
    if (err) { console.error(err); return res.status(500).json({ error: 'db_error' }); }
    if (!row) return res.status(401).json({ error: 'invalid_credentials' });
    try {
      const ok = await bcrypt.compare(password, row.password_hash);
      if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
      const user = { id: row.id, username: row.username };
      const token = createToken(user);
      res.json({ ok: true, token, user });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'server_error' });
    }
  });
});

// Get me
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: { id: req.user.id, username: req.user.username } });
});

// Global leaderboard: read-only open
app.get('/api/leaderboard', (req, res) => {
  const limit = parseInt(req.query.limit || '20', 10);
  db.all(`SELECT l.id, l.name, l.time_ms, l.date, u.username AS account_username
          FROM leaderboard l
          LEFT JOIN users u ON u.id = l.user_id
          ORDER BY l.time_ms ASC, l.date ASC
          LIMIT ?`, [Math.min(200, limit)], (err, rows) => {
    if (err) { console.error(err); return res.status(500).json({ error: 'db_error' }); }
    res.json({ ok: true, rows });
  });
});

// Submit new leaderboard entry (auth required) — uses username from token
app.post('/api/leaderboard', requireAuth, (req, res) => {
  const timeMs = parseInt(req.body.timeMs, 10);
  if (!Number.isFinite(timeMs) || timeMs < 0) return res.status(400).json({ error: 'invalid_time' });
  const now = new Date().toISOString();
  const name = req.user.username; // we store name as account username for global entries
  db.run(`INSERT INTO leaderboard(user_id, name, time_ms, date) VALUES(?,?,?,?)`, [req.user.id, name, timeMs, now], function(err) {
    if (err) { console.error(err); return res.status(500).json({ error: 'db_error' }); }
    res.json({ ok: true, entryId: this.lastID });
  });
});

// Optionally: allow anonymous submit (not recommended), but we won't implement it by default
// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} (DB: ${DB_FILE})`);
});
