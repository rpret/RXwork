'use strict';

// ── STATE ──────────────────────────────────────────────────────────────
const state = {
  employees: [],
  schedules: {},
  weekStart: null,
  config: { base: 194, max: 225, ftMin: 34, ftTarget: 34, ptTarget: 25 },
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

let pickerCtx = null;
let editingId  = null;

const DAYS      = ['Sat','Sun','Mon','Tue','Wed','Thu','Fri'];
const DAYS_FULL = ['Saturday','Sunday','Monday','Tuesday','Wednesday','Thursday','Friday'];
const IS_WEEKEND = [true, true, false, false, false, false, false];

const PRESETS = [
  { lbl:'Open → Close',     start:'08:30', end:'19:00', cls:'cl' },
  { lbl:'Open → Close (W)', start:'08:45', end:'19:00', cls:'cl' },
  { lbl:'Open → Afternoon', start:'08:30', end:'16:00', cls:'op' },
  { lbl:'Open → Afternoon', start:'08:45', end:'16:15', cls:'op' },
  { lbl:'Late → Close',     start:'09:00', end:'19:00', cls:'cl' },
  { lbl:'Mid Shift',        start:'09:00', end:'17:00', cls:'md' },
  { lbl:'Short ★ till 1:30',start:'09:00', end:'13:30', cls:'sh' },
  { lbl:'Mid Shift',        start:'10:00', end:'17:00', cls:'md' },
  { lbl:'Sun Open→Close',   start:'09:30', end:'18:00', cls:'cl' },
  { lbl:'Sun Short ★',      start:'09:30', end:'13:30', cls:'sh' },
  { lbl:'Afternoon→Close',  start:'11:00', end:'19:00', cls:'cl' },
  { lbl:'Half Day AM',      start:'08:30', end:'13:00', cls:'sh' },
];

// ── PERSIST ─────────────────────────────────────────────────────────────
function save() {
  localStorage.setItem('rxsched_v4', JSON.stringify({
    employees:  state.employees,
    schedules:  state.schedules,
    config:     state.config,
    storeHours: state.storeHours,
    nextId:     state.nextId,
    weekISO:    state.weekStart?.toISOString() ?? null,
  }));
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem('rxsched_v4') || 'null');
    if (!d) return;
    if (d.employees)  state.employees  = d.employees;
    if (d.schedules)  state.schedules  = d.schedules;
    if (d.config)     Object.assign(state.config, d.config);
    if (d.storeHours) state.storeHours = d.storeHours;
    if (d.nextId)     state.nextId     = d.nextId;
    if (d.weekISO)    state.weekStart  = new Date(d.weekISO);
  } catch(e) { console.warn('load failed', e); }
}

// ── DATE UTILS ───────────────────────────────────────────────────────────
function getSaturday(date) {
  const d = new Date(date); d.setHours(0,0,0,0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 6 ? 0 : day + 1));
  return d;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function fmtDate(d)    { return d.toLocaleDateString('en-US', { month:'short', day:'numeric' }); }
function weekKey()     { return state.weekStart.toISOString().slice(0,10); }
function weekDates()   { return DAYS.map((_,i) => addDays(state.weekStart, i)); }

// ── SCHEDULE ACCESSORS ───────────────────────────────────────────────────
function getWS() {
  const k = weekKey();
  if (!state.schedules[k]) state.schedules[k] = {};
  return state.schedules[k];
}
function getShift(eid, d) { const ws = getWS(); return ws[eid]?.[d] ?? null; }
function setShift(eid, d, val) {
  const k = weekKey();
  if (!state.schedules[k]) state.schedules[k] = {};
  if (!state.schedules[k][eid]) state.schedules[k][eid] = {};
  if (val === null) delete state.schedules[k][eid][d];
  else state.schedules[k][eid][d] = val;
  save();
}

// ── TIME UTILS ───────────────────────────────────────────────────────────
function t2m(t)  { const [h,m] = t.split(':').map(Number); return h*60+m; }
function m2t(m)  { return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`; }
function fmt12(t) {
  const [h,m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am', h12 = h%12||12;
  return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2,'0')}${ap}`;
}
function calcHrs(s, e) { const raw = (t2m(e)-t2m(s))/60; return raw >= 6 ? raw-0.5 : raw; }
function isCloser(shift, di) { return shift && shift.end >= (state.storeHours[di]?.close || '19:00'); }
function isShort(shift)      { return shift && shift.hrs <= 5; }

// ── TOTALS ────────────────────────────────────────────────────────────────
function empHrs(eid) {
  return Math.round(DAYS.reduce((s,_,i) => { const sh = getShift(eid,i); return s+(sh?.hrs??0); }, 0)*100)/100;
}
function totalHrs() { return state.employees.reduce((s,e) => s+empHrs(e.id), 0); }

