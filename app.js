'use strict';

// ── STATE ──────────────────────────────────────────────────────────────
const state = {
  employees: [],
  schedules: {},
  weekStart: null,
  config: { base: 194, max: 225, ftMin: 34 },
  storeHours: [
    { open:'08:45', close:'19:00' }, // Sat
    { open:'09:30', close:'18:00' }, // Sun
    { open:'08:30', close:'19:00' }, // Mon
    { open:'08:30', close:'19:00' }, // Tue
    { open:'08:45', close:'19:00' }, // Wed
    { open:'08:30', close:'19:00' }, // Thu
    { open:'08:30', close:'19:00' }, // Fri
  ],
  nextId: 1,
};

let pickerCtx = null; // { empId, dayIdx }
let editingId  = null;

const DAYS      = ['Sat','Sun','Mon','Tue','Wed','Thu','Fri'];
const DAYS_FULL = ['Saturday','Sunday','Monday','Tuesday','Wednesday','Thursday','Friday'];

const PRESETS = [
  { lbl:'Open → Close',    start:'08:30', end:'19:00', cls:'cl' },
  { lbl:'Open → Close (W)',start:'08:45', end:'19:00', cls:'cl' },
  { lbl:'Open → Afternoon',start:'08:30', end:'16:00', cls:'op' },
  { lbl:'Open → Afternoon',start:'08:45', end:'16:15', cls:'op' },
  { lbl:'Late → Close',    start:'09:00', end:'19:00', cls:'cl' },
  { lbl:'Mid Shift',       start:'09:00', end:'17:00', cls:'md' },
  { lbl:'Short ★ till 1:30',start:'09:00',end:'13:30', cls:'sh' },
  { lbl:'Mid Shift',       start:'10:00', end:'17:00', cls:'md' },
  { lbl:'Sun Open→Close',  start:'09:30', end:'18:00', cls:'cl' },
  { lbl:'Sun Short ★',     start:'09:30', end:'13:30', cls:'sh' },
  { lbl:'Afternoon→Close', start:'11:00', end:'19:00', cls:'cl' },
  { lbl:'Half Day AM',     start:'08:30', end:'13:00', cls:'sh' },
];

// ── PERSIST ────────────────────────────────────────────────────────────
function save() {
  localStorage.setItem('rxsched_v3', JSON.stringify({
    employees: state.employees,
    schedules: state.schedules,
    config:    state.config,
    storeHours:state.storeHours,
    nextId:    state.nextId,
    weekISO:   state.weekStart?.toISOString() ?? null,
  }));
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem('rxsched_v3') || 'null');
    if (!d) return;
    if (d.employees)  state.employees  = d.employees;
    if (d.schedules)  state.schedules  = d.schedules;
    if (d.config)     Object.assign(state.config, d.config);
    if (d.storeHours) state.storeHours = d.storeHours;
    if (d.nextId)     state.nextId     = d.nextId;
    if (d.weekISO)    state.weekStart  = new Date(d.weekISO);
  } catch(e) { console.warn('load state failed', e); }
}

