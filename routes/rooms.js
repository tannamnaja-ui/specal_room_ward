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

  // ประวัติซ่อมแซม/แยกโรคของแต่ละเตียง (ตารางของแอปเอง ไม่ใช่ตาราง HIS) — 1 แถวต่อ 1 ครั้งที่ซ่อม/แยกโรค
  await query(`CREATE TABLE IF NOT EXISTS bed_status_history (
    id ${autoInc},
    bedno VARCHAR(20),
    status_type_id INT,
    status_name VARCHAR(50),
    start_date TIMESTAMP,
    end_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, [], cfg);

  // Migrate existing tables: add new columns if missing
  const alterCols = {
    bookings: ['booking_ref VARCHAR(20)', 'an VARCHAR(20)', 'ward VARCHAR(100)', 'doctor_name VARCHAR(200)', 'deposit_amount DECIMAL(10,2) DEFAULT 0', 'contact_name VARCHAR(200)', 'contact_phone VARCHAR(50)', 'priority_type VARCHAR(200)', 'waiting_list_id INT'],
    room_types: ['food_price_per_day DECIMAL(10,2) DEFAULT 0'],
    rooms: ['ward VARCHAR(100)'],
    waiting_list: ['an VARCHAR(20)', 'ward VARCHAR(100)', 'doctor_name VARCHAR(200)', 'contact_name VARCHAR(200)', 'contact_phone VARCHAR(50)', 'priority_type VARCHAR(200)', 'roomtype_code VARCHAR(50)', 'roomtype_name VARCHAR(200)', 'check_in_date VARCHAR(50)', 'no_room_reason TEXT', 'room_type_id_2 INT', 'roomtype_name_2 VARCHAR(200)', 'room_type_id_3 INT', 'roomtype_name_3 VARCHAR(200)', 'no_pay_reason TEXT'],
    // ตาราง bedno เป็นตารางของ HIS เอง (ไม่ใช่ตารางที่แอปนี้สร้าง) — เพิ่มฟิลวันที่+เวลาซ่อมเตียง/วันที่ใช้เป็นห้องแยกโรค
    bedno: ['repair_start_date TIMESTAMP', 'repair_end_date TIMESTAMP', 'isolation_start_date TIMESTAMP', 'isolation_end_date TIMESTAMP']
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

  // ฟิลวันที่ซ่อม/แยกโรคของ bedno เดิมเป็น DATE (ไม่มีเวลา) — อัปเกรดเป็น TIMESTAMP ให้คำนวณจำนวนชั่วโมงได้จริง
  const bednoDateCols = ['repair_start_date', 'repair_end_date', 'isolation_start_date', 'isolation_end_date'];
  for (const col of bednoDateCols) {
    try {
      if (isPg) {
        await query(`ALTER TABLE bedno ALTER COLUMN ${col} TYPE TIMESTAMP USING ${col}::timestamp`, [], cfg);
      } else {
        await query(`ALTER TABLE bedno MODIFY COLUMN ${col} TIMESTAMP NULL`, [], cfg);
      }
    } catch {}
  }
}

// บันทึก/อัปเดตประวัติซ่อมแซม-แยกโรค 1 ครั้ง ผูกด้วย (bedno, status_type_id, start_date)
// ถ้าเจอแถวเดิมที่ start_date ตรงกัน แปลว่าเป็นการแก้ไขครั้งเดิม (เช่น เพิ่งมาใส่วันที่เสร็จทีหลัง) ให้ update แทนการเพิ่มซ้ำ
async function upsertBedStatusHistory(cfg, bedno, statusTypeId, statusName, startDate, endDate) {
  if (!startDate) return;
  const existing = await query(
    `SELECT id FROM bed_status_history WHERE bedno=$1 AND status_type_id=$2 AND start_date=$3 LIMIT 1`,
    [bedno, statusTypeId, startDate], cfg
  );
  if (existing && existing.length > 0) {
    await query(`UPDATE bed_status_history SET end_date=$1 WHERE id=$2`, [endDate || null, existing[0].id], cfg);
  } else {
    await query(
      `INSERT INTO bed_status_history (bedno, status_type_id, status_name, start_date, end_date) VALUES ($1,$2,$3,$4,$5)`,
      [bedno, statusTypeId, statusName, startDate, endDate || null], cfg
    );
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
  SELECT w.name as ward, rt.name as roomtype, rt.roomtype as roomtype_code, b.bedno, r.ward as ward_code, r.roomno, nd.price,
         b.bed_status_type_id, bst.bed_status_type_name, b.repair_start_date, b.isolation_start_date
  FROM bedno b
  LEFT OUTER JOIN roomno r ON r.roomno = b.roomno
  LEFT OUTER JOIN ward w ON w.ward = r.ward
  LEFT OUTER JOIN roomtype rt ON rt.roomtype = r.roomtype
  LEFT OUTER JOIN nondrugitems nd ON nd.icode = b.room_charge_icode
  LEFT OUTER JOIN bed_status_type bst ON bst.bed_status_type_id = b.bed_status_type_id
  WHERE rt.hos_guid = 'Y'
    AND w.ward_active = 'Y'
    AND b.bed_status_type_id <> 3
  ORDER BY w.name, rt.name, b.bedno
`;

// bed_status_type_id: 1=เตียงใช้งาน 2=จ่ายเตียง(ญาติใช้ห้อง) 3=ปิดเตียง(ไม่แสดง) 4=ซ่อมแซม 5=แยกโรค
function deriveBedStatus(row, availSet) {
  if (row.bed_status_type_id === 4) return 'repair';
  if (row.bed_status_type_id === 5) return 'isolation';
  if (row.bed_status_type_id === 2) return 'relative';
  return availSet.has(row.bedno) ? 'available' : 'occupied';
}

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
      repair_start_date:    row.repair_start_date,
      isolation_start_date: row.isolation_start_date,
      room_status: deriveBedStatus(row, availSet)
    }));

    res.json({ success: true, beds });
  } catch (err) {
    console.error('GET /api/rooms/hosbed error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/rooms/manage-special-rooms - สถานะเตียงห้องพิเศษทุกวอร์ด (เตียงใช้งาน/ซ่อมแซม — ไม่รวมเตียงที่ปิด)
router.get('/manage-special-rooms', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query(`
      select w.name as ward, rt.name as roomtype, b.bedno, b.bed_status_type_id,
             case when b.bed_status_type_id = 1 and occ.an is not null
                  then 'มีผู้ป่วยใช้ห้อง' else bs.bed_status_type_name end as bed_status_type_name,
             case
               when b.bed_status_type_id = 4 then 'repair'
               when b.bed_status_type_id = 5 then 'isolation'
               when b.bed_status_type_id = 2 then 'relative'
               when b.bed_status_type_id = 1 and occ.an is not null then 'occupied'
               when b.bed_status_type_id = 1 then 'available'
               else 'other'
             end as status_key,
             nd.price,
             b.repair_start_date, b.repair_end_date, b.isolation_start_date, b.isolation_end_date
      from bedno b
      left join roomno r on r.roomno=b.roomno
      left join bed_status_type bs on bs.bed_status_type_id=b.bed_status_type_id
      left join ward w on w.ward=r.ward
      left join roomtype  rt on rt.roomtype=r.roomtype
      left join nondrugitems nd on nd.icode = b.room_charge_icode
      left join bedtype bt on bt.bedtype=b.bedtype
      left join (
        select d.bedno, d.an from iptadm d join ipt on d.an = ipt.an where ipt.dchdate is null
      ) occ on occ.bedno = b.bedno
      where w.ward_active='Y' and rt.hos_guid='Y' and b.bed_status_type_id <> 3
        and bt.hos_guid='Y'
      order by w.name,rt.name,b.bedno,bed_status_type_name
    `, [], cfg);
    res.json({ success: true, beds: rows });
  } catch (err) {
    console.error('GET /api/rooms/manage-special-rooms error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/rooms/bed-detail/:bedno - รายละเอียดทุกฟิลของเตียง (สำหรับ popup แก้ไข)
router.get('/bed-detail/:bedno', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    await ensureTables(cfg); // การันตีว่า bedno มีฟิล repair_start_date/repair_end_date แล้ว
    const rows = await query(`
      SELECT b.*, nd.price as special_room_price
      FROM bedno b
      LEFT JOIN nondrugitems nd ON nd.icode = b.room_charge_icode
      WHERE b.bedno = $1 LIMIT 1
    `, [req.params.bedno], cfg);
    if (!rows || rows.length === 0) return res.status(404).json({ success: false, message: 'ไม่พบเตียงนี้' });
    res.json({ success: true, bed: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/rooms/bed-detail/:bedno - บันทึกการแก้ไขเตียงลงตาราง bedno จริง (ยกเว้น bedno เอง)
router.patch('/bed-detail/:bedno', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const {
    roomno, bedtype, bed_status_type_id, bed_order,
    repair_start_date, repair_end_date,
    isolation_start_date, isolation_end_date
  } = req.body;
  try {
    await ensureTables(cfg);
    await query(
      `UPDATE bedno SET roomno=$1, bedtype=$2, bed_status_type_id=$3, bed_order=$4, repair_start_date=$5, repair_end_date=$6,
       isolation_start_date=$7, isolation_end_date=$8
       WHERE bedno=$9`,
      [
        roomno || null,
        bedtype || null,
        bed_status_type_id || null,
        bed_order || null,
        repair_start_date || null,
        repair_end_date || null,
        isolation_start_date || null,
        isolation_end_date || null,
        req.params.bedno
      ],
      cfg
    );

    const statusIdNum = bed_status_type_id ? Number(bed_status_type_id) : null;
    if (statusIdNum === 4) {
      await upsertBedStatusHistory(cfg, req.params.bedno, 4, 'ซ่อมแซม', repair_start_date || null, repair_end_date || null);
    } else if (statusIdNum === 5) {
      await upsertBedStatusHistory(cfg, req.params.bedno, 5, 'แยกโรค', isolation_start_date || null, isolation_end_date || null);
    }

    req.io.emit('room_updated');
    res.json({ success: true, message: 'บันทึกข้อมูลเตียงเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/rooms/bed-status-history - ประวัติซ่อมแซม/แยกโรคทั้งหมด (หรือกรองเฉพาะเตียงเดียวด้วย ?bedno=)
router.get('/bed-status-history', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    await ensureTables(cfg);
    const { bedno } = req.query;
    const params = [];
    let where = '';
    if (bedno) { params.push(bedno); where = 'WHERE h.bedno = $1'; }
    const rows = await query(`
      SELECT h.*, rn.name as room_name, w.name as ward_name
      FROM bed_status_history h
      LEFT JOIN bedno b ON b.bedno = h.bedno
      LEFT JOIN roomno rn ON rn.roomno = b.roomno
      LEFT JOIN ward w ON w.ward = rn.ward
      ${where}
      ORDER BY h.start_date DESC
    `, params, cfg);
    res.json({ success: true, history: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/rooms/bed-status-types - ตัวเลือกสถานะเตียงทั้งหมด (bed_status_type)
router.get('/bed-status-types', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query(`SELECT bed_status_type_id, bed_status_type_name FROM bed_status_type ORDER BY bed_status_type_id`, [], cfg);
    res.json({ success: true, types: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/rooms/bedtypes - ตัวเลือกประเภทเตียงทั้งหมด (bedtype)
router.get('/bedtypes', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query(`SELECT bedtype, name FROM bedtype ORDER BY bedtype`, [], cfg);
    res.json({ success: true, types: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/rooms/roomno-options - ตัวเลือกห้อง (roomno) ในวอร์ดที่ยัง active และเป็นห้องพิเศษ
router.get('/roomno-options', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query(`
      SELECT r.roomno, r.name, w.name as ward_name
      FROM roomno r
      LEFT JOIN ward w ON w.ward = r.ward
      LEFT JOIN roomtype rt ON rt.roomtype = r.roomtype
      WHERE w.ward_active = 'Y' AND rt.hos_guid = 'Y'
      ORDER BY w.name, r.name
    `, [], cfg);
    res.json({ success: true, rooms: rows });
  } catch (err) {
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

// GET /api/rooms/bedtype-list - ประเภทเตียง (bedtype) สำหรับหน้าตั้งค่าระบบ
router.get('/bedtype-list', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query(
      `SELECT bedtype, name, TRIM(hos_guid) as special FROM bedtype ORDER BY name`,
      [], cfg
    );
    res.json({ success: true, bedtypes: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/rooms/bedtype-list/:code - toggle hos_guid (เลือก = 'Y' ทันที)
router.patch('/bedtype-list/:code', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { special } = req.body;
  try {
    await query(
      `UPDATE bedtype SET hos_guid = $1 WHERE bedtype = $2`,
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