// ── UTILS ─────────────────────────────────────────────────────────────────
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ═══════════════════════════════════════════════════════════════════════════
// ── AUTO-SCHEDULER ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

function buildAutoSchedule(params) {
  /*
    Rules applied:
    1. Priority conflict → detected after build, user asked what to cut
    2. Weekend closers  → 1 required, 2 preferred (soft target)
    3. Days off         → unconstrained, just hit hour targets
  */
  const { budget, ftHours, ptHours, morningStaff, afternoonStaff,
          closersPerDayWkdy, closersPerDayWknd, shortWeekend } = params;

  const FTs = state.employees.filter(e => e.type === 'FT');
  const PTs = state.employees.filter(e => e.type === 'PT');
  const all = [...FTs, ...PTs];

  const k = weekKey();
  state.schedules[k] = {};

  // ── Shift templates derived from store hours ─────────────────────────
  function mkShift(start, end) { return { start, end, hrs: calcHrs(start, end) }; }

  function shiftsForDay(di) {
    const open = state.storeHours[di].open, close = state.storeHours[di].close;
    const openM = t2m(open), closeM = t2m(close);
    const storeLen = closeM - openM;
    const midStart = m2t(openM + Math.round(storeLen * 0.35 / 30) * 30);
    const midEnd   = m2t(openM + Math.round(storeLen * 0.75 / 30) * 30);
    return {
      closer:     mkShift(open,  close),
      lateCloser: mkShift(m2t(openM + 30), close),
      opener:     mkShift(open,  m2t(Math.min(openM + 7*60, closeM - 60))),
      mid:        mkShift(midStart, midEnd),
      short:      mkShift(m2t(openM + 15), m2t(openM + 15 + 4*60)),
    };
  }

  // ── Tracking ─────────────────────────────────────────────────────────
  const assignedDays = {}; all.forEach(e => assignedDays[e.id] = []);
  const accHrs = {};       all.forEach(e => accHrs[e.id] = 0);

  function assign(emp, di, shift) {
    if (!state.schedules[k][emp.id]) state.schedules[k][emp.id] = {};
    state.schedules[k][emp.id][di] = shift;
    assignedDays[emp.id].push(di);
    accHrs[emp.id] = Math.round((accHrs[emp.id] + shift.hrs) * 100) / 100;
  }
  const isAssigned = (emp, di) => assignedDays[emp.id].includes(di);
  const daysWorked = (emp) => assignedDays[emp.id].length;
  const targetHrs  = (emp) => emp.type === 'FT' ? ftHours : ptHours;
  const hrsLeft    = (emp) => targetHrs(emp) - accHrs[emp.id];

  // Sorted by fewest days worked (fair rotation), then by hour deficit
  function sorted(pool) {
    return [...pool].sort((a, b) =>
      daysWorked(a) - daysWorked(b) || hrsLeft(b) - hrsLeft(a)
    );
  }

  // ── PASS 1: Weekend short ★ shifts ───────────────────────────────────
  if (shortWeekend) {
    for (const di of [0, 1]) { // Sat=0, Sun=1
      const tmpl = shiftsForDay(di);
      // Prefer PT for short shifts; fall back to FT
      const cands = [...sorted(PTs), ...sorted(FTs)]
        .filter(e => !isAssigned(e, di) && hrsLeft(e) >= tmpl.short.hrs);
      if (cands.length) assign(cands[0], di, tmpl.short);
    }
  }

  // ── PASS 2: Assign closers (required minimums first, then preferred) ──
  for (let di = 0; di < 7; di++) {
    const tmpl = shiftsForDay(di);
    const isWknd = IS_WEEKEND[di];
    // Required = 1 for weekends, closersPerDayWkdy for weekdays
    const required  = isWknd ? 1 : closersPerDayWkdy;
    const preferred = isWknd ? closersPerDayWknd : closersPerDayWkdy;

    let assigned = 0;
    for (let pass = 0; pass < preferred; pass++) {
      const isSoft = pass >= required; // 2nd closer on weekend is soft
      const cands = sorted([...FTs, ...PTs]).filter(e =>
        !isAssigned(e, di) && hrsLeft(e) >= tmpl.closer.hrs - 0.5
      );
      if (!cands.length) {
        if (!isSoft) {
          // Required closer not filled — flag for conflict resolution later
          params._conflicts = params._conflicts || [];
          params._conflicts.push({ type: 'closer', di, required: true });
        }
        break;
      }
      assign(cands[0], di, tmpl.closer);
      assigned++;
    }
  }

  // ── PASS 3: Fill morning + afternoon coverage slots ───────────────────
  for (let di = 0; di < 7; di++) {
    const tmpl = shiftsForDay(di);
    const slotsNeeded = morningStaff + afternoonStaff;
    const filled = all.filter(e => isAssigned(e, di)).length;
    const stillNeeded = Math.max(0, slotsNeeded - filled);

    for (let s = 0; s < stillNeeded; s++) {
      const cands = sorted([...FTs, ...PTs]).filter(e =>
        !isAssigned(e, di) && hrsLeft(e) >= 3
      );
      if (!cands.length) break;
      const emp = cands[0];
      // Morning slots get opener shift, afternoon slots get mid
      const shift = s < morningStaff ? tmpl.opener : tmpl.mid;
      assign(emp, di, shift);
    }
  }

  // ── PASS 4: Top-up hours toward each person's target ─────────────────
  // Sort all employees by how far below target they are (biggest gap first)
  const byGap = [...all].sort((a, b) => hrsLeft(b) - hrsLeft(a));
  const dayOrder = [2, 3, 4, 5, 6, 0, 1]; // weekdays first, weekend last

  for (const emp of byGap) {
    for (const di of dayOrder) {
      if (isAssigned(emp, di)) continue;
      const budgetRemaining = budget - all.reduce((s, e) => s + accHrs[e.id], 0);
      const myLeft = hrsLeft(emp);
      if (myLeft < 1 || budgetRemaining < 1) break;

      const tmpl = shiftsForDay(di);
      let shift;
      if (myLeft >= tmpl.closer.hrs - 0.5)      shift = tmpl.closer;
      else if (myLeft >= tmpl.opener.hrs - 0.5)  shift = tmpl.opener;
      else if (myLeft >= tmpl.mid.hrs - 0.5)     shift = tmpl.mid;
      else                                        shift = tmpl.short;

      // Don't assign if it would blow the budget
      if (accHrs[emp.id] + shift.hrs > budget - all.reduce((s,e)=>s+(e===emp?0:accHrs[e.id]),0) + 0.5) break;
      assign(emp, di, shift);
    }
  }

  save();
  renderAll();

  // ── POST-BUILD: detect conflicts and ask Larisa ───────────────────────
  const total = all.reduce((s, e) => s + accHrs[e.id], 0);
  const conflicts = [];

  // Check FT minimums
  FTs.forEach(e => {
    if (accHrs[e.id] < state.config.ftMin) {
      conflicts.push({ emp: e, got: accHrs[e.id], target: ftHours, type: 'ft-low' });
    }
  });
  // Check PT targets
  PTs.forEach(e => {
    if (accHrs[e.id] < ptHours - 2) {
      conflicts.push({ emp: e, got: accHrs[e.id], target: ptHours, type: 'pt-low' });
    }
  });
  // Check budget
  if (total > budget) {
    conflicts.push({ type: 'over-budget', got: total, target: budget });
  }
  // Check required weekend closers
  (params._conflicts || []).forEach(c => conflicts.push(c));

  if (conflicts.length > 0) {
    // Show conflict resolution dialog
    setTimeout(() => showConflictDialog(conflicts, params), 300);
  } else {
    toast(`✓ Schedule built! ${total.toFixed(1)}h / ${budget}h`, 'success');
  }
}

