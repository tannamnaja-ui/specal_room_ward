const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const { loadSettings, query } = require('./config/db');
const authRouter = require('./routes/auth');
const roomsRouter = require('./routes/rooms');
const bookingsRouter = require('./routes/bookings');
const waitlistRouter = require('./routes/waitlist');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'hospital-room-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// Share io with routes
app.use((req, res, next) => { req.io = io; next(); });

// ต้องเช็ค login ก่อนเสมอ (ทั้ง '/' และ '/index.html') — ต้องอยู่ก่อน express.static
// เพราะ static จะเสิร์ฟ index.html ให้ตรงๆทันทีถ้าเจอไฟล์ ไม่ผ่านการเช็ค session เลย
app.get(['/', '/index.html'], (req, res) => {
  if (!loadSettings()) return res.redirect('/settings.html');
  if (!req.session.user) {
    // เก็บ query string เดิมไว้ด้วย (เช่น ?bms-session-id=...) ไม่งั้นจะหายไปตอน redirect
    // ทำให้หน้า login ไม่เห็น session id ที่ BMS ส่งมาให้เลย
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect('/login.html' + qs);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/waitlist', waitlistRouter);

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

async function runMigrations() {
  const cfg = loadSettings();
  if (!cfg) return;
  try {
    if (cfg.db_type === 'postgresql') {
      await query(`ALTER TABLE waiting_list ADD COLUMN IF NOT EXISTS check_in_date VARCHAR(50)`, [], cfg);
    } else {
      const cols = await query(`SHOW COLUMNS FROM waiting_list LIKE 'check_in_date'`, [], cfg);
      if (!cols || cols.length === 0)
        await query(`ALTER TABLE waiting_list ADD COLUMN check_in_date VARCHAR(50)`, [], cfg);
    }
  } catch {}
}

const PORT = process.env.PORT || 3004;
server.listen(PORT, () => {
  console.log(`Hospital Room System running at http://localhost:${PORT}`);
  runMigrations();
});
