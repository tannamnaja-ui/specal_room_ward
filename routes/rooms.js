const express = require('express');
const router = express.Router();
const { query, loadSettings } = require('../config/db');

function authCheck(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
  next();
}

// ensureTables ทำ CREATE/ALTER TABLE ~25 คำสั่งต่อครั้ง — cache ผลไว้ต่อการเชื่อมต่อ
// เพื่อไม่ต้องยิง DDL ซ้ำทุก request (ของเดิมเรียกทุกครั้งที่เปิดหน้าตั้งค่า/โหลดห้อง ทำให้ช้า/ค้าง
// ได้ง่ายถ้ามี lock หรือ network latency สูง)
let _ensuredKey = null;
let _ensuredPromise = null;

async function ensureTables(cfg) {
  const key = `${cfg.db_type}:${cfg.host}:${cfg.port}:${cfg.database}:${cfg.username}`;
  if (_ensuredKey === key && _ensuredPromise) return _ensuredPromise;
  _ensuredKey = key;
  _ensuredPromise = ensureTablesInternal(cfg).catch(err => {
    _ensuredKey = null; // ล้าง cache ถ้าล้มเหลว จะได้ลองใหม่ในครั้งถัดไป
    _ensuredPromise = null;
    throw err;
  });
  return _ensuredPromise;
}

