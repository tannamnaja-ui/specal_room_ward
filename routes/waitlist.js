const express = require('express');
const router = express.Router();
const { query, loadSettings } = require('../config/db');

function authCheck(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
  next();
}

// GET waiting list
router.get('/', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const showAll = req.query.all === 'true';
    const statusFilter = req.query.status;
    let whereClause = '';
    if (statusFilter) whereClause = `WHERE w.status = '${statusFilter.replace(/'/g,"''")}'`;
    else if (!showAll) whereClause = "WHERE w.status = 'waiting'";
    const rows = await query(`
      SELECT w.*, rt.type_name
      FROM waiting_list w
      LEFT JOIN room_types rt ON w.room_type_id = rt.id
      ${whereClause}
      ORDER BY w.request_date ASC
    `, [], cfg);
    res.json({ success: true, list: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST add to waiting list
router.post('/', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const {
    hn, patient_name, room_type_id, preferred_room, rights_type, notes,
    an, ward, ward_code, doctor_name, roomtype_code, roomtype_name, bedno,
    check_in_date, check_out_date, deposit_amount, contact_name, contact_phone, priority_type,
    no_room_reason, no_pay_reason, room_type_id_2, roomtype_name_2, room_type_id_3, roomtype_name_3
  } = req.body;
  // สาเหตุการไม่จ่ายห้อง เก็บที่คอลัมน์ no_pay_reason (ตามที่ใช้งานจริง) — รับ no_room_reason ไว้เผื่อ backward-compat
  const payReason = no_pay_reason || no_room_reason || null;
  try {
    // ถ้า HN มีอยู่ในคิวรอแล้ว ให้ update แทน insert ใหม่
    const existing = await query(
      `SELECT id FROM waiting_list WHERE hn = $1 AND status = 'waiting' LIMIT 1`,
      [hn], cfg
    );
    if (existing && existing.length > 0) {
      await query(
        `UPDATE waiting_list SET an=$1, patient_name=$2, ward=$3, doctor_name=$4, room_type_id=$5, preferred_room=$6,
         rights_type=$7, notes=$8, contact_name=$9, contact_phone=$10, priority_type=$11,
         roomtype_code=$12, roomtype_name=$13, check_in_date=$14, no_pay_reason=$15,
         room_type_id_2=$16, roomtype_name_2=$17, room_type_id_3=$18, roomtype_name_3=$19,
         request_date=CURRENT_TIMESTAMP WHERE id=$20`,
        [an||null, patient_name, ward||ward_code||null, doctor_name||null,
         room_type_id, preferred_room, rights_type, notes,
         contact_name||null, contact_phone||null, priority_type||null,
         roomtype_code||null, roomtype_name||null, check_in_date||null, payReason,
         room_type_id_2||null, roomtype_name_2||null, room_type_id_3||null, roomtype_name_3||null,
         existing[0].id],
        cfg
      );
    } else {
      await query(
        `INSERT INTO waiting_list (hn, an, patient_name, ward, doctor_name, room_type_id, preferred_room, rights_type, notes, check_in_date, contact_name, contact_phone, priority_type, roomtype_code, roomtype_name, no_pay_reason, room_type_id_2, roomtype_name_2, room_type_id_3, roomtype_name_3, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'waiting',$21)`,
        [hn, an||null, patient_name, ward||ward_code||null, doctor_name||null,
         room_type_id, preferred_room, rights_type, notes, check_in_date||null,
         contact_name||null, contact_phone||null, priority_type||null,
         roomtype_code||null, roomtype_name||null, payReason,
         room_type_id_2||null, roomtype_name_2||null, room_type_id_3||null, roomtype_name_3||null,
         req.session.user.login_name],
        cfg
      );
    }

    // INSERT into roomtype_reserve (HIS)
    try {
      const statusRows = await query(
        `SELECT room_reserve_status_id FROM room_reserve_status WHERE hos_guid = 'waiting' LIMIT 1`,
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
            reserve_date, reserve_time, room_reserve_status_id)
         VALUES (get_serialnumber('roomtype_reserve_id'),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [hn, an||null, contact_name||null, contact_phone||null,
         ward_code||null, roomtype_code||null, bedno||null,
         estAdmDate, check_out_date||null,
         deposit_amount ? parseFloat(deposit_amount) : null,
         notes||null, reserveDate, reserveTime, statusId],
        cfg
      );
    } catch {}

    req.io.emit('waitlist_updated');
    res.json({ success: true, message: 'เพิ่มในคิวรอเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH confirm from waitlist (assign room)
router.patch('/:id/confirm', authCheck, async (req, res) => {
  const cfg = loadSettings();
  const { room_id, room_number, check_in_date, check_out_date } = req.body;
  try {
    const rows = await query('SELECT * FROM waiting_list WHERE id = $1', [req.params.id], cfg);
    if (!rows || rows.length === 0) return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลในคิว' });
    const item = rows[0];

    // Create booking
    await query(
      `INSERT INTO bookings (hn, patient_name, room_id, room_number, room_type_id, check_in_date, check_out_date, rights_type, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'reserved',$10)`,
      [item.hn, item.patient_name, room_id, room_number, item.room_type_id,
       check_in_date, check_out_date, item.rights_type, item.notes, req.session.user.login_name],
      cfg
    );
    // Update room status
    await query(`UPDATE rooms SET status = 'reserved' WHERE id = $1`, [room_id], cfg);
    // Remove from waitlist
    await query(`UPDATE waiting_list SET status = 'assigned' WHERE id = $1`, [req.params.id], cfg);

    req.io.emit('room_updated');
    req.io.emit('waitlist_updated');
    res.json({ success: true, message: 'จัดห้องให้ผู้ป่วยเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE / cancel from waitlist
router.patch('/:id/cancel', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    await query(`UPDATE waiting_list SET status = 'cancelled' WHERE id = $1`, [req.params.id], cfg);
    req.io.emit('waitlist_updated');
    res.json({ success: true, message: 'ยกเลิกคิวรอเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH cancel all waiting entries by HN (called after booking success)
router.patch('/by-hn/:hn/assign', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    await query(
      `UPDATE waiting_list SET status = 'assigned' WHERE hn = $1 AND status = 'waiting'`,
      [req.params.hn], cfg
    );
    req.io.emit('waitlist_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
