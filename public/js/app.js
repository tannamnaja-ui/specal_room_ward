/* ===== STATE ===== */
let allRooms = [];
let allRoomTypes = [];
let currentFloor = 'all';
let currentUser = null;
let assignWaitId = null;
let waitlistItems = [];
let currentWaitlistId = null;
const socket = io();

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
  const res = await fetch('/api/auth/me');
  const data = await res.json();
  if (!data.loggedIn) { location.href = '/login.html'; return; }
  currentUser = data.user;
  document.getElementById('sidebarUserName').textContent = data.user.name || data.user.login_name;
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
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
socket.on('room_updated', () => refreshAllData());
socket.on('waitlist_updated', () => refreshAllData());

/* ===== TAB NAVIGATION ===== */
const tabTitles = {
  dashboard:     '📊 แดชบอร์ดสถานะห้องพัก',
  wardpatients:  '🧑‍⚕️ รายชื่อคนไข้ที่นอนใน ward',
  specrooms:    '🏠 ห้องพิเศษทั้งหมด',
  booking:      '📝 ฟอร์มจองห้องพิเศษ',
  mywardbookings: '🗂️ คนไข้ที่ ward ท่านเป็นคนจอง',
  reservations: '📋 รายชื่อผู้จองห้องพิเศษ (ได้ห้องแล้ว รอเข้าพัก)',
  waitlist:     '⏳ คิวรอห้องพัก (จองคิวไว้ ยังไม่ได้ห้อง)',
  current:      '🛏️ ผู้พักและการจองปัจจุบัน',
  allrooms:     '🏨 ชื่อผู้จองและรอคิวทั้งหมด (รอจัดการ)',
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
      fetch('/api/rooms'),
      fetch('/api/rooms/stats')
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
    const res = await fetch('/api/rooms/types');
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
      await fetch(`/api/rooms/${room.id}/status`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:'available'}) });
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
  const booking = await fetch('/api/bookings').then(r=>r.json()).then(d=>d.bookings?.find(b=>b.room_id==room.id&&b.status==='occupied'));
  if (!booking) { toast('ไม่พบข้อมูลการจอง', 'error'); return; }
  await fetch(`/api/bookings/${booking.id}/pending-discharge`, { method:'PATCH' });
  closeModal('roomModal'); toast('อัปเดตสถานะ: รอจำหน่าย', 'success'); refreshAllData();
}

async function checkInByRoom(room) {
  const booking = await fetch('/api/bookings').then(r=>r.json()).then(d=>d.bookings?.find(b=>b.room_id==room.id&&b.status==='reserved'));
  if (!booking) { toast('ไม่พบข้อมูลการจอง', 'error'); return; }
  await fetch(`/api/bookings/${booking.id}/checkin`, { method:'PATCH' });
  closeModal('roomModal'); toast('Check-in เรียบร้อย', 'success'); refreshAllData();
}

async function checkOutByRoom(room) {
  if (!confirm(`ยืนยัน Check-out ห้อง ${room.room_number}?`)) return;
  const booking = await fetch('/api/bookings').then(r=>r.json()).then(d=>d.bookings?.find(b=>b.room_id==room.id&&b.status==='occupied'));
  if (!booking) { toast('ไม่พบข้อมูลการจอง', 'error'); return; }
  await fetch(`/api/bookings/${booking.id}/checkout`, { method:'PATCH' });
  closeModal('roomModal'); toast('Check-out เรียบร้อย ห้องอยู่ระหว่างทำความสะอาด', 'success'); refreshAllData();
}

