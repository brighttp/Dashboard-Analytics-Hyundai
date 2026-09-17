/* ======================================================================
   DATA LAYER
   Ganti fungsi fetchPlaySessions() ini dengan pemanggilan API asli Anda.
   Bentuk data yang diharapkan (array of objects):
   {
     id: string,
     playerId: string,
     timestamp: "YYYY-MM-DDTHH:mm:ss",
     score: number (0-100),
     completed: boolean
   }

   Contoh integrasi API sungguhan:
   async function fetchPlaySessions() {
     const res = await fetch("https://api.andaselaku.com/quiz/hyundai/sessions");
     if (!res.ok) throw new Error("Gagal memuat data API");
     return await res.json();
   }
   ====================================================================== */
const API_BASE_URL = 'https://activity-tracker.abracodebra.com/api';

async function fetchPlaySessions(){
  try {
    const res = await fetch(`${API_BASE_URL}/activity-records`);
    if(!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const json = await res.json();
    
    if(!json.data || !json.data.records) return [];

    const sessions = [];
    const recordsObj = json.data.records;
    
    // Flatten the grouped data from API
    for (const activityName in recordsObj) {
      const items = recordsObj[activityName];
      for (const item of items) {
        sessions.push({
          id: item.id || `S${Math.floor(Math.random() * 99999)}`,
          username: item.full_name || '-',
          email: item.email || '-',
          phone: item.phone_number || '-',
          timestamp: item.created_at ? item.created_at.replace(' ', 'T') : new Date().toISOString(),
          score: parseFloat(item.point_score) || 0,
          completed: parseFloat(item.point_score) > 0 // Assume completion if score > 0
        });
      }
    }
    
    // Sort descending by timestamp
    sessions.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    return sessions;
  } catch(err){
    console.error('Failed to fetch from API:', err);
    return [];
  }
}

/* ======================================================================
   STATE + RENDER
   ====================================================================== */
let ALL_SESSIONS = [];
let hourlyChart, dailyChart, gaugeChart;
let AVAILABLE_DATES = new Set();

// Applied filter state (used by getFilteredSessions/render)
let rangeStart = null;    // Date or null ("semua tanggal")
let rangeEnd = null;      // Date or null
let hourFrom = 0;
let hourTo = 23;

// Pending state while the popup is open (only committed on "Terapkan filter")
let pendingRangeStart = null;
let pendingRangeEnd = null;
let pendingHoverDate = null;
let pendingHourFrom = 0;
let pendingHourTo = 23;
let pendingHourHover = null;
let calendarMonth = new Date();

function fmtDate(d){
  return d.toLocaleDateString('id-ID', {weekday:'short', day:'2-digit', month:'short'});
}
function fmtShort(d){
  return d.toLocaleDateString('id-ID', {day:'2-digit', month:'short'});
}
function dayKey(d){
  return d.toISOString().slice(0,10);
}
function fmtHour(h){
  return String(h).padStart(2,'0') + ':00';
}
function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d, n){ return new Date(d.getFullYear(), d.getMonth()+n, 1); }
function isSameDay(a,b){ return a && b && a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function isBetween(d, start, end){ return start && end && d > start && d < end; }

function computeAvailableDates(sessions){
  AVAILABLE_DATES = new Set(sessions.map(s => dayKey(new Date(s.timestamp))));
  const sorted = [...AVAILABLE_DATES].sort();
  if(sorted.length){
    const latest = new Date(sorted[sorted.length-1] + "T00:00:00");
    calendarMonth = new Date(latest.getFullYear(), latest.getMonth(), 1);
  }
}

function getFilteredSessions(){
  return ALL_SESSIONS.filter(s => {
    const d = new Date(s.timestamp);
    const hour = d.getHours();
    if(rangeStart){
      const k = dayKey(d);
      if(k < dayKey(rangeStart) || k > dayKey(rangeEnd)) return false;
    }
    if(hour < hourFrom || hour > hourTo) return false;
    return true;
  });
}

/* ---------- Popup: two-month range calendar (Traveloka-style) ---------- */
function buildMonthGrid(container, monthDate, monthLabelEl){
  if(!container || !monthLabelEl) return;
  monthLabelEl.textContent = monthDate.toLocaleDateString('id-ID', {month:'long', year:'numeric'});

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const todayKey = dayKey(new Date());

  container.innerHTML = '';

  for(let i=0; i<startOffset; i++){
    const blank = document.createElement('span');
    blank.className = 'cal-day blank';
    container.appendChild(blank);
  }

  for(let day=1; day<=daysInMonth; day++){
    const dateObj = new Date(year, month, day);
    const key = dayKey(dateObj);
    const dow = dateObj.getDay();
    const isWeekend = dow === 0 || dow === 6;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = day;
    btn.dataset.time = String(dateObj.getTime());
    btn.className = 'cal-day' + (isWeekend ? ' wknd' : '') + (key === todayKey ? ' today' : '');

    btn.addEventListener('mouseenter', () => {
      if(pendingRangeStart && !pendingRangeEnd){
        pendingHoverDate = dateObj;
        updateCalendarSelectionUI();
      }
    });
    btn.addEventListener('click', () => onDayClick(dateObj));
    container.appendChild(btn);
  }
}

function renderCalendar(){
  const leftMonth = calendarMonth;
  const rightMonth = addMonths(leftMonth, 1);
  buildMonthGrid(document.getElementById('calendarGridLeft'), leftMonth, document.getElementById('calMonthLabelLeft'));
  buildMonthGrid(document.getElementById('calendarGridRight'), rightMonth, document.getElementById('calMonthLabelRight'));
  updateCalendarSelectionUI();
}

function updateCalendarSelectionUI(){
  ['calendarGridLeft','calendarGridRight'].forEach(id => {
    const grid = document.getElementById(id);
    if(!grid) return;
    grid.querySelectorAll('.cal-day:not(.blank)').forEach(btn => {
      const d = new Date(Number(btn.dataset.time));
      btn.classList.remove('is-in-range','is-range-start','is-range-end','is-range-single');

      if(pendingRangeStart && !pendingRangeEnd && pendingHoverDate){
        if(isBetween(d, pendingRangeStart, pendingHoverDate) || isBetween(d, pendingHoverDate, pendingRangeStart)){
          btn.classList.add('is-in-range');
        }
      }
      if(isBetween(d, pendingRangeStart, pendingRangeEnd)) btn.classList.add('is-in-range');

      if(pendingRangeStart && pendingRangeEnd && isSameDay(d, pendingRangeStart) && isSameDay(d, pendingRangeEnd)){
        btn.classList.add('is-range-single');
      } else if(pendingRangeStart && isSameDay(d, pendingRangeStart)){
        btn.classList.add(pendingRangeEnd ? 'is-range-start' : 'is-range-single');
      } else if(pendingRangeEnd && isSameDay(d, pendingRangeEnd)){
        btn.classList.add('is-range-end');
      }
    });
  });

  const startEl = document.getElementById('rangeStartLabel');
  if(startEl) startEl.textContent = pendingRangeStart ? fmtShort(pendingRangeStart) : '—';
  
  const endEl = document.getElementById('rangeEndLabel');
  if(endEl) endEl.textContent = pendingRangeEnd ? fmtShort(pendingRangeEnd) : '—';
}

function onDayClick(d){
  const toggle = document.getElementById('allDaysToggle');
  if(toggle) toggle.checked = false;

  if(!pendingRangeStart || (pendingRangeStart && pendingRangeEnd)){
    pendingRangeStart = d;
    pendingRangeEnd = null;
  } else {
    if(d < pendingRangeStart){
      pendingRangeEnd = pendingRangeStart;
      pendingRangeStart = d;
    } else {
      pendingRangeEnd = d;
    }
  }
  pendingHoverDate = null;
  updateCalendarSelectionUI();
}

function setQuickDateRange(kind){
  const today = new Date();
  today.setHours(0,0,0,0);
  if(kind === 'today'){
    pendingRangeStart = today;
    pendingRangeEnd = today;
  } else {
    const days = parseInt(kind, 10);
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    pendingRangeStart = start;
    pendingRangeEnd = today;
  }
  const toggle = document.getElementById('allDaysToggle');
  if(toggle) toggle.checked = false;
  pendingHoverDate = null;
  calendarMonth = startOfMonth(pendingRangeStart);
  renderCalendar();
}

function changeMonth(delta){
  calendarMonth = addMonths(calendarMonth, delta);
  renderCalendar();
}

/* ---------- Popup: hour range grid (click start, then end) ---------- */
function buildHourGrid(){
  const grid = document.getElementById('hourGrid');
  grid.innerHTML = '';
  for(let h=0; h<24; h++){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hour-cell';
    btn.textContent = fmtHour(h);
    btn.dataset.hour = String(h);

    btn.addEventListener('mouseenter', () => {
      if(pendingHourFrom !== null && pendingHourTo === null){
        pendingHourHover = h;
        updateHourSelectionUI();
      }
    });
    btn.addEventListener('click', () => onHourClick(h));
    grid.appendChild(btn);
  }
  updateHourSelectionUI();
}

function updateHourSelectionUI(){
  document.querySelectorAll('#hourGrid .hour-cell').forEach(btn => {
    const h = Number(btn.dataset.hour);
    btn.classList.remove('is-in-range','is-range-start','is-range-end','is-range-single');

    if(pendingHourFrom !== null && pendingHourTo === null && pendingHourHover !== null){
      const lo = Math.min(pendingHourFrom, pendingHourHover);
      const hi = Math.max(pendingHourFrom, pendingHourHover);
      if(h > lo && h < hi) btn.classList.add('is-in-range');
    }
    if(pendingHourFrom !== null && pendingHourTo !== null && h > pendingHourFrom && h < pendingHourTo){
      btn.classList.add('is-in-range');
    }

    if(pendingHourFrom !== null && pendingHourTo !== null && h === pendingHourFrom && h === pendingHourTo){
      btn.classList.add('is-range-single');
    } else if(pendingHourFrom !== null && h === pendingHourFrom){
      btn.classList.add(pendingHourTo !== null ? 'is-range-start' : 'is-range-single');
    } else if(pendingHourTo !== null && h === pendingHourTo){
      btn.classList.add('is-range-end');
    }
  });

  const hStart = document.getElementById('hourStartLabel');
  if(hStart) hStart.textContent = pendingHourFrom !== null ? fmtHour(pendingHourFrom) : '—';

  const hEnd = document.getElementById('hourEndLabel');
  if(hEnd) hEnd.textContent = pendingHourTo !== null ? fmtHour(pendingHourTo) : '—';
}

function onHourClick(h){
  if(pendingHourFrom === null || (pendingHourFrom !== null && pendingHourTo !== null)){
    pendingHourFrom = h;
    pendingHourTo = null;
  } else {
    if(h < pendingHourFrom){
      pendingHourTo = pendingHourFrom;
      pendingHourFrom = h;
    } else {
      pendingHourTo = h;
    }
  }
  pendingHourHover = null;
  updateHourSelectionUI();
}

function setQuickHourRange(kind){
  if(kind === 'full'){ pendingHourFrom = 0; pendingHourTo = 23; }
  if(kind === 'morning'){ pendingHourFrom = 6; pendingHourTo = 12; }
  if(kind === 'evening'){ pendingHourFrom = 18; pendingHourTo = 23; }
  pendingHourHover = null;
  updateHourSelectionUI();
}

function updateFilterSummary(){
  let dayLabel;
  if(!rangeStart){
    dayLabel = 'Pilih tanggal';
  } else if(isSameDay(rangeStart, rangeEnd)){
    dayLabel = fmtDate(rangeStart);
  } else {
    dayLabel = `${fmtShort(rangeStart)} - ${fmtShort(rangeEnd)}`;
  }

  const dateValEl = document.getElementById('filterDateValue');
  if(dateValEl) dateValEl.textContent = dayLabel;

  let timeLabel;
  if(hourFrom === 0 && hourTo === 23){
    timeLabel = 'Sepanjang hari';
  } else {
    timeLabel = `${fmtHour(hourFrom)} - ${fmtHour(hourTo)}`;
  }

  const timeValEl = document.getElementById('filterTimeValue');
  if(timeValEl) timeValEl.textContent = timeLabel;
}

function openDatePopup(){
  closeTimePopup();
  pendingRangeStart = rangeStart;
  pendingRangeEnd = rangeEnd;
  pendingHoverDate = null;

  if(rangeStart){
    calendarMonth = startOfMonth(rangeStart);
  }
  renderCalendar();

  const datePopup = document.getElementById('datePopup');
  if(datePopup) datePopup.hidden = false;

  const dateTrig = document.getElementById('filterDateTrigger');
  if(dateTrig){
    dateTrig.classList.add('open');
    dateTrig.setAttribute('aria-expanded', 'true');
  }
}

function closeDatePopup(){
  const datePopup = document.getElementById('datePopup');
  if(datePopup) datePopup.hidden = true;

  const dateTrig = document.getElementById('filterDateTrigger');
  if(dateTrig){
    dateTrig.classList.remove('open');
    dateTrig.setAttribute('aria-expanded', 'false');
  }
}

function openTimePopup(){
  closeDatePopup();
  pendingHourFrom = hourFrom;
  pendingHourTo = hourTo;
  pendingHourHover = null;

  updateHourSelectionUI();

  const timePopup = document.getElementById('timePopup');
  if(timePopup) timePopup.hidden = false;

  const timeTrig = document.getElementById('filterTimeTrigger');
  if(timeTrig){
    timeTrig.classList.add('open');
    timeTrig.setAttribute('aria-expanded', 'true');
  }
}

function closeTimePopup(){
  const timePopup = document.getElementById('timePopup');
  if(timePopup) timePopup.hidden = true;

  const timeTrig = document.getElementById('filterTimeTrigger');
  if(timeTrig){
    timeTrig.classList.remove('open');
    timeTrig.setAttribute('aria-expanded', 'false');
  }
}

function closeAllPopups(){
  closeDatePopup();
  closeTimePopup();
}

function updateOdometer(total){
  const str = String(total).padStart(6,'0');
  const box = document.getElementById('odometer');
  box.innerHTML = str.split('').map(d => `<span class="digit">${d}</span>`).join('');
}

function render(){
  const filtered = getFilteredSessions();
  const total = filtered.length;
  const completed = filtered.filter(s => s.completed).length;
  const completionRate = total ? Math.round((completed/total)*100) : 0;
  const avgScore = total ? Math.round(filtered.reduce((a,s)=>a+s.score,0)/total) : 0;

  // hero
  updateOdometer(total);
  document.getElementById('completionRate').textContent = completionRate + '%';

  const hoursSpan = Math.max(1, hourTo - hourFrom + 1);
  const dayCount = rangeStart ? (Math.round((rangeEnd - rangeStart) / 86400000) + 1) : 14;
  document.getElementById('avgPerHour').textContent = Math.round(total / (hoursSpan*dayCount)) || 0;

  // side stats
  const todayKey = dayKey(new Date());
  const todayCount = ALL_SESSIONS.filter(s => dayKey(new Date(s.timestamp)) === todayKey).length;
  document.getElementById('statToday').textContent = todayCount;

  const hourCounts = Array(24).fill(0);
  filtered.forEach(s => hourCounts[new Date(s.timestamp).getHours()]++);
  const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
  document.getElementById('statPeakHour').textContent = total ? `${String(peakHour).padStart(2,'0')}:00` : '--';
  document.getElementById('statAvgScore').textContent = avgScore;

  // gauge
  if(gaugeChart && gaugeChart.data && gaugeChart.data.datasets && gaugeChart.data.datasets[0]){
    gaugeChart.data.datasets[0].data = [completionRate, 100-completionRate];
    gaugeChart.update();
  }

  // hourly chart
  const hourlySubEl = document.getElementById('hourlySub');
  const hourlyEmptyEl = document.getElementById('hourlyEmptyState');
  if(total === 0){
    if(hourlySubEl) hourlySubEl.textContent = 'Belum ada data';
    if(hourlyEmptyEl) hourlyEmptyEl.style.display = 'flex';
  } else {
    if(hourlySubEl) hourlySubEl.textContent = `${total} sesi`;
    if(hourlyEmptyEl) hourlyEmptyEl.style.display = 'none';
  }

  if(hourlyChart && hourlyChart.data && hourlyChart.data.datasets && hourlyChart.data.datasets[0]){
    hourlyChart.data.datasets[0].data = hourCounts;
    hourlyChart.update();
  }

  // daily chart (always last 30 days regardless of day filter, respects hour filter)
  const dayMap = {};
  ALL_SESSIONS.forEach(s => {
    const d = new Date(s.timestamp);
    const hour = d.getHours();
    if(hour < hourFrom || hour > hourTo) return;
    const k = dayKey(d);
    dayMap[k] = (dayMap[k]||0) + 1;
  });
  const sortedDays = Object.keys(dayMap).sort();

  const dailySubEl = document.getElementById('dailySub');
  const dailyEmptyEl = document.getElementById('dailyEmptyState');
  if(total === 0){
    if(dailySubEl) dailySubEl.textContent = 'Belum ada data';
    if(dailyEmptyEl) dailyEmptyEl.style.display = 'flex';
  } else {
    if(dailySubEl) dailySubEl.textContent = `${sortedDays.length} hari`;
    if(dailyEmptyEl) dailyEmptyEl.style.display = 'none';
  }

  if(dailyChart && dailyChart.data && dailyChart.data.datasets && dailyChart.data.datasets[0]){
    dailyChart.data.labels = sortedDays.map(k => fmtDate(new Date(k+"T00:00:00")));
    dailyChart.data.datasets[0].data = sortedDays.map(k => dayMap[k]);
    dailyChart.update();
  }

  // table — most recent 12
  const recent = [...filtered].sort((a,b)=> new Date(b.timestamp)-new Date(a.timestamp)).slice(0,12);
  document.getElementById('tableSub').textContent = `${total} entri cocok filter`;
  const body = document.getElementById('logBody');
  if(recent.length === 0){
    body.innerHTML = `<tr class="empty-row"><td colspan="6">Tidak ada sesi pada rentang filter ini.</td></tr>`;
  } else {
    body.innerHTML = recent.map(s => {
      const d = new Date(s.timestamp);
      const scoreClass = s.score >= 70 ? 'score-high' : s.score >= 40 ? 'score-mid' : 'score-low';
      const formattedDate = fmtDate(d) + ', ' + d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
      return `<tr>
        <td>${s.id}</td>
        <td>${s.username}</td>
        <td>${s.email}</td>
        <td>${s.phone}</td>
        <td>${formattedDate}</td>
        <td><span class="score-pill ${scoreClass}">${s.score}</span></td>
      </tr>`;
    }).join('');
  }

  document.getElementById('lastUpdated').textContent = 'Diperbarui ' + new Date().toLocaleTimeString('id-ID');
}

function initCharts(){
  const navy = '#0B2A4A', cyan = '#00AAD2', line = '#DCE4EA';

  gaugeChart = new Chart(document.getElementById('gaugeChart'), {
    type: 'doughnut',
    data: {
      labels: ['Selesai','Sisa'],
      datasets: [{ data:[0,100], backgroundColor:[cyan, 'rgba(255,255,255,0.12)'], borderWidth:0 }]
    },
    options: {
      cutout: '72%',
      rotation: -90, circumference: 180,
      plugins:{ legend:{display:false}, tooltip:{enabled:false} }
    }
  });

  hourlyChart = new Chart(document.getElementById('hourlyChart'), {
    type: 'bar',
    data: {
      labels: Array.from({length:24}, (_,i)=>String(i).padStart(2,'0')+':00'),
      datasets: [{ data:Array(24).fill(0), backgroundColor: cyan, borderRadius:4, maxBarThickness:22 }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false} },
      scales:{
        x:{ grid:{display:false}, ticks:{ font:{family:'IBM Plex Mono', size:10}, maxRotation:0, autoSkip:true, color:'#5B6B7A' } },
        y:{ grid:{color:line}, ticks:{ font:{family:'IBM Plex Mono', size:10}, color:'#5B6B7A' }, beginAtZero:true }
      }
    }
  });

  dailyChart = new Chart(document.getElementById('dailyChart'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        data: [], borderColor: navy, backgroundColor:'rgba(11,42,74,0.08)',
        fill:true, tension:0.35, pointRadius:3, pointBackgroundColor: cyan
      }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false} },
      scales:{
        x:{ grid:{display:false}, ticks:{ font:{family:'IBM Plex Mono', size:10}, color:'#5B6B7A' } },
        y:{ grid:{color:line}, ticks:{ font:{family:'IBM Plex Mono', size:10}, color:'#5B6B7A' }, beginAtZero:true }
      }
    }
  });
}

