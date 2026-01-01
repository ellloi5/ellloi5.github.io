# Parkour Global Leaderboard Server

Simple Node.js server providing user accounts and a global leaderboard backed by SQLite.

Requirements:
- Node.js 14+
- npm

Install & run:
1. cd server
2. npm install
3. node server.js
4. Server runs on http://localhost:3000 by default.

API:
- POST /api/register { username, password } -> { token, user }
- POST /api/login { username, password } -> { token, user }
- GET /api/me (Authorization: Bearer <token>) -> user info
- GET /api/leaderboard?limit=20 -> top entries
- POST /api/leaderboard (Authorization: Bearer <token>) { timeMs } -> submit entry

Notes:
- JWT secret is in environment variable JWT_SECRET (or defaults to an insecure local string). For production replace with a strong secret.
- DB file is data.sqlite in the server folder by default. You can provide DB_FILE env var to change it.
