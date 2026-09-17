/* ===== STATE ===== */
let allRooms = [];
let allRoomTypes = [];
let currentFloor = 'all';
let currentUser = null;
let assignWaitId = null;
let waitlistItems = [];
let currentWaitlistId = null;
// ถ้า socket.io.js โหลดไม่สำเร็จ (เช่น ถูก antivirus/proxy บล็อก) ต้องไม่ทำให้ทั้งแอปใช้งานไม่ได้
// — real-time auto-refresh จะหายไปเฉย ๆ แต่ข้อมูลอื่นต้องโหลด/ใช้งานได้ปกติ (กดรีเฟรชเองแทนได้)
let socket = null;
try {
  if (typeof io === 'function') {
    socket = io();
  } else {
    console.error('Socket.IO client ไม่ได้โหลด (real-time update จะปิดใช้งาน แต่ระบบอื่นทำงานได้ปกติ)');
  }
} catch (e) {
  console.error('เชื่อมต่อ Socket.IO ไม่สำเร็จ:', e);
}

/* ป้องกันหน้าค้าง "กำลังโหลด..." ตลอดไป กรณี DB ไม่ตอบสนอง (เช่น เชื่อมต่อไม่ถึงเครื่อง DB) */
async function fetchWithTimeout(url, opts = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('หมดเวลาเชื่อมต่อ (เกิน 20 วินาที) — ตรวจสอบว่าเครื่องนี้เชื่อมต่อฐานข้อมูลได้หรือไม่ ที่หน้า ตั้งค่าการเชื่อมต่อ');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  initClock();
  await Promise.all([loadRooms(), loadRoomTypes()]);
  await Promise.all([loadWaitlist(), loadBookings(), loadBookingWards(), loadBookingRoomTypes(), loadBookingPriorityTypes(), loadRoomPriceTypes(), loadReservations()]);
  clearBookingForm();
  loadAllQueue();
  loadHosBeds();
  document.addEventListener('click', e => {
    if (!e.target.closest('#bnAn') && !e.target.closest('#bnAnDropdown')) hideAnDropdown();
  });
});

async function checkAuth() {
  try {
    const res = await fetchWithTimeout('/api/auth/me');
    const data = await res.json();
    if (!data.loggedIn) { location.href = '/login.html'; return; }
    currentUser = data.user;
    const nameEl = document.getElementById('sidebarUserName');
    if (nameEl) nameEl.textContent = (data.user && (data.user.name || data.user.login_name)) || '-';
  } catch (e) {
    // ไม่ว่า /api/auth/me จะพลาดด้วยเหตุผลอะไร ก็ต้องไม่ทำให้การโหลดข้อมูลส่วนอื่นของทั้งแอปหยุดตาม
    // เพราะ checkAuth() เป็น await ตัวแรกสุดใน DOMContentLoaded — ถ้าปล่อยให้ throw ทุกอย่างหลังจากนี้จะไม่ทำงานเลย
    console.error('checkAuth failed (ไม่บล็อกการโหลดหน้าอื่น):', e);
  }
}

async function logout() {
  await fetchWithTimeout('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
}

/* ===== CLOCK ===== */
function initClock() {
  function update() {
    const now = new Date();
    const days = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const d = days[now.getDay()];
    const m = months[now.getMonth()];
    const date = now.getDate();
    const y = now.getFullYear() + 543;
    const h = String(now.getHours()).padStart(2,'0');
    const min = String(now.getMinutes()).padStart(2,'0');
    const s = String(now.getSeconds()).padStart(2,'0');
    document.getElementById('clockDisplay').textContent = `วัน${d} ${date} ${m} ${y}  |  ${h}:${min}:${s}`;
  }
  update();
  setInterval(update, 1000);
}

/* ===== REFRESH ALL DATA ===== */
async function refreshAllData() {
  await Promise.all([loadRooms(), loadWaitlist(), loadReservations(), loadOccupants(), loadAllQueue()]);
  loadHosBeds();
}

/* ===== SOCKET.IO REAL-TIME ===== */
if (socket) {
  socket.on('room_updated', () => refreshAllData());
  socket.on('waitlist_updated', () => refreshAllData());
}

/* ===== TAB NAVIGATION ===== */
const tabTitles = {
  dashboard:     '📊 แดชบอร์ดสถานะห้องพัก',
  wardpatients:  '🧑‍⚕️ รายชื่อคนไข้ที่นอนใน ward',
  managerooms:  '🛏️ จัดการห้องพิเศษ',
  specrooms:    '🏠 ห้องพิเศษทั้งหมด',
  booking:      '📝 ฟอร์มจองห้องพิเศษ',
  mywardbookings: '🗂️ คนไข้ที่ ward ท่านเป็นคนจอง',
  reservations: '📋 รายชื่อผู้จองห้องพิเศษ (ได้ห้องแล้ว รอเข้าพัก)',
  waitlist:     '⏳ คิวรอห้องพัก (จองคิวไว้ ยังไม่ได้ห้อง)',
  current:      '🛏️ ผู้พักและการจองปัจจุบัน',
  allrooms:     '🏨 ชื่อผู้จองและรอคิวทั้งหมด (รอจัดการ)',
  reports:      '📊 สรุปรายงานการใช้ห้อง',
  settings:     '⚙️ ตั้งค่าระบบ'
};

function switchTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`panel-${tab}`).classList.add('active');
  document.getElementById(`nav-${tab}`).classList.add('active');
  document.getElementById('topbarTitle').textContent = tabTitles[tab] || tab;
  if (tab === 'specrooms')    loadSpecRooms();
  if (tab === 'allrooms')     loadAllQueue();
  if (tab === 'settings')     loadSettingsData();
  if (tab === 'reservations') loadReservations();
  if (tab === 'wardpatients') loadWardPatients();
  if (tab === 'mywardbookings') loadMyWardBookings();
  if (tab === 'managerooms') loadManageRooms();
  if (tab === 'reports') { renderReportCards(); showReportsHub(); }
}

/* ===== TOAST ===== */
function toast(msg, type = 'info', dur = 4000) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), dur);
}

/* ===== LOADING ===== */
function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('show', show);
}

/* ===== MODAL ===== */
function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

/* ===== LOAD ROOMS ===== */
async function loadRooms() {
  try {
    const [roomsRes, statsRes] = await Promise.all([
      fetchWithTimeout('/api/rooms'),
      fetchWithTimeout('/api/rooms/stats')
    ]);
    const roomsData = await roomsRes.json();
    const statsData = await statsRes.json();
    if (!roomsData.success) { toast(roomsData.message, 'error'); return; }
    allRooms = roomsData.rooms || [];
    updateStats(statsData.success ? statsData.stats : null);
    buildFloorTabs();
    renderRooms(currentFloor);
  } catch (err) {
    console.error('loadRooms:', err);
  }
}

async function loadRoomTypes() {
  try {
    const res = await fetchWithTimeout('/api/rooms/types');
    const data = await res.json();
    if (!data.success) return;
    allRoomTypes = data.types || [];
    populateRoomTypeSelect();
  } catch {}
}

function updateStats(stats) {
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  if (stats) {
    setText('countTotal',        stats.total      ?? 0);
    setText('countAvailable',    stats.available  ?? 0);
    setText('countOccupied',     stats.occupied   ?? 0);
    setText('countOccupancyRate',(stats.occupancy_rate ?? 0) + '%');
  }
  const count = (s) => allRooms.filter(r => r.status === s).length;
  setText('countReserved', count('reserved'));
  setText('countCleaning', count('cleaning'));
  setText('countPending',  count('pending_discharge'));
}

function buildFloorTabs() {
  const floors = [...new Set(allRooms.map(r => r.floor).filter(Boolean))].sort();
  const container = document.getElementById('floorTabs');
  const current = container.querySelector('[data-floor].active')?.dataset.floor || 'all';
  container.innerHTML = `<div class="floor-tab ${current==='all'?'active':''}" data-floor="all" onclick="filterFloor('all',this)">ทุกชั้น</div>`;
  floors.forEach(f => {
    const div = document.createElement('div');
    div.className = `floor-tab ${current===f?'active':''}`;
    div.dataset.floor = f;
    div.textContent = `ชั้น ${f}`;
    div.onclick = function() { filterFloor(f, this); };
    container.appendChild(div);
  });
}

function filterFloor(floor, el) {
  currentFloor = floor;
  document.querySelectorAll('.floor-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderRooms(floor);
}

function renderRooms(floor) {
  const grid = document.getElementById('roomsGrid');
  let rooms = allRooms;
  if (floor !== 'all') rooms = rooms.filter(r => r.floor === floor);

  if (rooms.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🏨</div><p>ไม่พบห้องพัก${floor!=='all'?` ชั้น ${floor}`:''}</p></div>`;
    return;
  }

  const statusLabel = { available:'ว่าง', reserved:'จองแล้ว', occupied:'มีผู้พัก', cleaning:'ทำความสะอาด', pending_discharge:'รอจำหน่าย' };
  const statusIcon  = { available:'🟢', reserved:'🟡', occupied:'🔴', cleaning:'🔵', pending_discharge:'🟣' };

  grid.innerHTML = rooms.map(r => `
    <div class="room-card ${r.status}" onclick="openRoomModal(${r.id})">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="room-number">${r.room_number}</div>
        <div class="status-dot dot-${r.status}"></div>
      </div>
      <div class="room-type">${r.type_name || '-'}</div>
      ${r.building ? `<div style="font-size:11px;color:#90A4AE;margin-top:2px">${r.building}</div>` : ''}
      <div class="room-status-badge badge-${r.status}">${statusIcon[r.status] || ''} ${statusLabel[r.status] || r.status}</div>
      ${r.patient_name ? `<div class="room-patient"><strong>${r.patient_name}</strong><span>HN: ${r.hn}</span></div>` : ''}
      ${r.price_per_day ? `<div style="font-size:11px;color:#78909C;margin-top:4px">฿${Number(r.price_per_day).toLocaleString()}/วัน</div>` : ''}
    </div>
  `).join('');
}

/* ===== ROOM MODAL ===== */
function openRoomModal(roomId) {
  const room = allRooms.find(r => r.id === roomId);
  if (!room) return;

  const statusLabel = { available:'ว่าง', reserved:'จองแล้ว', occupied:'มีผู้พัก', cleaning:'กำลังทำความสะอาด', pending_discharge:'รอจำหน่าย' };
  const statusColor = { available:'#2E7D32', reserved:'#F57F17', occupied:'#C62828', cleaning:'#546E7A', pending_discharge:'#6A1B9A' };

  document.getElementById('roomModalTitle').textContent = `ห้อง ${room.room_number}`;
  document.getElementById('roomModalBody').innerHTML = `
    <div style="display:grid;gap:10px">
      <div class="info-row"><span class="info-label" style="min-width:100px">ประเภทห้อง:</span><span class="info-value">${room.type_name || '-'}</span></div>
      <div class="info-row"><span class="info-label" style="min-width:100px">ชั้น/อาคาร:</span><span class="info-value">${room.floor || '-'} / ${room.building || '-'}</span></div>
      <div class="info-row"><span class="info-label" style="min-width:100px">สถานะ:</span>
        <span style="font-weight:700;color:${statusColor[room.status]}">${statusLabel[room.status] || room.status}</span>
      </div>
      ${room.price_per_day ? `<div class="info-row"><span class="info-label" style="min-width:100px">ราคา:</span><span class="info-value">฿${Number(room.price_per_day).toLocaleString()}/วัน</span></div>` : ''}
      ${room.patient_name ? `
        <div style="background:#FFF3E0;border-radius:8px;padding:10px;margin-top:4px">
          ${room.booking_ref ? `<div class="info-row"><span class="info-label" style="min-width:100px">เลขที่จอง:</span><span class="info-value" style="font-family:monospace">${room.booking_ref}</span></div>` : ''}
          <div class="info-row"><span class="info-label" style="min-width:100px">ผู้พัก:</span><span class="info-value">${room.patient_name}</span></div>
          <div class="info-row"><span class="info-label" style="min-width:100px">HN:</span><span class="info-value">${room.hn}</span></div>
          ${room.an ? `<div class="info-row"><span class="info-label" style="min-width:100px">AN:</span><span class="info-value">${room.an}</span></div>` : ''}
          ${room.ward ? `<div class="info-row"><span class="info-label" style="min-width:100px">Ward:</span><span class="info-value">${room.ward}</span></div>` : ''}
          ${room.doctor_name ? `<div class="info-row"><span class="info-label" style="min-width:100px">แพทย์:</span><span class="info-value">${room.doctor_name}</span></div>` : ''}
        </div>` : ''}
    </div>`;

  // Action buttons
  const footer = document.getElementById('roomModalFooter');
  footer.innerHTML = '';

  if (room.status === 'available') {
    const btnBook = document.createElement('button');
    btnBook.className = 'btn btn-primary btn-sm';
    btnBook.textContent = '📝 จองห้องนี้';
    btnBook.onclick = () => { closeModal('roomModal'); prefillRoom(room); switchTab('booking'); };
    footer.appendChild(btnBook);
  }
  if (room.status === 'reserved') {
    const btnCI = document.createElement('button');
    btnCI.className = 'btn btn-success btn-sm';
    btnCI.textContent = '✅ Check-in';
    btnCI.onclick = () => checkInByRoom(room);
    footer.appendChild(btnCI);
    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn-danger btn-sm';
    btnCancel.textContent = '❌ ยกเลิกจอง';
    btnCancel.onclick = () => cancelByRoom(room);
    footer.appendChild(btnCancel);
  }
  if (room.status === 'occupied') {
    const btnPD = document.createElement('button');
    btnPD.className = 'btn btn-sm';
    btnPD.style.cssText = 'background:#6A1B9A;color:white';
    btnPD.textContent = '🟣 แจ้งรอจำหน่าย';
    btnPD.onclick = () => markPendingDischarge(room);
    footer.appendChild(btnPD);
    const btnCO = document.createElement('button');
    btnCO.className = 'btn btn-warning btn-sm';
    btnCO.textContent = '🚪 Check-out';
    btnCO.onclick = () => checkOutByRoom(room);
    footer.appendChild(btnCO);
  }
  if (room.status === 'pending_discharge') {
    const btnCO = document.createElement('button');
    btnCO.className = 'btn btn-warning btn-sm';
    btnCO.textContent = '🚪 Check-out';
    btnCO.onclick = () => checkOutByRoom(room);
    footer.appendChild(btnCO);
  }
  if (room.status === 'cleaning') {
    const btnReady = document.createElement('button');
    btnReady.className = 'btn btn-success btn-sm';
    btnReady.textContent = '✨ ทำความสะอาดเสร็จแล้ว';
    btnReady.onclick = async () => {
      await fetchWithTimeout(`/api/rooms/${room.id}/status`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:'available'}) });
      closeModal('roomModal'); toast('ห้องพร้อมให้บริการ', 'success'); refreshAllData();
    };
    footer.appendChild(btnReady);
  }

  const btnClose = document.createElement('button');
  btnClose.className = 'btn btn-secondary btn-sm';
  btnClose.textContent = 'ปิด';
  btnClose.onclick = () => closeModal('roomModal');
  footer.appendChild(btnClose);

  document.getElementById('roomModal').classList.add('show');
}

async function markPendingDischarge(room) {
  const booking = await fetchWithTimeout('/api/bookings').then(r=>r.json()).then(d=>d.bookings?.find(b=>b.room_id==room.id&&b.status==='occupied'));
  if (!booking) { toast('ไม่พบข้อมูลการจอง', 'error'); return; }
  await fetchWithTimeout(`/api/bookings/${booking.id}/pending-discharge`, { method:'PATCH' });
  closeModal('roomModal'); toast('อัปเดตสถานะ: รอจำหน่าย', 'success'); refreshAllData();
}

async function checkInByRoom(room) {
  const booking = await fetchWithTimeout('/api/bookings').then(r=>r.json()).then(d=>d.bookings?.find(b=>b.room_id==room.id&&b.status==='reserved'));
  if (!booking) { toast('ไม่พบข้อมูลการจอง', 'error'); return; }
  await fetchWithTimeout(`/api/bookings/${booking.id}/checkin`, { method:'PATCH' });
  closeModal('roomModal'); toast('Check-in เรียบร้อย', 'success'); refreshAllData();
}

async function checkOutByRoom(room) {
  if (!confirm(`ยืนยัน Check-out ห้อง ${room.room_number}?`)) return;
  const booking = await fetchWithTimeout('/api/bookings').then(r=>r.json()).then(d=>d.bookings?.find(b=>b.room_id==room.id&&b.status==='occupied'));
  if (!booking) { toast('ไม่พบข้อมูลการจอง', 'error'); return; }
  await fetchWithTimeout(`/api/bookings/${booking.id}/checkout`, { method:'PATCH' });
  closeModal('roomModal'); toast('Check-out เรียบร้อย ห้องอยู่ระหว่างทำความสะอาด', 'success'); refreshAllData();
}

async function cancelByRoom(room) {
  if (!confirm(`ยืนยันยกเลิกการจองห้อง ${room.room_number}?`)) return;
  const booking = await fetchWithTimeout('/api/bookings').then(r=>r.json()).then(d=>d.bookings?.find(b=>b.room_id==room.id&&b.status==='reserved'));
  if (!booking) { toast('ไม่พบข้อมูลการจอง', 'error'); return; }
  await fetchWithTimeout(`/api/bookings/${booking.id}/cancel`, { method:'PATCH' });
  closeModal('roomModal'); toast('ยกเลิกการจองเรียบร้อย', 'success'); refreshAllData();
}

function prefillRoom(room) {
  // ทางลัดจากการคลิกห้องในแดชบอร์ด — ยังไม่ทราบหอผู้ป่วย/ห้อง HIS ที่ตรงกัน
  // จึงเติมเตียงเข้า select ตรงๆ โดยไม่ผ่านลำดับ หอผู้ป่วย > ประเภทห้อง > ห้อง
  document.getElementById('bnRoomType').value = room.room_type_id || '';
  document.getElementById('bnRoomNo').innerHTML = '<option value="">-- เลือกห้อง --</option>';
  const sel = document.getElementById('bnRoomId');
  sel.innerHTML = '<option value="">-- เลือกเตียง --</option>';
  const opt = document.createElement('option');
  opt.value = room.room_number;
  opt.dataset.roomId = room.id || '';
  opt.dataset.price  = room.price_per_day || 0;
  opt.textContent = `เตียง ${room.room_number}`;
  sel.appendChild(opt);
  sel.value = room.room_number;
  showRoomPrice();
}

/* ===== ROOM TYPE SELECT ===== */
function populateRoomTypeSelect() {
  // bnRoomType โหลดจาก HIS ใน loadBookingRoomTypes() แล้ว
}

function populateWardFilterSelect() {
  // bnWardFilter โหลดจาก HIS ใน loadBookingWards() แล้ว
}

async function loadBookingWards() {
  const sel = document.getElementById('bnWardFilter');
  if (!sel) return;
  try {
    const res  = await fetchWithTimeout('/api/bookings/his-wards');
    const data = await res.json();
    if (!data.success) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— เลือกหอผู้ป่วย —</option>';
    (data.wards || []).filter(w => w.ward && w.name).forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.ward; opt.textContent = w.name;
      sel.appendChild(opt);
    });
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  } catch(e) {}
}

async function loadBookingRoomTypes(ward) {
  const sel = document.getElementById('bnRoomType');
  if (!sel) return;
  try {
    const params = new URLSearchParams();
    if (ward) params.set('ward', ward);
    const res  = await fetchWithTimeout(`/api/bookings/his-roomtypes?${params}`);
    const data = await res.json();
    if (!data.success) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- เลือกประเภทห้อง --</option>';
    (data.roomtypes || []).forEach(rt => {
      const opt = document.createElement('option');
      opt.value = rt.roomtype; opt.textContent = rt.name;
      sel.appendChild(opt);
    });
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  } catch(e) {}
}

async function loadBookingPriorityTypes() {
  const sel = document.getElementById('bnPriorityType');
  if (!sel) return;
  try {
    const res  = await fetchWithTimeout('/api/bookings/priority-types');
    const data = await res.json();
    if (!data.success) return;
    sel.innerHTML = '<option value="">-- เลือกประเภทผู้จอง --</option>';
    (data.types || []).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.name; opt.textContent = t.name;
      sel.appendChild(opt);
    });
  } catch(e) {}
}

async function onWardFilterChange() {
  const ward = document.getElementById('bnWardFilter')?.value || '';
  document.getElementById('bnRoomType').value = '';
  document.getElementById('bnRoomNo').innerHTML = '<option value="">-- เลือกห้อง --</option>';
  document.getElementById('bnRoomId').innerHTML = '<option value="">-- เลือกเตียง --</option>';
  document.getElementById('roomPriceBox').style.display = 'none';
  await loadBookingRoomTypes(ward);
}

async function filterRoomsByType() { await refreshRoomList(); }
async function filterBedsByRoom()  { await refreshBedList(); }

// ขั้นที่ 1: เลือกหอผู้ป่วย + ประเภทห้อง แล้ว → โหลดรายชื่อ "ห้อง" (roomno จาก HIS)
async function refreshRoomList() {
  const wardCode = document.getElementById('bnWardFilter')?.value || '';
  const roomtype = document.getElementById('bnRoomType')?.value || '';
  const sel = document.getElementById('bnRoomNo');
  sel.innerHTML = '<option value="">-- เลือกห้อง --</option>';
  document.getElementById('bnRoomId').innerHTML = '<option value="">-- เลือกเตียง --</option>';
  document.getElementById('roomPriceBox').style.display = 'none';
  if (!wardCode || !roomtype) return;
  try {
    const params = new URLSearchParams({ ward: wardCode, roomtype });
    const res  = await fetchWithTimeout(`/api/bookings/his-rooms?${params}`);
    const data = await res.json();
    if (!data.success) return;
    const rooms = data.rooms || [];
    if (rooms.length === 0) {
      sel.innerHTML += '<option value="" disabled>ไม่มีห้องว่างในเงื่อนไขนี้</option>';
      return;
    }
    rooms.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.roomno;
      opt.textContent = r.name || r.roomno;
      sel.appendChild(opt);
    });
  } catch(e) {}
}

// ขั้นที่ 2: เลือกห้องแล้ว → โหลดรายชื่อ "เตียง" ในห้องนั้น
async function refreshBedList() {
  const wardCode = document.getElementById('bnWardFilter')?.value || '';
  const roomtype = document.getElementById('bnRoomType')?.value || '';
  const roomno   = document.getElementById('bnRoomNo')?.value || '';
  const sel = document.getElementById('bnRoomId');
  sel.innerHTML = '<option value="">-- เลือกเตียง --</option>';
  document.getElementById('roomPriceBox').style.display = 'none';
  if (!roomtype || !roomno) return;
  try {
    const params = new URLSearchParams({ roomtype, roomno });
    if (wardCode) params.set('ward', wardCode);
    const res  = await fetchWithTimeout(`/api/bookings/his-beds?${params}`);
    const data = await res.json();
    if (!data.success) return;
    const beds = data.beds || [];
    if (beds.length === 0) {
      sel.innerHTML += '<option value="" disabled>ไม่มีเตียงว่างในเงื่อนไขนี้</option>';
      return;
    }
    beds.forEach(b => {
      const ir    = allRooms.find(r => String(r.room_number) === String(b.bedno));
      const price = Number(b.price) || 0;
      const opt   = document.createElement('option');
      opt.value = b.bedno;
      opt.dataset.roomId = ir?.id || '';
      opt.dataset.price  = price;
      opt.textContent = `เตียง ${b.bedno}${price ? ` (฿${price.toLocaleString()}/วัน)` : ''}`;
      sel.appendChild(opt);
    });
  } catch(e) {}
}

function showRoomPrice() {
  const sel = document.getElementById('bnRoomId');
  const opt = sel.options[sel.selectedIndex];
  const box = document.getElementById('roomPriceBox');
  if (!opt || !opt.value) { box.style.display = 'none'; return; }
  const price = Number(opt.dataset.price) || 0;
  document.getElementById('priceTotal').textContent = price.toLocaleString();
  box.style.display = 'block';
}

/* ===== HN SEARCH MODAL ===== */
let _searchDebounce = null;
function debounceSearch(type) {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => type === 'hn' ? runPatientSearch() : runAnSearch(), 350);
}

/* ===== HN AUTO-SEARCH (ในฟอร์มจองห้องพิเศษ) — ค้นหาอัตโนมัติระหว่างพิมพ์ ไม่ต้องรอกด Enter ===== */
let _hnAutoSearchDebounce = null;
function debounceHnAutoSearch() {
  clearTimeout(_hnAutoSearchDebounce);
  const hn = document.getElementById('bnHn').value.trim();
  if (!hn) return;
  _hnAutoSearchDebounce = setTimeout(() => searchPatient(), 350);
}

function openHnSearch() {
  const hn = document.getElementById('bnHn').value.trim();
  document.getElementById('hnSearchInput').value = hn;
  document.getElementById('hnSearchResults').innerHTML = '';
  document.getElementById('hnSearchModal').classList.add('show');
  setTimeout(() => document.getElementById('hnSearchInput').focus(), 100);
  if (hn) runPatientSearch();
}

async function runPatientSearch() {
  const q = document.getElementById('hnSearchInput').value.trim();
  const box = document.getElementById('hnSearchResults');
  if (!q) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="search-result-empty">กำลังค้นหา...</div>';
  try {
    const res  = await fetchWithTimeout(`/api/bookings/patient-search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.success) { box.innerHTML = `<div class="search-result-empty">เกิดข้อผิดพลาด</div>`; return; }
    const list = data.patients || [];
    if (list.length === 0) { box.innerHTML = '<div class="search-result-empty">ไม่พบข้อมูลผู้ป่วย</div>'; return; }
    box.innerHTML = list.map(p => `
      <div class="search-result-item" onclick="selectHnFromSearch('${p.hn}')">
        <span class="sri-hn">${p.hn}</span>
        <span class="sri-name">${p.patient_name || '-'}</span>
      </div>`).join('');
  } catch(e) {
    box.innerHTML = '<div class="search-result-empty">เกิดข้อผิดพลาดในการเชื่อมต่อ</div>';
  }
}