// ── CONFLICT RESOLUTION DIALOG ────────────────────────────────────────────
function showConflictDialog(conflicts, params) {
  const ov = document.getElementById('conflictOv');
  const body = document.getElementById('conflictBody');

  const total = totalHrs();
  const budget = params.budget;

  let html = `<div class="wiz-info" style="margin-bottom:14px">
    The auto-scheduler built the best schedule it could, but ran into <strong>${conflicts.length} issue${conflicts.length>1?'s':''}</strong>.
    Review each one and decide how to handle it.
  </div>`;

  conflicts.forEach((c, idx) => {
    if (c.type === 'ft-low') {
      const short = (c.target - c.got).toFixed(1);
      html += `<div class="conflict-card">
        <div class="conflict-icon">⚠️</div>
        <div class="conflict-detail">
          <strong>${esc(c.emp.name)}</strong> (FT) got <span class="red">${c.got.toFixed(1)}h</span>
          — needs <strong>${c.target}h</strong> target (${short}h short)
        </div>
        <div class="conflict-actions">
          <button class="btn btn-ghost btn-sm" onclick="conflictAccept(${idx})">Accept shortfall</button>
          <button class="btn btn-primary btn-sm" onclick="openPicker(${c.emp.id}, -1); closeConflictDialog()">Edit manually</button>
        </div>
      </div>`;
    } else if (c.type === 'pt-low') {
      const short = (c.target - c.got).toFixed(1);
      html += `<div class="conflict-card">
        <div class="conflict-icon">ℹ️</div>
        <div class="conflict-detail">
          <strong>${esc(c.emp.name)}</strong> (PT) got <span class="yellow">${c.got.toFixed(1)}h</span>
          — target was <strong>${c.target}h</strong> (${short}h short)
        </div>
        <div class="conflict-actions">
          <button class="btn btn-ghost btn-sm" onclick="conflictAccept(${idx})">Accept shortfall</button>
          <button class="btn btn-ghost btn-sm" onclick="closeConflictDialog()">Edit manually</button>
        </div>
      </div>`;
    } else if (c.type === 'over-budget') {
      html += `<div class="conflict-card">
        <div class="conflict-icon">🔴</div>
        <div class="conflict-detail">
          Total scheduled: <span class="red">${c.got.toFixed(1)}h</span>
          — budget is <strong>${c.target}h</strong> (${(c.got-c.target).toFixed(1)}h over)
        </div>
        <div class="conflict-actions">
          <button class="btn btn-ghost btn-sm" onclick="conflictAccept(${idx})">Accept overage</button>
          <button class="btn btn-danger btn-sm" onclick="closeConflictDialog()">Edit manually</button>
        </div>
      </div>`;
    } else if (c.type === 'closer') {
      html += `<div class="conflict-card">
        <div class="conflict-icon">🔐</div>
        <div class="conflict-detail">
          <strong>${DAYS_FULL[c.di]}</strong> — could not fill a required closer slot
          (no available employee had enough hours left)
        </div>
        <div class="conflict-actions">
          <button class="btn btn-ghost btn-sm" onclick="conflictAccept(${idx})">Skip this day</button>
          <button class="btn btn-ghost btn-sm" onclick="closeConflictDialog()">Fix manually</button>
        </div>
      </div>`;
    }
  });

  html += `<div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
    <button class="btn btn-ghost" onclick="closeConflictDialog()">Close &amp; edit manually</button>
    <button class="btn btn-success" onclick="conflictAcceptAll()">Accept all &amp; finish</button>
  </div>`;

  body.innerHTML = html;
  ov.classList.add('open');
}