function tickClock(){
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('id-ID');
}

function applyDefaults(){
  rangeStart = null;
  rangeEnd = null;
  hourFrom = 0;
  hourTo = 23;
  updateFilterSummary();
  render();
}

async function init(){
  // Wire up ALL interactive controls FIRST. This guarantees the filter
  // button (and every other control) works even if something below
  // (chart rendering, mock data generation) throws an error — a failure
  // there must never be able to leave the UI dead.
  const dateTrigger = document.getElementById('filterDateTrigger');
  const timeTrigger = document.getElementById('filterTimeTrigger');
  const datePopup = document.getElementById('datePopup');
  const timePopup = document.getElementById('timePopup');

  if(dateTrigger){
    dateTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if(datePopup && datePopup.hidden) openDatePopup(); else closeDatePopup();
    });
  }

  if(timeTrigger){
    timeTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if(timePopup && timePopup.hidden) openTimePopup(); else closeTimePopup();
    });
  }

  if(datePopup) datePopup.addEventListener('click', (e) => e.stopPropagation());
  if(timePopup) timePopup.addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener('click', () => closeAllPopups());
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeAllPopups(); });

  document.getElementById('prevMonth')?.addEventListener('click', () => changeMonth(-1));
  document.getElementById('nextMonth')?.addEventListener('click', () => changeMonth(1));

  document.getElementById('quickDateRanges')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if(btn) setQuickDateRange(btn.dataset.range);
  });

  document.getElementById('quickHourRanges')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-hour-range]');
    if(btn) setQuickHourRange(btn.dataset.hourRange);
  });

  // Date Apply button inside popup
  document.getElementById('dateApplyBtn')?.addEventListener('click', () => {
    if(pendingRangeStart){
      rangeStart = pendingRangeStart;
      rangeEnd = pendingRangeEnd || pendingRangeStart;
    } else {
      rangeStart = null;
      rangeEnd = null;
    }
    updateFilterSummary();
    render();
    closeDatePopup();
  });

  // Date Reset (Bersihkan) button
  document.getElementById('dateResetBtn')?.addEventListener('click', () => {
    pendingRangeStart = null;
    pendingRangeEnd = null;
    pendingHoverDate = null;
    rangeStart = null;
    rangeEnd = null;
    updateFilterSummary();
    render();
    closeDatePopup();
  });

  // Time Apply button inside popup
  document.getElementById('timeApplyBtn')?.addEventListener('click', () => {
    hourFrom = pendingHourFrom !== null ? pendingHourFrom : 0;
    hourTo = pendingHourTo !== null ? pendingHourTo : 23;
    updateFilterSummary();
    render();
    closeTimePopup();
  });

  // Time Reset (Bersihkan) button
  document.getElementById('timeResetBtn')?.addEventListener('click', () => {
    pendingHourFrom = 0;
    pendingHourTo = 23;
    pendingHourHover = null;
    hourFrom = 0;
    hourTo = 23;
    updateFilterSummary();
    render();
    closeTimePopup();
  });

  // Main Terapkan button on top filter bar
  document.getElementById('applyBtn')?.addEventListener('click', () => {
    if(datePopup && !datePopup.hidden){
      document.getElementById('dateApplyBtn')?.click();
    } else if(timePopup && !timePopup.hidden){
      document.getElementById('timeApplyBtn')?.click();
    } else {
      if(pendingRangeStart !== null) rangeStart = pendingRangeStart;
      if(pendingRangeEnd !== null) rangeEnd = pendingRangeEnd;
      if(pendingHourFrom !== null) hourFrom = pendingHourFrom;
      if(pendingHourTo !== null) hourTo = pendingHourTo;
      updateFilterSummary();
      render();
      closeAllPopups();
    }
  });

  document.getElementById('resetBtn')?.addEventListener('click', () => {
    applyDefaults();
    closeAllPopups();
  });

  // Build the (always-static) hour grid — this never depends on data,
  // so it's safe to run before/independent of the data fetch below.
  buildHourGrid();
  updateFilterSummary();

  // Charts + mock data: wrapped so a CDN/network hiccup (e.g. Chart.js
  // failing to load) can't take down the controls wired up above.
  try {
    initCharts();
  } catch(err){
    console.error('Gagal menginisialisasi grafik (Chart.js mungkin belum termuat):', err);
  }

  ALL_SESSIONS = await fetchPlaySessions();
  computeAvailableDates(ALL_SESSIONS);
  render();

  tickClock();
  setInterval(tickClock, 1000);
}

init();
