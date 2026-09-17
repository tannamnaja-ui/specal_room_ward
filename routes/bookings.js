const express = require('express');
const router = express.Router();
const { query, loadSettings } = require('../config/db');

function authCheck(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
  next();
}

function genBookingRef(id) {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `BK${y}${m}${d}${String(id).padStart(4, '0')}`;
}

// Search patients (modal) — by HN or name
router.get('/patient-search', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { q } = req.query;
  if (!q || q.trim().length < 1) return res.json({ success: true, patients: [] });
  const like = `%${q.trim()}%`;
  try {
    let patients = null;
    const queries = [
      `SELECT hn, concat(pname,fname,' ',lname) as patient_name FROM patient WHERE hn LIKE $1 OR fname LIKE $1 OR lname LIKE $1 ORDER BY hn LIMIT 30`,
      `SELECT hn, concat(fname,' ',lname) as patient_name FROM patient WHERE hn LIKE $1 OR fname LIKE $1 OR lname LIKE $1 ORDER BY hn LIMIT 30`,
    ];
    for (const sql of queries) {
      try {
        const rows = await query(sql, [like], cfg);
        if (rows !== null) { patients = rows; break; }
      } catch {}
    }
    res.json({ success: true, patients: patients || [] });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Search admissions (modal) — by AN or HN or name (ipt only active)
router.get('/admission-search', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { q } = req.query;
  if (!q || q.trim().length < 1) return res.json({ success: true, admissions: [] });
  const like = `%${q.trim()}%`;
  try {
    let admissions = null;
    const queries = [
      `SELECT i.an, i.hn, concat(p.pname,p.fname,' ',p.lname) as patient_name, to_char(i.regdate,'DD/MM/YY') as admit_date
       FROM ipt i LEFT OUTER JOIN patient p ON p.hn = i.hn
       WHERE i.dchdate IS NULL AND (i.an LIKE $1 OR i.hn LIKE $1 OR p.fname LIKE $1 OR p.lname LIKE $1)
       ORDER BY i.regdate DESC LIMIT 30`,
      `SELECT i.an, i.hn, concat(p.fname,' ',p.lname) as patient_name, i.regdate::text as admit_date
       FROM ipt i LEFT OUTER JOIN patient p ON p.hn = i.hn
       WHERE i.dchdate IS NULL AND (i.an LIKE $1 OR i.hn LIKE $1 OR p.fname LIKE $1 OR p.lname LIKE $1)
       ORDER BY i.regdate DESC LIMIT 30`,
    ];
    for (const sql of queries) {
      try {
        const rows = await query(sql, [like], cfg);
        if (rows !== null) { admissions = rows; break; }
      } catch {}
    }
    res.json({ success: true, admissions: admissions || [] });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Search patient by HN
router.get('/patient/:hn', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { hn } = req.params;
  try {
    let patient = null;
    const queries = [
      `SELECT hn, concat(pname,fname,' ',lname) as patient_name, mobile_phone_number FROM patient WHERE hn = $1 LIMIT 1`,
      `SELECT hn, concat(fname,' ',lname) as patient_name, mobile_phone_number FROM patient WHERE hn = $1 LIMIT 1`,
    ];
    for (const sql of queries) {
      try {
        const rows = await query(sql, [hn], cfg);
        if (rows && rows.length > 0) { patient = rows[0]; break; }
      } catch {}
    }
    if (patient) return res.json({ success: true, patient });
    res.json({ success: false, message: 'ไม่พบข้อมูลผู้ป่วย HN: ' + hn });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// หา AN ที่ยัง confirm_discharge ไม่เป็น 'Y' จาก HN (ใช้ตอนคีย์ค้นหาด้วย HN ในฟอร์มจอง
// เพื่อดึงข้อมูล admit มาแสดงให้ครบเหมือนค้นหาด้วย AN โดยตรง)
router.get('/an-by-hn/:hn', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { hn } = req.params;
  try {
    const rows = await query(
      `SELECT an FROM ipt WHERE hn = $1 AND (confirm_discharge IS NULL OR confirm_discharge <> 'Y') ORDER BY regdate DESC LIMIT 1`,
      [hn], cfg
    );
    if (rows && rows.length > 0 && rows[0].an) {
      return res.json({ success: true, an: rows[0].an });
    }
    res.json({ success: false, message: 'ไม่พบ Admission ที่ยังไม่ยืนยันจำหน่ายสำหรับ HN นี้' });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Get ward + doctor from AN (single call)
router.get('/info-by-an/:an', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { an } = req.params;
  try {
    const [wardRows, doctorRows, rightsRows, admitRows] = await Promise.all([
      query(
        `SELECT w.name as ward_name FROM ipt i LEFT OUTER JOIN ward w ON w.ward = i.ward WHERE i.an = $1 AND w.ward_active = 'Y' LIMIT 1`,
        [an], cfg
      ),
      query(
        `SELECT d.name as doctor_name FROM ipt i
         LEFT JOIN ipt_doctor_list dl ON dl.an = i.an
         LEFT JOIN doctor d ON d.code = dl.doctor
         WHERE i.an = $1 AND dl.active_doctor = 'Y' LIMIT 1`,
        [an], cfg
      ),
      query(
        `SELECT p.pttype as rights_code, p.name as rights_name FROM ipt i
         LEFT JOIN pttype p ON p.pttype = i.pttype
         WHERE i.an = $1 LIMIT 1`,
        [an], cfg
      ),
      query(
        `SELECT i.regdate as admit_date FROM ipt i WHERE i.an = $1 LIMIT 1`,
        [an], cfg
      )
    ]);
    const r = rightsRows?.[0];
    const rightsDisplay = r ? [r.rights_code, r.rights_name].filter(Boolean).join(' ') : null;
    res.json({
      success:     true,
      ward_name:   wardRows?.[0]?.ward_name    || null,
      doctor_name: doctorRows?.[0]?.doctor_name || null,
      rights_name: rightsDisplay,
      admit_date:  admitRows?.[0]?.admit_date   || null
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Get ward name from AN
router.get('/ward-by-an/:an', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { an } = req.params;
  try {
    const rows = await query(
      `SELECT w.name as ward_name FROM ipt i LEFT OUTER JOIN ward w ON w.ward = i.ward WHERE i.an = $1 AND w.ward_active = 'Y' LIMIT 1`,
      [an], cfg
    );
    if (rows && rows.length > 0 && rows[0].ward_name)
      return res.json({ success: true, ward_name: rows[0].ward_name });
    res.json({ success: false, message: 'ไม่พบข้อมูล Ward' });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// Search patient rights by HN — ดึงจาก patient_pttype.pttype (สิทธิปัจจุบันของผู้ป่วย)
router.get('/rights/:hn', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { hn } = req.params;
  try {
    let rows = null;

    // 1) ดึงจาก patient_pttype — ครอบ try-catch แยก เพราะตารางอาจไม่มีในบาง HIS
    try {
      rows = await query(
        `SELECT pp.pttype AS rights_type, p.name AS rights_name
         FROM patient_pttype pp
         LEFT JOIN pttype p ON p.pttype = pp.pttype
         WHERE pp.hn = $1
         ORDER BY pp.date_start DESC LIMIT 1`,
        [hn], cfg
      );
    } catch (_) {
      rows = null;
    }

    // 2) fallback — admission ที่ยังอยู่โรงพยาบาล (dchdate IS NULL)
    if (!rows || rows.length === 0 || !rows[0].rights_type) {
      rows = await query(
        `SELECT i.pttype AS rights_type, p.name AS rights_name
         FROM ipt i
         LEFT JOIN pttype p ON p.pttype = i.pttype
         WHERE i.hn = $1 AND i.dchdate IS NULL
         ORDER BY i.regdate DESC LIMIT 1`,
        [hn], cfg
      );
    }

    // 3) fallback สุดท้าย — admission ล่าสุดแม้จำหน่ายแล้ว
    if (!rows || rows.length === 0 || !rows[0].rights_type) {
      rows = await query(
        `SELECT i.pttype AS rights_type, p.name AS rights_name
         FROM ipt i
         LEFT JOIN pttype p ON p.pttype = i.pttype
         WHERE i.hn = $1
         ORDER BY i.regdate DESC LIMIT 1`,
        [hn], cfg
      );
    }

    if (rows && rows.length > 0 && rows[0].rights_type) {
      const r = rows[0];
      r.rights_display = [r.rights_type, r.rights_name].filter(Boolean).join(' ');
      return res.json({ success: true, rights: r });
    }

    res.json({ success: false, message: 'ไม่พบข้อมูลสิทธิ์การรักษา' });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// GET current occupants from HIS
router.get('/occupants', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query(`
      SELECT w.name as ward, rt.name as roomtype, b.bedno, r.ward as ward_code,
             tmp.an, i.regdate,
             concat(p.pname, p.fname, '  ', p.lname) as ptname,
             dd.name as doctor,
             EXISTS (
               SELECT 1 FROM bookings bk
               WHERE bk.room_number = b.bedno
                 AND bk.status = 'reserved'
             ) as has_next_reserve
      FROM bedno b
      LEFT OUTER JOIN roomno r ON b.roomno = r.roomno
      LEFT OUTER JOIN roomtype rt ON rt.roomtype = r.roomtype
      LEFT OUTER JOIN ward w ON r.ward = w.ward
      LEFT JOIN (
        SELECT bedno, d.an, ipt.regdate, ipt.dchdate
        FROM iptadm d
        LEFT OUTER JOIN ipt ON d.an = ipt.an
        WHERE ipt.dchdate IS NULL
      ) tmp ON b.bedno = tmp.bedno
      LEFT OUTER JOIN ipt i ON i.an = tmp.an
      LEFT OUTER JOIN patient p ON p.hn = i.hn
      LEFT OUTER JOIN ipt_doctor_list idl ON idl.an = i.an
      LEFT OUTER JOIN doctor dd ON dd.code = idl.doctor AND idl.active_doctor = 'Y'
      WHERE b.bed_status_type_id = 1
        AND r.name NOT LIKE '%รอรับ%'
        AND rt.hos_guid = 'Y'
        AND w.ward_active = 'Y'
        AND tmp.an IS NOT NULL
        AND (
          COALESCE(NULL, '') = ''
          OR (NULL = 'NULL' AND w.spclty IS NULL)
          OR w.spclty LIKE CONCAT('%', NULL, '%')
        )
      GROUP BY w.name, rt.name, b.bedno, r.ward, tmp.an, i.regdate,
               p.pname, p.fname, p.lname, dd.name
      ORDER BY w.name, rt.name, b.bedno
    `, [], cfg);
    res.json({ success: true, occupants: rows });
  } catch (err) {
    console.error('GET /api/bookings/occupants error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET all currently admitted patients grouped by ward (ทุก ward ไม่จำกัดเฉพาะห้องพิเศษ)
router.get('/ward-patients', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    // ipt_doctor_list มีได้หลายแถวต่อ AN (ร่วมรักษา/ที่ปรึกษา/บันทึกซ้ำจริงในข้อมูล) ทำให้ผู้ป่วย 1 คน
    // ขึ้นซ้ำหลายแถวถ้า join ตรง ๆ — ใช้ DISTINCT ON เลือกแค่ "แพทย์เจ้าของคนไข้" (ipt_doctor_type_id=1)
    // ที่ active เท่านั้น 1 คนต่อ AN (เรียงตาม incharge_date ล่าสุด แล้ว id ล่าสุด กันกรณีข้อมูลซ้ำเป๊ะ)
    const rows = await query(`
      WITH primary_doctor AS (
        SELECT DISTINCT ON (an) an, doctor
        FROM ipt_doctor_list
        WHERE active_doctor = 'Y' AND ipt_doctor_type_id = 1
        ORDER BY an, incharge_date DESC NULLS LAST, ipt_doctor_list_id DESC
      )
      SELECT w.name as ward, i.hn, i.an, i.regdate,
             concat(p.pname, p.fname, '  ', p.lname) as ptname,
             b.bedno,
             dd.name as doctor,
             EXISTS (
               SELECT 1 FROM waiting_list wl
               WHERE wl.status = 'waiting'
                 AND (wl.an = i.an OR (wl.an IS NULL AND wl.hn = i.hn))
             ) as waiting_special_room
      FROM ipt i
      LEFT OUTER JOIN ward w ON w.ward = i.ward
      LEFT OUTER JOIN patient p ON p.hn = i.hn
      LEFT OUTER JOIN iptadm ia ON ia.an = i.an
      LEFT OUTER JOIN bedno b ON b.bedno = ia.bedno
      LEFT OUTER JOIN primary_doctor pd ON pd.an = i.an
      LEFT OUTER JOIN doctor dd ON dd.code = pd.doctor
      WHERE i.dchdate IS NULL
        AND w.ward_active = 'Y'
      GROUP BY w.name, i.hn, i.an, i.regdate, p.pname, p.fname, p.lname, b.bedno, dd.name
      ORDER BY w.name, i.regdate
    `, [], cfg);
    res.json({ success: true, patients: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET bookings for a specific bedno (right panel)
router.get('/room-bookings/:bedno', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query(`
      SELECT b.booking_ref, b.an, b.patient_name, b.doctor_name,
             b.check_in_date, b.check_out_date, b.rights_type,
             b.ward, b.status, b.notes
      FROM bookings b
      WHERE b.room_number = $1
        AND b.status IN ('reserved','occupied')
      ORDER BY b.check_in_date ASC
    `, [req.params.bedno], cfg);
    res.json({ success: true, bookings: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET all wards from HIS for booking form
router.get('/his-wards', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query(`
      SELECT w.ward, w.name
      FROM roomtype rt
      LEFT OUTER JOIN roomno r ON r.roomtype = rt.roomtype
      LEFT OUTER JOIN ward w ON w.ward = r.ward
      WHERE rt.hos_guid = 'Y'
        AND w.ward_active = 'Y'
      GROUP BY w.ward, w.name
      ORDER BY w.name
    `, [], cfg);
    res.json({ success: true, wards: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET room types from HIS for booking form — ward optional (filters to types that exist in that ward)
router.get('/his-roomtypes', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { ward } = req.query;
  try {
    let sql, params;
    if (ward) {
      sql = `
        SELECT DISTINCT rt.roomtype, rt.name
        FROM roomtype rt
        JOIN roomno r ON r.roomtype = rt.roomtype
        WHERE rt.hos_guid = 'Y'
          AND r.ward = $1
        ORDER BY rt.name`;
      params = [ward];
    } else {
      sql = `
        SELECT roomtype, name FROM roomtype
        WHERE hos_guid = 'Y'
        ORDER BY name`;
      params = [];
    }
    const rows = await query(sql, params, cfg);
    res.json({ success: true, roomtypes: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET rooms from HIS for booking form — ward + roomtype required, only rooms with at least one available bed
router.get('/his-rooms', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { ward, roomtype } = req.query;
  if (!ward || !roomtype) return res.json({ success: true, rooms: [] });
  try {
    const rows = await query(`
      SELECT r.roomno, r.name
      FROM roomno r
      JOIN bedno b ON b.roomno = r.roomno
      LEFT JOIN (
        SELECT bedno FROM iptadm d
        JOIN ipt ON d.an = ipt.an
        WHERE ipt.dchdate IS NULL
      ) occ ON b.bedno = occ.bedno
      LEFT JOIN bookings bk ON bk.room_number = b.bedno AND bk.status IN ('reserved','occupied')
      WHERE r.ward = $1
        AND r.roomtype = $2
        AND b.bed_status_type_id = 1
        AND r.name NOT LIKE '%รอรับ%'
        AND occ.bedno IS NULL
        AND bk.id IS NULL
      GROUP BY r.roomno, r.name
      ORDER BY r.name
    `, [ward, roomtype], cfg);
    res.json({ success: true, rooms: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET available beds from HIS — roomtype required, ward/roomno optional (roomno scopes to one room)
router.get('/his-beds', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { ward, roomtype, roomno } = req.query;
  if (!roomtype) return res.json({ success: true, beds: [] });
  try {
    const params = [];
    const conditions = [];
    if (roomno) { params.push(roomno); conditions.push(`r.roomno = $${params.length}`); }
    if (ward)   { params.push(ward);   conditions.push(`r.ward = $${params.length}`); }
    params.push(roomtype); conditions.push(`r.roomtype = $${params.length}`);
    conditions.push(`b.bed_status_type_id = 1`);
    conditions.push(`r.name NOT LIKE '%รอรับ%'`);
    conditions.push(`occ.bedno IS NULL`);
    conditions.push(`bk.id IS NULL`);

    const sql = `
      SELECT b.bedno, nd.price
      FROM bedno b
      JOIN roomno r ON b.roomno = r.roomno
      LEFT JOIN nondrugitems nd ON nd.icode = b.room_charge_icode
      LEFT JOIN (
        SELECT bedno FROM iptadm d
        JOIN ipt ON d.an = ipt.an
        WHERE ipt.dchdate IS NULL
      ) occ ON b.bedno = occ.bedno
      LEFT JOIN bookings bk ON bk.room_number = b.bedno AND bk.status IN ('reserved','occupied')
      WHERE ${conditions.join(' AND ')}
      ORDER BY b.bedno`;
    const rows = await query(sql, params, cfg);
    res.json({ success: true, beds: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET priority types for booking form
router.get('/priority-types', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query(
      `SELECT room_priority_type_name as name FROM room_priority_type ORDER BY room_priority_type_id`,
      [], cfg
    );
    res.json({ success: true, types: rows });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// GET all active bookings
router.get('/', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query(`
      SELECT b.*, rt.type_name, rt.price_per_day, rt.food_price_per_day
      FROM bookings b
      LEFT JOIN room_types rt ON b.room_type_id = rt.id
      WHERE b.status NOT IN ('cancelled','checked_out')
      ORDER BY b.created_at DESC
    `, [], cfg);
    res.json({ success: true, bookings: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create booking
router.post('/', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const {
    hn, an, patient_name, ward, doctor_name,
    room_id, room_number, room_type_id,
    check_in_date, check_out_date,
    rights_type, deposit_amount, contact_name, contact_phone,
    priority_type, notes,
    ward_code, roomtype_code,
    waiting_list_id
  } = req.body;

  try {
    // Double-booking check: by room_id or room_number
    const dupRows = room_id
      ? await query(`SELECT id FROM bookings WHERE room_id = $1 AND status IN ('reserved','occupied') LIMIT 1`, [room_id], cfg)
      : await query(`SELECT id FROM bookings WHERE room_number = $1 AND status IN ('reserved','occupied') LIMIT 1`, [room_number], cfg);
    if (dupRows && dupRows.length > 0)
      return res.status(409).json({ success: false, message: 'กรุณาเลือกห้องที่จะจอง ถ้ายังไม่มีห้องกรุณาเพิ่มในคิวรอ', type: 'warning' });

    // Insert booking (without booking_ref first)
    await query(
      `INSERT INTO bookings
        (hn, an, patient_name, ward, doctor_name, room_id, room_number, room_type_id,
         check_in_date, check_out_date, rights_type, deposit_amount,
         contact_name, contact_phone, priority_type, notes, status, created_by, waiting_list_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'reserved',$17,$18)`,
      [hn, an||null, patient_name, ward||null, doctor_name||null,
       room_id, room_number, room_type_id,
       check_in_date, check_out_date||null,
       rights_type||null, deposit_amount||0,
       contact_name||null, contact_phone||null,
       priority_type||null, notes||null,
       req.session.user.login_name,
       waiting_list_id ? parseInt(waiting_list_id) : null],
      cfg
    );

    // Get inserted ID and set booking_ref
    const last = await query(
      `SELECT id FROM bookings WHERE hn = $1 AND room_id = $2 ORDER BY id DESC LIMIT 1`,
      [hn, room_id], cfg
    );
    if (last && last.length > 0) {
      const newId = last[0].id;
      const ref = genBookingRef(newId);
      await query(`UPDATE bookings SET booking_ref = $1 WHERE id = $2`, [ref, newId], cfg);
    }

    if (room_id) await query(`UPDATE rooms SET status = 'reserved', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [room_id], cfg);

    // INSERT into roomtype_reserve (HIS)
    let hisWarning = null;
    try {
      const statusRows = await query(
        `SELECT room_reserve_status_id FROM room_reserve_status WHERE hos_guid = 'reserved' LIMIT 1`,
        [], cfg
      );
      let statusId = statusRows?.[0]?.room_reserve_status_id ?? null;
      if (!statusId) {
        const fallback = await query(
          `SELECT room_reserve_status_id FROM room_reserve_status ORDER BY room_reserve_status_id LIMIT 1`,
          [], cfg
        );
        statusId = fallback?.[0]?.room_reserve_status_id ?? null;
      }
      const now = new Date();
      const reserveDate = now.toISOString().split('T')[0];
      const reserveTime = now.toTimeString().slice(0, 8);
      const estAdmDate  = check_in_date ? check_in_date.split('T')[0] : null;
      await query(
        `INSERT INTO roomtype_reserve
           (roomtype_reserve_id, hn, an, contact_person, contact_phone, ward, roomtype, bedno,
            est_adm_date, est_dch_date, deposit, reserve_note,
            reserve_date, reserve_time, room_reserve_status_id, waiting_list_id)
         VALUES (get_serialnumber('roomtype_reserve_id'),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [hn, an||null, contact_name||null, contact_phone||null,
         ward_code||null, roomtype_code||null, room_number||null,
         estAdmDate, check_out_date||null,
         deposit_amount ? parseFloat(deposit_amount) : null,
         notes||null, reserveDate, reserveTime, statusId,
         waiting_list_id ? parseInt(waiting_list_id) : null],
        cfg
      );
    } catch (e) {
      hisWarning = `บันทึกหลักสำเร็จ แต่บันทึก roomtype_reserve ไม่สำเร็จ: ${e.message}`;
    }

    // Update waiting_list status to 'reserved' if came from waitlist
    if (waiting_list_id) {
      try {
        await query(
          `UPDATE waiting_list SET status = 'reserved' WHERE id = $1`,
          [parseInt(waiting_list_id)], cfg
        );
      } catch (e) {}
    }

    req.io.emit('room_updated');
    res.json({ success: true, message: 'บันทึกการจองเรียบร้อย', warning: hisWarning });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH check-in
router.patch('/:id/checkin', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query('SELECT * FROM bookings WHERE id = $1', [req.params.id], cfg);
    if (!rows || rows.length === 0) return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลการจอง' });
    const booking = rows[0];
    await query(
      `UPDATE bookings SET status = 'occupied', actual_check_in = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [req.params.id], cfg
    );
    await query(`UPDATE rooms SET status = 'occupied', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [booking.room_id], cfg);
    req.io.emit('room_updated');
    res.json({ success: true, message: 'Check-in เรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH pending discharge (แจ้งกำลังจะ Discharge)
router.patch('/:id/pending-discharge', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query('SELECT * FROM bookings WHERE id = $1', [req.params.id], cfg);
    if (!rows || rows.length === 0) return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลการจอง' });
    const booking = rows[0];
    await query(`UPDATE rooms SET status = 'pending_discharge', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [booking.room_id], cfg);
    req.io.emit('room_updated');
    res.json({ success: true, message: 'อัปเดตสถานะ: กำลังจะจำหน่าย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH check-out
router.patch('/:id/checkout', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query('SELECT * FROM bookings WHERE id = $1', [req.params.id], cfg);
    if (!rows || rows.length === 0) return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลการจอง' });
    const booking = rows[0];
    await query(
      `UPDATE bookings SET status = 'checked_out', actual_check_out = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [req.params.id], cfg
    );
    await query(`UPDATE rooms SET status = 'cleaning', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [booking.room_id], cfg);
    req.io.emit('room_updated');
    res.json({ success: true, message: 'Check-out เรียบร้อย ห้องอยู่ระหว่างทำความสะอาด' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH cancel
router.patch('/:id/cancel', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const rows = await query('SELECT * FROM bookings WHERE id = $1', [req.params.id], cfg);
    if (!rows || rows.length === 0) return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลการจอง' });
    const booking = rows[0];
    await query(`UPDATE bookings SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [req.params.id], cfg);
    await query(`UPDATE rooms SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [booking.room_id], cfg);
    req.io.emit('room_updated');
    res.json({ success: true, message: 'ยกเลิกการจองเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/bookings/allqueue — combined waiting+reserved with ipt ward name + roomtype_reserve est_adm_date
router.get('/allqueue', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const isPg = cfg.db_type === 'postgresql';
  const rrDateExpr = isPg
    ? `est_adm_date::text`
    : `DATE_FORMAT(est_adm_date, '%Y-%m-%d')`;
  try {
    const [waitRows, bkRows] = await Promise.all([
      query(`
        SELECT w.id, w.hn, w.an, w.patient_name,
               w.ward AS booked_ward, w.rights_type, w.request_date,
               w.check_in_date, w.notes, w.priority_type,
               COALESCE(w.roomtype_name, rt.type_name) AS type_name,
               COALESCE(w.roomtype_name_2, rt2.type_name) AS type_name_2,
               COALESCE(w.roomtype_name_3, rt3.type_name) AS type_name_3,
               wd.name AS ipt_ward_name,
               w.created_by, COALESCE(off.officer_name, w.created_by) AS created_by_name,
               (SELECT ${rrDateExpr} FROM roomtype_reserve rr
                WHERE rr.hn = w.hn AND (w.an IS NULL OR w.an = '' OR rr.an = w.an)
                ORDER BY rr.roomtype_reserve_id DESC LIMIT 1) AS rr_est_adm_date
        FROM waiting_list w
        LEFT JOIN room_types rt ON rt.id = w.room_type_id
        LEFT JOIN room_types rt2 ON rt2.id = w.room_type_id_2
        LEFT JOIN room_types rt3 ON rt3.id = w.room_type_id_3
        LEFT JOIN ipt i ON i.an = w.an AND i.dchdate IS NULL
        LEFT JOIN ward wd ON wd.ward = i.ward
        LEFT JOIN officer off ON off.officer_login_name = w.created_by
        WHERE w.status = 'waiting'
        ORDER BY w.request_date ASC
      `, [], cfg),
      query(`
        SELECT b.id, b.hn, b.an, b.patient_name,
               b.ward AS booked_ward, b.room_number, b.rights_type,
               b.check_in_date, b.check_out_date, b.notes, b.priority_type,
               rt.type_name,
               wd.name AS ipt_ward_name,
               b.created_by, COALESCE(off.officer_name, b.created_by) AS created_by_name,
               (SELECT ${rrDateExpr} FROM roomtype_reserve rr
                WHERE rr.hn = b.hn AND (b.an IS NULL OR b.an = '' OR rr.an = b.an)
                ORDER BY rr.roomtype_reserve_id DESC LIMIT 1) AS rr_est_adm_date
        FROM bookings b
        LEFT JOIN room_types rt ON rt.id = b.room_type_id
        LEFT JOIN ipt i ON i.an = b.an AND i.dchdate IS NULL
        LEFT JOIN ward wd ON wd.ward = i.ward
        LEFT JOIN officer off ON off.officer_login_name = b.created_by
        WHERE b.status = 'reserved'
        ORDER BY b.check_in_date ASC
      `, [], cfg)
    ]);
    res.json({ success: true, waiting: waitRows, reserved: bkRows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