async function cancelByRoom(room) {
  if (!confirm(`ยืนยันยกเลิกการจองห้อง ${room.room_number}?`)) return;
  const booking = await fetch('/api/bookings').then(r=>r.json()).then(d=>d.bookings?.find(b=>b.room_id==room.id&&b.status==='reserved'));
  if (!booking) { toast('ไม่พบข้อมูลการจอง', 'error'); return; }
  await fetch(`/api/bookings/${booking.id}/cancel`, { method:'PATCH' });
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
    const res  = await fetch('/api/bookings/his-wards');
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
    const res  = await fetch(`/api/bookings/his-roomtypes?${params}`);
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
    const res  = await fetch('/api/bookings/priority-types');
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
    const res  = await fetch(`/api/bookings/his-rooms?${params}`);
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
    const res  = await fetch(`/api/bookings/his-beds?${params}`);
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
    const res  = await fetch(`/api/bookings/patient-search?q=${encodeURIComponent(q)}`);
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
    const res = await fetch(`/api/bookings/admission-search?q=${encodeURIComponent(q)}`);
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
    const res  = await fetch(`/api/bookings/admission-search?q=${encodeURIComponent(q)}`);
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
    const res  = await fetch(`/api/bookings/info-by-an/${encodeURIComponent(an)}`);
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
    const [pRes, rRes] = await Promise.all([
      fetch(`/api/bookings/patient/${hn}`),
      fetch(`/api/bookings/rights/${hn}`)
    ]);
    const pData = await pRes.json();
    const rData = await rRes.json();

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
      toast(`พบข้อมูลผู้ป่วย: ${pData.patient.patient_name}`, 'success');
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

/* ===== ราคาห้องที่จอง (จาก room_types) ===== */
async function loadRoomPriceTypes() {
  const sel = document.getElementById('bnRoomPriceType');
  if (!sel) return;
  try {
    const res  = await fetch('/api/rooms/types');
    const data = await res.json();
    if (!data.success) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- เลือกประเภทห้อง/ราคา --</option>';
    const sorted = [...(data.types || [])].sort((a, b) => (+a.price_per_day) - (+b.price_per_day));
    sorted.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.type_name} ${(+t.price_per_day).toLocaleString('th-TH')} บาท`;
      sel.appendChild(opt);
    });
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  } catch(e) {}
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
    const res = await fetch('/api/bookings', {
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
  const priceTypeSel= document.getElementById('bnRoomPriceType');
  const priceTypeId = priceTypeSel?.value || null;
  const priceTypeName = priceTypeSel?.value ? (priceTypeSel.options[priceTypeSel.selectedIndex]?.text || null) : null;

  if (!hn) return toast('กรุณากรอก HN', 'warning');
  if (!patientName) return toast('กรุณาค้นหาข้อมูลผู้ป่วยก่อน', 'warning');

  showLoading(true);
  try {
    const res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hn, patient_name: patientName, room_type_id: priceTypeId,
        rights_type: rightsType, notes,
        an, ward,
        doctor_name: document.getElementById('bnDoctor').value.trim(),
        ward_code: wardCode, bedno,
        check_in_date: checkIn, check_out_date: checkOut,
        deposit_amount: deposit || 0,
        contact_name: contactName, contact_phone: contactPhone,
        priority_type: (document.getElementById('bnPriorityType') || {}).value || null,
        roomtype_code: roomtype || null,
        roomtype_name: priceTypeName,
        no_room_reason: noRoomReason
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
  const rpt = document.getElementById('bnRoomPriceType');
  if (rpt) rpt.value = '';
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
    const res = await fetch('/api/bookings');
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
    const res  = await fetch(`/api/bookings/${id}/checkin`, { method: 'PATCH' });
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
    const res = await fetch('/api/waitlist?all=true');
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
  await fetch(`/api/waitlist/${id}/cancel`, { method: 'PATCH' });
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
    const res = await fetch(`/api/waitlist/${assignWaitId}/confirm`, {
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
    const res  = await fetch('/api/bookings/occupants');
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
    const res  = await fetch(`/api/bookings/room-bookings/${encodeURIComponent(bedno)}`);
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
  const res = await fetch(`/api/bookings/${id}/pending-discharge`, { method: 'PATCH' });
  const data = await res.json();
  showLoading(false);
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) { refreshAllData(); }
}

async function doCheckin(id) {
  showLoading(true);
  const res = await fetch(`/api/bookings/${id}/checkin`, { method: 'PATCH' });
  const data = await res.json();
  showLoading(false);
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) { refreshAllData(); }
}

async function doCheckout(id) {
  if (!confirm('ยืนยัน Check-out?')) return;
  showLoading(true);
  const res = await fetch(`/api/bookings/${id}/checkout`, { method: 'PATCH' });
  const data = await res.json();
  showLoading(false);
  toast(data.message, data.success ? 'success' : 'error');
  if (data.success) { refreshAllData(); }
}

async function doCancel(id) {
  if (!confirm('ยืนยันยกเลิกการจอง?')) return;
  showLoading(true);
  const res = await fetch(`/api/bookings/${id}/cancel`, { method: 'PATCH' });
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
    const res = await fetch('/api/rooms/seed-demo', { method: 'POST' });
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
    const res  = await fetch('/api/bookings/allqueue');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    const waitItems = (data.waiting || []).map(w => ({
      _type: 'waiting', id: w.id,
      hn: w.hn, an: w.an, patient_name: w.patient_name,
      ward: w.ipt_ward_name || w.booked_ward || '-',
      room_number: '-',
      type_name: w.type_name || '-',
      rights_type: w.rights_type,
      date: w.request_date,
      check_in_date: w.check_in_date,
      rr_est_adm_date: w.rr_est_adm_date,
      notes: w.notes,
      status: 'waiting', priority_type: w.priority_type
    }));

    const reservedItems = (data.reserved || []).map(b => ({
      _type: 'reserved', id: b.id,
      hn: b.hn, an: b.an, patient_name: b.patient_name,
      ward: b.ipt_ward_name || b.booked_ward || '-',
      room_number: b.room_number,
      type_name: b.type_name || '-',
      rights_type: b.rights_type,
      date: b.check_in_date || b.created_at,
      check_in_date: b.check_in_date,
      rr_est_adm_date: b.rr_est_adm_date,
      notes: b.notes,
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
          ${th('วันที่จอง')}<th style="padding:10px 12px;text-align:center;border-bottom:1px solid #E0E0E0">สถานะ</th>
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
            <td style="padding:10px 12px">${escHtml(item.type_name||'-')}</td>
            <td style="padding:10px 12px">${escHtml(item.rights_type||'-')}</td>
            <td style="padding:10px 12px;font-size:12px;white-space:nowrap">${fmtDate(item.check_in_date || item.rr_est_adm_date)}</td>
            <td style="padding:10px 12px;font-size:12px;max-width:160px;white-space:normal;color:#546E7A">${escHtml(item.notes||'-')}</td>
            <td style="padding:10px 12px;font-size:12px;color:#546E7A;white-space:nowrap">${item.date ? item.date.replace('T',' ').slice(0,16) : '-'}</td>
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
      fetch('/api/rooms/hosbed'),
      fetch('/api/bookings/occupants')
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
    const res = await fetch('/api/bookings/ward-patients');
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

/* ===== MY WARD BOOKINGS (waiting_list.ward = ward ที่จอง) ===== */
let allMyWardBookings = [];
const MY_WARD_BOOKINGS_STORAGE_KEY = 'myWardBookingsWardFilter';
let myWardBookingsWardRestored = false;

async function loadMyWardBookings() {
  const container = document.getElementById('myWardBookingsContent');
  if (container) container.innerHTML = `<div class="empty-state"><div class="spinner" style="margin:0 auto"></div><p style="margin-top:12px">กำลังโหลด...</p></div>`;
  try {
    const res = await fetch('/api/waitlist?all=true');
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
          ${th('วันที่จะใช้ห้อง')}${th('วันที่จอง')}<th style="padding:10px 12px;text-align:center;border-bottom:1px solid #E0E0E0">สถานะ</th>
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
            <td style="padding:10px 12px">${escHtml(w.roomtype_name || w.type_name || '-')}</td>
            <td style="padding:10px 12px;font-size:12px;white-space:nowrap">${fmtDate(w.check_in_date)}</td>
            <td style="padding:10px 12px;font-size:12px;white-space:nowrap">${fmtDate(w.request_date)}</td>
            <td style="padding:10px 12px;text-align:center">${statusChip[w.status] || w.status || '-'}</td>
            <td style="padding:10px 12px;text-align:center">
              <button class="btn btn-secondary btn-sm" style="font-size:12px;padding:5px 10px"
                onclick="openEditPriceModal(${w.id},'${escAttr(w.patient_name || '')}',${w.room_type_id || 'null'})">
                ✏️ เปลี่ยนราคาห้องที่เลือก</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ===== EDIT PRICE MODAL ===== */
async function openEditPriceModal(id, patientName, roomTypeId) {
  document.getElementById('epId').value = id;
  document.getElementById('epPatientLabel').textContent = patientName ? `ผู้ป่วย: ${patientName}` : '';
  const sel = document.getElementById('epRoomPriceType');
  try {
    const res  = await fetch('/api/rooms/types');
    const data = await res.json();
    sel.innerHTML = '<option value="">-- เลือกประเภทห้อง/ราคา --</option>';
    if (data.success) {
      const sorted = [...(data.types || [])].sort((a, b) => (+a.price_per_day) - (+b.price_per_day));
      sorted.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.type_name} ${(+t.price_per_day).toLocaleString('th-TH')} บาท`;
        sel.appendChild(opt);
      });
    }
  } catch(e) {}
  sel.value = roomTypeId || '';
  document.getElementById('editPriceModal').classList.add('show');
}