let _resolvedConflicts = new Set();
function conflictAccept(idx) {
  _resolvedConflicts.add(idx);
  const card = document.querySelectorAll('.conflict-card')[idx];
  if (card) {
    card.style.opacity = '0.4';
    card.style.pointerEvents = 'none';
    card.querySelector('.conflict-actions').innerHTML = '<span style="color:var(--green);font-size:12px">✓ Accepted</span>';
  }
}
function conflictAcceptAll() {
  closeConflictDialog();
  const total = totalHrs();
  toast(`Schedule finalised — ${total.toFixed(1)}h scheduled.`, 'success');
}
function closeConflictDialog() {
  document.getElementById('conflictOv').classList.remove('open');
  _resolvedConflicts = new Set();
  const total = totalHrs();
  toast(`Schedule built — ${total.toFixed(1)}h. Click any cell to edit.`, 'info');
}

// ── AUTO-BUILD WIZARD ────────────────────────────────────────────────────
let wizardStep = 0;
let wizardParams = {};

function openBuildWizard() {
  if (state.employees.length === 0) {
    toast('Add employees before building a schedule.', 'error');
    return;
  }
  wizardStep = 0;
  wizardParams = {};
  showWizardStep(0);
  document.getElementById('buildOv').classList.add('open');
}
function closeBuildWizard() {
  document.getElementById('buildOv').classList.remove('open');
}