async function selectHnFromSearch(hn) {
  closeModal('hnSearchModal');
  document.getElementById('bnHn').value = hn;
  await searchPatient();
}

/* ===== AN INLINE REALTIME SEARCH ===== */
let _anInlineDebounce = null;
function debounceAnInline() {
  clearTimeout(_anInlineDebounce);
  const q = document.getElementById('bnAn').value.trim();
  if (!q) { hideAnDropdown(); return; }
  _anInlineDebounce = setTimeout(() => runAnInlineSearch(), 350);
}

async function runAnInlineSearch() {
  const q = document.getElementById('bnAn').value.trim();
  const box = document.getElementById('bnAnDropdown');
  if (!q) { hideAnDropdown(); return; }
  box.style.display = 'block';
  box.innerHTML = '<div class="search-result-empty">กำลังค้นหา...</div>';
  try {
    const res = await fetchWithTimeout(`/api/bookings/admission-search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.success) { box.innerHTML = '<div class="search-result-empty">เกิดข้อผิดพลาด</div>'; return; }
    const list = data.admissions || [];
    if (list.length === 0) { box.innerHTML = '<div class="search-result-empty">ไม่พบข้อมูล Admission</div>'; return; }
    box.innerHTML = list.map(a => `
      <div class="search-result-item" onclick="selectAnInline('${escAttr(a.an)}','${escAttr(a.hn)}')">
        <span class="sri-hn">${escHtml(a.an)}</span>
        <span class="sri-name">${escHtml(a.patient_name || '-')}</span>
        <span class="sri-sub">HN: ${escHtml(a.hn)}${a.admit_date ? ' | ' + escHtml(a.admit_date) : ''}</span>
      </div>`).join('');
  } catch(e) {
    box.innerHTML = '<div class="search-result-empty">เกิดข้อผิดพลาดในการเชื่อมต่อ</div>';
  }
}

function hideAnDropdown() {
  const box = document.getElementById('bnAnDropdown');
  if (box) box.style.display = 'none';
}

async function selectAnInline(an, hn) {
  document.getElementById('bnAn').value = an;
  hideAnDropdown();
  await fillWardByAN(an);
  if (hn && !document.getElementById('bnHn').value.trim()) {
    document.getElementById('bnHn').value = hn;
    await searchPatient();
  }
}

/* ===== AN SEARCH MODAL ===== */
function openAnSearch() {
  const an = document.getElementById('bnAn').value.trim();
  document.getElementById('anSearchInput').value = an;
  document.getElementById('anSearchResults').innerHTML = '';
  document.getElementById('anSearchModal').classList.add('show');
  setTimeout(() => document.getElementById('anSearchInput').focus(), 100);
  if (an) runAnSearch();
}

async function runAnSearch() {
  const q = document.getElementById('anSearchInput').value.trim();
  const box = document.getElementById('anSearchResults');
  if (!q) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="search-result-empty">กำลังค้นหา...</div>';
  try {
    const res  = await fetchWithTimeout(`/api/bookings/admission-search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.success) { box.innerHTML = `<div class="search-result-empty">เกิดข้อผิดพลาด</div>`; return; }
    const list = data.admissions || [];
    if (list.length === 0) { box.innerHTML = '<div class="search-result-empty">ไม่พบข้อมูล Admission</div>'; return; }
    box.innerHTML = list.map(a => `
      <div class="search-result-item" onclick="selectAnFromSearch('${a.an}','${a.hn}')">
        <span class="sri-hn">${a.an}</span>
        <span class="sri-name">${a.patient_name || '-'}</span>
        <span class="sri-sub">HN: ${a.hn}${a.admit_date ? ' | ' + a.admit_date : ''}</span>
      </div>`).join('');
  } catch(e) {
    box.innerHTML = '<div class="search-result-empty">เกิดข้อผิดพลาดในการเชื่อมต่อ</div>';
  }
}

async function fillWardByAN(an) {
  if (!an) return;
  try {
    const res  = await fetchWithTimeout(`/api/bookings/info-by-an/${encodeURIComponent(an)}`);
    const data = await res.json();
    if (data.success) {
      if (data.ward_name)   document.getElementById('bnWard').value   = data.ward_name;
      if (data.doctor_name) document.getElementById('bnDoctor').value = data.doctor_name;
      if (data.rights_name) {
        document.getElementById('bnRightsType').value    = data.rights_name;
        document.getElementById('bnRightsDisplay').value = data.rights_name;
        const piRights = document.getElementById('piRights');
        if (piRights) piRights.textContent = data.rights_name;
      }
      if (data.admit_date) {
        const admitEl = document.getElementById('bnAdmitDate');
        if (admitEl) admitEl.value = new Date(data.admit_date).toLocaleString('th-TH', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      }
    }
  } catch(e) {}
}

async function selectAnFromSearch(an, hn) {
  closeModal('anSearchModal');
  document.getElementById('bnAn').value = an;
  await fillWardByAN(an);
  if (hn && !document.getElementById('bnHn').value.trim()) {
    document.getElementById('bnHn').value = hn;
    await searchPatient();
  }
}

async function searchAdmissionByAN() {
  const an = document.getElementById('bnAn').value.trim();
  if (!an) return;
  document.getElementById('anSearchInput').value = an;
  await runAnSearch();
  document.getElementById('anSearchModal').classList.add('show');
}

/* ===== PATIENT SEARCH ===== */
async function searchPatient() {
  const hn = document.getElementById('bnHn').value.trim();
  if (!hn) { toast('กรุณากรอก HN', 'warning'); return; }

  showLoading(true);
  try {
    const [pRes, rRes, anRes] = await Promise.all([
      fetchWithTimeout(`/api/bookings/patient/${hn}`),
      fetchWithTimeout(`/api/bookings/rights/${hn}`),
      fetchWithTimeout(`/api/bookings/an-by-hn/${hn}`)
    ]);
    const pData = await pRes.json();
    const rData = await rRes.json();
    const anData = await anRes.json();

    const box = document.getElementById('patientInfoBox');
    if (pData.success) {
      document.getElementById('piHN').textContent    = pData.patient.hn;
      document.getElementById('piName').textContent  = pData.patient.patient_name || '-';
      document.getElementById('piPhone').textContent = pData.patient.mobile_phone_number || '-';
      const rightsVal    = rData.success ? rData.rights.rights_type    : '';
      const rightsDisplay = rData.success ? (rData.rights.rights_display || rightsVal) : '';
      document.getElementById('piRights').textContent     = rightsDisplay || 'ไม่พบข้อมูลสิทธิ์';
      document.getElementById('bnPatientName').value       = pData.patient.patient_name || '';
      document.getElementById('bnRightsType').value        = rightsVal;
      document.getElementById('bnRightsDisplay').value     = rightsDisplay;
      box.classList.add('show');

      // ถ้าเจอ AN ที่ยังไม่ confirm_discharge (ยังนอนอยู่) ให้ดึงข้อมูล admit มาเติมให้ครบ
      // เหมือนกับตอนค้นหา/เลือกด้วย AN โดยตรง
      if (anData.success && anData.an) {
        document.getElementById('bnAn').value = anData.an;
        await fillWardByAN(anData.an);
        toast(`พบข้อมูลผู้ป่วย: ${pData.patient.patient_name} (พบ Admission ${anData.an} ที่ยังไม่จำหน่าย)`, 'success');
      } else {
        toast(`พบข้อมูลผู้ป่วย: ${pData.patient.patient_name}`, 'success');
      }
    } else {
      box.classList.remove('show');
      toast(pData.message, 'warning');
    }
  } catch (e) {
    toast('เกิดข้อผิดพลาดในการค้นหา', 'error');
  } finally {
    showLoading(false);
  }
}

/* ===== SET DEFAULT DATE/TIME ===== */
function setDefaultDateTime() {
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  document.getElementById('bnCheckIn').value = fmt(now);
}

/* ===== วันที่จองห้อง (auto = วันเวลาปัจจุบัน) ===== */
function setBookingDateNow() {
  const el = document.getElementById('bnBookingDate');
  if (!el) return;
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  el.value = `${pad(now.getDate())}-${pad(now.getMonth()+1)}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/* ===== ราคาห้องที่จอง (จาก room_types) — เลือกได้ 3 ลำดับ ===== */
function populateRoomPriceSelect(sel, types) {
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">-- เลือกประเภทห้อง/ราคา --</option>';
  const sorted = [...(types || [])].sort((a, b) => (+a.price_per_day) - (+b.price_per_day));
  sorted.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.type_name} ${(+t.price_per_day).toLocaleString('th-TH')} บาท`;
    sel.appendChild(opt);
  });
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

async function loadRoomPriceTypes() {
  try {
    const res  = await fetchWithTimeout('/api/rooms/types');
    const data = await res.json();
    if (!data.success) return;
    ['bnRoomPriceType1', 'bnRoomPriceType2', 'bnRoomPriceType3'].forEach(id => {
      populateRoomPriceSelect(document.getElementById(id), data.types);
    });
    updatePriceRankLocks();
  } catch(e) {}
}

// ต้องเลือกลำดับที่ 1 ก่อนจึงเลือกลำดับที่ 2 ได้ และเลือกลำดับ 1-2 ก่อนจึงเลือกลำดับที่ 3 ได้
// ใช้ class "locked" + pointer-events:none แทน disabled จริง เพื่อให้ div ครอบยังรับ click ได้ทุกครั้ง (disabled จะกินอีเวนต์ค้างไปเลย ไม่ bubble ให้ parent อย่างสม่ำเสมอ)
function updatePriceRankLocks() {
  const sel1 = document.getElementById('bnRoomPriceType1');
  const sel2 = document.getElementById('bnRoomPriceType2');
  const sel3 = document.getElementById('bnRoomPriceType3');
  if (!sel1 || !sel2 || !sel3) return;

  const lock2 = !sel1.value;
  sel2.classList.toggle('locked', lock2);
  sel2.tabIndex = lock2 ? -1 : 0;
  if (lock2 && sel2.value) sel2.value = '';

  const lock3 = !sel1.value || !sel2.value;
  sel3.classList.toggle('locked', lock3);
  sel3.tabIndex = lock3 ? -1 : 0;
  if (lock3 && sel3.value) sel3.value = '';
}

function checkPriceRankClick(rank) {
  const sel = document.getElementById(rank === 2 ? 'bnRoomPriceType2' : 'bnRoomPriceType3');
  if (!sel || !sel.classList.contains('locked')) return;
  toast(rank === 2 ? 'กรุณาเลือกลำดับที่ 1 ก่อน' : 'กรุณาเลือกลำดับที่ 1 และ 2 ก่อน', 'warning');
}

/* ===== SUBMIT BOOKING ===== */
async function submitBooking() {
  const hn         = document.getElementById('bnHn').value.trim();
  const an         = document.getElementById('bnAn').value.trim();
  const patientName= document.getElementById('bnPatientName').value;
  const ward       = document.getElementById('bnWard').value.trim();
  const doctor     = document.getElementById('bnDoctor').value.trim();
  const bedno      = document.getElementById('bnRoomId').value;
  const roomtype   = document.getElementById('bnRoomType').value;
  const checkIn    = document.getElementById('bnCheckIn').value;
  const checkOut   = document.getElementById('bnCheckOut').value;
  const deposit      = document.getElementById('bnDeposit').value;
  const contactName   = document.getElementById('bnContactName').value.trim();
  const contactPhone  = document.getElementById('bnContactPhone').value.trim();
  const priorityType  = document.getElementById('bnPriorityType').value;
  const notes         = document.getElementById('bnNotes').value;
  const rightsType    = document.getElementById('bnRightsType').value;

  if (!hn)           return toast('กรุณากรอก HN', 'warning');
  if (!ward)         return toast('กรุณาระบุหอผู้ป่วย (Ward) ต้นสังกัด', 'warning');
  if (!contactName)  return toast('กรุณากรอกชื่อผู้ติดต่อ', 'warning');
  if (!contactPhone) return toast('กรุณากรอกเบอร์โทรผู้ติดต่อ', 'warning');
  if (!checkIn)      return toast('กรุณาระบุวันที่เข้าพัก', 'warning');

  const selectedOpt = document.getElementById('bnRoomId').options[document.getElementById('bnRoomId').selectedIndex];
  const roomId     = selectedOpt?.dataset.roomId || null;
  const roomNumber = bedno;
  const internalRoom = allRooms.find(r => String(r.room_number) === String(bedno));
  const roomTypeId = internalRoom?.room_type_id || null;

  showLoading(true);
  try {
    const res = await fetchWithTimeout('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hn, an, patient_name: patientName, ward, doctor_name: doctor,
        room_id: roomId, room_number: roomNumber, room_type_id: roomTypeId,
        check_in_date: checkIn, check_out_date: checkOut,
        rights_type: rightsType, deposit_amount: deposit || 0,
        contact_name: contactName, contact_phone: contactPhone,
        priority_type: priorityType || null, notes,
        ward_code: document.getElementById('bnWardFilter').value,
        roomtype_code: roomtype,
        waiting_list_id: currentWaitlistId || null
      })
    });
    const data = await res.json();
    if (data.success) {
      toast(data.message, 'success');
      if (data.warning) toast(data.warning, 'warning');
      clearBookingForm();
      switchTab('reservations');
      refreshAllData();
    } else {
      toast(data.message, data.type || 'error');
    }
  } catch (e) {
    toast('เกิดข้อผิดพลาดในการบันทึก', 'error');
  } finally {
    showLoading(false);
  }
}

/* ===== ADD TO WAITLIST ===== */
async function addToWaitlist() {
  const hn          = document.getElementById('bnHn').value.trim();
  const an          = document.getElementById('bnAn').value.trim();
  const patientName = document.getElementById('bnPatientName').value;
  const roomtype    = document.getElementById('bnRoomType').value;
  const bedno       = document.getElementById('bnRoomId').value;
  const checkIn     = document.getElementById('bnCheckIn').value;
  const checkOut    = document.getElementById('bnCheckOut').value;
  const deposit     = document.getElementById('bnDeposit').value;
  const contactName = document.getElementById('bnContactName').value.trim();
  const contactPhone= document.getElementById('bnContactPhone').value.trim();
  const notes       = document.getElementById('bnNotes').value;
  const noRoomReason= document.getElementById('bnNoRoomReason')?.value || null;
  const rightsType  = document.getElementById('bnRightsType').value;
  const wardCode    = document.getElementById('bnWardFilter').value;
  const ward        = document.getElementById('bnWard').value.trim();

  function readPriceType(id) {
    const sel = document.getElementById(id);
    const value = sel?.value || null;
    const name = value ? (sel.options[sel.selectedIndex]?.text || null) : null;
    return { id: value, name };
  }
  const priceType1 = readPriceType('bnRoomPriceType1');
  const priceType2 = readPriceType('bnRoomPriceType2');
  const priceType3 = readPriceType('bnRoomPriceType3');

  if (!hn) return toast('กรุณากรอก HN', 'warning');
  if (!patientName) return toast('กรุณาค้นหาข้อมูลผู้ป่วยก่อน', 'warning');

  showLoading(true);
  try {
    const res = await fetchWithTimeout('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hn, patient_name: patientName, room_type_id: priceType1.id,
        rights_type: rightsType, notes,
        an, ward,
        doctor_name: document.getElementById('bnDoctor').value.trim(),
        ward_code: wardCode, bedno,
        check_in_date: checkIn, check_out_date: checkOut,
        deposit_amount: deposit || 0,
        contact_name: contactName, contact_phone: contactPhone,
        priority_type: (document.getElementById('bnPriorityType') || {}).value || null,
        roomtype_code: roomtype || null,
        roomtype_name: priceType1.name,
        room_type_id_2: priceType2.id, roomtype_name_2: priceType2.name,
        room_type_id_3: priceType3.id, roomtype_name_3: priceType3.name,
        no_pay_reason: noRoomReason
      })
    });
    const data = await res.json();
    toast(data.message, data.success ? 'success' : 'error');
    if (data.success) {
      clearBookingForm();
      refreshAllData();
      await goToMyWardBookings(ward);
    }
  } catch (e) {
    toast('เกิดข้อผิดพลาด', 'error');
  } finally {
    showLoading(false);
  }
}

