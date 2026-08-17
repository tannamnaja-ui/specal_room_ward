const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { loadSettings, saveSettings, testConnection, query } = require('../config/db');
const { ensureTables } = require('./rooms');

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

// Test DB connection
router.post('/test-connection', async (req, res) => {
  const cfg = req.body;
  try {
    await testConnection(cfg);
    res.json({ success: true, message: 'เชื่อมต่อสำเร็จ!' });
  } catch (err) {
    res.json({ success: false, message: `เชื่อมต่อไม่สำเร็จ: ${err.message}` });
  }
});

// Save connection settings
router.post('/save-connection', async (req, res) => {
  try {
    const newSettings = { ...req.body };
    if (!newSettings.password) {
      const existing = loadSettings();
      if (existing && existing.password) {
        newSettings.password = existing.password;
      }
    }
    saveSettings(newSettings);
    // ตรวจสอบ/สร้างตาราง (เช่น room_types สำหรับราคาห้องพิเศษ) ทันทีที่บันทึกการเชื่อมต่อ
    try { await ensureTables(newSettings); } catch (_) {}
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get saved connection (คืนรหัสผ่านจริงกลับไปด้วยเสมอ ให้ browser แสดงเป็น ●●● ในช่อง
// password ได้ ไม่ต้องพิมพ์ใหม่ทุกครั้ง — หน้านี้เข้าได้ก่อน login อยู่แล้ว เพราะใช้ตั้งค่า
// DB ครั้งแรกตอนที่ยัง login ไม่ได้)
router.get('/connection-settings', (req, res) => {
  const cfg = loadSettings();
  if (!cfg) return res.json({ configured: false });
  res.json({ configured: true, settings: { ...cfg, has_password: !!cfg.password } });
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ success: false, message: 'กรุณากรอก Username และ Password' });

  const cfg = loadSettings();
  if (!cfg) return res.status(503).json({ success: false, message: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล' });

  try {
    const rows = await query(
      'SELECT officer_login_name, officer_name, officer_login_password_md5 FROM officer WHERE officer_login_name = $1 LIMIT 1',
      [username], cfg
    );
    if (!rows || rows.length === 0)
      return res.status(401).json({ success: false, message: 'ไม่พบชื่อผู้ใช้นี้ในระบบ' });

    const officer = rows[0];
    const stored = (officer.officer_login_password_md5 || '').toLowerCase().trim();
    const input  = (password || '').toLowerCase().trim();
    // password arrives already MD5-hashed from the client
    if (stored !== input)
      return res.status(401).json({ success: false, message: 'รหัสผ่านไม่ถูกต้อง' });

    req.session.user = {
      login_name: officer.officer_login_name,
      name: officer.officer_name || officer.officer_login_name
    };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    res.status(500).json({ success: false, message: `เกิดข้อผิดพลาด: ${err.message}` });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// GET /api/auth/check-rt-fields - ตรวจสอบฟิลด์ใน roomtype_reserve
router.get('/check-rt-fields', async (req, res) => {
  const cfg = loadSettings();
  if (!cfg) return res.json({ success: false, message: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ' });
  const isPg = cfg.db_type === 'postgresql';
  const required = ['ward', 'deposit', 'est_dch_date', 'bedno', 'waiting_list_id'];
  try {
    let rows;
    if (isPg) {
      rows = await query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'roomtype_reserve'
         AND column_name = ANY($1)`,
        [required], cfg
      );
    } else {
      rows = await query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = DATABASE()
         AND table_name = 'roomtype_reserve'
         AND column_name IN ('ward','deposit','est_dch_date','bedno','waiting_list_id')`,
        [], cfg
      );
    }
    const found   = rows.map(r => (r.column_name || r.COLUMN_NAME).toLowerCase());
    const missing = required.filter(c => !found.includes(c));
    res.json({ success: true, all_exist: missing.length === 0, missing, found });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST /api/auth/add-rt-fields - เพิ่มฟิลด์ที่ขาดใน roomtype_reserve
router.post('/add-rt-fields', async (req, res) => {
  const cfg = loadSettings();
  if (!cfg) return res.json({ success: false, message: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ' });
  const isPg = cfg.db_type === 'postgresql';
  const colDefs = {
    ward:            'VARCHAR(5)',
    deposit:         isPg ? 'NUMERIC(12,2)' : 'DECIMAL(12,2)',
    est_dch_date:    'DATE',
    bedno:           'VARCHAR(10)',
    waiting_list_id: 'INTEGER'
  };
  try {
    const added = [];
    for (const [col, def] of Object.entries(colDefs)) {
      try {
        if (isPg) {
          await query(`ALTER TABLE roomtype_reserve ADD COLUMN IF NOT EXISTS ${col} ${def}`, [], cfg);
        } else {
          await query(`ALTER TABLE roomtype_reserve ADD COLUMN ${col} ${def}`, [], cfg);
        }
        added.push(col);
      } catch (e) {
        if (!e.message.toLowerCase().includes('duplicate') && !e.message.toLowerCase().includes('already exists')) throw e;
      }
    }
    res.json({ success: true, added });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// GET /api/auth/check-waitlist-table - ตรวจสอบตาราง waiting_list
router.get('/check-waitlist-table', async (req, res) => {
  const cfg = loadSettings();
  if (!cfg) return res.json({ success: false, message: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ' });
  const requiredCols = ['id','hn','patient_name','room_type_id','preferred_room','request_date',
    'rights_type','notes','status','created_by','created_at','an','ward','doctor_name','contact_name','contact_phone','priority_type','roomtype_code','roomtype_name'];
  try {
    // ตรวจว่าตารางมีอยู่
    const tblCheck = await query(
      `SELECT table_name FROM information_schema.tables WHERE table_name='waiting_list' LIMIT 1`, [], cfg
    );
    if (!tblCheck || tblCheck.length === 0) {
      return res.json({ success: true, table_exists: false, missing_cols: requiredCols });
    }
    const colRows = await query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='waiting_list'`, [], cfg
    );
    const found = colRows.map(r => (r.column_name || r.COLUMN_NAME).toLowerCase());
    const missing_cols = requiredCols.filter(c => !found.includes(c));
    res.json({ success: true, table_exists: true, all_exist: missing_cols.length === 0, missing_cols });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST /api/auth/create-waitlist-table - สร้าง/แก้ไขตาราง waiting_list
router.post('/create-waitlist-table', async (req, res) => {
  const cfg = loadSettings();
  if (!cfg) return res.json({ success: false, message: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ' });
  const isPg = cfg.db_type === 'postgresql';
  const autoInc = isPg ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';
  try {
    // สร้างตารางถ้ายังไม่มี
    await query(`CREATE TABLE IF NOT EXISTS waiting_list (
      id ${autoInc},
      hn VARCHAR(20),
      an VARCHAR(20),
      patient_name VARCHAR(200),
      ward VARCHAR(100),
      doctor_name VARCHAR(200),
      room_type_id INT,
      preferred_room VARCHAR(20),
      request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      rights_type VARCHAR(100),
      notes TEXT,
      status VARCHAR(20) DEFAULT 'waiting',
      created_by VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      contact_name VARCHAR(200),
      contact_phone VARCHAR(50),
      priority_type VARCHAR(200),
      roomtype_code VARCHAR(50),
      roomtype_name VARCHAR(200)
    )`, [], cfg);
    // เพิ่มคอลัมน์ที่ขาด
    const extraCols = {
      an: 'VARCHAR(20)', ward: 'VARCHAR(100)', doctor_name: 'VARCHAR(200)',
      contact_name: 'VARCHAR(200)', contact_phone: 'VARCHAR(50)', priority_type: 'VARCHAR(200)',
      roomtype_code: 'VARCHAR(50)', roomtype_name: 'VARCHAR(200)',
      check_in_date: 'VARCHAR(50)'
    };
    const added = [];
    for (const [col, def] of Object.entries(extraCols)) {
      try {
        if (isPg) {
          await query(`ALTER TABLE waiting_list ADD COLUMN IF NOT EXISTS ${col} ${def}`, [], cfg);
        } else {
          await query(`ALTER TABLE waiting_list ADD COLUMN ${col} ${def}`, [], cfg);
        }
        added.push(col);
      } catch (e) {
        if (!e.message.toLowerCase().includes('duplicate') && !e.message.toLowerCase().includes('already exists')) throw e;
      }
    }
    res.json({ success: true, added });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Check session
router.get('/me', (req, res) => {
  if (req.session.user) return res.json({ loggedIn: true, user: req.session.user });
  res.json({ loggedIn: false });
});

module.exports = router;