function showWizardStep(step) {
  const FTs = state.employees.filter(e => e.type === 'FT');
  const PTs = state.employees.filter(e => e.type === 'PT');

  const steps = [
    {
      title: '🗓 Step 1 of 4 — Budget',
      html: `
        <div class="wiz-info">Set the total hour budget for this week. Shifts will be assigned to stay within this limit.</div>
        <div class="fg">
          <label class="fl">Total Hour Budget (max hours to schedule)</label>
          <input class="fi" id="wBudget" type="number" min="1" value="${state.config.max}" step="1">
        </div>
        <div class="wiz-chips">
          <div class="wiz-chip" onclick="document.getElementById('wBudget').value=${state.config.base}">Base: ${state.config.base}h</div>
          <div class="wiz-chip" onclick="document.getElementById('wBudget').value=${state.config.max}">Max: ${state.config.max}h</div>
          <div class="wiz-chip" onclick="document.getElementById('wBudget').value=${Math.round(state.config.max*1.05)}">+5%: ${Math.round(state.config.max*1.05)}h</div>
        </div>`,
      next: () => {
        const v = parseFloat(document.getElementById('wBudget').value);
        if (!v || v < 1) { toast('Enter a valid budget.', 'error'); return false; }
        wizardParams.budget = v;
        return true;
      }
    },
    {
      title: '👥 Step 2 of 4 — Daily Coverage',
      html: `
        <div class="wiz-info">How many techs do you need on the floor at once? Sets minimum coverage slots per day.</div>
        <div class="frow">
          <div class="fg">
            <label class="fl">Morning staff per day</label>
            <input class="fi" id="wMorn" type="number" min="1" max="8" value="2">
          </div>
          <div class="fg">
            <label class="fl">Afternoon staff per day</label>
            <input class="fi" id="wAfter" type="number" min="1" max="8" value="2">
          </div>
        </div>
        <div class="frow" style="margin-top:2px">
          <div class="fg">
            <label class="fl">Closers — weekdays</label>
            <input class="fi" id="wCloseWkdy" type="number" min="1" max="4" value="2">
          </div>
          <div class="fg">
            <label class="fl">Closers — weekends</label>
            <input class="fi" id="wCloseWknd" type="number" min="1" max="4" value="2">
            <div class="wiz-note" style="margin-top:4px">Min 1 required, 2 preferred</div>
          </div>
        </div>
        <div class="wiz-note" style="margin-top:8px">💡 A short ★ shift till ~1:30pm will be auto-added on Sat &amp; Sun.</div>`,
      next: () => {
        wizardParams.morningStaff      = parseInt(document.getElementById('wMorn').value)      || 2;
        wizardParams.afternoonStaff    = parseInt(document.getElementById('wAfter').value)     || 2;
        wizardParams.closersPerDayWkdy = parseInt(document.getElementById('wCloseWkdy').value) || 2;
        wizardParams.closersPerDayWknd = parseInt(document.getElementById('wCloseWknd').value) || 2;
        wizardParams.shortWeekend      = true;
        return true;
      }
    },
    {
      title: '⏱ Step 3 of 4 — Hours per Employee',
      html: `
        <div class="wiz-info">Set target hours per employee type. The scheduler fills FT minimums first, then distributes remaining budget to PT staff.</div>
        <div class="frow">
          <div class="fg">
            <label class="fl">Full-Time target hours</label>
            <input class="fi" id="wFTh" type="number" min="1" max="60" value="${state.config.ftTarget || 34}">
            <div class="wiz-note" style="margin-top:5px">You have <strong>${FTs.length} FT</strong> employee${FTs.length!==1?'s':''}</div>
          </div>
          <div class="fg">
            <label class="fl">Part-Time target hours</label>
            <input class="fi" id="wPTh" type="number" min="1" max="60" value="${state.config.ptTarget || 25}">
            <div class="wiz-note" style="margin-top:5px">You have <strong>${PTs.length} PT</strong> employee${PTs.length!==1?'s':''}</div>
          </div>
        </div>
        <div class="wiz-budget-preview" id="wizPreview"></div>`,
      onEnter: () => {
        updateWizardPreview();
        document.getElementById('wFTh').addEventListener('input', updateWizardPreview);
        document.getElementById('wPTh').addEventListener('input', updateWizardPreview);
      },
      next: () => {
        const fth = parseFloat(document.getElementById('wFTh').value) || 34;
        const pth = parseFloat(document.getElementById('wPTh').value) || 25;
        wizardParams.ftHours = fth;
        wizardParams.ptHours = pth;
        state.config.ftTarget = fth;
        state.config.ptTarget = pth;
        save();
        return true;
      }
    },
    {
      title: '✅ Step 4 of 4 — Confirm & Build',
      html: () => {
        const FTs = state.employees.filter(e => e.type==='FT');
        const PTs = state.employees.filter(e => e.type==='PT');
        const ftTotal = FTs.length * wizardParams.ftHours;
        const ptMax   = wizardParams.budget - ftTotal;
        const ptActual= Math.min(PTs.length * wizardParams.ptHours, ptMax);
        const projected = ftTotal + ptActual;
        return `
        <div class="wiz-confirm">
          <div class="wiz-conf-row"><span>📅 Week</span><strong>${document.getElementById('weekLbl').textContent}</strong></div>
          <div class="wiz-conf-row"><span>💰 Budget</span><strong>${wizardParams.budget}h</strong></div>
          <div class="wiz-conf-row"><span>👥 Coverage / day</span><strong>${wizardParams.morningStaff} morning + ${wizardParams.afternoonStaff} afternoon, ${wizardParams.closersPerDay} closers</strong></div>
          <div class="wiz-conf-row"><span>🔵 FT hours (${FTs.length} employees)</span><strong>${wizardParams.ftHours}h each = ${ftTotal}h</strong></div>
          <div class="wiz-conf-row"><span>🟢 PT hours (${PTs.length} employees)</span><strong>~${wizardParams.ptHours}h each</strong></div>
          <div class="wiz-conf-sep"></div>
          <div class="wiz-conf-row total"><span>📊 Projected total</span><strong class="${projected>wizardParams.budget?'red':'green'}">${projected.toFixed(1)}h / ${wizardParams.budget}h</strong></div>
        </div>
        <div class="wiz-note" style="margin-top:12px">⚠️ This will <strong>replace</strong> the current week's schedule. Any manual changes will be lost.</div>`;
      },
      next: () => true,
    }
  ];

  const s = steps[step];
  document.getElementById('wizTitle').textContent = typeof s.title === 'function' ? s.title() : s.title;
  const body = document.getElementById('wizBody');
  body.innerHTML = typeof s.html === 'function' ? s.html() : s.html;
  if (s.onEnter) setTimeout(s.onEnter, 50);

  // Buttons
  const isLast = step === steps.length - 1;
  document.getElementById('wizBack').style.display = step === 0 ? 'none' : '';
  document.getElementById('wizNext').textContent = isLast ? '🚀 Build Schedule' : 'Next →';
  document.getElementById('wizNext').className = `btn btn-primary${isLast ? ' btn-build' : ''}`;

  wizardStep = step;
  window._wizSteps = steps;
}