async function ensureTablesInternal(cfg) {
  const isPg = cfg.db_type === 'postgresql';
  const autoInc = isPg ? 'SERIAL PRIMARY KEY' : 'INT AUTO_INCREMENT PRIMARY KEY';

  await query(`CREATE TABLE IF NOT EXISTS room_types (
    id ${autoInc},
    type_name VARCHAR(100) NOT NULL,
    description TEXT,
    price_per_day DECIMAL(10,2) DEFAULT 0,
    food_price_per_day DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, [], cfg);

  await query(`CREATE TABLE IF NOT EXISTS rooms (
    id ${autoInc},
    room_number VARCHAR(20) NOT NULL UNIQUE,
    room_type_id INT,
    floor VARCHAR(10),
    building VARCHAR(50),
    status VARCHAR(20) DEFAULT 'available',
    notes TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, [], cfg);

  await query(`CREATE TABLE IF NOT EXISTS bookings (
    id ${autoInc},
    booking_ref VARCHAR(20),
    hn VARCHAR(20),
    an VARCHAR(20),
    patient_name VARCHAR(200),
    ward VARCHAR(100),
    doctor_name VARCHAR(200),
    room_id INT,
    room_number VARCHAR(20),
    room_type_id INT,
    check_in_date TIMESTAMP,
    check_out_date TIMESTAMP,
    actual_check_in TIMESTAMP,
    actual_check_out TIMESTAMP,
    status VARCHAR(20) DEFAULT 'reserved',
    rights_type VARCHAR(100),
    deposit_amount DECIMAL(10,2) DEFAULT 0,
    contact_name VARCHAR(200),
    contact_phone VARCHAR(50),
    notes TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, [], cfg);

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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, [], cfg);

  // Migrate existing tables: add new columns if missing
  const alterCols = {
    bookings: ['booking_ref VARCHAR(20)', 'an VARCHAR(20)', 'ward VARCHAR(100)', 'doctor_name VARCHAR(200)', 'deposit_amount DECIMAL(10,2) DEFAULT 0', 'contact_name VARCHAR(200)', 'contact_phone VARCHAR(50)', 'priority_type VARCHAR(200)'],
    room_types: ['food_price_per_day DECIMAL(10,2) DEFAULT 0'],
    rooms: ['ward VARCHAR(100)'],
    waiting_list: ['an VARCHAR(20)', 'ward VARCHAR(100)', 'doctor_name VARCHAR(200)', 'contact_name VARCHAR(200)', 'contact_phone VARCHAR(50)', 'priority_type VARCHAR(200)', 'roomtype_code VARCHAR(50)', 'roomtype_name VARCHAR(200)', 'check_in_date VARCHAR(50)', 'no_room_reason TEXT', 'room_type_id_2 INT', 'roomtype_name_2 VARCHAR(200)', 'room_type_id_3 INT', 'roomtype_name_3 VARCHAR(200)', 'no_pay_reason TEXT']
  };
  for (const [tbl, cols] of Object.entries(alterCols)) {
    for (const col of cols) {
      const colName = col.split(' ')[0];
      try {
        if (isPg) {
          await query(`ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS ${col}`, [], cfg);
        } else {
          await query(`ALTER TABLE ${tbl} ADD COLUMN ${col}`, [], cfg);
        }
      } catch {}
    }
  }
}

// GET /api/rooms - all rooms with current occupant
router.get('/', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    await ensureTables(cfg);
    const rooms = await query(`
      SELECT r.*, rt.type_name, rt.price_per_day, rt.food_price_per_day,
        b.hn, b.patient_name, b.an, b.ward, b.doctor_name,
        b.check_in_date, b.check_out_date, b.booking_ref, b.id as booking_id
      FROM rooms r
      LEFT JOIN room_types rt ON r.room_type_id = rt.id
      LEFT JOIN bookings b ON b.room_id = r.id AND b.status IN ('reserved','occupied')
      ORDER BY r.floor, r.room_number
    `, [], cfg);
    res.json({ success: true, rooms });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/rooms/stats - occupancy summary from HIS
router.get('/stats', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const [allBeds, availBeds] = await Promise.all([
      query(SQL_ALL_BEDS, [], cfg),
      query(SQL_AVAILABLE_BEDS, [], cfg)
    ]);

    const total     = allBeds.length;
    const available = availBeds.length;
    const occupied  = total - available;

    const stats = {
      available,
      occupied,
      total,
      occupancy_rate: total > 0 ? Math.round((occupied / total) * 100) : 0
    };
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const SQL_AVAILABLE_BEDS = `
  SELECT b.bedno, r.ward
  FROM bedno b
  JOIN roomno r ON b.roomno = r.roomno
  JOIN roomtype rt ON rt.roomtype = r.roomtype
  JOIN ward w ON r.ward = w.ward
  LEFT JOIN (
    SELECT bedno, d.an, ipt.regdate, ipt.dchdate
    FROM iptadm d
    JOIN ipt ON d.an = ipt.an
    WHERE ipt.dchdate IS NULL
  ) tmp ON b.bedno = tmp.bedno
  WHERE b.bed_status_type_id = 1
    AND r.name NOT LIKE '%รอรับ%'
    AND rt.hos_guid = 'Y'
    AND w.ward_active = 'Y'
    AND tmp.an IS NULL
  GROUP BY b.bedno, r.ward
`;

const SQL_ALL_BEDS = `
  SELECT w.name as ward, rt.name as roomtype, rt.roomtype as roomtype_code, b.bedno, r.ward as ward_code, r.roomno, nd.price
  FROM bedno b
  LEFT OUTER JOIN roomno r ON r.roomno = b.roomno
  LEFT OUTER JOIN ward w ON w.ward = r.ward
  LEFT OUTER JOIN roomtype rt ON rt.roomtype = r.roomtype
  LEFT OUTER JOIN nondrugitems nd ON nd.icode = b.room_charge_icode
  WHERE rt.hos_guid = 'Y'
    AND w.ward_active = 'Y'
    AND b.bed_status_type_id = 1
  ORDER BY w.name, rt.name, b.bedno
`;

// GET /api/rooms/hosbed - derive status from HIS queries
router.get('/hosbed', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const [allBeds, availBeds] = await Promise.all([
      query(SQL_ALL_BEDS, [], cfg),
      query(SQL_AVAILABLE_BEDS, [], cfg)
    ]);

    const availSet = new Set(availBeds.map(r => r.bedno));

    const beds = allBeds.map(row => ({
      ward:          row.ward,
      roomtype:      row.roomtype,
      roomtype_code: row.roomtype_code,
      ward_code:     row.ward_code,
      roomno:        row.roomno,
      bedno:         row.bedno,
      price:         row.price,
      room_status: availSet.has(row.bedno) ? 'available' : 'occupied'
    }));

    res.json({ success: true, beds });
  } catch (err) {
    console.error('GET /api/rooms/hosbed error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/rooms/his-reserve-statuses - room_reserve_status from HIS
router.get('/his-reserve-statuses', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query(
      `SELECT room_reserve_status_id as id, room_reserve_status_name as name, hos_guid as status
       FROM room_reserve_status ORDER BY room_reserve_status_id`,
      [], cfg
    );
    res.json({ success: true, statuses: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/rooms/his-reserve-statuses/:id - update hos_guid
router.patch('/his-reserve-statuses/:id', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { hos_guid } = req.body;
  try {
    await query(
      `UPDATE room_reserve_status SET hos_guid = $1 WHERE room_reserve_status_id = $2`,
      [hos_guid, req.params.id], cfg
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/rooms/his-priority-types
router.get('/his-priority-types', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query(
      `SELECT room_priority_type_id as id, room_priority_type_name as name FROM room_priority_type ORDER BY room_priority_type_id`,
      [], cfg
    );
    res.json({ success: true, types: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/rooms/his-priority-types - insert new type
router.post('/his-priority-types', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อประเภทผู้จอง' });
  try {
    const maxRow = await query(`SELECT COALESCE(MAX(room_priority_type_id),0) as max_id FROM room_priority_type`, [], cfg);
    const newId = Number(maxRow[0]?.max_id || 0) + 1;
    await query(
      `INSERT INTO room_priority_type (room_priority_type_id, room_priority_type_name) VALUES ($1,$2)`,
      [newId, name.trim()], cfg
    );
    res.json({ success: true, id: newId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/rooms/his-priority-types/:id
router.delete('/his-priority-types/:id', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    await query(`DELETE FROM room_priority_type WHERE room_priority_type_id = $1`, [req.params.id], cfg);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/rooms/his-roomtypes - roomtype list from HIS
router.get('/his-roomtypes', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query(
      `SELECT roomtype, name, hos_guid as special FROM roomtype ORDER BY name`,
      [], cfg
    );
    res.json({ success: true, roomtypes: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/rooms/his-roomtypes/:code - toggle hos_guid
router.patch('/his-roomtypes/:code', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { special } = req.body;
  try {
    await query(
      `UPDATE roomtype SET hos_guid = $1 WHERE roomtype = $2`,
      [special === 'Y' ? 'Y' : 'N', req.params.code], cfg
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/rooms/types
router.get('/types', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    await ensureTables(cfg);
    const types = await query('SELECT * FROM room_types ORDER BY type_name', [], cfg);
    res.json({ success: true, types });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/rooms/types - add room type
router.post('/types', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { type_name, description, price_per_day, food_price_per_day } = req.body;
  if (!type_name) return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อประเภทห้อง' });
  try {
    await ensureTables(cfg);
    await query(
      `INSERT INTO room_types (type_name, description, price_per_day, food_price_per_day) VALUES ($1,$2,$3,$4)`,
      [type_name, description || '', price_per_day || 0, food_price_per_day || 0], cfg
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/rooms/types/:id - update room type
router.put('/types/:id', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { type_name, description, price_per_day, food_price_per_day } = req.body;
  if (!type_name) return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อประเภทห้อง' });
  try {
    await query(
      `UPDATE room_types SET type_name=$1, description=$2, price_per_day=$3, food_price_per_day=$4 WHERE id=$5`,
      [type_name, description || '', price_per_day || 0, food_price_per_day || 0, req.params.id], cfg
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/rooms/types/:id - delete room type
router.delete('/types/:id', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    await query(`DELETE FROM room_types WHERE id=$1`, [req.params.id], cfg);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/rooms - add room
router.post('/', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { room_number, room_type_id, floor, building, notes } = req.body;
  try {
    await ensureTables(cfg);
    await query(
      `INSERT INTO rooms (room_number, room_type_id, floor, building, status, notes) VALUES ($1,$2,$3,$4,'available',$5)`,
      [room_number, room_type_id, floor, building, notes], cfg
    );
    req.io.emit('room_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/rooms/:id/status
router.patch('/:id/status', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { status } = req.body;
  try {
    await query(
      `UPDATE rooms SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [status, req.params.id], cfg
    );
    req.io.emit('room_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/rooms/seed-demo
router.post('/seed-demo', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    await ensureTables(cfg);
    const types = [
      ['ห้องเดี่ยวมาตรฐาน', 'ห้องเดี่ยวพร้อมสิ่งอำนวยความสะดวกพื้นฐาน', 1500, 300],
      ['ห้องเดี่ยวพิเศษ', 'ห้องเดี่ยวพร้อมโทรทัศน์และตู้เย็น', 2500, 400],
      ['ห้อง VIP', 'ห้อง VIP ขนาดใหญ่ มีโซฟาและห้องน้ำส่วนตัว', 4500, 600],
      ['ห้อง Suite', 'ห้อง Suite พร้อมห้องนั่งเล่นแยก', 8000, 1000]
    ];
    for (const [name, desc, price, food] of types) {
      try {
        await query(
          `INSERT INTO room_types (type_name, description, price_per_day, food_price_per_day) VALUES ($1,$2,$3,$4)`,
          [name, desc, price, food], cfg
        );
      } catch {}
    }
    const typeRows = await query('SELECT id, type_name FROM room_types ORDER BY id', [], cfg);
    const typeMap = {};
    typeRows.forEach(t => { typeMap[t.type_name] = t.id; });

    const demoRooms = [
      ['301', typeMap['ห้องเดี่ยวมาตรฐาน'] || 1, '3', 'อาคาร A', 'available'],
      ['302', typeMap['ห้องเดี่ยวมาตรฐาน'] || 1, '3', 'อาคาร A', 'occupied'],
      ['303', typeMap['ห้องเดี่ยวพิเศษ'] || 2, '3', 'อาคาร A', 'available'],
      ['304', typeMap['ห้องเดี่ยวพิเศษ'] || 2, '3', 'อาคาร A', 'reserved'],
      ['305', typeMap['ห้องเดี่ยวพิเศษ'] || 2, '3', 'อาคาร A', 'cleaning'],
      ['401', typeMap['ห้อง VIP'] || 3, '4', 'อาคาร A', 'available'],
      ['402', typeMap['ห้อง VIP'] || 3, '4', 'อาคาร A', 'occupied'],
      ['403', typeMap['ห้อง VIP'] || 3, '4', 'อาคาร A', 'pending_discharge'],
      ['501', typeMap['ห้อง Suite'] || 4, '5', 'อาคาร B', 'available'],
      ['502', typeMap['ห้อง Suite'] || 4, '5', 'อาคาร B', 'occupied'],
    ];
    for (const [num, typeId, floor, building, status] of demoRooms) {
      try {
        await query(
          `INSERT INTO rooms (room_number, room_type_id, floor, building, status) VALUES ($1,$2,$3,$4,$5)`,
          [num, typeId, floor, building, status], cfg
        );
      } catch {}
    }
    req.io.emit('room_updated');
    res.json({ success: true, message: 'เพิ่มข้อมูลตัวอย่างเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
module.exports.ensureTables = ensureTables;
