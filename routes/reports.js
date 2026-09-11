const express = require('express');
const router = express.Router();
const { query, loadSettings } = require('../config/db');
const { ensureTables } = require('./rooms');

function authCheck(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
  next();
}

// เติมเงื่อนไขช่วงวันที่ลง WHERE แบบไดนามิก (from/to เป็น optional query string YYYY-MM-DD)
function dateRangeClause(col, from, to, params) {
  let clause = '';
  if (from) { params.push(from + ' 00:00:00'); clause += ` AND ${col} >= $${params.length}`; }
  if (to)   { params.push(to + ' 23:59:59');   clause += ` AND ${col} <= $${params.length}`; }
  return clause;
}

// เติมเงื่อนไขกรอง ward (ward code จากตาราง ward) — ward ว่าง/ไม่ส่งมา = ทุก ward
function wardClause(col, ward, params) {
  if (!ward) return '';
  params.push(ward);
  return ` AND ${col} = $${params.length}`;
}

// รายได้ = ราคาห้อง (room_types.price_per_day ที่ผูกกับการจอง) x จำนวนคืนที่พักจริง (actual_check_in -> actual_check_out)
// นับเฉพาะการจองที่มีการเข้าพักจริงแล้ว (actual_check_in ไม่ว่าง) — ถ้ายังไม่ออก (checked_out) ใช้เวลาปัจจุบันคำนวณคืนที่ผ่านมาแล้ว
// ward ของแต่ละการจอง อิงจากห้อง/เตียงที่ใช้จริง (bookings.room_number -> bedno -> roomno -> ward) ไม่ใช่ ward ต้นสังกัดของผู้ป่วย
const STAY_CTE = `
  WITH stay AS (
    SELECT b.*, rt.price_per_day, rt.type_name, w.ward as ward_code, w.name as ward_name,
           GREATEST(1, CEIL(EXTRACT(EPOCH FROM (COALESCE(b.actual_check_out, NOW()) - b.actual_check_in)) / 86400.0)) AS nights
    FROM bookings b
    LEFT JOIN room_types rt ON b.room_type_id = rt.id
    LEFT JOIN bedno bn ON bn.bedno = b.room_number
    LEFT JOIN roomno rn ON rn.roomno = bn.roomno
    LEFT JOIN ward w ON w.ward = rn.ward
    WHERE b.actual_check_in IS NOT NULL
  )
`;