function updateWizardPreview() {
  const fth = parseFloat(document.getElementById('wFTh')?.value) || 34;
  const pth = parseFloat(document.getElementById('wPTh')?.value) || 25;
  const FTs = state.employees.filter(e => e.type==='FT');
  const PTs = state.employees.filter(e => e.type==='PT');
  const ftTotal  = FTs.length * fth;
  const ptTotal  = PTs.length * pth;
  const projected = ftTotal + ptTotal;
  const bgt = wizardParams.budget || state.config.max;
  const cls = projected > bgt ? 'red' : projected > state.config.base ? 'yellow' : 'green';
  const el = document.getElementById('wizPreview');
  if (el) el.innerHTML = `
    <div class="wiz-prev-row"><span>FT: ${FTs.length} × ${fth}h</span><span>${ftTotal}h</span></div>
    <div class="wiz-prev-row"><span>PT: ${PTs.length} × ${pth}h</span><span>${ptTotal}h</span></div>
    <div class="wiz-prev-row total"><span>Projected total</span><span class="${cls}">${projected.toFixed(1)}h / ${bgt}h</span></div>`;
}

function wizNext() {
  const steps = window._wizSteps;
  if (!steps) return;
  const ok = steps[wizardStep].next();
  if (!ok) return;
  if (wizardStep < steps.length - 1) {
    showWizardStep(wizardStep + 1);
  } else {
    closeBuildWizard();
    buildAutoSchedule(wizardParams);
  }
}
function wizBack() {
  if (wizardStep > 0) showWizardStep(wizardStep - 1);
}

// ═══════════════════════════════════════════════════════════════════════════
// ── RENDER ────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

function shiftBlockHTML(emp, di, shift) {
  if (!shift) return `<div class="sb-blk empty" onclick="openPicker(${emp.id},${di})">+ Shift</div>`;
  const closer = isCloser(shift, di);
  const short  = isShort(shift);
  const tagCls  = closer ? 'cl-s' : short ? 'sh-s' : '';
  const ptCls   = emp.type==='PT' ? 'pt-s' : '';
  const timeCls = closer ? 'cc' : short ? 'sc2' : emp.type==='PT' ? 'pc' : 'fc';
  const badge   = closer
    ? `<span class="sbdg cl" title="Closing shift">C</span>`
    : short ? `<span class="sbdg sh" title="Short shift">★</span>` : '';
  return `<div class="sb-blk on ${tagCls} ${ptCls}" onclick="openPicker(${emp.id},${di})">
    ${badge}
    <div class="st ${timeCls}">${fmt12(shift.start)}–${fmt12(shift.end)}</div>
    <div class="sh">${shift.hrs.toFixed(1)}h${shift.hrs>=6?'<span style="opacity:.5"> ml</span>':''}</div>
  </div>`;
}

function renderWeekLabel() {
  const dd = weekDates();
  document.getElementById('weekLbl').textContent = `${fmtDate(dd[0])} – ${fmtDate(dd[6])}`;
}

function renderStoreHours() {
  document.getElementById('shGrid').innerHTML = DAYS.map((d,i) => `
    <div class="sh-row">
      <span class="sh-day">${d}</span>
      <input class="sh-inp" type="time" value="${state.storeHours[i].open}"
        oninput="state.storeHours[${i}].open=this.value;save();renderTable()">
      <input class="sh-inp" type="time" value="${state.storeHours[i].close}"
        oninput="state.storeHours[${i}].close=this.value;save();renderTable()">
    </div>`).join('');
}