function clearBookingForm() {
  ['bnHn','bnAn','bnPatientName','bnRightsType','bnWard','bnDoctor','bnContactName','bnContactPhone','bnNotes','bnDeposit','bnRightsDisplay','bnAdmitDate','bnNoRoomReason'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const pt = document.getElementById('bnPriorityType');
  if (pt) pt.value = '';
  ['bnRoomPriceType1', 'bnRoomPriceType2', 'bnRoomPriceType3'].forEach(id => {
    const rpt = document.getElementById(id);
    if (rpt) rpt.value = '';
  });
  updatePriceRankLocks();
  const co = document.getElementById('bnCheckOut');
  if (co) co.value = '';
  const wf = document.getElementById('bnWardFilter'); if (wf) wf.value = '';
  document.getElementById('bnRoomType').value = '';
  document.getElementById('bnRoomNo').innerHTML = '<option value="">-- เลือกห้อง --</option>';
  document.getElementById('bnRoomId').innerHTML = '<option value="">-- เลือกเตียง --</option>';
  document.getElementById('patientInfoBox').classList.remove('show');
  document.getElementById('roomPriceBox').style.display = 'none';
  setDefaultDateTime();
  setBookingDateNow();
  currentWaitlistId = null;
}

/* ===== RESERVATIONS LIST ===== */
async function loadReservations() {
  const wrap = document.getElementById('reservationsTableWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div style="text-align:center;color:#90A4AE;padding:40px 0;font-size:14px">กำลังโหลดข้อมูล...</div>';
  try {
    const res = await fetchWithTimeout('/api/bookings');
    const data = await res.json();
    if (!data.success) { wrap.innerHTML = '<div style="text-align:center;color:#e57373;padding:40px 0">โหลดข้อมูลไม่สำเร็จ</div>'; return; }
    const allList = (data.bookings || []).filter(b => b.status === 'reserved' || b.status === 'occupied');
    const filterVal = document.querySelector('input[name="reservFilter"]:checked')?.value || 'reserved';
    const list = filterVal === 'all' ? allList : allList.filter(b => b.status === filterVal);
    const reservedCount = allList.filter(b => b.status === 'reserved').length;
    const badge = document.getElementById('reservationsBadge');
    if (badge) { if (reservedCount > 0) { badge.textContent = reservedCount; badge.style.display = 'inline-flex'; } else badge.style.display = 'none'; }
    if (list.length === 0) {
      wrap.innerHTML = '<div style="text-align:center;color:#90A4AE;padding:40px 0;font-size:14px">ไม่มีข้อมูลการจอง</div>';
      return;
    }
    const statusLabel = { reserved: '<span class="status-chip chip-reserved">รอเข้าพัก</span>', occupied: '<span class="status-chip chip-occupied">เข้าพักแล้ว</span>' };
    wrap.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#F5F7FA;color:#546E7A;font-size:12px">
            <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #E0E0E0">HN</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #E0E0E0">ชื่อ-สกุล</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #E0E0E0">ห้อง</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #E0E0E0">ประเภทห้อง</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #E0E0E0">วันที่เข้าพัก</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #E0E0E0">วันที่กำหนดออก</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #E0E0E0">สิทธิ์</th>
            <th style="padding:10px 12px;text-align:center;border-bottom:1px solid #E0E0E0">สถานะ</th>
            <th style="padding:10px 12px;text-align:center;border-bottom:1px solid #E0E0E0">จัดการ</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((b, i) => `
          <tr style="background:${i%2===0?'#fff':'#FAFAFA'};border-bottom:1px solid #F0F0F0">
            <td style="padding:10px 12px;font-weight:600;color:var(--primary)">${escHtml(b.hn||'-')}</td>
            <td style="padding:10px 12px">${escHtml(b.patient_name||'-')}</td>
            <td style="padding:10px 12px;font-weight:600">${escHtml(b.room_number||'-')}</td>
            <td style="padding:10px 12px">${escHtml(b.type_name||'-')}</td>
            <td style="padding:10px 12px">${b.check_in_date ? b.check_in_date.replace('T',' ').slice(0,16) : '-'}</td>
            <td style="padding:10px 12px">${b.check_out_date ? b.check_out_date.slice(0,10) : '-'}</td>
            <td style="padding:10px 12px">${escHtml(b.rights_type||'-')}</td>
            <td style="padding:10px 12px;text-align:center">${statusLabel[b.status]||b.status}</td>
            <td style="padding:10px 12px;text-align:center">
              ${b.status === 'reserved'
                ? `<button class="btn btn-sm" style="background:#1565C0;color:#fff;font-size:12px;padding:5px 10px"
                     onclick="openCheckinConfirm(${b.id},'${escHtml(b.patient_name||'')}','${escHtml(b.room_number||'')}')">
                     🔄 อัพเดทสถานะ
                   </button>`
                : `<span style="font-size:12px;color:#90A4AE">-</span>`}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    wrap.innerHTML = '<div style="text-align:center;color:#e57373;padding:40px 0">เกิดข้อผิดพลาดในการโหลดข้อมูล</div>';
  }
}

/* ===== CHECK-IN CONFIRM ===== */
function openCheckinConfirm(bookingId, patientName, roomNumber) {
  document.getElementById('checkinPatientName').textContent = patientName || '-';
  document.getElementById('checkinRoomNumber').textContent  = roomNumber  || '-';
  document.getElementById('checkinModal').dataset.bookingId = bookingId;
  document.getElementById('checkinModal').classList.add('show');
}

async function confirmCheckin() {
  const modal = document.getElementById('checkinModal');
  const id = modal.dataset.bookingId;
  if (!id) return;
  showLoading(true);
  try {
    const res  = await fetchWithTimeout(`/api/bookings/${id}/checkin`, { method: 'PATCH' });
    const data = await res.json();
    toast(data.message, data.success ? 'success' : 'error');
    if (data.success) {
      modal.classList.remove('show');
      refreshAllData();
    }
  } catch (e) {
    toast('เกิดข้อผิดพลาด', 'error');
  } finally {
    showLoading(false);
  }
}

/* ===== LOAD WAITLIST ===== */
async function loadWaitlist() {
  try {
    const filterVal = document.querySelector('input[name="waitlistFilter"]:checked')?.value || 'waiting';
    const res = await fetchWithTimeout('/api/waitlist?all=true');
    const data = await res.json();
    if (!data.success) return;
    const allList = data.list || [];
    let list = filterVal === 'all' ? allList
             : allList.filter(w => w.status === filterVal);

    // กรองวันที่เข้าพัก
    const dateFrom = document.getElementById('wlDateFrom')?.value || '';
    const dateTo   = document.getElementById('wlDateTo')?.value || '';
    if (dateFrom || dateTo) {
      list = list.filter(item => {
        if (!item.check_in_date) return false;
        const d = item.check_in_date.slice(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo   && d > dateTo)   return false;
        return true;
      });
      const info = document.getElementById('wlDateFilterInfo');
      if (info) {
        const fmtTH = v => v ? new Date(v + 'T00:00:00').toLocaleDateString('th-TH') : '';
        const parts = [];
        if (dateFrom) parts.push(`ตั้งแต่ ${fmtTH(dateFrom)}`);
        if (dateTo)   parts.push(`ถึง ${fmtTH(dateTo)}`);
        info.textContent = `กำลังกรอง: ${parts.join(' ')} — พบ ${list.length} รายการ`;
        info.style.display = 'inline';
      }
    } else {
      const info = document.getElementById('wlDateFilterInfo');
      if (info) info.style.display = 'none';
    }

    // Badge + dashboard: นับเฉพาะ waiting
    const waitingCount = allList.filter(w => w.status === 'waiting').length;
    const badge = document.getElementById('waitBadge');
    if (waitingCount > 0) { badge.textContent = waitingCount; badge.style.display = 'inline-flex'; }
    else badge.style.display = 'none';
    const dashWard = document.getElementById('dashBedWardFilter')?.value || '';
    const cwCount  = dashWard ? allList.filter(w => w.status === 'waiting' && w.ward === dashWard).length : waitingCount;
    const cw = document.getElementById('countWaiting');
    if (cw) cw.textContent = cwCount;

    const container = document.getElementById('waitlistContent');
    if (list.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>ไม่มีรายการในคิวรอ</p></div>`;
      return;
    }

    waitlistItems = list;
    const statusChip = {
      waiting:  '<span class="status-chip chip-waiting">รอคิว</span>',
      reserved: '<span class="status-chip chip-reserved">จองแล้ว</span>',
      assigned: '<span class="status-chip chip-occupied">ได้ห้องแล้ว</span>',
      cancelled:'<span class="status-chip chip-cancelled">ยกเลิก</span>'
    };
    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>คิว</th>
            <th>HN</th>
            <th>AN</th>
            <th>ชื่อ-สกุล</th>
            <th>ประเภทผู้จอง</th>
            <th>ประเภทห้อง</th>
            <th>สิทธิ์</th>
            <th>วันที่เข้าพัก</th>
            <th>หมายเหตุ</th>
            <th>วันที่/เวลาลงข้อมูล</th>
            <th>สถานะ</th>
            <th>การดำเนินการ</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((item, i) => {
            const reqDate = new Date(item.request_date);
            const dateStr = reqDate.toLocaleDateString('th-TH') + ' ' + reqDate.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
            const isDone  = item.status !== 'waiting';
            const rowStyle = isDone ? 'opacity:0.6;background:#FAFAFA' : '';
            const actions  = isDone
              ? `<span style="font-size:12px;color:#90A4AE">-</span>`
              : `<div style="display:flex;gap:6px">
                   <button class="btn btn-success btn-sm" onclick="goToBookingFromWait(${item.id})">🏨 จัดห้อง</button>
                   <button class="btn btn-danger btn-sm" onclick="cancelWait(${item.id})">✕</button>
                 </div>`;
            return `
              <tr style="${rowStyle}">
                <td><div class="queue-number">${i+1}</div></td>
                <td><span class="hn-text">${escHtml(item.hn||'-')}</span></td>
                <td style="font-size:13px;color:#546E7A">${escHtml(item.an||'-')}</td>
                <td>${escHtml(item.patient_name||'-')}</td>
                <td style="font-size:13px">${escHtml(item.priority_type||'-')}</td>
                <td>${escHtml(item.roomtype_name||item.type_name||'-')}</td>
                <td>${escHtml(item.rights_type||'-')}</td>
                <td style="font-size:13px">${item.check_in_date ? new Date(item.check_in_date).toLocaleDateString('th-TH') : '-'}</td>
                <td style="font-size:13px;max-width:150px;white-space:normal">${escHtml(item.notes||'-')}</td>
                <td style="font-size:13px">${escHtml(dateStr)}</td>
                <td>${statusChip[item.status] || escHtml(item.status)}</td>
                <td>${actions}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    console.error('loadWaitlist error', e);
  }
}

function clearWlDateFilter() {
  const f = document.getElementById('wlDateFrom');
  const t = document.getElementById('wlDateTo');
  if (f) f.value = '';
  if (t) t.value = '';
  loadWaitlist();
}

async function cancelWait(id) {
  if (!confirm('ยืนยันยกเลิกคิวรอนี้?')) return;
  await fetchWithTimeout(`/api/waitlist/${id}/cancel`, { method: 'PATCH' });
  toast('ยกเลิกคิวรอเรียบร้อย', 'success');
  refreshAllData();
}

function goToBookingFromWait(id) {
  const item = waitlistItems.find(w => w.id === id);
  if (!item) return;
  currentWaitlistId = id;
  switchTab('booking');
  // Fill form
  document.getElementById('bnHn').value          = item.hn          || '';
  document.getElementById('bnAn').value           = item.an          || '';
  document.getElementById('bnPatientName').value  = item.patient_name|| '';
  document.getElementById('bnWard').value          = item.ward         || '';
  document.getElementById('bnDoctor').value        = item.doctor_name  || '';
  document.getElementById('bnRightsType').value    = item.rights_type  || '';
  document.getElementById('bnRightsDisplay').value = item.rights_type  || '';
  document.getElementById('bnNotes').value         = item.notes        || '';
  document.getElementById('bnContactName').value   = item.contact_name  || '';
  document.getElementById('bnContactPhone').value  = item.contact_phone || '';
  const pt = document.getElementById('bnPriorityType');
  if (pt) pt.value = item.priority_type || '';
  const rtSel = document.getElementById('bnRoomType');
  if (rtSel && item.roomtype_code) {
    if ([...rtSel.options].some(o => o.value === item.roomtype_code)) rtSel.value = item.roomtype_code;
  }
  // Show patient info box
  if (item.hn) {
    document.getElementById('piHN').textContent    = item.hn;
    document.getElementById('piName').textContent  = item.patient_name || '-';
    document.getElementById('piRights').textContent= item.rights_type  || '-';
    document.getElementById('patientInfoBox').classList.add('show');
  }
}

/* ===== ASSIGN MODAL ===== */
function openAssignModal(waitId, patientName, roomTypeName) {
  assignWaitId = waitId;
  document.getElementById('assignModal').classList.add('show');

  // Populate available rooms
  const sel = document.getElementById('assignRoomId');
  const avail = allRooms.filter(r => r.status === 'available');
  sel.innerHTML = avail.length === 0
    ? '<option value="">ไม่มีห้องว่างขณะนี้</option>'
    : '<option value="">-- เลือกห้อง --</option>' + avail.map(r =>
        `<option value="${r.id}|${r.room_number}">ห้อง ${r.room_number} - ${r.type_name||''} ชั้น ${r.floor||''}</option>`
      ).join('');

  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  document.getElementById('assignCheckIn').value = fmt(now);
  document.getElementById('assignCheckOut').value = '';
}

async function confirmAssign() {
  const roomVal = document.getElementById('assignRoomId').value;
  const checkIn = document.getElementById('assignCheckIn').value;
  const checkOut = document.getElementById('assignCheckOut').value;
  if (!roomVal) return toast('กรุณาเลือกห้อง', 'warning');
  if (!checkIn) return toast('กรุณาระบุวันเข้าพัก', 'warning');

  const [roomId, roomNumber] = roomVal.split('|');
  showLoading(true);
  try {
    const res = await fetchWithTimeout(`/api/waitlist/${assignWaitId}/confirm`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId, room_number: roomNumber, check_in_date: checkIn, check_out_date: checkOut })
    });
    const data = await res.json();
    toast(data.message, data.success ? 'success' : 'error');
    if (data.success) {
      closeModal('assignModal');
      await refreshAllData();
    }
  } catch (e) {
    toast('เกิดข้อผิดพลาด', 'error');
  } finally {
    showLoading(false);
  }
}

/* ===== CURRENT OCCUPANTS (SPLIT PANEL) ===== */
let allOccupants = [];
let selectedBedno = null;

async function loadBookings() { await loadOccupants(); }  // alias for socket events

async function loadOccupants() {
  const panel = document.getElementById('occupantsPanel');
  panel.innerHTML = `<div class="empty-state"><div class="spinner" style="margin:0 auto"></div><p style="margin-top:12px">กำลังโหลด...</p></div>`;
  try {
    const res  = await fetchWithTimeout('/api/bookings/occupants');
    const data = await res.json();
    if (!data.success) {
      panel.innerHTML = `<div class="alert alert-error" style="margin:16px">❌ ${data.message}</div>`;
      return;
    }
    allOccupants = data.occupants || [];
    populateOccupantWardDropdown(allOccupants);
    renderOccupants(allOccupants);
  } catch (e) {
    panel.innerHTML = `<div class="alert alert-error" style="margin:16px">❌ โหลดไม่สำเร็จ</div>`;
  }
}

function populateOccupantWardDropdown(list) {
  const sel = document.getElementById('occupantWardFilter');
  if (!sel) return;
  const cur = sel.value;
  const wards = [...new Set(list.map(o => o.ward).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">— ทุก Ward —</option>';
  wards.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w; opt.textContent = w;
    sel.appendChild(opt);
  });
  if (wards.includes(cur)) sel.value = cur;
}

function filterOccupants() {
  const ward = document.getElementById('occupantWardFilter')?.value || '';
  const filtered = ward ? allOccupants.filter(o => o.ward === ward) : allOccupants;
  renderOccupants(filtered);
}

function fmtDate(val) {
  if (!val) return '-';
  const d = new Date(val);
  if (isNaN(d)) return val;
  return d.toLocaleDateString('th-TH', { day:'2-digit', month:'2-digit', year:'2-digit' });
}

function renderOccupants(list) {
  const panel = document.getElementById('occupantsPanel');
  if (!list || list.length === 0) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-icon">🛏️</div><p>ไม่มีผู้พักในขณะนี้</p></div>`;
    return;
  }

  // Group: ward → roomtype → rows
  const grouped = new Map();
  for (const o of list) {
    const ward = o.ward || 'ไม่ระบุ';
    const rt   = o.roomtype || 'ไม่ระบุประเภท';
    if (!grouped.has(ward)) grouped.set(ward, new Map());
    const rtMap = grouped.get(ward);
    if (!rtMap.has(rt)) rtMap.set(rt, []);
    rtMap.get(rt).push(o);
  }

  let html = `
    <div style="padding:8px 18px;background:#F5F7FA;font-size:12px;color:#546E7A;border-bottom:1px solid #E0E0E0">
      ผู้พักปัจจุบัน <strong>${list.length}</strong> ราย
    </div>
    <!-- column header -->
    <div class="occ-row" style="background:#FAFBFC;cursor:default;font-size:11px;font-weight:700;color:#90A4AE;border-bottom:2px solid #E3F2FD">
      <div>เตียง</div>
      <div>ชื่อ-นามสกุล</div>
      <div>วัน Admit</div>
      <div>AN</div>
      <div>แพทย์เจ้าของไข้</div>
    </div>`;

  for (const [ward, rtMap] of grouped) {
    const total = [...rtMap.values()].reduce((s,a)=>s+a.length,0);
    html += `<div class="occ-ward-header">🏥 ${ward} <span style="font-size:11px;font-weight:500;margin-left:6px;color:#64B5F6">(${total} ราย)</span></div>`;

    for (const [rt, rows] of rtMap) {
      html += `<div class="occ-roomtype-label">🛏️ ${rt}</div>`;
      for (const o of rows) {
        const sel = selectedBedno === o.bedno ? ' selected' : '';
        const nextStyle = o.has_next_reserve ? ' style="background:#FFF9C4;color:#000"' : '';
        const nextBadge = o.has_next_reserve ? ' <span title="มีคนจองต่อ" style="font-size:11px;background:#F9A825;color:#000;padding:1px 6px;border-radius:10px;font-weight:700">📋 จองต่อ</span>' : '';
        html += `<div class="occ-row${sel}" onclick="selectBed('${o.bedno}')"${nextStyle}>
          <div class="occ-bedno">${o.bedno}</div>
          <div class="occ-name">${o.ptname || '-'}${nextBadge}</div>
          <div class="occ-admit">${fmtDate(o.regdate)}</div>
          <div class="occ-an">${o.an || '-'}</div>
          <div class="occ-doctor">${o.doctor || '-'}</div>
        </div>`;
      }
    }
  }

  panel.innerHTML = html;
}

async function selectBed(bedno) {
  selectedBedno = bedno;
  // highlight selected row
  document.querySelectorAll('.occ-row').forEach(r => r.classList.remove('selected'));
  document.querySelectorAll('.occ-row').forEach(r => {
    if (r.onclick?.toString().includes(`'${bedno}'`)) r.classList.add('selected');
  });
  await loadRoomBookings(bedno);
}

async function loadRoomBookings(bedno) {
  const panel = document.getElementById('bookingsPanel');
  panel.innerHTML = `<div class="right-header">📋 การจองเตียง ${bedno}</div>
    <div class="empty-state" style="min-height:120px">
      <div class="spinner" style="margin:0 auto;width:28px;height:28px;border-width:3px"></div>
    </div>`;
  try {
    const res  = await fetchWithTimeout(`/api/bookings/room-bookings/${encodeURIComponent(bedno)}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    const bks = data.bookings || [];
    const statusLabel = { reserved:'🟡 จองแล้ว', occupied:'🔴 มีผู้พัก' };
    const statusClass = { reserved:'badge-reserved', occupied:'badge-occupied' };

    const cardsHtml = bks.length === 0
      ? `<div class="right-placeholder"><div style="font-size:32px;opacity:.3">📭</div>
           <p style="color:#90A4AE;margin-top:8px;font-size:13px">ไม่มีการจองสำหรับเตียงนี้</p></div>`
      : bks.map(b => `
          <div class="booking-card">
            <div class="bk-ref">${b.booking_ref || '(ไม่มีรหัส)'}</div>
            <div class="bk-name">${b.patient_name || '-'}</div>
            <div class="bk-meta">
              ${b.an ? `<div>AN: <strong>${b.an}</strong></div>` : ''}
              ${b.doctor_name ? `<div>แพทย์: ${b.doctor_name}</div>` : ''}
              ${b.ward ? `<div>Ward: ${b.ward}</div>` : ''}
              <div>วันเข้าพัก: <strong>${b.check_in_date ? new Date(b.check_in_date).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}) : '-'}</strong></div>
              ${b.check_out_date ? `<div>วันกำหนดออก: ${new Date(b.check_out_date).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'})}</div>` : ''}
              ${b.rights_type ? `<div>สิทธิ์: ${b.rights_type}</div>` : ''}
            </div>
            <span class="room-status-badge ${statusClass[b.status]||''} bk-status">${statusLabel[b.status]||b.status}</span>
          </div>`).join('');

    panel.innerHTML = `
      <div class="right-header">📋 การจองเตียง <span style="font-size:18px;font-weight:800">${bedno}</span>
        <span style="margin-left:auto;font-size:12px;font-weight:500;opacity:.8">${bks.length} รายการ</span>
      </div>
      ${cardsHtml}`;
  } catch (e) {
    panel.innerHTML = `<div class="right-header">📋 การจองเตียง ${bedno}</div>
      <div class="alert alert-error" style="margin:12px">❌ ${e.message}</div>`;
  }
}

async function doPendingDischarge(id) {
  showLoading(true);
  const res = await fetchWithTimeout(`/api/bookings/${id}/pending-discharge`, { method: 'PATCH' });
  const data = await res.json();
  showLoading(false);
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) { refreshAllData(); }
}

async function doCheckin(id) {
  showLoading(true);
  const res = await fetchWithTimeout(`/api/bookings/${id}/checkin`, { method: 'PATCH' });
  const data = await res.json();
  showLoading(false);
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) { refreshAllData(); }
}

async function doCheckout(id) {
  if (!confirm('ยืนยัน Check-out?')) return;
  showLoading(true);
  const res = await fetchWithTimeout(`/api/bookings/${id}/checkout`, { method: 'PATCH' });
  const data = await res.json();
  showLoading(false);
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) { refreshAllData(); }
}

async function doCancel(id) {
  if (!confirm('ยืนยันยกเลิกการจอง?')) return;
  showLoading(true);
  const res = await fetchWithTimeout(`/api/bookings/${id}/cancel`, { method: 'PATCH' });
  const data = await res.json();
  showLoading(false);
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) { refreshAllData(); }
}

/* ===== SEED DEMO ===== */
async function seedDemo() {
  if (!confirm('เพิ่มข้อมูลห้องพักตัวอย่างสำหรับทดสอบ?')) return;
  showLoading(true);
  try {
    const res = await fetchWithTimeout('/api/rooms/seed-demo', { method: 'POST' });
    const data = await res.json();
    toast(data.message, data.success ? 'success' : 'error');
    if (data.success) await loadRooms();
  } catch (e) {
    toast('เกิดข้อผิดพลาด', 'error');
  } finally {
    showLoading(false);
  }
}

/* ===== ALL QUEUE (waiting + reserved combined) ===== */
let allQueueList = [];
let allQueueFilteredList = [];

async function loadAllQueue() {
  const wrap = document.getElementById('allQueueTableWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div style="text-align:center;color:#90A4AE;padding:40px 0;font-size:14px">กำลังโหลดข้อมูล...</div>';
  try {
    const res  = await fetchWithTimeout('/api/bookings/allqueue');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    const waitItems = (data.waiting || []).map(w => ({
      _type: 'waiting', id: w.id,
      hn: w.hn, an: w.an, patient_name: w.patient_name,
      ward: w.ipt_ward_name || w.booked_ward || '-',
      room_number: '-',
      type_name: w.type_name || '-',
      type_name_2: w.type_name_2 || '-',
      type_name_3: w.type_name_3 || '-',
      rights_type: w.rights_type,
      date: w.request_date,
      check_in_date: w.check_in_date,
      rr_est_adm_date: w.rr_est_adm_date,
      notes: w.notes,
      created_by_name: w.created_by_name,
      status: 'waiting', priority_type: w.priority_type
    }));

    const reservedItems = (data.reserved || []).map(b => ({
      _type: 'reserved', id: b.id,
      hn: b.hn, an: b.an, patient_name: b.patient_name,
      ward: b.ipt_ward_name || b.booked_ward || '-',
      room_number: b.room_number,
      type_name: b.type_name || '-',
      type_name_2: '-',
      type_name_3: '-',
      rights_type: b.rights_type,
      date: b.check_in_date || b.created_at,
      check_in_date: b.check_in_date,
      rr_est_adm_date: b.rr_est_adm_date,
      notes: b.notes,
      created_by_name: b.created_by_name,
      status: 'reserved', priority_type: b.priority_type || '-'
    }));

    allQueueList = [...waitItems, ...reservedItems]
      .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

    populateAllQueueWardDropdown(allQueueList);
    renderAllQueue(allQueueList);
  } catch (e) {
    if (wrap) wrap.innerHTML = '<div style="text-align:center;color:#e57373;padding:40px 0">เกิดข้อผิดพลาดในการโหลดข้อมูล</div>';
  }
}

function populateAllQueueWardDropdown(list) {
  const sel = document.getElementById('allQueueWardFilter');
  if (!sel) return;
  const cur = sel.value;
  const wards = [...new Set(list.map(o => o.ward).filter(w => w && w !== '-'))].sort();
  sel.innerHTML = '<option value="">— ทุก Ward —</option>';
  wards.forEach(w => { const o = document.createElement('option'); o.value = w; o.textContent = w; sel.appendChild(o); });
  if (wards.includes(cur)) sel.value = cur;
}

function filterAllQueue() {
  const ward      = document.getElementById('allQueueWardFilter')?.value || '';
  const filterVal = document.querySelector('input[name="allQueueFilter"]:checked')?.value || 'all';
  const dateFrom  = document.getElementById('aqDateFrom')?.value || '';
  const dateTo    = document.getElementById('aqDateTo')?.value || '';

  let list = allQueueList;
  if (ward)                list = list.filter(i => i.ward === ward);
  if (filterVal !== 'all') list = list.filter(i => i.status === filterVal);

  if (dateFrom || dateTo) {
    list = list.filter(item => {
      // ใช้ check_in_date ก่อน ถ้าไม่มีใช้ rr_est_adm_date
      const raw = item.check_in_date || item.rr_est_adm_date || '';
      if (!raw) return false;
      const d = raw.slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo   && d > dateTo)   return false;
      return true;
    });
    const info = document.getElementById('aqDateFilterInfo');
    if (info) {
      const fmtTH = v => v ? new Date(v + 'T00:00:00').toLocaleDateString('th-TH') : '';
      const parts = [];
      if (dateFrom) parts.push(`ตั้งแต่ ${fmtTH(dateFrom)}`);
      if (dateTo)   parts.push(`ถึง ${fmtTH(dateTo)}`);
      info.textContent = `กำลังกรอง: ${parts.join(' ')} — พบ ${list.length} รายการ`;
      info.style.display = 'inline';
    }
  } else {
    const info = document.getElementById('aqDateFilterInfo');
    if (info) info.style.display = 'none';
  }

  renderAllQueue(list);
}

function clearAqDateFilter() {
  const f = document.getElementById('aqDateFrom');
  const t = document.getElementById('aqDateTo');
  if (f) f.value = '';
  if (t) t.value = '';
  filterAllQueue();
}

function renderAllQueue(list) {
  allQueueFilteredList = list;
  const wrap = document.getElementById('allQueueTableWrap');
  if (!wrap) return;
  if (list.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;color:#90A4AE;padding:40px 0;font-size:14px">ไม่มีข้อมูล</div>';
    return;
  }
  const statusChip = {
    waiting:  '<span class="status-chip chip-waiting">⏳ ยังไม่ได้ห้อง</span>',
    reserved: '<span class="status-chip chip-reserved">✅ ได้ห้องแล้ว รอเข้าพัก</span>'
  };
  const th = s => `<th style="padding:10px 12px;text-align:left;border-bottom:1px solid #E0E0E0;white-space:nowrap">${s}</th>`;
  wrap.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead>
        <tr style="background:#F5F7FA;color:#546E7A;font-size:12px;font-weight:700">
          ${th('#')}${th('HN')}${th('ชื่อ-สกุล')}${th('Ward ปัจจุบัน')}${th('ห้อง')}
          ${th('ประเภทห้อง')}${th('สิทธิการรักษา')}${th('วันที่เข้าพัก')}${th('หมายเหตุ')}
          ${th('วันที่จอง')}${th('ผู้จอง')}<th style="padding:10px 12px;text-align:center;border-bottom:1px solid #E0E0E0">สถานะ</th>
        </tr>
      </thead>
      <tbody>
        ${list.map((item, i) => {
          const fmtDate = v => v ? new Date(v).toLocaleDateString('th-TH') : '-';
          return `
          <tr style="background:${i%2===0?'#fff':'#FAFAFA'};border-bottom:1px solid #F0F0F0">
            <td style="padding:10px 12px;color:#90A4AE;font-size:12px">${i+1}</td>
            <td style="padding:10px 12px;font-weight:600;color:var(--primary)">${escHtml(item.hn||'-')}</td>
            <td style="padding:10px 12px">${escHtml(item.patient_name||'-')}</td>
            <td style="padding:10px 12px">${escHtml(item.ward||'-')}</td>
            <td style="padding:10px 12px;font-weight:${item.room_number!=='-'?'600':'400'}">${escHtml(item.room_number||'-')}</td>
            <td style="padding:10px 12px;font-size:12px;line-height:1.6;white-space:nowrap">
              <div>1. ${escHtml(item.type_name||'-')}</div>
              <div>2. ${escHtml(item.type_name_2||'-')}</div>
              <div>3. ${escHtml(item.type_name_3||'-')}</div>
            </td>
            <td style="padding:10px 12px">${escHtml(item.rights_type||'-')}</td>
            <td style="padding:10px 12px;font-size:12px;white-space:nowrap">${fmtDate(item.check_in_date || item.rr_est_adm_date)}</td>
            <td style="padding:10px 12px;font-size:12px;max-width:160px;white-space:normal;color:${item.notes ? '#C62828' : '#546E7A'}">${escHtml(item.notes||'-')}</td>
            <td style="padding:10px 12px;font-size:12px;color:#546E7A;white-space:nowrap">${item.date ? item.date.replace('T',' ').slice(0,16) : '-'}</td>
            <td style="padding:10px 12px;font-size:12px;white-space:nowrap">${escHtml(item.created_by_name||'-')}</td>
            <td style="padding:10px 12px;text-align:center">${statusChip[item.status]||item.status}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

/* ===== PRINT ALL QUEUE ===== */
function printAllQueue() {
  const list = allQueueFilteredList;
  if (!list || list.length === 0) { toast('ไม่มีข้อมูลสำหรับพิมพ์', 'warning'); return; }

  // รวบรวม filter info สำหรับแสดงหัวรายงาน
  const ward      = document.getElementById('allQueueWardFilter')?.value || '';
  const filterVal = document.querySelector('input[name="allQueueFilter"]:checked')?.value || 'all';
  const dateFrom  = document.getElementById('aqDateFrom')?.value || '';
  const dateTo    = document.getElementById('aqDateTo')?.value || '';
  const statusLabel = { all: 'ทั้งหมด', waiting: 'ยังไม่ได้ห้อง', reserved: 'ได้ห้องแล้ว รอเข้าพัก' };
  const fmtTH = v => v ? new Date(v + 'T00:00:00').toLocaleDateString('th-TH', { day:'numeric', month:'long', year:'numeric' }) : '';
  const fmtDT = v => v ? new Date(v).toLocaleDateString('th-TH', { day:'numeric', month:'long', year:'numeric' }) : '-';

  const filterParts = [];
  if (ward)     filterParts.push(`Ward: <b>${escHtml(ward)}</b>`);
  filterParts.push(`สถานะ: <b>${statusLabel[filterVal] || filterVal}</b>`);
  if (dateFrom) filterParts.push(`ตั้งแต่: <b>${fmtTH(dateFrom)}</b>`);
  if (dateTo)   filterParts.push(`ถึง: <b>${fmtTH(dateTo)}</b>`);

  const rows = list.map((item, i) => {
    const checkInDate = fmtDT(item.check_in_date || item.rr_est_adm_date);
    const statusTH = { waiting: 'รอคิว', reserved: 'ได้ห้องแล้ว รอเข้าพัก' };
    return `<tr>
      <td class="center">${i + 1}</td>
      <td class="center">${escHtml(item.hn || '-')}</td>
      <td>${escHtml(item.patient_name || '-')}</td>
      <td>${escHtml(item.ward || '-')}</td>
      <td class="center">${escHtml(item.room_number && item.room_number !== '-' ? item.room_number : '-')}</td>
      <td>${escHtml(item.type_name || '-')}</td>
      <td>${escHtml(item.rights_type || '-')}</td>
      <td class="center">${checkInDate}</td>
      <td>${escHtml(item.notes || '')}</td>
      <td class="center">${statusTH[item.status] || item.status}</td>
    </tr>`;
  }).join('');

  const printedAt = new Date().toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' });

  const html = `<!DOCTYPE html><html lang="th"><head>
  <meta charset="UTF-8">
  <title>รายชื่อผู้จองและรอคิว</title>
  <style>
    @page { size: A4 landscape; margin: 15mm 12mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Angsana New', 'AngsanaUPC', serif; font-size: 16px; color: #222; margin: 0; }
    .report-title { font-size: 22px; font-weight: 700; text-align: center; margin-bottom: 4px; }
    .report-sub   { font-size: 17px; text-align: center; color: #555; margin-bottom: 10px; }
    .filter-bar   { font-size: 15px; color: #444; margin-bottom: 12px; display: flex; flex-wrap: wrap; gap: 14px; border-bottom: 1px solid #ccc; padding-bottom: 8px; }
    .meta-right   { text-align: right; font-size: 14px; color: #777; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 16px; }
    thead tr { background: #1565C0; color: #fff; }
    th { padding: 6px 8px; text-align: left; font-weight: 600; white-space: nowrap; border: 1px solid #1565C0; }
    td { padding: 5px 8px; border: 1px solid #ddd; vertical-align: top; }
    tr:nth-child(even) td { background: #F3F6FF; }
    td.center, th.center { text-align: center; }
    .footer { margin-top: 14px; font-size: 14px; color: #888; text-align: right; }
  </style>
  </head><body>
  <div class="report-title">รายชื่อผู้จองและรอคิวห้องพิเศษ</div>
  <div class="report-sub">ชื่อผู้จองและรอคิวทั้งหมด (รอจัดการ)</div>
  <div class="meta-right">พิมพ์เมื่อ: ${printedAt}</div>
  <div class="filter-bar">${filterParts.join(' &nbsp;|&nbsp; ')} &nbsp;|&nbsp; จำนวน: <b>${list.length} รายการ</b></div>
  <table>
    <thead>
      <tr>
        <th class="center" style="width:30px">#</th>
        <th class="center" style="width:65px">HN</th>
        <th style="width:160px">ชื่อ-สกุล</th>
        <th style="width:110px">Ward ปัจจุบัน</th>
        <th class="center" style="width:55px">ห้อง</th>
        <th style="width:110px">ประเภทห้อง</th>
        <th style="width:100px">สิทธิการรักษา</th>
        <th class="center" style="width:90px">วันที่เข้าพัก</th>
        <th>หมายเหตุ</th>
        <th class="center" style="width:110px">สถานะ</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">จำนวนทั้งหมด ${list.length} รายการ</div>
  </body></html>`;

  const w = window.open('', '_blank', 'width=1100,height=750');
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 400);
}

/* ===== EXPORT ALL QUEUE EXCEL ===== */
function exportAllQueueExcel() {
  const list = allQueueFilteredList;
  if (!list || list.length === 0) { toast('ไม่มีข้อมูลสำหรับส่งออก', 'warning'); return; }

  const escXml = s => String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const cell = (v, type = 'String') =>
    `<Cell><Data ss:Type="${type}">${escXml(v)}</Data></Cell>`;

  const fmtDate = v => {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return String(v).slice(0, 10);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  const statusTH = { waiting: 'รอคิว (ยังไม่ได้ห้อง)', reserved: 'ได้ห้องแล้ว รอเข้าพัก' };

  // header row
  const headers = ['#','HN','ชื่อ-สกุล','Ward ปัจจุบัน','ห้อง','ประเภทห้อง','สิทธิการรักษา','วันที่เข้าพัก','หมายเหตุ','สถานะ'];
  const hRow = `<Row>${headers.map(h =>
    `<Cell ss:StyleID="hdr"><Data ss:Type="String">${escXml(h)}</Data></Cell>`
  ).join('')}</Row>`;

  // data rows
  const dataRows = list.map((item, i) => `<Row>
    ${cell(i + 1, 'Number')}
    ${cell(item.hn)}
    ${cell(item.patient_name)}
    ${cell(item.ward)}
    ${cell(item.room_number && item.room_number !== '-' ? item.room_number : '')}
    ${cell(item.type_name)}
    ${cell(item.rights_type)}
    ${cell(fmtDate(item.check_in_date || item.rr_est_adm_date))}
    ${cell(item.notes)}
    ${cell(statusTH[item.status] || item.status)}
  </Row>`).join('');

  // filter info rows (ใส่ด้านบนก่อน header)
  const ward      = document.getElementById('allQueueWardFilter')?.value || '';
  const filterVal = document.querySelector('input[name="allQueueFilter"]:checked')?.value || 'all';
  const dateFrom  = document.getElementById('aqDateFrom')?.value || '';
  const dateTo    = document.getElementById('aqDateTo')?.value || '';
  const statusLabel = { all: 'ทั้งหมด', waiting: 'ยังไม่ได้ห้อง', reserved: 'ได้ห้องแล้ว รอเข้าพัก' };
  const fmtTH = v => v ? fmtDate(v + 'T00:00:00') : '';
  const now = new Date();
  const printedAt = `${fmtDate(now)} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')} น.`;

  const infoRows = [
    `<Row><Cell ss:StyleID="title" ss:MergeAcross="9"><Data ss:Type="String">รายชื่อผู้จองและรอคิวห้องพิเศษ</Data></Cell></Row>`,
    `<Row><Cell ss:MergeAcross="9"><Data ss:Type="String">พิมพ์เมื่อ: ${escXml(printedAt)}</Data></Cell></Row>`,
    `<Row><Cell ss:MergeAcross="9"><Data ss:Type="String">สถานะ: ${escXml(statusLabel[filterVal] || filterVal)}${ward ? '  |  Ward: ' + ward : ''}${dateFrom ? '  |  ตั้งแต่: ' + fmtTH(dateFrom) : ''}${dateTo ? '  ถึง: ' + fmtTH(dateTo) : ''}  |  จำนวน: ${list.length} รายการ</Data></Cell></Row>`,
    `<Row></Row>`
  ].join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:x="urn:schemas-microsoft-com:office:excel">
  <Styles>
    <Style ss:ID="title">
      <Font ss:Bold="1" ss:Size="16" ss:FontName="Angsana New"/>
    </Style>
    <Style ss:ID="hdr">
      <Font ss:Bold="1" ss:Color="#FFFFFF" ss:FontName="Angsana New" ss:Size="14"/>
      <Interior ss:Color="#1565C0" ss:Pattern="Solid"/>
      <Alignment ss:Horizontal="Center"/>
    </Style>
    <Style ss:ID="Default">
      <Font ss:FontName="Angsana New" ss:Size="14"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="ผู้จองและรอคิว">
    <Table ss:DefaultColumnWidth="80">
      <Column ss:Width="30"/>
      <Column ss:Width="70"/>
      <Column ss:Width="160"/>
      <Column ss:Width="110"/>
      <Column ss:Width="55"/>
      <Column ss:Width="120"/>
      <Column ss:Width="110"/>
      <Column ss:Width="90"/>
      <Column ss:Width="160"/>
      <Column ss:Width="130"/>
      ${infoRows}
      ${hRow}
      ${dataRows}
    </Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
      <FreezePanes/>
      <FrozenNoSplit/>
      <SplitHorizontal>5</SplitHorizontal>
      <TopRowBottomPane>5</TopRowBottomPane>
    </WorksheetOptions>
  </Worksheet>
</Workbook>`;

  const blob = new Blob(['﻿' + xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  a.href     = url;
  a.download = `allqueue_${dateStr}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('ส่งออก Excel เรียบร้อย', 'success');
}

/* ===== SPEC ROOMS ALL (HIS beds) ===== */
let specBedStatusFilter = 'all';

async function loadSpecRooms() {
  const container = document.getElementById('specRoomsHisContent');
  if (!container) return;
  if (allHosBeds.length > 0) {
    populateSpecWardDropdown(allHosBeds);
    updateSpecCountBar(allHosBeds);
    filterSpecBeds();
    return;
  }
  container.innerHTML = `<div class="empty-state"><div class="spinner" style="margin:0 auto"></div><p style="margin-top:12px">กำลังโหลด...</p></div>`;
  await loadHosBeds();
}

function populateSpecWardDropdown(beds) {
  const sel = document.getElementById('specWardFilter');
  if (!sel) return;
  const current = sel.value;
  const wards = [...new Set(beds.map(b => b.ward).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">— ทุก Ward —</option>';
  wards.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w; opt.textContent = w;
    sel.appendChild(opt);
  });
  if (wards.includes(current)) sel.value = current;
}

function updateSpecCountBar(beds) {
  const bar = document.getElementById('specCountBar');
  if (!bar) return;
  const ward = document.getElementById('specWardFilter')?.value || '';
  const base = ward ? beds.filter(b => b.ward === ward) : beds;
  const total = base.length;
  const avail = base.filter(b => b.room_status === 'available').length;
  const occup = base.filter(b => b.room_status === 'occupied').length;
  bar.innerHTML = `รวม <b>${total}</b> ห้อง &nbsp;|&nbsp; 🟢 ว่าง <b>${avail}</b> &nbsp; 🔴 มีคนพัก <b>${occup}</b>`;
}

function setSpecFilter(status, el) {
  specBedStatusFilter = status;
  document.querySelectorAll('#panel-specrooms .spec-filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  filterSpecBeds();
}

function filterSpecBeds() {
  const ward = document.getElementById('specWardFilter')?.value || '';
  let filtered = allHosBeds;
  if (ward) filtered = filtered.filter(b => b.ward === ward);
  if (specBedStatusFilter !== 'all') filtered = filtered.filter(b => (b.room_status || 'unknown') === specBedStatusFilter);
  updateSpecCountBar(allHosBeds);
  renderBedsToContainer(filtered, 'specRoomsHisContent');
}

/* ===== HOS BED LAYOUT ===== */
let allHosBeds = [];
let currentBedStatusFilter = '';
let currentDashBedStatusFilter = '';

async function loadHosBeds() {
  const container = document.getElementById('allRoomsContent');
  if (container) container.innerHTML = `<div class="empty-state"><div class="spinner" style="margin:0 auto"></div><p style="margin-top:12px">กำลังโหลด...</p></div>`;
  try {
    const [hosbedRes, occupantsRes] = await Promise.all([
      fetchWithTimeout('/api/rooms/hosbed'),
      fetchWithTimeout('/api/bookings/occupants')
    ]);
    const hosbedData    = await hosbedRes.json();
    const occupantsData = await occupantsRes.json();

    if (!hosbedData.success) {
      container.innerHTML = `<div class="alert alert-error" style="margin:20px">❌ ${hosbedData.message}</div>`;
      return;
    }

    // Build bedno → occupant map from HIS (prefer rows with patient data)
    const occMap = new Map();
    if (occupantsData.success) {
      for (const o of (occupantsData.occupants || [])) {
        const key = String(o.bedno).trim();
        const existing = occMap.get(key);
        const name = (o.ptname || '').trim();
        // keep this row if no entry yet, or if current entry has no name but this one does
        if (!existing || (!(existing.ptname || '').trim() && name)) {
          occMap.set(key, { ...o, ptname: name || null });
        }
      }
    }

    // Merge occupant data into each bed
    allHosBeds = (hosbedData.beds || []).map(bed => {
      const occ = occMap.get(String(bed.bedno).trim());
      if (occ) {
        return {
          ...bed,
          patient_name: occ.ptname || null,
          an:           occ.an   || null,
          doctor_name:  occ.doctor || null,
          regdate:      occ.regdate || null,
        };
      }
      return bed;
    });

    populateWardDropdown(allHosBeds);
    populateDashWardDropdown(allHosBeds);
    populateWardFilterSelect();
    renderBedsToContainer(allHosBeds, 'allRoomsContent');
    renderBedsToContainer(allHosBeds, 'dashAllRoomsContent');
    updateStatsByBeds(allHosBeds, document.getElementById('dashBedWardFilter')?.value || '');
    // อัพเดท specrooms ถ้าแท็บเปิดอยู่
    if (document.getElementById('panel-specrooms')?.classList.contains('active')) {
      populateSpecWardDropdown(allHosBeds);
      updateSpecCountBar(allHosBeds);
      filterSpecBeds();
    }
  } catch (e) {
    const errHtml = `<div class="alert alert-error" style="margin:20px">❌ ไม่สามารถโหลดข้อมูลได้</div>`;
    if (container) container.innerHTML = errHtml;
    const dc = document.getElementById('dashAllRoomsContent');
    if (dc) dc.innerHTML = errHtml;
    const sc = document.getElementById('specRoomsHisContent');
    if (sc) sc.innerHTML = errHtml;
  }
}

function setBedStatusFilter(status, el) {
  currentBedStatusFilter = status;
  document.querySelectorAll('#panel-allrooms .bed-filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  filterHosBeds();
}

function setDashBedStatusFilter(status, el) {
  currentDashBedStatusFilter = status;
  document.querySelectorAll('#panel-dashboard .dash-bed-filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  filterDashHosBeds();
}

function populateWardDropdown(beds) {
  const sel = document.getElementById('hosBedWardFilter');
  if (!sel) return;
  const current = sel.value;
  const wards = [...new Set(beds.map(b => b.ward).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">— ทุก Ward —</option>';
  wards.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w; opt.textContent = w;
    sel.appendChild(opt);
  });
  if (wards.includes(current)) sel.value = current;
}

const DASH_WARD_STORAGE_KEY = 'dashWardFilter';
let dashWardRestored = false;

function populateDashWardDropdown(beds) {
  const sel = document.getElementById('dashBedWardFilter');
  if (!sel) return;
  const current = sel.value;
  const wards = [...new Set(beds.map(b => b.ward).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">— ทุก Ward —</option>';
  wards.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w; opt.textContent = w;
    sel.appendChild(opt);
  });
  if (wards.includes(current)) {
    sel.value = current;
  } else if (!dashWardRestored) {
    const saved = localStorage.getItem(DASH_WARD_STORAGE_KEY) || '';
    if (saved && wards.includes(saved)) sel.value = saved;
  }
  if (!dashWardRestored) {
    dashWardRestored = true;
    filterDashHosBeds();
  }
}

function rememberDashWard() {
  const sel = document.getElementById('dashBedWardFilter');
  const ward = sel?.value || '';
  localStorage.setItem(DASH_WARD_STORAGE_KEY, ward);
  toast(ward ? `📌 จำค่า Ward "${ward}" แล้ว` : '📌 จำค่า "ทุก Ward" แล้ว', 'success');
}

function filterHosBeds() {
  const ward = document.getElementById('hosBedWardFilter')?.value || '';
  let filtered = allHosBeds;
  if (ward) filtered = filtered.filter(b => b.ward === ward);
  if (currentBedStatusFilter) filtered = filtered.filter(b => (b.room_status || 'unknown') === currentBedStatusFilter);
  renderBedsToContainer(filtered, 'allRoomsContent');
}

function filterDashHosBeds() {
  const ward = document.getElementById('dashBedWardFilter')?.value || '';
  let filtered = allHosBeds;
  if (ward) filtered = filtered.filter(b => b.ward === ward);
  if (currentDashBedStatusFilter) filtered = filtered.filter(b => (b.room_status || 'unknown') === currentDashBedStatusFilter);
  renderBedsToContainer(filtered, 'dashAllRoomsContent');
  updateStatsByBeds(allHosBeds, ward);
}

function updateStatsByBeds(beds, ward) {
  const base = ward ? beds.filter(b => b.ward === ward) : beds;
  const total    = base.length;
  const available= base.filter(b => !b.room_status || b.room_status === 'available').length;
  const occupied = base.filter(b => b.room_status === 'occupied').length;
  const reserved = base.filter(b => b.room_status === 'reserved').length;
  const rate     = total > 0 ? (occupied / total * 100).toFixed(1) : 0;
  const setText  = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('countTotal', total);
  setText('countAvailable', available);
  setText('countOccupied', occupied);
  setText('countReserved', reserved);
  setText('countOccupancyRate', rate + '%');
  // คิวรอ: กรองตาม ward ถ้าเลือก
  const waiting = waitlistItems.filter(w => w.status === 'waiting' && (!ward || w.ward === ward)).length;
  setText('countWaiting', waiting);
}

/* ===== WARD PATIENTS (คนไข้ที่นอนใน ward ทั้งหมด) ===== */
let allWardPatients = [];

async function loadWardPatients() {
  const container = document.getElementById('wardPatientsContent');
  if (container) container.innerHTML = `<div class="empty-state"><div class="spinner" style="margin:0 auto"></div><p style="margin-top:12px">กำลังโหลด...</p></div>`;
  try {
    const res = await fetchWithTimeout('/api/bookings/ward-patients');
    const data = await res.json();
    if (!data.success) {
      if (container) container.innerHTML = `<div class="alert alert-error" style="margin:20px">❌ ${data.message}</div>`;
      return;
    }
    allWardPatients = data.patients || [];
    populateWardPatientsWardDropdown(allWardPatients);
    filterWardPatients();
  } catch (e) {
    if (container) container.innerHTML = `<div class="alert alert-error" style="margin:20px">❌ ไม่สามารถโหลดข้อมูลได้</div>`;
  }
}

const WARD_PATIENTS_STORAGE_KEY = 'wardPatientsWardFilter';
let wardPatientsWardRestored = false;

function populateWardPatientsWardDropdown(patients) {
  const sel = document.getElementById('wardPatientsWardFilter');
  if (!sel) return;
  const current = sel.value;
  const wards = [...new Set(patients.map(p => p.ward).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">— ทุก Ward —</option>';
  wards.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w; opt.textContent = w;
    sel.appendChild(opt);
  });
  if (wards.includes(current)) {
    sel.value = current;
  } else if (!wardPatientsWardRestored) {
    const saved = localStorage.getItem(WARD_PATIENTS_STORAGE_KEY) || '';
    if (saved && wards.includes(saved)) sel.value = saved;
  }
  wardPatientsWardRestored = true;
}

function rememberWardPatientsWard() {
  const sel = document.getElementById('wardPatientsWardFilter');
  const ward = sel?.value || '';
  localStorage.setItem(WARD_PATIENTS_STORAGE_KEY, ward);
  toast(ward ? `📌 จำค่า Ward "${ward}" แล้ว` : '📌 จำค่า "ทุก Ward" แล้ว', 'success');
}

function filterWardPatients() {
  const ward = document.getElementById('wardPatientsWardFilter')?.value || '';
  const hnQ  = document.getElementById('wardPatientsHnFilter')?.value.trim().toLowerCase() || '';
  const anQ  = document.getElementById('wardPatientsAnFilter')?.value.trim().toLowerCase() || '';
  let filtered = allWardPatients;
  if (ward) filtered = filtered.filter(p => p.ward === ward);
  if (hnQ)  filtered = filtered.filter(p => (p.hn || '').toLowerCase().includes(hnQ));
  if (anQ)  filtered = filtered.filter(p => (p.an || '').toLowerCase().includes(anQ));
  filtered = [...filtered].sort((a, b) => String(a.bedno || '').localeCompare(String(b.bedno || ''), 'th', { numeric: true }));
  renderWardPatients(filtered);
}

function renderWardPatients(patients) {
  const container = document.getElementById('wardPatientsContent');
  const countBar   = document.getElementById('wardPatientsCountBar');
  if (!container) return;
  if (countBar) countBar.textContent = `พบทั้งหมด ${patients.length} ราย`;
  if (!patients || patients.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🧑‍⚕️</div><p>ไม่พบข้อมูลคนไข้</p></div>`;
    return;
  }
  const th = s => `<th style="padding:10px 12px;text-align:left;border-bottom:1px solid #E0E0E0;white-space:nowrap">${s}</th>`;
  const fmtDate = v => v ? new Date(v).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'numeric' }) : '-';
  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead>
        <tr style="background:#F5F7FA;color:#546E7A;font-size:12px;font-weight:700">
          ${th('#')}${th('Ward')}${th('เตียง')}${th('AN')}${th('HN')}${th('ชื่อ-สกุล')}${th('แพทย์เจ้าของไข้')}${th('วัน Admit')}<th style="padding:10px 12px;text-align:center;border-bottom:1px solid #E0E0E0">สถานะ</th>
        </tr>
      </thead>
      <tbody>
        ${patients.map((p, i) => `
          <tr style="background:${i % 2 === 0 ? '#fff' : '#FAFAFA'};border-bottom:1px solid #F0F0F0;cursor:pointer"
              title="คลิกเพื่อไปที่ฟอร์มจองห้องพิเศษ"
              onclick="openWardPatientBooking('${escAttr(p.hn || '')}','${escAttr(p.an || '')}')">
            <td style="padding:10px 12px;color:#90A4AE;font-size:12px">${i + 1}</td>
            <td style="padding:10px 12px">${escHtml(p.ward || '-')}</td>
            <td style="padding:10px 12px">${escHtml(p.bedno || '-')}</td>
            <td style="padding:10px 12px">${escHtml(p.an || '-')}</td>
            <td style="padding:10px 12px;font-weight:600;color:var(--primary)">${escHtml(p.hn || '-')}</td>
            <td style="padding:10px 12px">${escHtml((p.ptname || '').trim() || '-')}</td>
            <td style="padding:10px 12px">${escHtml(p.doctor || '-')}</td>
            <td style="padding:10px 12px;font-size:12px;white-space:nowrap">${fmtDate(p.regdate)}</td>
            <td style="padding:10px 12px;text-align:center">${p.waiting_special_room ? '<span class="status-chip chip-waiting">⏳ รอห้องพิเศษ</span>' : '-'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function openWardPatientBooking(hn, an) {
  switchTab('booking');
  clearBookingForm();
  if (hn) {
    document.getElementById('bnHn').value = hn;
    await searchPatient();
  }
  if (an) {
    document.getElementById('bnAn').value = an;
    await fillWardByAN(an);
  }
}

/* ===== จัดการห้องพิเศษ (สถานะเตียง: เตียงใช้งาน/ปิดเตียง/ซ่อมแซม) ===== */
let allManageRooms = [];
let currentManageRoomsStatusFilter = '';
const MANAGE_ROOMS_STORAGE_KEY = 'manageRoomsWardFilter';
let manageRoomsWardRestored = false;

async function loadManageRooms() {
  const container = document.getElementById('manageRoomsContent');
  if (container) container.innerHTML = `<div class="empty-state"><div class="spinner" style="margin:0 auto"></div><p style="margin-top:12px">กำลังโหลด...</p></div>`;
  try {
    const res = await fetchWithTimeout('/api/rooms/manage-special-rooms');
    const data = await res.json();
    if (!data.success) {
      if (container) container.innerHTML = `<div class="alert alert-error" style="margin:20px">❌ ${data.message}</div>`;
      return;
    }
    allManageRooms = data.beds || [];
    populateManageRoomsWardDropdown(allManageRooms);
    filterManageRooms();
  } catch (e) {
    if (container) container.innerHTML = `<div class="alert alert-error" style="margin:20px">❌ ไม่สามารถโหลดข้อมูลได้</div>`;
  }
}

function populateManageRoomsWardDropdown(beds) {
  const sel = document.getElementById('manageRoomsWardFilter');
  if (!sel) return;
  const current = sel.value;
  const wards = [...new Set(beds.map(b => b.ward).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">— ทุก Ward —</option>';
  wards.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w; opt.textContent = w;
    sel.appendChild(opt);
  });
  if (wards.includes(current)) {
    sel.value = current;
  } else if (!manageRoomsWardRestored) {
    const saved = localStorage.getItem(MANAGE_ROOMS_STORAGE_KEY) || '';
    if (saved && wards.includes(saved)) sel.value = saved;
  }
  manageRoomsWardRestored = true;
}

function rememberManageRoomsWard() {
  const sel = document.getElementById('manageRoomsWardFilter');
  const ward = sel?.value || '';
  localStorage.setItem(MANAGE_ROOMS_STORAGE_KEY, ward);
  toast(ward ? `📌 จำค่า Ward "${ward}" แล้ว` : '📌 จำค่า "ทุก Ward" แล้ว', 'success');
}

function setManageRoomsStatusFilter(status, el) {
  currentManageRoomsStatusFilter = status;
  document.querySelectorAll('#panel-managerooms .manage-rooms-filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  filterManageRooms();
}

function filterManageRooms() {
  const ward = document.getElementById('manageRoomsWardFilter')?.value || '';
  let filtered = allManageRooms;
  if (ward) filtered = filtered.filter(b => b.ward === ward);
  if (currentManageRoomsStatusFilter) filtered = filtered.filter(b => b.status_key === currentManageRoomsStatusFilter);
  renderManageRooms(filtered);
}

function renderManageRooms(beds) {
  const container = document.getElementById('manageRoomsContent');
  const countBar   = document.getElementById('manageRoomsCountBar');
  if (!container) return;
  if (countBar) countBar.textContent = `พบทั้งหมด ${beds.length} เตียง`;
  if (!beds || beds.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🛏️</div><p>ไม่พบข้อมูลเตียง</p></div>`;
    return;
  }
  // ใช้ status_key (คำนวณจาก bed_status_type_id ฝั่ง backend) แทนการเทียบชื่อสถานะตรง ๆ
  // เพราะชื่อสถานะใน HIS (bed_status_type.bed_status_type_name) อาจถูกแก้ไข/เปลี่ยนชื่อได้จากฝั่งโรงพยาบาล
  const statusChip = {
    available: '<span class="status-chip chip-available">🟢 ว่าง</span>',
    occupied:  '<span class="status-chip chip-occupied">🔴 มีผู้ป่วยใช้ห้อง</span>',
    repair:    '<span class="status-chip chip-reserved">🟠 ซ่อมแซม</span>',
    isolation: '<span class="status-chip chip-cancelled">🟣 แยกโรค</span>',
    relative:  '<span class="status-chip chip-waiting">🔵 ญาติใช้ห้อง</span>'
  };
  const th = s => `<th style="padding:10px 12px;text-align:left;border-bottom:1px solid #E0E0E0;white-space:nowrap">${s}</th>`;
  const fmtDate = v => v ? new Date(v).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'numeric' }) : '?';
  const dateRangeCell = b => {
    if (b.status_key === 'repair' && (b.repair_start_date || b.repair_end_date)) {
      return `<div style="font-size:12px">🟠 เริ่มซ่อม: ${fmtDate(b.repair_start_date)}<br>ซ่อมเสร็จ: ${fmtDate(b.repair_end_date)}</div>`;
    }
    if (b.status_key === 'isolation' && (b.isolation_start_date || b.isolation_end_date)) {
      return `<div style="font-size:12px">🟣 เริ่มแยกโรค: ${fmtDate(b.isolation_start_date)}<br>สิ้นสุด: ${fmtDate(b.isolation_end_date)}</div>`;
    }
    return '-';
  };
  const sorted = [...beds].sort((a, b) =>
    String(a.ward || '').localeCompare(String(b.ward || ''), 'th') ||
    String(a.bedno || '').localeCompare(String(b.bedno || ''), 'th', { numeric: true })
  );
  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead>
        <tr style="background:#F5F7FA;color:#546E7A;font-size:12px;font-weight:700">
          ${th('#')}${th('Ward')}${th('ประเภทห้อง')}${th('เตียง')}${th('ราคาห้องพิเศษ')}<th style="padding:10px 12px;text-align:center;border-bottom:1px solid #E0E0E0">สถานะเตียง</th>${th('วันที่')}
        </tr>
      </thead>
      <tbody>
        ${sorted.map((b, i) => `
          <tr style="background:${i % 2 === 0 ? '#fff' : '#FAFAFA'};border-bottom:1px solid #F0F0F0;cursor:pointer"
              title="คลิกเพื่อจัดการเตียงนี้"
              onclick="openEditBedModal('${escAttr(b.bedno || '')}')">
            <td style="padding:10px 12px;color:#90A4AE;font-size:12px">${i + 1}</td>
            <td style="padding:10px 12px">${escHtml(b.ward || '-')}</td>
            <td style="padding:10px 12px">${escHtml(b.roomtype || '-')}</td>
            <td style="padding:10px 12px;font-weight:600;color:var(--primary)">${escHtml(b.bedno || '-')}</td>
            <td style="padding:10px 12px">${b.price != null ? (+b.price).toLocaleString('th-TH') + ' บาท' : '-'}</td>
            <td style="padding:10px 12px;text-align:center">${statusChip[b.status_key] || escHtml(b.bed_status_type_name || '-')}</td>
            <td style="padding:10px 12px">${dateRangeCell(b)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ===== EDIT BED MODAL (จัดการเตียง) ===== */
async function openEditBedModal(bedno) {
  if (!bedno) return;
  document.getElementById('editBedNoLabel').textContent = bedno;
  document.getElementById('ebBedno').value = bedno;
  showLoading(true);
  try {
    const [bedRes, statusRes, bedtypeRes, roomnoRes] = await Promise.all([
      fetchWithTimeout(`/api/rooms/bed-detail/${encodeURIComponent(bedno)}`),
      fetchWithTimeout('/api/rooms/bed-status-types'),
      fetchWithTimeout('/api/rooms/bedtypes'),
      fetchWithTimeout('/api/rooms/roomno-options')
    ]);
    const bedData      = await bedRes.json();
    const statusData   = await statusRes.json();
    const bedtypeData  = await bedtypeRes.json();
    const roomnoData   = await roomnoRes.json();

    if (!bedData.success) { toast(bedData.message || 'ไม่พบข้อมูลเตียงนี้', 'error'); return; }
    const bed = bedData.bed;

    // เติมตัวเลือก select
    const statusSel = document.getElementById('ebBedStatusTypeId');
    statusSel.innerHTML = '<option value="">-- เลือกสถานะ --</option>';
    (statusData.types || []).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.bed_status_type_id; opt.textContent = t.bed_status_type_name;
      statusSel.appendChild(opt);
    });

    const bedtypeSel = document.getElementById('ebBedtype');
    bedtypeSel.innerHTML = '<option value="">-- เลือกประเภทเตียง --</option>';
    (bedtypeData.types || []).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.bedtype; opt.textContent = `${t.bedtype} - ${t.name}`;
      bedtypeSel.appendChild(opt);
    });

    const roomnoSel = document.getElementById('ebRoomno');
    roomnoSel.innerHTML = '<option value="">-- เลือกห้อง --</option>';
    (roomnoData.rooms || []).forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.roomno; opt.textContent = `${r.name || r.roomno} (${r.ward_name || '-'})`;
      roomnoSel.appendChild(opt);
    });

    // เติมค่าปัจจุบันของเตียง
    statusSel.value  = bed.bed_status_type_id != null ? String(bed.bed_status_type_id) : '';
    bedtypeSel.value = bed.bedtype || '';
    roomnoSel.value  = bed.roomno || '';
    document.getElementById('ebBedOrder').value         = bed.bed_order ?? '';
    document.getElementById('ebSpecialRoomPrice').value = bed.special_room_price != null
      ? (+bed.special_room_price).toLocaleString('th-TH') + ' บาท' : 'ไม่พบราคา (ไม่มี icode ตรงกับ nondrugitems)';
    document.getElementById('ebRepairStartDate').value = toDateInputValue(bed.repair_start_date);
    document.getElementById('ebRepairEndDate').value   = toDateInputValue(bed.repair_end_date);
    document.getElementById('ebIsolationStartDate').value = toDateInputValue(bed.isolation_start_date);
    document.getElementById('ebIsolationEndDate').value   = toDateInputValue(bed.isolation_end_date);
    toggleEbStatusDates();

    document.getElementById('editBedModal').classList.add('show');
  } catch (e) {
    toast('โหลดข้อมูลเตียงไม่สำเร็จ', 'error');
  } finally {
    showLoading(false);
  }
}

function toDateInputValue(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// แสดงช่องวันที่ที่เกี่ยวข้องตามสถานะเตียงที่เลือก
// "ซ่อมแซม" -> วันที่เริ่มซ่อม/วันที่ซ่อมเสร็จ, "แยกโรค" -> วันที่เริ่ม/สิ้นสุดใช้เป็นห้องแยกโรค
function toggleEbStatusDates() {
  const sel = document.getElementById('ebBedStatusTypeId');
  const repairRow    = document.getElementById('ebRepairDatesRow');
  const isolationRow = document.getElementById('ebIsolationDatesRow');
  if (!sel) return;
  const selectedText = (sel.options[sel.selectedIndex]?.textContent || '').trim();
  if (repairRow)    repairRow.style.display    = selectedText === 'ซ่อมแซม' ? 'grid' : 'none';
  if (isolationRow) isolationRow.style.display = selectedText === 'แยกโรค'  ? 'grid' : 'none';
}

async function saveEditBed() {
  const bedno = document.getElementById('ebBedno').value;
  if (!bedno) return;
  const payload = {
    roomno:             document.getElementById('ebRoomno').value || null,
    bedtype:            document.getElementById('ebBedtype').value || null,
    bed_status_type_id: document.getElementById('ebBedStatusTypeId').value || null,
    bed_order:          document.getElementById('ebBedOrder').value || null,
    repair_start_date:  document.getElementById('ebRepairStartDate').value || null,
    repair_end_date:    document.getElementById('ebRepairEndDate').value || null,
    isolation_start_date: document.getElementById('ebIsolationStartDate').value || null,
    isolation_end_date:   document.getElementById('ebIsolationEndDate').value || null
  };
  try {
    const res = await fetchWithTimeout(`/api/rooms/bed-detail/${encodeURIComponent(bedno)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    toast('บันทึกข้อมูลเตียงเรียบร้อย', 'success');
    closeModal('editBedModal');
    loadManageRooms();
  } catch (e) {
    toast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  }
}

/* ===== ประวัติซ่อมแซม/แยกโรค ===== */
function openBedHistoryModal(bedno) {
  const filterEl = document.getElementById('bedHistoryBednoFilter');
  if (filterEl) filterEl.value = bedno || '';
  document.getElementById('bedHistoryModal').classList.add('show');
  loadBedHistory();
}

function formatDuration(startStr, endStr) {
  const start = new Date(startStr);
  if (isNaN(start)) return '-';
  const end = endStr ? new Date(endStr) : new Date();
  if (isNaN(end)) return '-';
  let ms = end - start;
  if (ms < 0) ms = 0;
  const totalHours = Math.floor(ms / (1000 * 60 * 60));
  const days  = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const parts = [];
  if (days > 0)  parts.push(`${days} วัน`);
  parts.push(`${hours} ชั่วโมง`);
  return parts.join(' ') + (endStr ? '' : ' (ยังดำเนินอยู่)');
}

async function loadBedHistory() {
  const content = document.getElementById('bedHistoryContent');
  if (!content) return;
  content.innerHTML = `<div class="empty-state"><div class="spinner" style="margin:0 auto"></div><p style="margin-top:12px">กำลังโหลด...</p></div>`;
  try {
    const bedno = (document.getElementById('bedHistoryBednoFilter')?.value || '').trim();
    const url = bedno ? `/api/rooms/bed-status-history?bedno=${encodeURIComponent(bedno)}` : '/api/rooms/bed-status-history';
    const res  = await fetchWithTimeout(url);
    const data = await res.json();
    if (!data.success) { content.innerHTML = `<div class="alert alert-error">❌ ${data.message}</div>`; return; }
    const list = data.history || [];
    if (list.length === 0) {
      content.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>ไม่พบประวัติ</p></div>`;
      return;
    }
    const fmtDT = v => v ? new Date(v).toLocaleString('th-TH', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '-';
    const th = s => `<th style="padding:8px 10px;text-align:left;border-bottom:1px solid #E0E0E0;white-space:nowrap">${s}</th>`;
    content.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#F5F7FA;color:#546E7A;font-size:12px;font-weight:700">
            ${th('เตียง')}${th('ห้อง / Ward')}${th('สถานะ')}${th('วันที่-เวลาเริ่ม')}${th('วันที่-เวลาเสร็จ')}${th('ระยะเวลา')}
          </tr>
        </thead>
        <tbody>
          ${list.map((h, i) => {
            const chipClass = h.status_type_id === 4 ? 'chip-waiting' : 'chip-cancelled';
            const icon = h.status_type_id === 4 ? '🟠' : '🟣';
            return `<tr style="background:${i%2===0?'#fff':'#FAFAFA'};border-bottom:1px solid #F0F0F0">
              <td style="padding:8px 10px;font-weight:700;color:var(--primary)">${escHtml(h.bedno||'-')}</td>
              <td style="padding:8px 10px">${escHtml(h.room_name||'-')} ${h.ward_name ? '/ ' + escHtml(h.ward_name) : ''}</td>
              <td style="padding:8px 10px"><span class="status-chip ${chipClass}">${icon} ${escHtml(h.status_name||'-')}</span></td>
              <td style="padding:8px 10px;white-space:nowrap">${fmtDT(h.start_date)}</td>
              <td style="padding:8px 10px;white-space:nowrap">${h.end_date ? fmtDT(h.end_date) : '<span style="color:#F57F17;font-weight:600">ยังไม่เสร็จ</span>'}</td>
              <td style="padding:8px 10px;white-space:nowrap;font-weight:600">${formatDuration(h.start_date, h.end_date)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    content.innerHTML = `<div class="alert alert-error">❌ ไม่สามารถโหลดข้อมูลได้</div>`;
  }
}

/* ===== รายงานสรุปการใช้ห้อง (สรุปรายงานการใช้ห้อง) ===== */
let currentReportKey = null;
let reportWardsLoaded = false;

async function loadReportWards() {
  if (reportWardsLoaded) return;
  const sel = document.getElementById('reportWardFilter');
  if (!sel) return;
  try {
    const res  = await fetchWithTimeout('/api/bookings/his-wards');
    const data = await res.json();
    if (!data.success) return;
    (data.wards || []).filter(w => w.ward && w.name).forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.ward; opt.textContent = w.name;
      sel.appendChild(opt);
    });
    reportWardsLoaded = true;
  } catch (e) {}
}

// รายได้ทุกรายงานคำนวณแบบประมาณการ = ราคาห้อง (room_types.price_per_day ตอนจอง) x จำนวนคืนที่พักจริง
// (ระบบนี้เป็นระบบจอง/คิว ไม่มีตารางใบเสร็จ/การเงินจริงจาก HIS จึงต้องอิงข้อมูลการจองที่มีอยู่)
const REPORTS_CONFIG = {
  'repair-duration': {
    icon: '🔧', title: 'สรุประยะเวลาการส่งซ่อม',
    desc: 'ระยะเวลาที่แต่ละเตียงถูกส่งซ่อม (จากประวัติที่บันทึกในหน้าจัดการเตียง)',
    endpoint: '/api/reports/repair-duration', render: renderDurationReport
  },
  'isolation-duration': {
    icon: '🦠', title: 'สรุประยะเวลาการใช้ห้องพิเศษเป็นห้องแยกโรค',
    desc: 'ระยะเวลาที่แต่ละเตียงถูกใช้เป็นห้องแยกโรค (จากประวัติที่บันทึกในหน้าจัดการเตียง)',
    endpoint: '/api/reports/isolation-duration', render: renderDurationReport
  },
  'monthly-revenue': {
    icon: '📅', title: 'สรุปรายได้ต่อเดือนของการใช้ห้องพิเศษ(ราคาเต็ม)',
    desc: 'รายได้ประมาณการ (ราคาห้อง x คืนที่พักจริง) แยกตามเดือน',
    endpoint: '/api/reports/monthly-revenue', render: renderMonthlyRevenueReport
  },
  'rooms-revenue': {
    icon: '🏠', title: 'สรุปจำนวนห้องที่ใช้ และรายได้รวมต่อห้อง',
    desc: 'จำนวนครั้งที่ใช้ จำนวนวันนอนทั้งหมด และรายได้รวมของแต่ละห้อง (จากประวัติการย้ายเตียงจริง)',
    endpoint: '/api/reports/rooms-revenue',
    render: renderRoomsRevenueReport
  },
  'total-revenue': {
    icon: '💰', title: 'สรุปรายได้จริงของห้องพิเศษ(ชำระเงิน)',
    desc: 'รายได้ที่เก็บได้จริง (ชำระเงินแล้ว) จากรายการเรียกเก็บจริงของ HIS แยกตามเตียง',
    endpoint: '/api/reports/total-revenue', render: renderTotalRevenueReport,
    note: 'นับเฉพาะรายการที่ paidst = "ชำระเองเบิกได้" หรือ "ชำระเองเบิกไม่ได้" (จ่ายเงินจริงแล้ว) ไม่รวมค้างชำระ/ลูกหนี้สิทธิ/ส่วนลด'
  },
  'waiting-duration': {
    icon: '⏳', title: 'สรุประยะเวลารอคอยการจองห้องพิเศษ',
    desc: 'นับราย AN ตั้งแต่เข้าคิวจอง จนได้เข้าห้องพิเศษจริง',
    endpoint: '/api/reports/waiting-duration', render: renderWaitingDurationReport,
    note: 'นับได้เฉพาะรายการที่มี AN กรอกไว้ในคิวรอ และ AN นั้นเคยถูกย้ายเข้าห้องพิเศษจริงแล้ว (จากประวัติการย้ายเตียง)'
  },
  'rights-summary': {
    icon: '🪪', title: 'สรุปจำนวนจ่ายห้องของแต่ละกลุ่มสิทธิ',
    desc: 'สิทธิไหนใช้ห้องพิเศษไปเท่าไหร่ และราคาที่จ่ายจริงตามสิทธินั้น',
    endpoint: '/api/reports/rights-summary', render: renderRightsSummaryReport
  },
  'holiday-weekday-revenue': {
    icon: '🗓️', title: 'สรุปรายได้วันหยุด/วันธรรมดา',
    desc: 'สรุปรายได้แยกตามวันทั้ง 7 วัน พร้อมราคาเบิกได้ตามสิทธิ และราคาที่ต้องชำระ',
    endpoint: '/api/reports/holiday-weekday-revenue', render: renderHolidayWeekdayReport
  },
  'shift-revenue': {
    icon: '🕐', title: 'สรุปรายได้ตามเวร เช้า บ่าย ดึก',
    desc: 'แยกตามเวร พร้อมราคาเบิกได้ตามสิทธิ และราคาที่ต้องชำระ',
    endpoint: '/api/reports/shift-revenue', render: renderShiftRevenueReport,
    note: 'แบ่งเวรจากเวลาที่เรียกเก็บจริง: เช้า 08:00-15:59, บ่าย 16:00-23:59, ดึก 00:00-07:59'
  }
};

function renderReportCards() {
  const grid = document.getElementById('reportCardsGrid');
  if (!grid) return;
  grid.innerHTML = Object.entries(REPORTS_CONFIG).map(([key, r]) => `
    <div class="report-card" onclick="openReport('${key}')">
      <div class="report-card-icon">${r.icon}</div>
      <div class="report-card-title">${r.title}</div>
      <div class="report-card-desc">${r.desc}</div>
    </div>
  `).join('');
}

function showReportsHub() {
  document.getElementById('reportsHub').style.display = '';
  document.getElementById('reportsDetail').style.display = 'none';
  currentReportKey = null;
}

async function openReport(key) {
  const cfg = REPORTS_CONFIG[key];
  if (!cfg) return;
  currentReportKey = key;
  document.getElementById('reportsHub').style.display = 'none';
  document.getElementById('reportsDetail').style.display = '';
  document.getElementById('reportDetailTitle').textContent = `${cfg.icon} ${cfg.title}`;
  const noteEl = document.getElementById('reportDetailNote');
  if (cfg.note) { noteEl.textContent = 'ℹ️ ' + cfg.note; noteEl.style.display = ''; }
  else { noteEl.style.display = 'none'; }
  document.getElementById('reportWardFilter').value = '';
  const today = todayDateInputValue();
  document.getElementById('reportFromDate').value = today;
  document.getElementById('reportToDate').value = today;
  await loadReportWards();
  loadCurrentReport();
}

function todayDateInputValue() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function loadCurrentReport() {
  const cfg = REPORTS_CONFIG[currentReportKey];
  const content = document.getElementById('reportDetailContent');
  if (!cfg || !content) return;
  content.innerHTML = `<div class="empty-state"><div class="spinner" style="margin:0 auto"></div><p style="margin-top:12px">กำลังโหลด...</p></div>`;
  try {
    const ward = document.getElementById('reportWardFilter').value;
    const from = document.getElementById('reportFromDate').value;
    const to   = document.getElementById('reportToDate').value;
    const params = new URLSearchParams();
    if (ward) params.set('ward', ward);
    if (from) params.set('from', from);
    if (to)   params.set('to', to);
    const qs = params.toString();
    const res  = await fetchWithTimeout(cfg.endpoint + (qs ? '?' + qs : ''));
    const data = await res.json();
    if (!data.success) { content.innerHTML = `<div class="alert alert-error">❌ ${data.message}</div>`; return; }
    content.innerHTML = cfg.render(data);
  } catch (e) {
    content.innerHTML = `<div class="alert alert-error">❌ ไม่สามารถโหลดข้อมูลได้</div>`;
  }
}

function fmtBaht(v) {
  return (+v || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' บาท';
}

const reportTh = s => `<th style="padding:10px 12px;text-align:left;border-bottom:1px solid #E0E0E0;white-space:nowrap">${s}</th>`;

// รายงานเชิงรายการ + ระยะเวลา (ใช้กับ repair-duration / isolation-duration)
function renderDurationReport(data) {
  const rows = data.rows || [];
  if (rows.length === 0) return `<div class="empty-state"><div class="empty-icon">📋</div><p>ไม่พบข้อมูลในช่วงที่เลือก</p></div>`;
  const fmtDT = v => v ? new Date(v).toLocaleString('th-TH', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '-';
  let totalMs = 0;
  const bodyRows = rows.map((h, i) => {
    const start = new Date(h.start_date);
    const end = h.end_date ? new Date(h.end_date) : new Date();
    if (!isNaN(start) && !isNaN(end)) totalMs += Math.max(0, end - start);
    return `<tr style="background:${i%2===0?'#fff':'#FAFAFA'};border-bottom:1px solid #F0F0F0">
      <td style="padding:8px 10px;font-weight:700;color:var(--primary)">${escHtml(h.bedno||'-')}</td>
      <td style="padding:8px 10px">${escHtml(h.room_name||'-')} ${h.ward_name ? '/ ' + escHtml(h.ward_name) : ''}</td>
      <td style="padding:8px 10px;white-space:nowrap">${fmtDT(h.start_date)}</td>
      <td style="padding:8px 10px;white-space:nowrap">${h.end_date ? fmtDT(h.end_date) : '<span style="color:#F57F17;font-weight:600">ยังไม่เสร็จ</span>'}</td>
      <td style="padding:8px 10px;white-space:nowrap;font-weight:600">${formatDuration(h.start_date, h.end_date)}</td>
    </tr>`;
  }).join('');
  const totalHours = Math.floor(totalMs / (1000*60*60));
  const totalDays  = Math.floor(totalHours / 24);
  return `
    <div style="margin-bottom:14px;font-size:13px;color:#546E7A">พบ <b>${rows.length}</b> ครั้ง รวมระยะเวลาทั้งหมด <b>${totalDays} วัน ${totalHours % 24} ชั่วโมง</b></div>
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#F5F7FA;color:#546E7A;font-size:12px;font-weight:700">
        ${reportTh('เตียง')}${reportTh('ห้อง / Ward')}${reportTh('วันที่-เวลาเริ่ม')}${reportTh('วันที่-เวลาเสร็จ')}${reportTh('ระยะเวลา')}
      </tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
    </div>`;
}

// รายงานเชิงกลุ่ม + จำนวนครั้ง/คืน/รายได้ (ใช้กับ monthly-revenue, rooms-revenue, rights-summary, holiday-weekday-revenue, shift-revenue)
// opts เอาไว้ override ข้อความหัวคอลัมน์ nights/revenue เฉพาะรายงานที่ต้องการ (ไม่กระทบรายงานอื่นที่ใช้ default)
function renderGroupRevenueReport(groupKey, groupLabel, opts = {}) {
  const nightsLabel  = opts.nightsLabel  || 'คืนรวม';
  const revenueLabel = opts.revenueLabel || 'รายได้ประมาณการ';
  return function(data) {
    const rows = data.rows || [];
    if (rows.length === 0) return `<div class="empty-state"><div class="empty-icon">📋</div><p>ไม่พบข้อมูลในช่วงที่เลือก (อาจยังไม่มีการบันทึกเช็คอิน/เช็คเอาท์จริงในระบบ)</p></div>`;
    let totalNights = 0, totalRevenue = 0;
    const bodyRows = rows.map((r, i) => {
      totalNights += (+r.nights || 0);
      totalRevenue += (+r.revenue || 0);
      return `<tr style="background:${i%2===0?'#fff':'#FAFAFA'};border-bottom:1px solid #F0F0F0">
        <td style="padding:8px 10px;font-weight:600">${escHtml(r[groupKey] ?? '-')}</td>
        <td style="padding:8px 10px;text-align:right">${(+r.nights||0).toLocaleString('th-TH')}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:700;color:#2E7D32">${fmtBaht(r.revenue)}</td>
      </tr>`;
    }).join('');
    return `
      <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#F5F7FA;color:#546E7A;font-size:12px;font-weight:700">
          ${reportTh(groupLabel)}<th style="padding:10px 12px;text-align:right;border-bottom:1px solid #E0E0E0">${nightsLabel}</th><th style="padding:10px 12px;text-align:right;border-bottom:1px solid #E0E0E0">${revenueLabel}</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
        <tfoot><tr style="background:#F5F7FA;font-weight:700">
          <td style="padding:8px 10px">รวมทั้งหมด</td>
          <td style="padding:8px 10px;text-align:right">${totalNights.toLocaleString('th-TH')}</td>
          <td style="padding:8px 10px;text-align:right;color:#2E7D32">${fmtBaht(totalRevenue)}</td>
        </tr></tfoot>
      </table>
      </div>`;
  };
}

// สรุปจำนวนห้องที่ใช้ และรายได้รวมต่อห้อง — โชว์ชื่อ/เลขห้อง (roomno) นำหน้าเลขเตียง (bedno) เพราะ 1 ห้องอาจมีหลายเตียง
function renderRoomsRevenueReport(data) {
  const rows = data.rows || [];
  if (rows.length === 0) return `<div class="empty-state"><div class="empty-icon">📋</div><p>ไม่พบข้อมูลในช่วงที่เลือก</p></div>`;
  let totalNights = 0, totalRevenue = 0;
  const bodyRows = rows.map((r, i) => {
    totalNights += (+r.nights || 0);
    totalRevenue += (+r.revenue || 0);
    return `<tr style="background:${i%2===0?'#fff':'#FAFAFA'};border-bottom:1px solid #F0F0F0">
      <td style="padding:8px 10px">${escHtml(r.room_name || r.roomno || '-')}</td>
      <td style="padding:8px 10px;font-weight:600">${escHtml(r.room_number||'-')}</td>
      <td style="padding:8px 10px;text-align:right">${(+r.nights||0).toLocaleString('th-TH')}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:700;color:#2E7D32">${fmtBaht(r.revenue)}</td>
    </tr>`;
  }).join('');
  return `
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#F5F7FA;color:#546E7A;font-size:12px;font-weight:700">
        ${reportTh('ห้อง')}${reportTh('เตียง')}<th style="padding:10px 12px;text-align:right;border-bottom:1px solid #E0E0E0">จำนวนวันนอนทั้งหมด</th><th style="padding:10px 12px;text-align:right;border-bottom:1px solid #E0E0E0">รายได้</th>
      </tr></thead>
      <tbody>${bodyRows}</tbody>
      <tfoot><tr style="background:#F5F7FA;font-weight:700">
        <td style="padding:8px 10px" colspan="2">รวมทั้งหมด</td>
        <td style="padding:8px 10px;text-align:right">${totalNights.toLocaleString('th-TH')}</td>
        <td style="padding:8px 10px;text-align:right;color:#2E7D32">${fmtBaht(totalRevenue)}</td>
      </tr></tfoot>
    </table>
    </div>`;
}

// สรุปรายได้ต่อเดือน — ถ้าเลือกช่วงวันที่ (from/to) backend จะแจงเป็นรายวันแทน ให้เปลี่ยนหัวคอลัมน์ตามจริง
function renderMonthlyRevenueReport(data) {
  const label = data.groupedByDay ? 'วันที่' : 'เดือน';
  return renderGroupRevenueReport('month', label)(data);
}

function renderTotalRevenueReport(data) {
  const total = data.total || {};
  const byBed = data.byBed || [];
  const summaryCards = `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:20px">
      <div class="stat-card" style="border-left-color:#2E7D32">
        <div class="stat-icon">💰</div>
        <div><div class="stat-number" style="color:#2E7D32;font-size:20px">${fmtBaht(total.revenue)}</div><div class="stat-label">รายได้จริงที่เก็บได้ (ชำระเงินแล้ว)</div></div>
      </div>
      <div class="stat-card" style="border-left-color:#1565C0">
        <div class="stat-icon">🧾</div>
        <div><div class="stat-number" style="color:#1565C0">${(+total.bookings_count||0).toLocaleString('th-TH')}</div><div class="stat-label">จำนวนรายการเรียกเก็บที่ชำระแล้ว</div></div>
      </div>
    </div>`;
  if (byBed.length === 0) return summaryCards + `<div class="empty-state"><div class="empty-icon">📋</div><p>ไม่พบข้อมูลในช่วงที่เลือก</p></div>`;
  const bodyRows = byBed.map((r, i) => `
    <tr style="background:${i%2===0?'#fff':'#FAFAFA'};border-bottom:1px solid #F0F0F0">
      <td style="padding:8px 10px;font-weight:600;color:var(--primary)">${escHtml(r.room_number||'-')}</td>
      <td style="padding:8px 10px;text-align:right">${(+r.bookings_count||0).toLocaleString('th-TH')}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:700;color:#2E7D32">${fmtBaht(r.revenue)}</td>
    </tr>`).join('');
  return summaryCards + `
    <div style="font-size:13px;font-weight:700;color:#546E7A;margin-bottom:8px">แยกตามเตียง</div>
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#F5F7FA;color:#546E7A;font-size:12px;font-weight:700">
        ${reportTh('เตียง')}<th style="padding:10px 12px;text-align:right;border-bottom:1px solid #E0E0E0">จำนวนรายการ</th><th style="padding:10px 12px;text-align:right;border-bottom:1px solid #E0E0E0">รายได้</th>
      </tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
    </div>`;
}

// สรุปจำนวนจ่ายห้องของแต่ละกลุ่มสิทธิ — ชื่อสิทธิ, จำนวนรวมตามสิทธิ (จำนวนรายการที่จ่าย), ราคาที่จ่ายจริงตามสิทธินั้น
function renderRightsSummaryReport(data) {
  const rows = data.rows || [];
  if (rows.length === 0) return `<div class="empty-state"><div class="empty-icon">📋</div><p>ไม่พบข้อมูลในช่วงที่เลือก</p></div>`;
  let totalCount = 0, totalRevenue = 0;
  const bodyRows = rows.map((r, i) => {
    totalCount += (+r.bookings_count || 0);
    totalRevenue += (+r.revenue || 0);
    return `<tr style="background:${i%2===0?'#fff':'#FAFAFA'};border-bottom:1px solid #F0F0F0">
      <td style="padding:8px 10px;font-weight:600">${escHtml(r.rights_type||'-')}</td>
      <td style="padding:8px 10px;text-align:right">${(+r.bookings_count||0).toLocaleString('th-TH')}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:700;color:#2E7D32">${fmtBaht(r.revenue)}</td>
    </tr>`;
  }).join('');
  return `
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#F5F7FA;color:#546E7A;font-size:12px;font-weight:700">
        ${reportTh('สิทธิการรักษา')}<th style="padding:10px 12px;text-align:right;border-bottom:1px solid #E0E0E0">จำนวนรวมตามสิทธิ</th><th style="padding:10px 12px;text-align:right;border-bottom:1px solid #E0E0E0">ราคาที่ใช้ได้ตามสิทธิ</th>
      </tr></thead>
      <tbody>${bodyRows}</tbody>
      <tfoot><tr style="background:#F5F7FA;font-weight:700">
        <td style="padding:8px 10px">รวมทั้งหมด</td>
        <td style="padding:8px 10px;text-align:right">${totalCount.toLocaleString('th-TH')}</td>
        <td style="padding:8px 10px;text-align:right;color:#2E7D32">${fmtBaht(totalRevenue)}</td>
      </tr></tfoot>
    </table>
    </div>`;
}

// สรุปรายได้วันหยุด/วันธรรมดา — สรุปแค่รายได้ แยกตามวันทั้ง 7 วัน (จันทร์-อาทิตย์) ไม่แยกตามเตียง พร้อมราคาเบิกได้ตามสิทธิ (paidst=02) และราคาที่ต้องชำระ (paidst 01,03)
function renderHolidayWeekdayReport(data) {
  const rows = data.rows || [];
  if (rows.length === 0) return `<div class="empty-state"><div class="empty-icon">📋</div><p>ไม่พบข้อมูลในช่วงที่เลือก</p></div>`;
  const dowNames = { 1: 'จันทร์', 2: 'อังคาร', 3: 'พุธ', 4: 'พฤหัสบดี', 5: 'ศุกร์', 6: 'เสาร์', 7: 'อาทิตย์' };
  const sorted = [...rows].sort((a, b) => a.dow - b.dow);
  let totalClaimable = 0, totalPayable = 0;
  const bodyRows = sorted.map((r, i) => {
    totalClaimable += (+r.claimable_revenue || 0);
    totalPayable += (+r.payable_revenue || 0);
    const isWeekend = r.dow === 6 || r.dow === 7;
    return `<tr style="background:${i%2===0?'#fff':'#FAFAFA'};border-bottom:1px solid #F0F0F0">
      <td style="padding:8px 10px;font-weight:600${isWeekend ? ';color:#C62828' : ''}">${dowNames[r.dow] || '-'}</td>
      <td style="padding:8px 10px;text-align:right">${fmtBaht(r.claimable_revenue)}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:700;color:#2E7D32">${fmtBaht(r.payable_revenue)}</td>
    </tr>`;
  }).join('');
  return `
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#F5F7FA;color:#546E7A;font-size:12px;font-weight:700">
        ${reportTh('วัน')}<th style="padding:10px 12px;text-align:right;border-bottom:1px solid #E0E0E0">ราคาเบิกได้ตามสิทธิ</th><th style="padding:10px 12px;text-align:right;border-bottom:1px solid #E0E0E0">ราคาที่ต้องชำระ</th>
      </tr></thead>
      <tbody>${bodyRows}</tbody>
      <tfoot><tr style="background:#F5F7FA;font-weight:700">
        <td style="padding:8px 10px">รวมทั้งหมด</td>
        <td style="padding:8px 10px;text-align:right">${fmtBaht(totalClaimable)}</td>
        <td style="padding:8px 10px;text-align:right;color:#2E7D32">${fmtBaht(totalPayable)}</td>
      </tr></tfoot>
    </table>
    </div>`;
}

// สรุปรายได้ตามเวร เช้า/บ่าย/ดึก พร้อมราคาเบิกได้ตามสิทธิ (paidst=02) และราคาที่ต้องชำระ (paidst 01,03)
function renderShiftRevenueReport(data) {
  const rows = data.rows || [];
  if (rows.length === 0) return `<div class="empty-state"><div class="empty-icon">📋</div><p>ไม่พบข้อมูลในช่วงที่เลือก</p></div>`;
  let totalClaimable = 0, totalPayable = 0;
  const bodyRows = rows.map((r, i) => {
    totalClaimable += (+r.claimable_revenue || 0);
    totalPayable += (+r.payable_revenue || 0);
    return `<tr style="background:${i%2===0?'#fff':'#FAFAFA'};border-bottom:1px solid #F0F0F0">
      <td style="padding:8px 10px;font-weight:600">${escHtml(r.shift||'-')}</td>
      <td style="padding:8px 10px;text-align:right">${fmtBaht(r.claimable_revenue)}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:700;color:#2E7D32">${fmtBaht(r.payable_revenue)}</td>
    </tr>`;
  }).join('');
  return `
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#F5F7FA;color:#546E7A;font-size:12px;font-weight:700">
        ${reportTh('เวร')}<th style="padding:10px 12px;text-align:right;border-bottom:1px solid #E0E0E0">ราคาเบิกได้ตามสิทธิ</th><th style="padding:10px 12px;text-align:right;border-bottom:1px solid #E0E0E0">ราคาที่ต้องชำระ</th>
      </tr></thead>
      <tbody>${bodyRows}</tbody>
      <tfoot><tr style="background:#F5F7FA;font-weight:700">
        <td style="padding:8px 10px">รวมทั้งหมด</td>
        <td style="padding:8px 10px;text-align:right">${fmtBaht(totalClaimable)}</td>
        <td style="padding:8px 10px;text-align:right;color:#2E7D32">${fmtBaht(totalPayable)}</td>
      </tr></tfoot>
    </table>
    </div>`;
}

function renderWaitingDurationReport(data) {
  const rows = data.rows || [];
  if (rows.length === 0) return `<div class="empty-state"><div class="empty-icon">📋</div><p>ไม่พบข้อมูลในช่วงที่เลือก</p></div>`;
  const fmtDT = v => v ? new Date(v).toLocaleString('th-TH', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '-';
  const bodyRows = rows.map((r, i) => `
    <tr style="background:${i%2===0?'#fff':'#FAFAFA'};border-bottom:1px solid #F0F0F0">
      <td style="padding:8px 10px;font-weight:600;color:var(--primary)">${escHtml(r.an||'-')}</td>
      <td style="padding:8px 10px">${escHtml(r.hn||'-')}</td>
      <td style="padding:8px 10px">${escHtml(r.patient_name||'-')}</td>
      <td style="padding:8px 10px">${escHtml(r.room_number||'-')} ${r.room_ward_name ? '/ ' + escHtml(r.room_ward_name) : ''}</td>
      <td style="padding:8px 10px;white-space:nowrap">${fmtDT(r.request_date)}</td>
      <td style="padding:8px 10px;white-space:nowrap">${fmtDT(r.got_room_at)}</td>
      <td style="padding:8px 10px;white-space:nowrap;font-weight:600">${formatDuration(r.request_date, r.got_room_at)}</td>
    </tr>`).join('');
  return `
    <div style="margin-bottom:14px;font-size:13px;color:#546E7A">พบ <b>${rows.length}</b> AN</div>
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#F5F7FA;color:#546E7A;font-size:12px;font-weight:700">
        ${reportTh('AN')}${reportTh('HN')}${reportTh('ชื่อ-สกุล')}${reportTh('ห้องที่ได้ / Ward')}${reportTh('วันที่เข้าคิว')}${reportTh('วันที่ได้เข้าห้อง')}${reportTh('ระยะเวลารอ')}
      </tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
    </div>`;
}

function tableToCSVRows(table) {
  const rows = [];
  table.querySelectorAll('tr').forEach(tr => {
    const cells = [...tr.children].map(td => {
      let text = td.textContent.replace(/\s+/g, ' ').trim();
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        text = '"' + text.replace(/"/g, '""') + '"';
      }
      return text;
    });
    rows.push(cells.join(','));
  });
  return rows;
}

function exportCurrentReportCSV() {
  const cfg = REPORTS_CONFIG[currentReportKey];
  const content = document.getElementById('reportDetailContent');
  const tables = content ? content.querySelectorAll('table') : [];
  if (!cfg || tables.length === 0) { toast('ไม่มีข้อมูลสำหรับส่งออก', 'warning'); return; }
  let csvLines = [];
  tables.forEach(table => { csvLines = csvLines.concat(tableToCSVRows(table)); csvLines.push(''); });
  const csv = csvLines.join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  a.href = url;
  a.download = `${currentReportKey}_${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('ส่งออก CSV เรียบร้อย', 'success');
}

function printCurrentReport() {
  const cfg = REPORTS_CONFIG[currentReportKey];
  const content = document.getElementById('reportDetailContent');
  if (!cfg || !content || !content.innerHTML.trim()) { toast('ไม่มีข้อมูลสำหรับพิมพ์', 'warning'); return; }

  const wardSel  = document.getElementById('reportWardFilter');
  const wardText = wardSel && wardSel.value ? wardSel.options[wardSel.selectedIndex].textContent : 'ทุก Ward';
  const from = document.getElementById('reportFromDate').value;
  const to   = document.getElementById('reportToDate').value;
  const fmtTH = v => v ? new Date(v + 'T00:00:00').toLocaleDateString('th-TH', { day:'numeric', month:'long', year:'numeric' }) : '';
  const filterParts = [`Ward: <b>${escHtml(wardText)}</b>`];
  if (from) filterParts.push(`ตั้งแต่: <b>${fmtTH(from)}</b>`);
  if (to)   filterParts.push(`ถึง: <b>${fmtTH(to)}</b>`);
  const printedAt = new Date().toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' });

  const html = `<!DOCTYPE html><html lang="th"><head>
  <meta charset="UTF-8">
  <title>${escHtml(cfg.title)}</title>
  <style>
    @page { size: A4 portrait; margin: 15mm 12mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Angsana New', 'AngsanaUPC', serif; font-size: 16px; color: #222; margin: 0; }
    .report-title { font-size: 22px; font-weight: 700; text-align: center; margin-bottom: 4px; }
    .meta-right   { text-align: right; font-size: 14px; color: #777; margin-bottom: 10px; }
    .filter-bar   { font-size: 15px; color: #444; margin-bottom: 12px; border-bottom: 1px solid #ccc; padding-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 16px; margin-top: 10px; }
    th { padding: 6px 8px; text-align: left; font-weight: 700; border: 1px solid #000; }
    td { padding: 5px 8px; border: 1px solid #000; vertical-align: top; }
    .stat-card { display: inline-flex; align-items: center; gap: 10px; border: 1px solid #000; border-radius: 4px; padding: 10px 16px; margin: 0 10px 10px 0; }
    .stat-icon { font-size: 22px; }
    .stat-number { font-size: 18px; font-weight: 700; }
    .stat-label { font-size: 13px; color: #444; }
    .empty-state { text-align: center; color: #444; padding: 20px; }
    /* ไม่พิมพ์ด้วยสี — บังคับพื้นหลังของทุกแถว/เซลล์ (รวมที่มี inline style ติดมาจากหน้าเว็บ) ให้เป็นสีขาวล้วน */
    table, thead, tbody, tfoot, tr, th, td { background: #fff !important; }
  </style>
  </head><body>
  <div class="report-title">${escHtml(cfg.title)}</div>
  <div class="meta-right">พิมพ์เมื่อ: ${printedAt}</div>
  <div class="filter-bar">${filterParts.join(' &nbsp;|&nbsp; ')}</div>
  ${content.innerHTML}
  </body></html>`;

  const w = window.open('', '_blank', 'width=1100,height=750');
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 400);
}

/* ===== MY WARD BOOKINGS (waiting_list.ward = ward ที่จอง) ===== */
let allMyWardBookings = [];
const MY_WARD_BOOKINGS_STORAGE_KEY = 'myWardBookingsWardFilter';
let myWardBookingsWardRestored = false;

async function loadMyWardBookings() {
  const container = document.getElementById('myWardBookingsContent');
  if (container) container.innerHTML = `<div class="empty-state"><div class="spinner" style="margin:0 auto"></div><p style="margin-top:12px">กำลังโหลด...</p></div>`;
  try {
    const res = await fetchWithTimeout('/api/waitlist?all=true');
    const data = await res.json();
    if (!data.success) {
      if (container) container.innerHTML = `<div class="alert alert-error" style="margin:20px">❌ ${data.message}</div>`;
      return;
    }
    allMyWardBookings = (data.list || []).filter(w => w.status !== 'cancelled');
    populateMyWardBookingsWardDropdown(allMyWardBookings);
    filterMyWardBookings();
  } catch (e) {
    if (container) container.innerHTML = `<div class="alert alert-error" style="margin:20px">❌ ไม่สามารถโหลดข้อมูลได้</div>`;
  }
}

function populateMyWardBookingsWardDropdown(list) {
  const sel = document.getElementById('myWardBookingsWardFilter');
  if (!sel) return;
  const current = sel.value;
  const wards = [...new Set(list.map(w => w.ward).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">— ทุก Ward —</option>';
  wards.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w; opt.textContent = w;
    sel.appendChild(opt);
  });
  if (wards.includes(current)) {
    sel.value = current;
  } else if (!myWardBookingsWardRestored) {
    const saved = localStorage.getItem(MY_WARD_BOOKINGS_STORAGE_KEY) || '';
    if (saved && wards.includes(saved)) sel.value = saved;
  }
  myWardBookingsWardRestored = true;
}

/* เด้งมาที่หน้านี้หลังบันทึกคิวรอสำเร็จ พร้อมกรองตาม ward ที่เพิ่งจอง */
async function goToMyWardBookings(ward) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('panel-mywardbookings').classList.add('active');
  document.getElementById('nav-mywardbookings').classList.add('active');
  document.getElementById('topbarTitle').textContent = tabTitles['mywardbookings'];

  await loadMyWardBookings();

  const sel = document.getElementById('myWardBookingsWardFilter');
  if (sel && ward) {
    if (![...sel.options].some(o => o.value === ward)) {
      const opt = document.createElement('option');
      opt.value = ward; opt.textContent = ward;
      sel.appendChild(opt);
    }
    sel.value = ward;
  }
  filterMyWardBookings();
}

function rememberMyWardBookingsWard() {
  const sel = document.getElementById('myWardBookingsWardFilter');
  const ward = sel?.value || '';
  localStorage.setItem(MY_WARD_BOOKINGS_STORAGE_KEY, ward);
  toast(ward ? `📌 จำค่า Ward "${ward}" แล้ว` : '📌 จำค่า "ทุก Ward" แล้ว', 'success');
}

function filterMyWardBookings() {
  const ward = document.getElementById('myWardBookingsWardFilter')?.value || '';
  const filtered = ward ? allMyWardBookings.filter(w => w.ward === ward) : allMyWardBookings;
  renderMyWardBookings(filtered);
}

function renderMyWardBookings(list) {
  const container = document.getElementById('myWardBookingsContent');
  const countBar   = document.getElementById('myWardBookingsCountBar');
  if (!container) return;
  if (countBar) countBar.textContent = `พบทั้งหมด ${list.length} ราย`;
  if (!list || list.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🗂️</div><p>ไม่พบข้อมูล</p></div>`;
    return;
  }
  const statusChip = {
    waiting:  '<span class="status-chip chip-waiting">⏳ ยังไม่ได้ห้อง</span>',
    assigned: '<span class="status-chip chip-reserved">✅ ได้ห้องแล้ว</span>'
  };
  const th = s => `<th style="padding:10px 12px;text-align:left;border-bottom:1px solid #E0E0E0;white-space:nowrap">${s}</th>`;
  const fmtDate = v => v ? new Date(v).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'numeric' }) : '-';
  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead>
        <tr style="background:#F5F7FA;color:#546E7A;font-size:12px;font-weight:700">
          ${th('#')}${th('Ward ที่จอง')}${th('HN')}${th('ชื่อ-สกุล')}${th('AN')}${th('ราคาห้องที่จอง')}
          ${th('วันที่จะใช้ห้อง')}${th('วันที่จอง')}${th('หมายเหตุ')}<th style="padding:10px 12px;text-align:center;border-bottom:1px solid #E0E0E0">สถานะ</th>
          <th style="padding:10px 12px;text-align:center;border-bottom:1px solid #E0E0E0">จัดการ</th>
        </tr>
      </thead>
      <tbody>
        ${list.map((w, i) => `
          <tr style="background:${i % 2 === 0 ? '#fff' : '#FAFAFA'};border-bottom:1px solid #F0F0F0">
            <td style="padding:10px 12px;color:#90A4AE;font-size:12px">${i + 1}</td>
            <td style="padding:10px 12px">${escHtml(w.ward || '-')}</td>
            <td style="padding:10px 12px;font-weight:600;color:var(--primary)">${escHtml(w.hn || '-')}</td>
            <td style="padding:10px 12px">${escHtml(w.patient_name || '-')}</td>
            <td style="padding:10px 12px">${escHtml(w.an || '-')}</td>
            <td style="padding:10px 12px;font-size:12px;line-height:1.6;white-space:nowrap">
              <div>1. ${escHtml(w.roomtype_name || w.type_name || '-')}</div>
              <div>2. ${escHtml(w.roomtype_name_2 || '-')}</div>
              <div>3. ${escHtml(w.roomtype_name_3 || '-')}</div>
            </td>
            <td style="padding:10px 12px;font-size:12px;white-space:nowrap">${fmtDate(w.check_in_date)}</td>
            <td style="padding:10px 12px;font-size:12px;white-space:nowrap">${fmtDate(w.request_date)}</td>
            <td style="padding:10px 12px;font-size:12px;max-width:180px;white-space:normal;color:#546E7A">${escHtml(w.notes || '-')}</td>
            <td style="padding:10px 12px;text-align:center">${statusChip[w.status] || w.status || '-'}</td>
            <td style="padding:10px 12px;text-align:center">
              <button class="btn btn-secondary btn-sm" style="font-size:12px;padding:5px 10px"
                onclick="goToEditBookingFromMyWard(${w.id})">
                ✏️ เปลี่ยนราคาห้องที่เลือก</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* กดปุ่ม "เปลี่ยนราคาห้องที่เลือก" จากหน้า คนไข้ที่ ward ท่านเป็นคนจอง — วิ่งไปที่ฟอร์มจองห้องพิเศษ
   พร้อมดึงข้อมูลของคนไข้คนนั้นที่เคยลงไว้มาเติมในฟอร์มให้ครบ (HN/AN ดึงข้อมูลล่าสุดจาก HIS,
   ส่วนที่เหลือ เช่น ผู้ติดต่อ/หมายเหตุ/ราคาห้องที่จอง 3 ลำดับ ดึงจากที่บันทึกไว้ใน waiting_list) */
async function goToEditBookingFromMyWard(id) {
  const item = allMyWardBookings.find(w => w.id === id);
  if (!item) { toast('ไม่พบข้อมูลรายการนี้', 'error'); return; }

  switchTab('booking');
  clearBookingForm();

  if (item.hn) {
    document.getElementById('bnHn').value = item.hn;
    await searchPatient();
  }
  if (item.an) {
    document.getElementById('bnAn').value = item.an;
    await fillWardByAN(item.an);
  }

  document.getElementById('bnContactName').value  = item.contact_name  || '';
  document.getElementById('bnContactPhone').value = item.contact_phone || '';
  document.getElementById('bnNotes').value        = item.notes         || '';
  const noRoomReasonEl = document.getElementById('bnNoRoomReason');
  if (noRoomReasonEl) noRoomReasonEl.value = item.no_pay_reason || item.no_room_reason || '';

  const ptEl = document.getElementById('bnPriorityType');
  if (ptEl && item.priority_type) ptEl.value = item.priority_type;

  if (item.check_in_date) {
    const d = new Date(item.check_in_date);
    if (!isNaN(d)) {
      const pad = n => String(n).padStart(2, '0');
      document.getElementById('bnCheckIn').value =
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }

  await loadRoomPriceTypes(); // ให้แน่ใจว่าตัวเลือกราคาห้องพร้อมก่อนตั้งค่า
  const setPriceSel = (selId, value) => {
    const sel = document.getElementById(selId);
    if (sel && value != null) sel.value = String(value);
  };
  setPriceSel('bnRoomPriceType1', item.room_type_id);
  setPriceSel('bnRoomPriceType2', item.room_type_id_2);
  setPriceSel('bnRoomPriceType3', item.room_type_id_3);
  updatePriceRankLocks();

  toast(`ดึงข้อมูลการจองของ ${item.patient_name || item.hn || ''} มาที่ฟอร์มจองห้องพิเศษแล้ว`, 'success');
}

function renderHosBeds(beds) {
  renderBedsToContainer(beds, 'allRoomsContent');
}

function renderBedsToContainer(beds, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!beds || beds.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🏨</div><p>ไม่พบข้อมูลห้องพิเศษ</p></div>`;
    return;
  }

  // Group: ward → roomtype → [beds]
  const grouped = new Map();
  for (const b of beds) {
    const ward = b.ward || 'ไม่ระบุ Ward';
    const rt   = b.roomtype || 'ไม่ระบุประเภท';
    if (!grouped.has(ward)) grouped.set(ward, new Map());
    const rtMap = grouped.get(ward);
    if (!rtMap.has(rt)) rtMap.set(rt, []);
    rtMap.get(rt).push(b);
  }

  const statusLabel = {
    available: 'ว่าง', reserved: 'จองแล้ว', occupied: 'มีผู้พัก',
    cleaning: 'ทำความสะอาด', pending_discharge: 'รอจำหน่าย', unknown: 'ไม่ทราบ',
    repair: 'ซ่อมแซม', isolation: 'แยกโรค', relative: 'ญาติใช้ห้อง'
  };

  let html = '';
  for (const [ward, rtMap] of grouped) {
    const totalBeds   = [...rtMap.values()].reduce((s, arr) => s + arr.length, 0);
    const occupiedBeds= [...rtMap.values()].flat().filter(b => b.room_status && b.room_status !== 'available' && b.room_status !== 'cleaning').length;

    html += `<div class="ward-section">
      <div class="ward-header">
        🏥 ${ward}
        <span class="ward-count">มีผู้พัก/จอง ${occupiedBeds} / ${totalBeds} ห้อง</span>
      </div>
      <div class="ward-body">`;

    for (const [rt, bedList] of rtMap) {
      const availCount = bedList.filter(b => !b.room_status || b.room_status === 'available').length;
      html += `<div class="roomtype-section">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span class="roomtype-label">🛏️ ${rt}</span>
          <span style="font-size:12px;color:#546E7A">ว่าง ${availCount}/${bedList.length}</span>
        </div>
        <div class="beds-row">`;

      for (const bed of bedList) {
        const st    = bed.room_status || 'unknown';
        const label = statusLabel[st] || st;
        const hasPatient = !!bed.patient_name;
        const shortName  = hasPatient
          ? bed.patient_name.split(' ').slice(0,2).join(' ')
          : '';

        const price = Number(bed.price);
        const priceHtml = price > 0
          ? `<span class="bed-price">${price.toLocaleString('th-TH')} บาท</span>`
          : '';

        const statusDate = st === 'repair' ? bed.repair_start_date
                          : st === 'isolation' ? bed.isolation_start_date
                          : null;
        const statusNoteHtml = (st === 'repair' || st === 'isolation' || st === 'relative')
          ? `<span class="bed-status-note">${label}${statusDate ? ' ' + fmtDate(statusDate) : ''}</span>`
          : '';

        html += `<div class="bed-box bed-${st}" onclick='openBedDetail(${JSON.stringify(bed).replace(/'/g,"&#39;")})' title="${bed.bedno} - ${label}${hasPatient ? '\n' + bed.patient_name : ''}">
          <div class="bed-status-dot"></div>
          ${priceHtml}
          <span class="bed-number">${bed.bedno}</span>
          ${statusNoteHtml}
          ${hasPatient ? `<span class="bed-patient">${shortName}</span>` : ''}
        </div>`;
      }

      html += `</div></div>`;
    }

    html += `</div></div>`;
  }

  container.innerHTML = html;
}

function openBedDetail(bed) {
  const st = bed.room_status || 'unknown';
  const statusLabel = {
    available:'ว่าง', reserved:'จองแล้ว', occupied:'มีผู้พัก',
    cleaning:'ทำความสะอาด', pending_discharge:'รอจำหน่าย', unknown:'ไม่ทราบสถานะ',
    repair:'ซ่อมแซม', isolation:'แยกโรค', relative:'ญาติใช้ห้อง'
  };
  const statusColor = {
    available:'#2E7D32', reserved:'#F57F17', occupied:'#C62828',
    cleaning:'#546E7A', pending_discharge:'#6A1B9A', unknown:'#9E9E9E',
    repair:'#F9A825', isolation:'#7B1FA2', relative:'#1565C0'
  };

  document.getElementById('roomModalTitle').textContent = `เตียง ${bed.bedno}`;
  document.getElementById('roomModalBody').innerHTML = `
    <div style="display:grid;gap:10px">
      <div class="info-row"><span class="info-label" style="min-width:100px">Ward:</span><span class="info-value">${bed.ward || '-'}</span></div>
      <div class="info-row"><span class="info-label" style="min-width:100px">ประเภทห้อง:</span><span class="info-value">${bed.roomtype || '-'}</span></div>
      <div class="info-row"><span class="info-label" style="min-width:100px">เลขเตียง:</span><span class="info-value">${bed.bedno}</span></div>
      <div class="info-row"><span class="info-label" style="min-width:100px">สถานะ:</span>
        <span style="font-weight:700;color:${statusColor[st]}">${statusLabel[st]}</span>
      </div>
      ${st === 'repair' && bed.repair_start_date ? `<div class="info-row"><span class="info-label" style="min-width:100px">วันที่เริ่มซ่อม:</span><span class="info-value">${fmtDate(bed.repair_start_date)}</span></div>` : ''}
      ${st === 'isolation' && bed.isolation_start_date ? `<div class="info-row"><span class="info-label" style="min-width:100px">วันที่เริ่มแยกโรค:</span><span class="info-value">${fmtDate(bed.isolation_start_date)}</span></div>` : ''}
      ${bed.an ? `
        <div style="background:#FFEBEE;border-radius:8px;padding:12px;margin-top:4px;border-left:4px solid #C62828">
          <div style="font-size:11px;font-weight:700;color:#C62828;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">🔴 ผู้พักปัจจุบัน (จาก HIS)</div>
          ${bed.patient_name
            ? `<div class="info-row"><span class="info-label" style="min-width:100px">ชื่อ-นามสกุล:</span><span class="info-value" style="font-weight:700">${bed.patient_name}</span></div>`
            : ''}
          <div class="info-row"><span class="info-label" style="min-width:100px">AN:</span><span class="info-value" style="font-family:monospace">${bed.an}</span></div>
          ${bed.regdate ? `<div class="info-row"><span class="info-label" style="min-width:100px">วัน Admit:</span><span class="info-value">${fmtDate(bed.regdate)}</span></div>` : ''}
          ${bed.doctor_name ? `<div class="info-row"><span class="info-label" style="min-width:100px">แพทย์เจ้าของ:</span><span class="info-value">${bed.doctor_name}</span></div>` : ''}
        </div>` : ''}
    </div>`;

  const footer = document.getElementById('roomModalFooter');
  footer.innerHTML = '';
  if (st === 'available') {
    const btnBook = document.createElement('button');
    btnBook.className = 'btn btn-primary btn-sm';
    btnBook.textContent = '📝 จองห้อง';
    btnBook.onclick = () => prefillBedBooking(bed);
    footer.appendChild(btnBook);
  }
  const btnClose = document.createElement('button');
  btnClose.className = 'btn btn-secondary btn-sm';
  btnClose.textContent = 'ปิด';
  btnClose.onclick = () => closeModal('roomModal');
  footer.appendChild(btnClose);

  document.getElementById('roomModal').classList.add('show');
}

async function prefillBedBooking(bed) {
  closeModal('roomModal');
  switchTab('booking');

  // 1. หอผู้ป่วย: ใช้ ward_code (r.ward) เป็น value
  const wf = document.getElementById('bnWardFilter');
  if (wf && bed.ward_code) {
    if (![...wf.options].some(o => o.value === bed.ward_code)) {
      const opt = document.createElement('option');
      opt.value = bed.ward_code; opt.textContent = bed.ward || bed.ward_code;
      wf.appendChild(opt);
    }
    wf.value = bed.ward_code;
  }

  // 2. โหลดประเภทห้องจาก HIS ตาม ward ที่เลือก
  await loadBookingRoomTypes(bed.ward_code || '');

  // 3. ประเภทห้อง: ใช้ roomtype_code (rt.roomtype)
  const rtSel = document.getElementById('bnRoomType');
  if (bed.roomtype_code && [...rtSel.options].some(o => o.value === bed.roomtype_code)) {
    rtSel.value = bed.roomtype_code;
  }

  // 4. โหลดรายชื่อห้อง (roomno) ของ ward + ประเภทห้องนี้
  await refreshRoomList();

  // 5. ห้อง: ใช้ roomno ถ้ามี
  const roomNoSel = document.getElementById('bnRoomNo');
  if (bed.roomno && [...roomNoSel.options].some(o => o.value === String(bed.roomno))) {
    roomNoSel.value = String(bed.roomno);
  }

  // 6. โหลดเตียงว่างของห้องนั้น (หรือทั้งประเภทห้อง ถ้าไม่รู้ roomno)
  await refreshBedList();

  // 7. auto-select bedno
  const roomSel = document.getElementById('bnRoomId');
  if ([...roomSel.options].some(o => o.value === String(bed.bedno))) {
    roomSel.value = String(bed.bedno);
    showRoomPrice();
  }
}

async function setRoomAvailable(roomId) {
  await fetchWithTimeout(`/api/rooms/${roomId}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'available' })
  });
  toast('ห้องพร้อมให้บริการแล้ว', 'success');
  await loadRooms();
  loadHosBeds();
}

/* ===== SETTINGS ===== */
let settingsRoomTypes = [];
let hisRoomtypesLoaded = false;

async function loadSettingsData() {
  // reserved for future settings sections
}

/* ===== ROOM TYPE PRICE SETTINGS (collapsible, with add) ===== */
let roomTypesSettingsLoaded = false;

function toggleRoomTypesSettings() {
  const container  = document.getElementById('roomTypesSettingsContainer');
  const chevron    = document.getElementById('roomTypesSettingsChevron');
  const refreshBtn = document.getElementById('rtRefreshBtn');
  const addBtn     = document.getElementById('rtAddBtn');
  const isHidden   = container.style.display === 'none';
  container.style.display = isHidden ? 'block' : 'none';
  chevron.style.transform  = isHidden ? 'rotate(90deg)' : '';
  if (refreshBtn) refreshBtn.style.display = isHidden ? '' : 'none';
  if (addBtn) addBtn.style.display = isHidden ? '' : 'none';
  if (isHidden && !roomTypesSettingsLoaded) {
    roomTypesSettingsLoaded = true;
    loadRoomTypesSettings();
  }
}

/* ===== HIS PRIORITY TYPES (collapsible, with add) ===== */
let priorityTypesLoaded = false;

function togglePriorityTypes() {
  const container  = document.getElementById('priorityTypesContainer');
  const chevron    = document.getElementById('priorityTypesChevron');
  const refreshBtn = document.getElementById('ptRefreshBtn');
  const isHidden   = container.style.display === 'none';
  container.style.display = isHidden ? 'block' : 'none';
  chevron.style.transform  = isHidden ? 'rotate(90deg)' : '';
  if (refreshBtn) refreshBtn.style.display = isHidden ? '' : 'none';
  if (isHidden && !priorityTypesLoaded) {
    priorityTypesLoaded = true;
    loadPriorityTypes();
  }
}

async function loadPriorityTypes() {
  const wrap = document.getElementById('priorityTypesWrap');
  wrap.innerHTML = '<div class="empty-state"><p>กำลังโหลด...</p></div>';
  try {
    const res  = await fetchWithTimeout('/api/rooms/his-priority-types');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    renderPriorityTypes(data.types);
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><p style="color:#c62828">โหลดไม่สำเร็จ: ${e.message}</p></div>`;
  }
}

function renderPriorityTypes(types) {
  const wrap = document.getElementById('priorityTypesWrap');
  if (!types || !types.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">👤</div><p>ยังไม่มีข้อมูล</p></div>';
    return;
  }
  wrap.innerHTML = `
    <table class="config-table">
      <thead>
        <tr>
          <th style="width:80px">ลำดับ (ID)</th>
          <th>ชื่อประเภทผู้จอง</th>
          <th style="width:80px;text-align:center">ลบ</th>
        </tr>
      </thead>
      <tbody>
        ${types.map(t => `
          <tr>
            <td><code class="status-code">${escHtml(String(t.id))}</code></td>
            <td>${escHtml(t.name || '-')}</td>
            <td style="text-align:center">
              <button class="btn btn-danger btn-sm"
                onclick="deletePriorityType(${t.id},'${escAttr(t.name)}')">🗑️</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function addPriorityType() {
  const input = document.getElementById('newPriorityTypeName');
  const name  = input.value.trim();
  if (!name) { toast('กรุณากรอกชื่อประเภทผู้จอง', 'warning'); input.focus(); return; }
  try {
    const res  = await fetchWithTimeout('/api/rooms/his-priority-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    toast(`เพิ่ม "${name}" สำเร็จ`, 'success');
    input.value = '';
    await loadPriorityTypes();
    loadBookingPriorityTypes();
  } catch (e) {
    toast('เพิ่มไม่สำเร็จ: ' + e.message, 'error');
  }
}

async function deletePriorityType(id, name) {
  if (!confirm(`ยืนยันลบ "${name}" ?`)) return;
  try {
    const res  = await fetchWithTimeout(`/api/rooms/his-priority-types/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    toast(`ลบ "${name}" สำเร็จ`, 'success');
    await loadPriorityTypes();
    loadBookingPriorityTypes();
  } catch (e) {
    toast('ลบไม่สำเร็จ: ' + e.message, 'error');
  }
}

/* ===== HIS RESERVE STATUSES (collapsible) ===== */
let reserveStatusesLoaded = false;

function toggleReserveStatuses() {
  const container  = document.getElementById('reserveStatusesContainer');
  const chevron    = document.getElementById('reserveStatusesChevron');
  const refreshBtn = document.getElementById('hisRsRefreshBtn');
  const isHidden   = container.style.display === 'none';
  container.style.display = isHidden ? 'block' : 'none';
  chevron.style.transform = isHidden ? 'rotate(90deg)' : '';
  if (refreshBtn) refreshBtn.style.display = isHidden ? '' : 'none';
  if (isHidden && !reserveStatusesLoaded) {
    reserveStatusesLoaded = true;
    loadReserveStatuses();
  }
}

async function loadReserveStatuses() {
  const wrap = document.getElementById('reserveStatusesWrap');
  wrap.innerHTML = '<div class="empty-state"><p>กำลังโหลดข้อมูลจาก HIS...</p></div>';
  try {
    const res = await fetchWithTimeout('/api/rooms/his-reserve-statuses');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    renderReserveStatuses(data.statuses);
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><p style="color:#c62828">โหลดไม่สำเร็จ: ${e.message}</p></div>`;
  }
}

function renderReserveStatuses(rows) {
  const wrap = document.getElementById('reserveStatusesWrap');
  if (!rows || !rows.length) {
    wrap.innerHTML = '<div class="empty-state"><p>ไม่มีข้อมูลสถานะการจองใน HIS</p></div>';
    return;
  }
  wrap.innerHTML = `
    <table class="config-table">
      <thead>
        <tr>
          <th style="width:80px">รหัส</th>
          <th>ชื่อสถานะ</th>
          <th style="width:120px;text-align:center">hos_guid</th>
          <th style="width:160px;text-align:center">รหัสสถานะ</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td><code class="status-code">${escHtml(String(r.id))}</code></td>
            <td>${escHtml(r.name || '-')}</td>
            <td style="text-align:center;color:#546E7A;font-size:13px">${escHtml(r.status ?? '-')}</td>
            <td style="text-align:center">
              <input type="text" class="rs-num-input"
                value="${r.status != null ? escAttr(String(r.status)) : ''}"
                data-id="${r.id}"
                onblur="saveReserveStatusNum(this)"
                onkeydown="if(event.key==='Enter')this.blur()">
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p style="font-size:12px;color:#90A4AE;margin-top:10px">* กรอกรหัสสถานะแล้วกด Enter หรือคลิกออกเพื่อบันทึกลง hos_guid</p>
  `;
}

async function saveReserveStatusNum(input) {
  const id  = input.dataset.id;
  const val = input.value.trim();
  const orig = input.getAttribute('data-orig');
  if (val === (orig ?? '')) return;
  input.disabled = true;
  try {
    const res = await fetchWithTimeout(`/api/rooms/his-reserve-statuses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hos_guid: val === '' ? null : val })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    input.setAttribute('data-orig', val);
    // อัปเดต column hos_guid ในแถวเดียวกัน
    const td = input.closest('tr').querySelectorAll('td')[2];
    if (td) td.textContent = val === '' ? '-' : val;
    toast(`บันทึก ID ${id}: hos_guid = ${val || 'null'}`, 'success');
  } catch (e) {
    input.value = orig ?? '';
    toast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  } finally {
    input.disabled = false;
  }
}

/* ===== HIS ROOMTYPES (collapsible) ===== */
function toggleHisRoomtypes() {
  const container = document.getElementById('hisRoomtypesContainer');
  const chevron   = document.getElementById('hisRoomtypesChevron');
  const refreshBtn = document.getElementById('hisRtRefreshBtn');
  const isHidden  = container.style.display === 'none';
  container.style.display = isHidden ? 'block' : 'none';
  chevron.style.transform = isHidden ? 'rotate(90deg)' : '';
  if (refreshBtn) refreshBtn.style.display = isHidden ? '' : 'none';
  if (isHidden && !hisRoomtypesLoaded) {
    hisRoomtypesLoaded = true;
    loadHisRoomtypes();
  }
}

async function loadHisRoomtypes() {
  const wrap = document.getElementById('hisRoomtypesWrap');
  wrap.innerHTML = '<div class="empty-state"><p>กำลังโหลดข้อมูลจาก HIS...</p></div>';
  try {
    const res = await fetchWithTimeout('/api/rooms/his-roomtypes');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    renderHisRoomtypes(data.roomtypes);
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><p style="color:#c62828">โหลดไม่สำเร็จ: ${e.message}</p></div>`;
  }
}

function renderHisRoomtypes(rows) {
  const wrap = document.getElementById('hisRoomtypesWrap');
  if (!rows || !rows.length) {
    wrap.innerHTML = '<div class="empty-state"><p>ไม่มีข้อมูลประเภทห้องใน HIS</p></div>';
    return;
  }
  wrap.innerHTML = `
    <table class="config-table">
      <thead>
        <tr>
          <th>รหัสประเภทห้อง</th>
          <th>ชื่อประเภทห้อง</th>
          <th style="text-align:center;width:140px">ห้องพิเศษ (hos_guid)</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td><code class="status-code">${escHtml(r.roomtype)}</code></td>
            <td>${escHtml(r.name || '-')}</td>
            <td style="text-align:center">
              <input type="checkbox" class="special-checkbox"
                ${r.special === 'Y' ? 'checked' : ''}
                title="${r.special === 'Y' ? 'Y — ห้องพิเศษ' : 'N — ไม่ใช่ห้องพิเศษ'}"
                onchange="updateHisRoomtypeSpecial('${escAttr(r.roomtype)}', this)">
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(s) {
  return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;');
}

async function updateHisRoomtypeSpecial(code, checkbox) {
  const newVal = checkbox.checked ? 'Y' : 'N';
  checkbox.disabled = true;
  try {
    const res = await fetchWithTimeout(`/api/rooms/his-roomtypes/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ special: newVal })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    checkbox.title = newVal === 'Y' ? 'Y — ห้องพิเศษ' : 'N — ไม่ใช่ห้องพิเศษ';
    toast(`${code}: hos_guid = ${newVal}`, 'success');
  } catch (e) {
    checkbox.checked = !checkbox.checked;
    toast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  } finally {
    checkbox.disabled = false;
  }
}

/* ===== จัดการประเภทที่จะให้แสดง (bedtype) — collapsible เหมือนกล่อง HIS roomtype ===== */
let bedtypesLoaded = false;

function toggleBedtypes() {
  const container  = document.getElementById('bedtypesContainer');
  const chevron    = document.getElementById('bedtypesChevron');
  const refreshBtn = document.getElementById('bedtypeRefreshBtn');
  const isHidden   = container.style.display === 'none';
  container.style.display = isHidden ? 'block' : 'none';
  chevron.style.transform = isHidden ? 'rotate(90deg)' : '';
  if (refreshBtn) refreshBtn.style.display = isHidden ? '' : 'none';
  if (isHidden && !bedtypesLoaded) {
    bedtypesLoaded = true;
    loadBedtypes();
  }
}

async function loadBedtypes() {
  const wrap = document.getElementById('bedtypesWrap');
  wrap.innerHTML = '<div class="empty-state"><p>กำลังโหลดข้อมูลจาก HIS...</p></div>';
  try {
    const res = await fetchWithTimeout('/api/rooms/bedtype-list');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    renderBedtypes(data.bedtypes);
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><p style="color:#c62828">โหลดไม่สำเร็จ: ${e.message}</p></div>`;
  }
}

function renderBedtypes(rows) {
  const wrap = document.getElementById('bedtypesWrap');
  if (!rows || !rows.length) {
    wrap.innerHTML = '<div class="empty-state"><p>ไม่มีข้อมูลประเภทเตียงใน HIS</p></div>';
    return;
  }
  wrap.innerHTML = `
    <table class="config-table">
      <thead>
        <tr>
          <th>รหัสประเภทเตียง</th>
          <th>ชื่อประเภทเตียง</th>
          <th style="text-align:center;width:140px">แสดง (hos_guid)</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td><code class="status-code">${escHtml(r.bedtype)}</code></td>
            <td>${escHtml(r.name || '-')}</td>
            <td style="text-align:center">
              <input type="checkbox" class="special-checkbox"
                ${r.special === 'Y' ? 'checked' : ''}
                title="${r.special === 'Y' ? 'Y — ให้แสดง' : 'N — ไม่แสดง'}"
                onchange="updateBedtypeSpecial('${escAttr(r.bedtype)}', this)">
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function updateBedtypeSpecial(code, checkbox) {
  const newVal = checkbox.checked ? 'Y' : 'N';
  checkbox.disabled = true;
  try {
    const res = await fetchWithTimeout(`/api/rooms/bedtype-list/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ special: newVal })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    checkbox.title = newVal === 'Y' ? 'Y — ให้แสดง' : 'N — ไม่แสดง';
    toast(`${code}: hos_guid = ${newVal}`, 'success');
  } catch (e) {
    checkbox.checked = !checkbox.checked;
    toast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  } finally {
    checkbox.disabled = false;
  }
}

async function loadRoomTypesSettings() {
  const wrap = document.getElementById('roomTypesTableWrap');
  wrap.innerHTML = '<div class="empty-state"><p>กำลังโหลด...</p></div>';
  try {
    const res = await fetchWithTimeout('/api/rooms/types');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    settingsRoomTypes = data.types || [];
    renderRoomTypesTable(settingsRoomTypes);
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><p style="color:#c62828">โหลดข้อมูลไม่สำเร็จ: ${e.message}</p></div>`;
  }
}

function renderRoomTypesTable(types) {
  const wrap = document.getElementById('roomTypesTableWrap');
  if (!types.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">🏷️</div><p>ยังไม่มีประเภทห้อง — กด "+ เพิ่มประเภทห้อง"</p></div>';
    return;
  }
  wrap.innerHTML = `
    <table class="config-table">
      <thead>
        <tr>
          <th>ชื่อประเภทห้อง</th>
          <th>คำอธิบาย</th>
          <th style="text-align:right">ราคา/วัน</th>
          <th style="text-align:right">ค่าอาหาร/วัน</th>
          <th style="text-align:center">จัดการ</th>
        </tr>
      </thead>
      <tbody>
        ${types.map(t => `
          <tr>
            <td style="font-weight:700">${t.type_name}</td>
            <td style="color:#546E7A;font-size:13px">${t.description || '-'}</td>
            <td style="text-align:right">${(+t.price_per_day).toLocaleString('th-TH')} บาท</td>
            <td style="text-align:right">${(+t.food_price_per_day).toLocaleString('th-TH')} บาท</td>
            <td style="text-align:center;white-space:nowrap">
              <button class="btn btn-secondary btn-sm" onclick="openRoomTypeModal(${t.id})">✏️ แก้ไข</button>
              <button class="btn btn-danger btn-sm" onclick="deleteRoomType(${t.id},'${t.type_name.replace(/'/g,"\\'")}')">🗑️</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function openRoomTypeModal(id) {
  document.getElementById('rtId').value = id || '';
  document.getElementById('rtName').value = '';
  document.getElementById('rtDesc').value = '';
  document.getElementById('rtPrice').value = '';
  document.getElementById('rtFoodPrice').value = '';
  if (id) {
    const t = settingsRoomTypes.find(r => r.id == id);
    if (t) {
      document.getElementById('roomTypeModalTitle').textContent = '✏️ แก้ไขประเภทห้อง';
      document.getElementById('rtName').value = t.type_name || '';
      document.getElementById('rtDesc').value = t.description || '';
      document.getElementById('rtPrice').value = t.price_per_day || 0;
      document.getElementById('rtFoodPrice').value = t.food_price_per_day || 0;
    }
  } else {
    document.getElementById('roomTypeModalTitle').textContent = '➕ เพิ่มประเภทห้อง';
  }
  document.getElementById('roomTypeModal').classList.add('show');
}

async function saveRoomType() {
  const id = document.getElementById('rtId').value;
  const type_name = document.getElementById('rtName').value.trim();
  const description = document.getElementById('rtDesc').value.trim();
  const price_per_day = parseFloat(document.getElementById('rtPrice').value) || 0;
  const food_price_per_day = parseFloat(document.getElementById('rtFoodPrice').value) || 0;
  if (!type_name) { toast('กรุณากรอกชื่อประเภทห้อง', 'warning'); return; }
  try {
    const res = await fetchWithTimeout(id ? `/api/rooms/types/${id}` : '/api/rooms/types', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type_name, description, price_per_day, food_price_per_day })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    toast(id ? 'แก้ไขประเภทห้องสำเร็จ' : 'เพิ่มประเภทห้องสำเร็จ', 'success');
    closeModal('roomTypeModal');
    await loadRoomTypesSettings();
    loadRoomTypes();
    loadRoomPriceTypes();
  } catch (e) {
    toast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
}

async function deleteRoomType(id, name) {
  if (!confirm(`ยืนยันลบประเภทห้อง "${name}" ?\n\nข้อมูลประเภทห้องจะถูกลบออก (ห้องที่ใช้ประเภทนี้จะไม่ถูกลบ)`)) return;
  try {
    const res = await fetchWithTimeout(`/api/rooms/types/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    toast('ลบประเภทห้องสำเร็จ', 'success');
    await loadRoomTypesSettings();
    loadRoomTypes();
    loadRoomPriceTypes();
  } catch (e) {
    toast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
}

/* ===== CLOSE MODAL ON OVERLAY CLICK ===== */
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('show');
  });
});