// 1) สรุประยะเวลาการส่งซ่อม
router.get('/repair-duration', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    await ensureTables(cfg);
    const { from, to, ward } = req.query;
    const params = [4];
    let where = dateRangeClause('h.start_date', from, to, params);
    where += wardClause('w.ward', ward, params);
    const rows = await query(`
      SELECT h.*, rn.name as room_name, w.name as ward_name
      FROM bed_status_history h
      LEFT JOIN bedno b ON b.bedno = h.bedno
      LEFT JOIN roomno rn ON rn.roomno = b.roomno
      LEFT JOIN ward w ON w.ward = rn.ward
      WHERE h.status_type_id = $1 ${where}
      ORDER BY h.start_date DESC
    `, params, cfg);
    res.json({ success: true, rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2) สรุประยะเวลาการใช้ห้องพิเศษเป็นห้องแยกโรค
router.get('/isolation-duration', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    await ensureTables(cfg);
    const { from, to, ward } = req.query;
    const params = [5];
    let where = dateRangeClause('h.start_date', from, to, params);
    where += wardClause('w.ward', ward, params);
    const rows = await query(`
      SELECT h.*, rn.name as room_name, w.name as ward_name
      FROM bed_status_history h
      LEFT JOIN bedno b ON b.bedno = h.bedno
      LEFT JOIN roomno rn ON rn.roomno = b.roomno
      LEFT JOIN ward w ON w.ward = rn.ward
      WHERE h.status_type_id = $1 ${where}
      ORDER BY h.start_date DESC
    `, params, cfg);
    res.json({ success: true, rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// รายได้จาก AN จริง (ข้อมูล HIS) = ราคาห้องพิเศษจริง (nondrugitems.price ผ่าน bedno.room_charge_icode) x จำนวนวันนอน (an_stat.admdate)
// นับเฉพาะ AN ที่เคยเข้าพักเตียงที่เป็น "ห้องพิเศษ" (bedtype.hos_guid='Y') อย่างน้อย 1 เตียง — ถ้าเข้าพักหลายเตียงในหนึ่ง AN ใช้เตียงล่าสุด (iptadm.indate ล่าสุด) เป็นตัวแทนราคาห้อง
// เดือนอิงจากวันที่จำหน่าย (dchdate) เพราะเป็นวันที่ปิดการรักษา/ทราบจำนวนวันนอนที่แน่นอนแล้ว — นับเฉพาะ AN ที่จำหน่ายแล้ว (dchdate ไม่ว่าง)
const AN_REVENUE_CTE = `
  WITH an_special_bed AS (
    SELECT DISTINCT ON (i.an) i.an, i.bedno, i.roomno, rn.ward
    FROM iptadm i
    JOIN bedno bn ON bn.bedno = i.bedno
    JOIN bedtype bt ON bt.bedtype = bn.bedtype
    LEFT JOIN roomno rn ON rn.roomno = i.roomno
    WHERE bt.hos_guid = 'Y'
    ORDER BY i.an, i.indate DESC
  ),
  an_revenue AS (
    SELECT a.an, a.hn, a.dchdate, a.regdate, a.admdate as days, a.pttype,
           asb.bedno, w.ward as ward_code, w.name as ward_name,
           nd.price as room_price,
           a.admdate * COALESCE(nd.price,0) as revenue
    FROM an_stat a
    JOIN an_special_bed asb ON asb.an = a.an
    LEFT JOIN bedno bn2 ON bn2.bedno = asb.bedno
    LEFT JOIN nondrugitems nd ON nd.icode = bn2.room_charge_icode
    LEFT JOIN ward w ON w.ward = asb.ward
    WHERE a.dchdate IS NOT NULL AND a.admdate IS NOT NULL
  )
`;

// 3) สรุปรายได้ต่อเดือนของการใช้ห้องพิเศษ
// ถ้าผู้ใช้เลือกช่วงวันที่ (from/to) จะแจงเป็นรายวันตามวันที่ที่เลือกแทนการเหมารวมเป็นเดือน — ถ้าไม่เลือกวันที่เลย (ดูทั้งหมด) จะสรุปเป็นรายเดือนตามปกติ
router.get('/monthly-revenue', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const { from, to, ward } = req.query;
    const params = [];
    let where = dateRangeClause('dchdate', from, to, params);
    where += wardClause('ward_code', ward, params);
    const groupedByDay = !!(from || to);
    const groupExpr = groupedByDay ? `TO_CHAR(dchdate, 'YYYY-MM-DD')` : `TO_CHAR(dchdate, 'YYYY-MM')`;
    const rows = await query(`
      ${AN_REVENUE_CTE}
      SELECT ${groupExpr} as month,
             COUNT(*) as bookings_count,
             SUM(days) as nights,
             SUM(revenue) as revenue
      FROM an_revenue
      WHERE 1=1 ${where}
      GROUP BY ${groupExpr}
      ORDER BY month
    `, params, cfg);
    res.json({ success: true, rows, groupedByDay });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// วันที่เข้า-ออกแต่ละห้องพิเศษจริง มาจากตาราง iptbedmove (ประวัติการย้ายเตียง) เพราะ iptadm.indate/outdate ว่างเปล่าทั้งตารางในเครื่องนี้
// แต่ละแถวใน iptbedmove คือ 1 เหตุการณ์ย้ายเข้าเตียง nbedno — "วันที่ออก" ของแต่ละช่วงคือเวลาย้ายครั้งถัดไปของ AN เดียวกัน (LEAD) หรือถ้าเป็นเตียงล่าสุด ใช้วันที่จำหน่าย (an_stat.dchdate) หรือเวลาปัจจุบันถ้ายังไม่จำหน่าย
const ROOM_STAY_CTE = `
  WITH moves AS (
    SELECT an, nbedno as bedno, nroomno as roomno, nward as ward,
           (movedate + movetime) as move_at,
           LEAD(movedate + movetime) OVER (PARTITION BY an ORDER BY movedate, movetime) as next_move_at
    FROM iptbedmove
    WHERE movedate IS NOT NULL AND nbedno IS NOT NULL AND nbedno <> ''
  ),
  room_stay AS (
    SELECT m.an, m.bedno, m.roomno, rn.name as room_name, w.ward as ward_code, w.name as ward_name,
           m.move_at as indate,
           COALESCE(m.next_move_at, a.dchdate::timestamp, NOW()) as outdate,
           nd.price as room_price,
           GREATEST(1, CEIL(EXTRACT(EPOCH FROM (COALESCE(m.next_move_at, a.dchdate::timestamp, NOW()) - m.move_at)) / 86400.0)) as nights
    FROM moves m
    JOIN bedno bn ON bn.bedno = m.bedno
    JOIN bedtype bt ON bt.bedtype = bn.bedtype
    LEFT JOIN nondrugitems nd ON nd.icode = bn.room_charge_icode
    LEFT JOIN an_stat a ON a.an = m.an
    LEFT JOIN ward w ON w.ward = m.ward
    LEFT JOIN roomno rn ON rn.roomno = m.roomno
    WHERE bt.hos_guid = 'Y'
  )
`;

// 4) สรุปจำนวนห้องที่ใช้ และรายได้รวมต่อห้อง — group ตามห้อง (bedno) จากประวัติการย้ายเตียงจริง (iptbedmove)
router.get('/rooms-revenue', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const { from, to, ward } = req.query;
    const params = [];
    let where = dateRangeClause('indate', from, to, params);
    where += wardClause('ward_code', ward, params);
    const rows = await query(`
      ${ROOM_STAY_CTE}
      SELECT bedno as room_number, roomno, room_name,
             COUNT(*) as bookings_count,
             SUM(nights) as nights,
             SUM(nights * COALESCE(room_price,0)) as revenue
      FROM room_stay
      WHERE 1=1 ${where}
      GROUP BY bedno, roomno, room_name
      ORDER BY revenue DESC
    `, params, cfg);
    res.json({ success: true, rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// รายได้จริงของห้องพิเศษ — จากตาราง opitemrece (รายการเรียกเก็บจริงของ HIS) กรอง icode = ราคาห้องของเตียงพิเศษ
// เตียงพิเศษหลายเตียงอาจใช้ room_charge_icode เดียวกัน (ราคาห้องเดียวกัน) จึงต้องหาว่า AN นั้นนอนเตียงไหนจริงจาก iptbedmove (ใช้เตียงล่าสุดถ้าย้ายหลายครั้ง) เพื่อไม่ให้รายได้ซ้ำซ้อนข้ามเตียง
// paidst กรองต่างกันตามรายงาน: '01'/'03' = ชำระเองเบิกได้/เบิกไม่ได้ (เงินสดจริงจากผู้ป่วย) ส่วน '02' = ลูกหนี้สิทธิ (ยอดที่เบิกได้จากสิทธิ/ประกัน ไม่ใช่เงินสดจากผู้ป่วย)
function buildPaidRevenueCte(paidstList) {
  const paidstSql = paidstList.map(p => `'${p}'`).join(',');
  return `
  WITH special_beds AS (
    SELECT bn.bedno, bn.room_charge_icode, bn.roomno
    FROM bedno bn
    JOIN bedtype bt ON bt.bedtype = bn.bedtype
    WHERE bt.hos_guid = 'Y' AND bn.room_charge_icode IS NOT NULL
  ),
  an_bed AS (
    SELECT DISTINCT ON (i.an) i.an, i.nbedno as bedno
    FROM iptbedmove i
    JOIN special_beds sb ON sb.bedno = i.nbedno
    ORDER BY i.an, (i.movedate + i.movetime) DESC
  ),
  paid_charges AS (
    SELECT ab.bedno, w.ward as ward_code, w.name as ward_name, o.sum_price, o.vstdate, o.vsttime, o.paidst,
           o.pttype, COALESCE(pt.name, 'ไม่ระบุสิทธิ') as pttype_name
    FROM opitemrece o
    JOIN an_bed ab ON ab.an = o.an
    JOIN special_beds sb ON sb.bedno = ab.bedno AND sb.room_charge_icode = o.icode
    LEFT JOIN roomno rn ON rn.roomno = sb.roomno
    LEFT JOIN ward w ON w.ward = rn.ward
    LEFT JOIN pttype pt ON pt.pttype = o.pttype
    WHERE o.paidst IN (${paidstSql})
  )
`;
}

// paidst 01/03 = จ่ายเงินสดจริงจากผู้ป่วย — ใช้กับรายงาน "รายได้จริงของห้องพิเศษ(ชำระเงิน)"
const PAID_REVENUE_CTE = buildPaidRevenueCte(['01', '03']);
// paidst 02 = ลูกหนี้สิทธิ (ยอดที่เบิกได้ตามสิทธิ/ประกัน) — ใช้กับรายงาน "จำนวนจ่ายห้องของแต่ละกลุ่มสิทธิ"
const RIGHTS_REVENUE_CTE = buildPaidRevenueCte(['02']);
// รวมทั้ง 3 รหัส (01/02/03) ไว้ในชุดเดียว แล้วแยกยอดด้วย FILTER ตอน query — ใช้กับรายงานที่ต้องโชว์ทั้งสองยอดคู่กัน เช่น "รายได้วันหยุด/วันธรรมดา"
const COMBINED_PAID_CTE = buildPaidRevenueCte(['01', '02', '03']);

// 5) สรุปรายได้จริงของห้องพิเศษ (ชำระเงิน) — นับตามเตียง
router.get('/total-revenue', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const { from, to, ward } = req.query;
    const params = [];
    let where = dateRangeClause('vstdate', from, to, params);
    where += wardClause('ward_code', ward, params);
    const totalRows = await query(`
      ${PAID_REVENUE_CTE}
      SELECT COUNT(*) as bookings_count, SUM(sum_price) as revenue
      FROM paid_charges
      WHERE 1=1 ${where}
    `, params, cfg);
    const byBedRows = await query(`
      ${PAID_REVENUE_CTE}
      SELECT bedno as room_number, COUNT(*) as bookings_count, SUM(sum_price) as revenue
      FROM paid_charges
      WHERE 1=1 ${where}
      GROUP BY bedno
      ORDER BY revenue DESC
    `, params, cfg);
    res.json({ success: true, total: totalRows[0] || {}, byBed: byBedRows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6) สรุประยะเวลารอคอยการจองห้องพิเศษ — นับราย AN ตั้งแต่ "จอง" (waiting_list.request_date) จนได้ "เข้าห้อง" จริง
// (ครั้งแรกที่ AN นั้นถูกย้ายเข้าเตียงพิเศษจริง จากประวัติการย้ายเตียง iptbedmove ไม่ใช่แค่เวลาที่พยาบาลบันทึกจองในแอป)
// หมายเหตุ: waiting_list.an ต้องมีข้อมูล (กรอก/ค้นหา AN ไว้ตอนเพิ่มคิว) ถึงจะจับคู่กับ iptbedmove ได้
router.get('/waiting-duration', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    await ensureTables(cfg);
    const { from, to, ward } = req.query;
    const params = [];
    let where = dateRangeClause('wl.request_date', from, to, params);
    where += wardClause('w.ward', ward, params);
    const rows = await query(`
      SELECT wl.an, wl.hn, wl.patient_name, wl.ward, wl.roomtype_name,
             wl.request_date, m.first_move_at as got_room_at, m.bedno as room_number, w.name as room_ward_name,
             EXTRACT(EPOCH FROM (m.first_move_at - wl.request_date)) as wait_seconds
      FROM waiting_list wl
      JOIN (
        SELECT i.an, MIN(i.movedate + i.movetime) as first_move_at,
               (ARRAY_AGG(i.nbedno ORDER BY i.movedate, i.movetime))[1] as bedno,
               (ARRAY_AGG(i.nroomno ORDER BY i.movedate, i.movetime))[1] as roomno
        FROM iptbedmove i
        JOIN bedno bn ON bn.bedno = i.nbedno
        JOIN bedtype bt ON bt.bedtype = bn.bedtype
        WHERE bt.hos_guid = 'Y'
        GROUP BY i.an
      ) m ON m.an = wl.an
      LEFT JOIN roomno rn ON rn.roomno = m.roomno
      LEFT JOIN ward w ON w.ward = rn.ward
      WHERE wl.an IS NOT NULL AND wl.an <> '' ${where}
      ORDER BY wl.request_date DESC
    `, params, cfg);
    res.json({ success: true, rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7) สรุปจำนวนจ่ายห้องของแต่ละกลุ่มสิทธิการรักษา — สิทธิไหนใช้ห้องพิเศษไปเท่าไหร่ และราคาที่จ่ายจริงตามสิทธินั้น (opitemrece.pttype ผูกกับผู้จ่ายจริง ไม่ใช่ an_stat.pttype ที่เป็นสิทธิหลักตอน admit)
router.get('/rights-summary', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const { from, to, ward } = req.query;
    const params = [];
    let where = dateRangeClause('vstdate', from, to, params);
    where += wardClause('ward_code', ward, params);
    const rows = await query(`
      ${RIGHTS_REVENUE_CTE}
      SELECT pttype_name as rights_type,
             COUNT(*) as bookings_count, SUM(sum_price) as revenue
      FROM paid_charges
      WHERE 1=1 ${where}
      GROUP BY pttype_name
      ORDER BY revenue DESC
    `, params, cfg);
    res.json({ success: true, rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8) สรุปรายได้วันหยุด/วันธรรมดา — สรุปแค่รายได้ แยกตามวันทั้ง 7 วัน (จันทร์-อาทิตย์) ไม่แยกตามเตียง
// แสดง 2 ยอดคู่กัน: "ราคาเบิกได้ตามสิทธิ" (paidst=02) และ "ราคาที่ต้องชำระ" (paidst 01,03)
router.get('/holiday-weekday-revenue', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const { from, to, ward } = req.query;
    const params = [];
    let where = dateRangeClause('vstdate', from, to, params);
    where += wardClause('ward_code', ward, params);
    const rows = await query(`
      ${COMBINED_PAID_CTE}
      SELECT EXTRACT(ISODOW FROM vstdate)::int as dow,
             SUM(sum_price) FILTER (WHERE paidst = '02') as claimable_revenue,
             SUM(sum_price) FILTER (WHERE paidst IN ('01','03')) as payable_revenue
      FROM paid_charges
      WHERE 1=1 ${where}
      GROUP BY EXTRACT(ISODOW FROM vstdate)
      ORDER BY dow
    `, params, cfg);
    res.json({ success: true, rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 9) สรุปรายได้ตามเวร เช้า(08:00-15:59) บ่าย(16:00-23:59) ดึก(00:00-07:59) — อิงเวลาที่เรียกเก็บจริง (opitemrece.vsttime)
// แสดง 2 ยอดคู่กัน: "ราคาเบิกได้ตามสิทธิ" (paidst=02) และ "ราคาที่ต้องชำระ" (paidst 01,03)
router.get('/shift-revenue', authCheck, async (req, res) => {
  const cfg = loadSettings();
  try {
    const { from, to, ward } = req.query;
    const params = [];
    let where = dateRangeClause('vstdate', from, to, params);
    where += wardClause('ward_code', ward, params);
    // หมายเหตุ: ห้ามใส่ emoji ในค่า string ของ SQL — DB connection ใช้ client encoding WIN874 (ภาษาไทย) เข้ารหัส emoji (UTF8 4-byte) ไม่ได้ ทำให้ query error
    const shiftExpr = `CASE
        WHEN EXTRACT(HOUR FROM vsttime) >= 8 AND EXTRACT(HOUR FROM vsttime) < 16 THEN 'เช้า (08:00-15:59)'
        WHEN EXTRACT(HOUR FROM vsttime) >= 16 THEN 'บ่าย (16:00-23:59)'
        ELSE 'ดึก (00:00-07:59)'
      END`;
    const rows = await query(`
      ${COMBINED_PAID_CTE}
      SELECT ${shiftExpr} as shift,
             SUM(sum_price) FILTER (WHERE paidst = '02') as claimable_revenue,
             SUM(sum_price) FILTER (WHERE paidst IN ('01','03')) as payable_revenue
      FROM paid_charges
      WHERE 1=1 ${where}
      GROUP BY ${shiftExpr}
    `, params, cfg);
    res.json({ success: true, rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