function renderBudget() {
  const tot = totalHrs(), base = state.config.base, max = state.config.max;
  const pct = base > 0 ? Math.round(tot/base*100) : 0;
  const cls = tot > max ? 'over' : tot > base ? 'warn' : 'ok';
  document.getElementById('bPct').textContent = `${pct}%`;
  document.getElementById('bPct').className   = `bgt-pct ${cls}`;
  document.getElementById('bBar').style.width = `${Math.min(100,(tot/max)*100)}%`;
  document.getElementById('bBar').className   = `bgt-bar${cls!=='ok'?' '+cls:''}`;
  document.getElementById('bSched').textContent = `${tot.toFixed(1)} h`;
  document.getElementById('bBase').textContent  = `${base.toFixed(1)} h`;
  document.getElementById('bMax').textContent   = `${max.toFixed(1)} h`;
}

function renderSidebar() {
  document.getElementById('empCnt').textContent = state.employees.length;
  if (!state.employees.length) {
    document.getElementById('empList').innerHTML = `<div class="empty">
      <div class="empty-ico">👤</div>
      <div class="empty-txt">No employees yet.<br>Click "+ Add Employee".</div></div>`;
    return;
  }
  document.getElementById('empList').innerHTML = state.employees.map(e => {
    const h   = empHrs(e.id);
    const min = e.type==='FT' ? state.config.ftMin : 0;
    const cls = h >= e.targetHrs ? 'ok' : h >= min ? 'low' : 'over';
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

function renderCoverage() {
  const dd = weekDates();
  document.getElementById('covBar').innerHTML = DAYS.map((day,i) => {
    const onFloor = state.employees.filter(e => getShift(e.id,i)?.hrs > 0);
    const cnt     = onFloor.length;
    const closers = onFloor.filter(e => isCloser(getShift(e.id,i), i));
    const shorts  = onFloor.filter(e => isShort(getShift(e.id,i)));
    const cls     = cnt===0?'low':cnt<2?'warn':'ok';
    const tags    = [
      closers.length ? `<div class="cov-tag closer">🔐 ${closers.map(e=>e.name.split(' ')[0]).join(', ')}</div>` : '',
      shorts.length  ? `<div class="cov-tag short">★ ${shorts.map(e=>e.name.split(' ')[0]).join(', ')}</div>` : '',
    ].join('');
    return `<div class="cov-card">
      <div class="cov-day">${day}</div>
      <div class="cov-cnt ${cls}">${cnt}</div>
      <div class="cov-date">${fmtDate(dd[i])}</div>
      ${tags?`<div class="cov-tags">${tags}</div>`:''}
    </div>`;
  }).join('');
}

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

  document.getElementById('tbody').innerHTML = state.employees.map(e => {
    const h   = empHrs(e.id);
    const min = e.type==='FT' ? state.config.ftMin : 0;
    const cls = h >= e.targetHrs ? 'ok' : h >= min ? 'warn' : 'low';
    const days = DAYS.map((_,i) => `<td class="sc">${shiftBlockHTML(e, i, getShift(e.id,i))}</td>`).join('');
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

// ── WEEK NAV ──────────────────────────────────────────────────────────────
function changeWeek(dir) { state.weekStart = addDays(state.weekStart, dir*7); save(); renderAll(); }

function clearWeek() {
  if (!confirm('Clear all shifts for this week?')) return;
  state.schedules[weekKey()] = {};
  save(); renderAll();
  toast('Week cleared.','info');
}

function exportCSV() {
  const dd  = weekDates();
  const hdr = ['Employee','Type',...DAYS.map((d,i)=>`${d} ${fmtDate(dd[i])}`),'Total Hours'];
  const rows = state.employees.map(e => {
    const days = DAYS.map((_,i) => { const s=getShift(e.id,i); return s?`${fmt12(s.start)}-${fmt12(s.end)} (${s.hrs.toFixed(1)}h)`:'OFF'; });
    return [e.name,e.type,...days,empHrs(e.id).toFixed(1)];
  });
  const csv = [hdr,...rows].map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv],{type:'text/csv'})),
    download: `pharmacy_schedule_${weekKey()}.csv`
  });
  a.click(); toast('CSV exported!','success');
}

// ── EMPLOYEE MODAL ────────────────────────────────────────────────────────
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
  setTimeout(() => document.getElementById('eName').focus(), 80);
}
function closeEmpModal() { document.getElementById('empOv').classList.remove('open'); editingId=null; }

function selectType(type, update=true) {
  const ft=document.getElementById('tFT'), pt=document.getElementById('tPT');
  ft.className=`ropt${type==='FT'?' sel ft':''}`;
  pt.className=`ropt${type==='PT'?' sel pt':''}`;
  ft.dataset.sel=type==='FT'?'1':''; pt.dataset.sel=type==='PT'?'1':'';
  if (update) { document.getElementById('eTgt').value=type==='FT'?34:25; document.getElementById('eMin').value=type==='FT'?34:0; }
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
    const i = state.employees.findIndex(e=>e.id===editingId);
    if (i>-1) state.employees[i]=emp;
    toast(`Updated ${emp.name}`,'success');
  } else {
    state.employees.push(emp);
    toast(`Added ${emp.name}`,'success');
  }
  save(); closeEmpModal(); renderAll();
}