async function saveEditPrice() {
  const id = document.getElementById('epId').value;
  const roomTypeId = document.getElementById('epRoomPriceType').value || null;
  try {
    const res = await fetch(`/api/waitlist/${id}/price`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_type_id: roomTypeId })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    toast('แก้ไขราคาห้องที่จองเรียบร้อย', 'success');
    closeModal('editPriceModal');
    loadMyWardBookings();
  } catch (e) {
    toast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
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
    cleaning: 'ทำความสะอาด', pending_discharge: 'รอจำหน่าย', unknown: 'ไม่ทราบ'
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

        html += `<div class="bed-box bed-${st}" onclick='openBedDetail(${JSON.stringify(bed).replace(/'/g,"&#39;")})' title="${bed.bedno} - ${label}${hasPatient ? '\n' + bed.patient_name : ''}">
          <div class="bed-status-dot"></div>
          ${priceHtml}
          <span class="bed-number">${bed.bedno}</span>
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
    cleaning:'ทำความสะอาด', pending_discharge:'รอจำหน่าย', unknown:'ไม่ทราบสถานะ'
  };
  const statusColor = {
    available:'#2E7D32', reserved:'#F57F17', occupied:'#C62828',
    cleaning:'#546E7A', pending_discharge:'#6A1B9A', unknown:'#9E9E9E'
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
  await fetch(`/api/rooms/${roomId}/status`, {
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
    const res  = await fetch('/api/rooms/his-priority-types');
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
    const res  = await fetch('/api/rooms/his-priority-types', {
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
    const res  = await fetch(`/api/rooms/his-priority-types/${id}`, { method: 'DELETE' });
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
    const res = await fetch('/api/rooms/his-reserve-statuses');
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
    const res = await fetch(`/api/rooms/his-reserve-statuses/${encodeURIComponent(id)}`, {
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
    const res = await fetch('/api/rooms/his-roomtypes');
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
    const res = await fetch(`/api/rooms/his-roomtypes/${encodeURIComponent(code)}`, {
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

async function loadRoomTypesSettings() {
  const wrap = document.getElementById('roomTypesTableWrap');
  wrap.innerHTML = '<div class="empty-state"><p>กำลังโหลด...</p></div>';
  try {
    const res = await fetch('/api/rooms/types');
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
    const res = await fetch(id ? `/api/rooms/types/${id}` : '/api/rooms/types', {
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
    const res = await fetch(`/api/rooms/types/${id}`, { method: 'DELETE' });
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