// ── DATE UTILS ─────────────────────────────────────────────────────────
function getSaturday(date) {
  const d = new Date(date); d.setHours(0,0,0,0);
  const day = d.getDay(); // 0=Sun … 6=Sat
  d.setDate(d.getDate() - (day === 6 ? 0 : day + 1));
  return d;
}
function addDays(d, n) { const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function fmtDate(d)    { return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
function weekKey()     { return state.weekStart.toISOString().slice(0,10); }
function weekDates()   { return DAYS.map((_,i)=>addDays(state.weekStart,i)); }

// ── SCHEDULE ACCESSORS ─────────────────────────────────────────────────
function getWS() {
  const k = weekKey();
  if (!state.schedules[k]) state.schedules[k] = {};
  return state.schedules[k];
}
function getShift(eid, d) { const ws=getWS(); return ws[eid]?.[d] ?? null; }
function setShift(eid, d, val) {
  const k = weekKey();
  if (!state.schedules[k]) state.schedules[k]={};
  if (!state.schedules[k][eid]) state.schedules[k][eid]={};
  if (val === null) delete state.schedules[k][eid][d];
  else state.schedules[k][eid][d] = val;
  save();
}

// ── TIME UTILS ─────────────────────────────────────────────────────────
function t2m(t) { const [h,m]=t.split(':').map(Number); return h*60+m; }
function fmt12(t) {
  const [h,m]=t.split(':').map(Number);
  const ap=h>=12?'pm':'am', h12=h%12||12;
  return m===0?`${h12}${ap}`:`${h12}:${String(m).padStart(2,'0')}${ap}`;
}
function calcHrs(s,e) {
  const raw=(t2m(e)-t2m(s))/60;
  return raw>=6 ? raw-0.5 : raw;
}
function isCloser(shift, di) {
  if (!shift) return false;
  return shift.end >= (state.storeHours[di]?.close || '19:00');
}
function isShort(shift) { return shift && shift.hrs <= 5; }

// ── TOTALS ─────────────────────────────────────────────────────────────
function empHrs(eid) {
  return Math.round(DAYS.reduce((s,_,i)=>{ const sh=getShift(eid,i); return s+(sh?.hrs??0); },0)*100)/100;
}
function totalHrs() { return state.employees.reduce((s,e)=>s+empHrs(e.id),0); }

// ── RENDER HELPERS ─────────────────────────────────────────────────────
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function shiftBlockHTML(emp, di, shift) {
  if (!shift) return `<div class="sb-blk empty" onclick="openPicker(${emp.id},${di})">+ Shift</div>`;
  const closer = isCloser(shift, di);
  const short  = isShort(shift);
  const tagCls = closer ? 'cl-s' : short ? 'sh-s' : '';
  const ptCls  = emp.type==='PT' ? 'pt-s' : '';
  const timeCls= closer ? 'cc' : short ? 'sc2' : emp.type==='PT' ? 'pc' : 'fc';
  const badge  = closer
    ? `<span class="sbdg cl" title="Closing shift">C</span>`
    : short ? `<span class="sbdg sh" title="Short shift">★</span>` : '';
  const mealNote = shift.hrs >= 6 ? '<span style="opacity:.5"> meal</span>' : '';
  return `<div class="sb-blk on ${tagCls} ${ptCls}" onclick="openPicker(${emp.id},${di})">
    ${badge}
    <div class="st ${timeCls}">${fmt12(shift.start)}–${fmt12(shift.end)}</div>
    <div class="sh">${shift.hrs.toFixed(1)}h${mealNote}</div>
  </div>`;
}

// ── RENDER: WEEK LABEL ─────────────────────────────────────────────────
function renderWeekLabel() {
  const dd = weekDates();
  document.getElementById('weekLbl').textContent = `${fmtDate(dd[0])} – ${fmtDate(dd[6])}`;
}

// ── RENDER: STORE HOURS ────────────────────────────────────────────────
function renderStoreHours() {
  document.getElementById('shGrid').innerHTML = DAYS.map((d,i)=>`
    <div class="sh-row">
      <span class="sh-day">${d}</span>
      <input class="sh-inp" type="time" value="${state.storeHours[i].open}"
        oninput="state.storeHours[${i}].open=this.value;save();renderTable()">
      <input class="sh-inp" type="time" value="${state.storeHours[i].close}"
        oninput="state.storeHours[${i}].close=this.value;save();renderTable()">
    </div>`).join('');
}

// ── RENDER: BUDGET ─────────────────────────────────────────────────────
function renderBudget() {
  const tot  = totalHrs();
  const base = state.config.base;
  const max  = state.config.max;
  const pct  = base>0 ? Math.round(tot/base*100) : 0;
  const cls  = tot>max ? 'over' : tot>base ? 'warn' : 'ok';

  document.getElementById('bPct').textContent  = `${pct}%`;
  document.getElementById('bPct').className    = `bgt-pct ${cls}`;
  document.getElementById('bBar').style.width  = `${Math.min(100,(tot/max)*100)}%`;
  document.getElementById('bBar').className    = `bgt-bar${cls!=='ok'?' '+cls:''}`;
  document.getElementById('bSched').textContent = `${tot.toFixed(1)} h`;
  document.getElementById('bBase').textContent  = `${base.toFixed(1)} h`;
  document.getElementById('bMax').textContent   = `${max.toFixed(1)} h`;
}

// ── RENDER: EMPLOYEE SIDEBAR ───────────────────────────────────────────
function renderSidebar() {
  document.getElementById('empCnt').textContent = state.employees.length;
  if (!state.employees.length) {
    document.getElementById('empList').innerHTML = `<div class="empty">
      <div class="empty-ico">👤</div>
      <div class="empty-txt">No employees yet.<br>Click "+ Add Employee".</div></div>`;
    return;
  }
  document.getElementById('empList').innerHTML = state.employees.map(e=>{
    const h   = empHrs(e.id);
    const min = e.type==='FT' ? state.config.ftMin : 0;
    const cls = h>=e.targetHrs ? 'ok' : h>=min ? 'low' : 'over';
    return `<div class="emp-card">
      <div class="emp-dot ${e.type.toLowerCase()}"></div>
      <div class="emp-info">
        <div class="emp-name">${esc(e.name)}</div>
        <div class="emp-meta">${e.type} · ${e.targetHrs}h${e.role?' · '+esc(e.role):''}</div>
      </div>
      <div class="emp-chip ${cls}">${h.toFixed(1)}h</div>
      <div class="emp-acts">
        <button class="btn btn-ghost btn-ico btn-sm" title="Edit" onclick="openEmpModal(${e.id})">✏️</button>
        <button class="btn btn-danger btn-ico btn-sm" title="Delete" onclick="delEmp(${e.id})">🗑</button>
      </div>
    </div>`;
  }).join('');
}

// ── RENDER: COVERAGE BAR ───────────────────────────────────────────────
function renderCoverage() {
  const dd = weekDates();
  document.getElementById('covBar').innerHTML = DAYS.map((day,i)=>{
    const onFloor = state.employees.filter(e=>getShift(e.id,i)?.hrs>0);
    const cnt     = onFloor.length;
    const closers = onFloor.filter(e=>isCloser(getShift(e.id,i),i));
    const shorts  = onFloor.filter(e=>isShort(getShift(e.id,i)));
    const cls     = cnt===0?'low':cnt<2?'warn':'ok';
    const tags    = [
      closers.length?`<div class="cov-tag closer">🔐 ${closers.map(e=>e.name.split(' ')[0]).join(', ')}</div>`:'',
      shorts.length ?`<div class="cov-tag short">★ ${shorts.map(e=>e.name.split(' ')[0]).join(', ')}</div>`:'',
    ].join('');
    return `<div class="cov-card">
      <div class="cov-day">${day}</div>
      <div class="cov-cnt ${cls}">${cnt}</div>
      <div class="cov-date">${fmtDate(dd[i])}</div>
      ${tags?`<div class="cov-tags">${tags}</div>`:''}
    </div>`;
  }).join('');
}

// ── RENDER: SCHEDULE TABLE ─────────────────────────────────────────────
function renderTable() {
  const dd = weekDates();
  document.getElementById('thead').innerHTML = `<tr>
    <th style="min-width:140px">Employee</th>
    ${DAYS.map((d,i)=>`<th class="dc">${d}<br><span style="font-weight:400;color:var(--text3);font-size:9.5px">${fmtDate(dd[i])}</span></th>`).join('')}
    <th style="text-align:center;min-width:65px">Total</th></tr>`;

  if (!state.employees.length) {
    document.getElementById('tbody').innerHTML = `<tr><td colspan="9">
      <div class="empty"><div class="empty-ico">📅</div>
      <div class="empty-txt">Add employees to build the schedule.</div></div></td></tr>`;
    return;
  }

  document.getElementById('tbody').innerHTML = state.employees.map(e=>{
    const h   = empHrs(e.id);
    const min = e.type==='FT' ? state.config.ftMin : 0;
    const cls = h>=e.targetHrs?'ok':h>=min?'warn':'low';
    const days = DAYS.map((_,i)=>`<td class="sc">${shiftBlockHTML(e,i,getShift(e.id,i))}</td>`).join('');
    return `<tr>
      <td class="ec"><div class="en">${esc(e.name)}</div><span class="et ${e.type.toLowerCase()}">${e.type}</span></td>
      ${days}
      <td class="etot ${cls}">${h.toFixed(1)}h</td></tr>`;
  }).join('');
}

function renderAll() {
  renderWeekLabel();
  renderStoreHours();
  renderSidebar();
  renderCoverage();
  renderTable();
  renderBudget();
}

// ── WEEK NAV ───────────────────────────────────────────────────────────
function changeWeek(dir) {
  state.weekStart = addDays(state.weekStart, dir*7);
  save(); renderAll();
}

// ── CLEAR / EXPORT ─────────────────────────────────────────────────────
function clearWeek() {
  if (!confirm('Clear all shifts for this week?')) return;
  state.schedules[weekKey()] = {};
  save(); renderAll();
  toast('Week cleared.','info');
}

function exportCSV() {
  const dd  = weekDates();
  const hdr = ['Employee','Type',...DAYS.map((d,i)=>`${d} ${fmtDate(dd[i])}`),'Total Hours'];
  const rows= state.employees.map(e=>{
    const days= DAYS.map((_,i)=>{ const s=getShift(e.id,i); return s?`${fmt12(s.start)}-${fmt12(s.end)} (${s.hrs.toFixed(1)}h)`:'OFF'; });
    return [e.name,e.type,...days,empHrs(e.id).toFixed(1)];
  });
  const csv = [hdr,...rows].map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');
  const a   = Object.assign(document.createElement('a'),{
    href: URL.createObjectURL(new Blob([csv],{type:'text/csv'})),
    download:`pharmacy_schedule_${weekKey()}.csv`
  });
  a.click(); toast('CSV exported!','success');
}

// ── EMPLOYEE MODAL ─────────────────────────────────────────────────────
function openEmpModal(id=null) {
  editingId = id;
  const e = id ? state.employees.find(x=>x.id===id) : null;
  document.getElementById('empModalTitle').textContent = id ? 'Edit Employee' : 'Add Employee';
  document.getElementById('eName').value  = e?.name      ?? '';
  document.getElementById('eTgt').value   = e?.targetHrs ?? 34;
  document.getElementById('eMin').value   = e?.minHrs    ?? 34;
  document.getElementById('eRole').value  = e?.role      ?? '';
  selectType(e?.type ?? 'FT', false);
  document.getElementById('empOv').classList.add('open');
  setTimeout(()=>document.getElementById('eName').focus(),80);
}
function closeEmpModal() { document.getElementById('empOv').classList.remove('open'); editingId=null; }

function selectType(type, update=true) {
  const ft=document.getElementById('tFT'), pt=document.getElementById('tPT');
  ft.className=`ropt${type==='FT'?' sel ft':''}`;
  pt.className=`ropt${type==='PT'?' sel pt':''}`;
  ft.dataset.sel=type==='FT'?'1':''; pt.dataset.sel=type==='PT'?'1':'';
  if (update) {
    document.getElementById('eTgt').value = type==='FT'?34:25;
    document.getElementById('eMin').value = type==='FT'?34:0;
  }
}
function getType() { return document.getElementById('tFT').dataset.sel?'FT':'PT'; }

function saveEmp() {
  const name = document.getElementById('eName').value.trim();
  if (!name) { toast('Please enter a name.','error'); return; }
  const emp = {
    id:        editingId || state.nextId++,
    name,
    type:      getType(),
    targetHrs: parseFloat(document.getElementById('eTgt').value) || 34,
    minHrs:    parseFloat(document.getElementById('eMin').value) || 0,
    role:      document.getElementById('eRole').value.trim(),
  };
  if (editingId) {
    const i=state.employees.findIndex(e=>e.id===editingId);
    if (i>-1) state.employees[i]=emp;
    toast(`Updated ${emp.name}`,'success');
  } else {
    state.employees.push(emp);
    toast(`Added ${emp.name}`,'success');
  }
  save(); closeEmpModal(); renderAll();
}

function delEmp(id) {
  const e=state.employees.find(x=>x.id===id);
  if (!e || !confirm(`Delete ${e.name}? All their shifts will be removed.`)) return;
  state.employees=state.employees.filter(x=>x.id!==id);
  Object.keys(state.schedules).forEach(k=>delete state.schedules[k][id]);
  save(); toast(`Removed ${e.name}`,'info'); renderAll();
}

// ── SHIFT PICKER ────────────────────────────────────────────────────────
function openPicker(eid, di) {
  pickerCtx = { eid, di };
  const e   = state.employees.find(x=>x.id===eid);
  document.getElementById('shiftModalTitle').textContent = `${e.name} — ${DAYS_FULL[di]}`;

  const open  = state.storeHours[di].open;
  const close = state.storeHours[di].close;
  document.getElementById('cStart').value = open;
  document.getElementById('cEnd').value   = close;

  document.getElementById('presetGrid').innerHTML = PRESETS.map(p=>{
    const h=calcHrs(p.start,p.end);
    return `<button class="prs ${p.cls}" onclick="applyPreset('${p.start}','${p.end}')">
      <div class="prs-lbl">${p.lbl}</div>
      <div class="prs-time">${fmt12(p.start)} – ${fmt12(p.end)}</div>
      <div class="prs-hrs">${h.toFixed(1)}h${h>=6?' (w/meal)':''}</div>
    </button>`;
  }).join('');

  document.getElementById('shiftOv').classList.add('open');
}
function closePicker() { document.getElementById('shiftOv').classList.remove('open'); pickerCtx=null; }

function applyPreset(s,e) {
  if (!pickerCtx) return;
  setShift(pickerCtx.eid, pickerCtx.di, {start:s, end:e, hrs:calcHrs(s,e)});
  closePicker(); renderAll();
}
function applyCustom() {
  if (!pickerCtx) return;
  const s=document.getElementById('cStart').value, e=document.getElementById('cEnd').value;
  if (!s||!e) { toast('Enter both times.','error'); return; }
  if (t2m(e)<=t2m(s)) { toast('End must be after start.','error'); return; }
  setShift(pickerCtx.eid, pickerCtx.di, {start:s, end:e, hrs:calcHrs(s,e)});
  closePicker(); renderAll();
}
function setOff() {
  if (!pickerCtx) return;
  setShift(pickerCtx.eid, pickerCtx.di, null);
  closePicker(); renderAll();
}

// ── CONFIG ─────────────────────────────────────────────────────────────
function syncConfig() {
  state.config.base  = parseFloat(document.getElementById('cfgBase').value)  || 194;
  state.config.max   = parseFloat(document.getElementById('cfgMax').value)   || 225;
  state.config.ftMin = parseFloat(document.getElementById('cfgFTMin').value) || 34;
  save(); renderAll();
}

// ── TOAST ───────────────────────────────────────────────────────────────
function toast(msg, type='info') {
  const ct = document.getElementById('toastCt');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${{success:'✓',error:'✕',info:'ℹ'}[type]||'ℹ'}</span><span>${msg}</span>`;
  ct.appendChild(el);
  setTimeout(()=>el.remove(), 3100);
}

// ── KEYBOARD ───────────────────────────────────────────────────────────
document.addEventListener('keydown', e=>{
  if (e.key==='Escape') { closePicker(); closeEmpModal(); }
});

// Close overlays on bg click
['empOv','shiftOv'].forEach(id=>{
  document.getElementById(id).addEventListener('click', function(e){ if(e.target===this) { closePicker(); closeEmpModal(); } });
});

// ── INIT ────────────────────────────────────────────────────────────────
(function init() {
  load();
  if (!state.weekStart) state.weekStart = getSaturday(new Date());

  // Sync config inputs
  document.getElementById('cfgBase').value  = state.config.base;
  document.getElementById('cfgMax').value   = state.config.max;
  document.getElementById('cfgFTMin').value = state.config.ftMin;

  // Seed employees if none
  if (!state.employees.length) {
    [
      { name:'Jennifer R.', type:'FT', targetHrs:34, minHrs:34, role:'Pharm Tech' },
      { name:'Anna S.',     type:'FT', targetHrs:34, minHrs:34, role:'Pharm Tech' },
      { name:'Allison W.',  type:'FT', targetHrs:34, minHrs:34, role:'Pharm Tech' },
      { name:'Karta P.',    type:'FT', targetHrs:34, minHrs:34, role:'Pharm Tech' },
      { name:'Marshall B.', type:'FT', targetHrs:34, minHrs:34, role:'Pharm Tech' },
      { name:'PT Tech 1',   type:'PT', targetHrs:27, minHrs:0,  role:'Pharm Tech' },
      { name:'PT Tech 2',   type:'PT', targetHrs:25, minHrs:0,  role:'Pharm Tech' },
      { name:'PT Tech 3',   type:'PT', targetHrs:13, minHrs:0,  role:'Pharm Tech' },
    ].forEach(e=>state.employees.push({id:state.nextId++, ...e}));
    save();
  }

  renderAll();
})();