function delEmp(id) {
  const e = state.employees.find(x=>x.id===id);
  if (!e || !confirm(`Delete ${e.name}? All their shifts will be removed.`)) return;
  state.employees = state.employees.filter(x=>x.id!==id);
  Object.keys(state.schedules).forEach(k=>delete state.schedules[k][id]);
  save(); toast(`Removed ${e.name}`,'info'); renderAll();
}

// ── SHIFT PICKER ──────────────────────────────────────────────────────────
function openPicker(eid, di) {
  pickerCtx = { eid, di };
  const e = state.employees.find(x=>x.id===eid);
  document.getElementById('shiftModalTitle').textContent = `${e.name} — ${DAYS_FULL[di]}`;
  const open  = state.storeHours[di].open;
  const close = state.storeHours[di].close;
  document.getElementById('cStart').value = open;
  document.getElementById('cEnd').value   = close;
  document.getElementById('presetGrid').innerHTML = PRESETS.map(p => {
    const h = calcHrs(p.start, p.end);
    return `<button class="prs ${p.cls}" onclick="applyPreset('${p.start}','${p.end}')">
      <div class="prs-lbl">${p.lbl}</div>
      <div class="prs-time">${fmt12(p.start)} – ${fmt12(p.end)}</div>
      <div class="prs-hrs">${h.toFixed(1)}h${h>=6?' (w/meal)':''}</div>
    </button>`;
  }).join('');
  document.getElementById('shiftOv').classList.add('open');
}
function closePicker() { document.getElementById('shiftOv').classList.remove('open'); pickerCtx=null; }

function applyPreset(s, e) {
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

// ── CONFIG ────────────────────────────────────────────────────────────────
function syncConfig() {
  state.config.base  = parseFloat(document.getElementById('cfgBase').value)  || 194;
  state.config.max   = parseFloat(document.getElementById('cfgMax').value)   || 225;
  state.config.ftMin = parseFloat(document.getElementById('cfgFTMin').value) || 34;
  save(); renderAll();
}

// ── TOAST ─────────────────────────────────────────────────────────────────
function toast(msg, type='info') {
  const ct = document.getElementById('toastCt');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${{success:'✓',error:'✕',info:'ℹ'}[type]||'ℹ'}</span><span>${msg}</span>`;
  ct.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── KEYBOARD ──────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key==='Escape') { closePicker(); closeEmpModal(); closeBuildWizard(); }
});
['empOv','shiftOv','buildOv'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', function(e) {
    if (e.target===this) { closePicker(); closeEmpModal(); closeBuildWizard(); }
  });
});

// ── INIT ──────────────────────────────────────────────────────────────────
(function init() {
  load();
  if (!state.weekStart) state.weekStart = getSaturday(new Date());
  document.getElementById('cfgBase').value  = state.config.base;
  document.getElementById('cfgMax').value   = state.config.max;
  document.getElementById('cfgFTMin').value = state.config.ftMin;

  if (!state.employees.length) {
    [
      {name:'Jennifer R.',type:'FT',targetHrs:34,minHrs:34,role:'Pharm Tech'},
      {name:'Anna S.',    type:'FT',targetHrs:34,minHrs:34,role:'Pharm Tech'},
      {name:'Allison W.', type:'FT',targetHrs:34,minHrs:34,role:'Pharm Tech'},
      {name:'Karta P.',   type:'FT',targetHrs:34,minHrs:34,role:'Pharm Tech'},
      {name:'Marshall B.',type:'FT',targetHrs:34,minHrs:34,role:'Pharm Tech'},
      {name:'PT Tech 1',  type:'PT',targetHrs:27,minHrs:0, role:'Pharm Tech'},
      {name:'PT Tech 2',  type:'PT',targetHrs:25,minHrs:0, role:'Pharm Tech'},
      {name:'PT Tech 3',  type:'PT',targetHrs:13,minHrs:0, role:'Pharm Tech'},
    ].forEach(e => state.employees.push({id:state.nextId++, ...e}));
    save();
  }
  renderAll();
})();

// Sync wizard progress dots
const _origShowStep = showWizardStep;
// Patch: update dots whenever step changes
(function patchDots() {
  const orig = window.showWizardStep;
  window.showWizardStep = function(step) {
    orig(step);
    const dots = document.querySelectorAll('.wiz-dot');
    dots.forEach((d, i) => {
      d.className = 'wiz-dot' + (i < step ? ' done' : i === step ? ' active' : '');
    });
  };
})();
