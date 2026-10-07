(() => {
  'use strict';

  const STORAGE_KEY = 'proteinLog.v1';
  const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snacks'];
  const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' };
  const state = loadState();
  let activeTab = 'today';
  let selectedDate = localDateKey(new Date());
  let selectedWeekStart = weekStartKey(selectedDate);
  let averagePeriod = 7;
  let reviewPeriod = 7;
  let selectedTrendEnd = selectedDate;
  let swipeAnimating = false;
  let touchStart = null;
  let lockedScrollY = 0;
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const toastRoot = document.getElementById('toast-root');

  init();

  function init() {
    applyTheme();
    document.addEventListener('focusin', selectNumericInputContent);
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = () => { if ((state.settings.theme || 'system') === 'system') applyTheme(); };
    if (colorScheme.addEventListener) colorScheme.addEventListener('change', syncSystemTheme);
    else if (colorScheme.addListener) colorScheme.addListener(syncSystemTheme);
    document.querySelectorAll('.tab-button').forEach(btn => btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-button').forEach(x => x.classList.toggle('active', x === btn));
      render();
    }));
    app.addEventListener('touchstart', startDaySwipe, { passive: true });
    app.addEventListener('touchmove', moveDaySwipe, { passive: false });
    app.addEventListener('touchend', finishDaySwipe, { passive: true });
    app.addEventListener('touchcancel', () => finishDaySwipe(null), { passive: true });
    app.addEventListener('click', e => { if (swipeAnimating || touchStart?.horizontal) { e.preventDefault(); e.stopPropagation(); } }, true);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
    render();
  }

  function defaultState() { return { settings: { proteinTarget: 160, calorieTarget: 2500, theme: 'system', claudeApiKey: '' }, days: {}, savedMeals: [], copiedMeal: null }; }
  function navigateDayBySwipe(dx, dy) { if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.25) return false; const today = localDateKey(new Date()); if (dx > 0) selectedDate = shiftDate(selectedDate, -1); else if (selectedDate < today) selectedDate = shiftDate(selectedDate, 1); else return false; renderToday(); return true; }
  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed) return defaultState();
      const base = defaultState();
      return { settings: { ...base.settings, ...(parsed.settings || {}) }, days: parsed.days || {}, savedMeals: Array.isArray(parsed.savedMeals) ? parsed.savedMeals : [], copiedMeal: parsed.copiedMeal && typeof parsed.copiedMeal.name === 'string' && Array.isArray(parsed.copiedMeal.ingredients) ? mealCopySnapshot(parsed.copiedMeal) : null };
    } catch { return defaultState(); }
  }
  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function render() { if (activeTab === 'today') renderToday(); else if (activeTab === 'saved') renderSaved(); else if (activeTab === 'review') renderWeekly(); else renderSettings(); }

  function renderToday(previewDate = null) {
    const date = previewDate || selectedDate;
    const day = previewDate ? (state.days[date] || { entries: [] }) : getDay(date);
    const totals = dayTotals(day);
    const proteinTarget = Number(state.settings.proteinTarget) || 160;
    const calorieTarget = Math.max(1, Number(state.settings.calorieTarget) || 2500);
    const pct = Math.min(1, totals.protein / proteinTarget);
    const proteinRemaining = Math.max(0, proteinTarget - totals.protein);
    const today = localDateKey(new Date());
    const isToday = date === today;
    const canNext = date < today;
    const average = nutritionAverage(date, averagePeriod);
    const weightTrend = rollingWeightSummary(date, averagePeriod);
    const activities = day.activities || {};
    const html = `<section class="day-view">
      <div class="date-nav"><button class="date-button" id="prev-day" aria-label="Previous day">‹</button><div class="date-center"><label class="date-click-target" for="date-picker"><div class="date-label">${escapeHtml(isToday ? 'Today' : formatDate(date))}</div><div class="date-sub">${escapeHtml(formatLongDate(date))}</div></label><input class="date-picker" id="date-picker" type="date" max="${today}" value="${date}" /></div><button class="date-button" id="next-day" aria-label="Next day" ${canNext ? '' : 'disabled'}>›</button></div>
      <div class="card progress-card"><div class="progress-ring" style="--progress:${Math.round(pct * 360)}deg;--protein-color:${proteinColor(totals.protein, proteinTarget)}"><div class="ring-content"><div class="ring-consumed">${roundMacro(totals.protein)} g eaten</div><div class="ring-number">${roundMacro(proteinRemaining)} g</div><div class="ring-target">protein left</div><div class="ring-consumed">Target ${roundMacro(proteinTarget)} g</div></div></div><div class="calorie-summary"><div><strong>${Math.round(totals.calories).toLocaleString()} kcal</strong><span>/ ${Math.round(calorieTarget).toLocaleString()} kcal</span></div><progress class="calorie-bar" aria-label="Calories toward daily target" max="${calorieTarget}" value="${Math.min(calorieTarget, totals.calories)}"></progress></div><div class="average-selector" aria-label="Average period"><button data-average-period="7" aria-pressed="${averagePeriod === 7}">7 days</button><button data-average-period="30" aria-pressed="${averagePeriod === 30}">30 days</button></div><div class="average-stat">${average.count ? `<strong>${roundMacro(average.protein)} g protein · ${Math.round(average.calories)} kcal</strong> average recorded intake<br>${average.count} logged day${average.count === 1 ? '' : 's'} · last ${averagePeriod} days` : `No recorded meals in the last ${averagePeriod} days`}</div><div class="weight-average">${renderWeightAverage(weightTrend, averagePeriod)}</div></div>
      ${!hasWeight(day) ? weightCardHtml(day) : ''}
      ${!day.creatine ? creatineCardHtml(day) : ''}
      ${state.copiedMeal ? `<div class="card copied-meal-card"><div class="copied-meal-heading"><div><small>Copied meal</small><strong>${escapeHtml(state.copiedMeal.name)}</strong></div><button class="close-button" id="clear-copied-meal" aria-label="Clear copied meal">×</button></div><div class="copy-controls"><select id="paste-category" aria-label="Paste meal section">${mealOptions(state.copiedMeal.category)}</select><button class="primary-button" id="paste-meal">Paste meal</button></div><div class="copy-footer"><span>To: ${escapeHtml(isToday ? 'Today' : formatDate(date))}</span>${isToday ? '' : '<button class="copy-today" id="copy-go-today">Go to today</button>'}</div></div>` : ''}
      ${MEAL_TYPES.map(type => renderMealSection(type, day)).join('')}
      <button class="card quick-add-toggle find-meal-button" id="find-meal">Find a meal <span aria-hidden="true">⌕</span></button>
      <div class="card activity-card"><div class="activity-head"><strong>Activity</strong><small>Optional markers for this day</small></div><div class="activity-grid">${activityToggle('strength', 'Strength workout', activities.strength)}${activityToggle('run', 'Run', activities.run)}${activityToggle('longBike', 'Longer bike ride', activities.longBike)}</div></div>
      ${day.creatine ? creatineCardHtml(day) : ''}
      ${hasWeight(day) ? weightCardHtml(day) : ''}
    </section>`;
    if (previewDate) return html;
    app.innerHTML = html;
    document.getElementById('find-meal').onclick = () => openMealLibrary();
    document.querySelectorAll('[data-average-period]').forEach(button => button.onclick = () => { averagePeriod = Number(button.dataset.averagePeriod); renderToday(); });
    document.getElementById('prev-day').onclick = () => { selectedDate = shiftDate(date, -1); renderToday(); };
    document.getElementById('next-day').onclick = () => { if (canNext) { selectedDate = shiftDate(date, 1); renderToday(); } };
    document.getElementById('date-picker').onchange = e => { if (e.target.value) { selectedDate = e.target.value; renderToday(); } };
    document.getElementById('creatine').onchange = e => { day.creatine = e.target.checked; saveState(); renderToday(); };
    document.getElementById('save-weight').onclick = () => { const value = num(document.getElementById('morning-weight').value); if (value <= 0) return toast('Enter a valid weight in kg'); day.weightKg = Math.round(value * 10) / 10; saveState(); renderToday(); toast('Morning weight saved'); };
    const deleteWeight = document.getElementById('delete-weight'); if (deleteWeight) deleteWeight.onclick = () => { delete day.weightKg; saveState(); renderToday(); toast('Weight entry deleted'); };
    document.querySelectorAll('[data-activity]').forEach(input => input.onchange = () => { day.activities = { ...(day.activities || {}), [input.dataset.activity]: input.checked }; saveState(); });
    document.querySelectorAll('[data-add-meal]').forEach(btn => btn.onclick = () => openFoodModal(btn.dataset.addMeal));
    document.querySelectorAll('[data-entry-id]').forEach(btn => btn.onclick = () => openExistingEntry(btn.dataset.entryId));
    const pasteMeal = document.getElementById('paste-meal');
    if (pasteMeal) pasteMeal.onclick = () => {
      if (!state.copiedMeal) return;
      const category = document.getElementById('paste-category').value;
      getDay(date).entries.push({ ...mealCopySnapshot(state.copiedMeal), id: uid(), category });
      state.copiedMeal = null;
      saveState(); renderToday(); toast('Meal pasted');
    };
    const clearCopy = document.getElementById('clear-copied-meal');
    if (clearCopy) clearCopy.onclick = () => { state.copiedMeal = null; saveState(); renderToday(); };
    const goToday = document.getElementById('copy-go-today');
    if (goToday) goToday.onclick = () => { selectedDate = localDateKey(new Date()); renderToday(); };
  }

  function activateToday() {
    activeTab = 'today';
    document.querySelectorAll('.tab-button').forEach(button => button.classList.toggle('active', button.dataset.tab === 'today'));
  }
  function proteinColor(value, target = 160) {
    const grams = Math.max(0, num(value));
    if (grams < 100) return '#b56a62';
    if (grams >= num(target) * .85) return '#237a52';
    if (grams < 130) return '#b28b52';
    return '#b1a35c';
  }
  function weightCardHtml(day) {
    return `<div class="card weight-card"><div><strong>Morning body weight</strong><small>${hasWeight(day) ? `${formatWeight(day.weightKg)} kg logged for this day` : 'Optional daily weigh-in'}</small></div><div class="weight-controls"><div class="weight-input"><input id="morning-weight" aria-label="Morning body weight in kilograms" inputmode="decimal" placeholder="82,7" value="${hasWeight(day) ? escapeAttr(day.weightKg) : ''}" /><span>kg</span></div><button class="secondary-button" id="save-weight">Save</button>${hasWeight(day) ? '<button class="weight-delete" id="delete-weight" aria-label="Delete morning weight">×</button>' : ''}</div></div>`;
  }
  function creatineCardHtml(day) {
    return `<label class="card creatine-row"><input id="creatine" type="checkbox" ${day.creatine ? 'checked' : ''}/><span class="checkmark">✓</span><span><strong>Creatine</strong><small>${day.creatine ? 'Taken today' : 'Mark as taken today'}</small></span></label>`;
  }
  function startDaySwipe(event) {
    if (activeTab !== 'today' || modalRoot.innerHTML || swipeAnimating || event.touches.length !== 1 || event.target.closest('input,textarea,select')) return;
    touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY, dx: 0, time: performance.now(), horizontal: false, current: app.querySelector('.day-view') };
  }
  function moveDaySwipe(event) {
    const gesture = touchStart;
    if (!gesture) return;
    if (event.touches.length !== 1) { finishDaySwipe(null); return; }
    const dx = event.touches[0].clientX - gesture.x, dy = event.touches[0].clientY - gesture.y;
    if (!gesture.horizontal) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { touchStart = null; return; }
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
      gesture.horizontal = true;
      gesture.width = app.clientWidth;
      gesture.current.style.willChange = 'transform';
      app.classList.add('day-dragging');
    }
    if (event.cancelable) event.preventDefault();
    gesture.dx = dx;
    const direction = dx > 0 ? -1 : 1, target = shiftDate(selectedDate, direction);
    const allowed = target <= localDateKey(new Date());
    if (gesture.direction !== direction) {
      gesture.preview?.remove();
      gesture.preview = null;
      gesture.direction = direction;
      gesture.target = allowed ? target : null;
      if (allowed) {
        const preview = document.createElement('div');
        preview.className = 'day-preview';
        preview.innerHTML = renderToday(target);
        preview.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
        preview.setAttribute('aria-hidden', 'true');
        preview.inert = true;
        app.appendChild(preview);
        gesture.preview = preview;
      }
    }
    const offset = allowed ? dx : dx * .18;
    gesture.current.style.transform = `translate3d(${offset}px,0,0)`;
    if (gesture.preview) gesture.preview.style.transform = `translate3d(${offset + direction * gesture.width}px,0,0)`;
  }
  function finishDaySwipe(event) {
    const gesture = touchStart;
    touchStart = null;
    if (!gesture?.horizontal) return;
    swipeAnimating = true;
    const speed = Math.abs(gesture.dx) / Math.max(1, performance.now() - gesture.time);
    const commit = Boolean(event && gesture.target && (Math.abs(gesture.dx) > gesture.width * .22 || (Math.abs(gesture.dx) > 45 && speed > .4)));
    const offset = commit ? -gesture.direction * gesture.width : 0;
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
    gesture.current.style.transition = `transform ${duration}ms cubic-bezier(.22,.75,.25,1)`;
    gesture.current.style.transform = `translate3d(${offset}px,0,0)`;
    if (gesture.preview) {
      gesture.preview.style.transition = gesture.current.style.transition;
      gesture.preview.style.transform = `translate3d(${offset + gesture.direction * gesture.width}px,0,0)`;
    }
    setTimeout(() => {
      gesture.preview?.remove();
      app.classList.remove('day-dragging');
      if (commit) selectedDate = gesture.target;
      renderToday();
      swipeAnimating = false;
    }, duration + 30);
  }

  function renderMealSection(type, day) {
    const entries = day.entries.filter(e => e.category === type);
    const protein = sum(entries, 'protein'), calories = sum(entries, 'calories');
    return `<div class="card meal-card"><div class="meal-header"><div><div class="meal-title">${MEAL_LABELS[type]}</div><div class="meal-subtitle">${entries.length ? `${roundMacro(protein)} g protein · ${Math.round(calories)} kcal` : 'No food added'}</div></div><button class="add-button" data-add-meal="${type}">+ Add</button></div>${entries.length ? entries.map(e => `<button class="meal-entry" data-entry-id="${e.id}"><span><strong>${escapeHtml(e.name || e.description || 'Meal')}</strong><span class="entry-badges">${mealBadge(e)}</span></span><span class="entry-macros"><strong>${roundMacro(e.protein)} g protein</strong><small>${Math.round(num(e.calories))} kcal</small></span></button>`).join('') : '<div class="meal-empty">Nothing here yet.</div>'}</div>`;
  }

  function activityToggle(key, label, checked) {
    return `<label class="activity-toggle"><input type="checkbox" data-activity="${key}" ${checked ? 'checked' : ''}/><span class="activity-check">✓</span><span>${label}</span></label>`;
  }

  function renderWeekly() {
    const start = reviewPeriod === 7 ? selectedWeekStart : shiftDate(selectedTrendEnd, -29);
    const report = buildWeeklyReport(start, reviewPeriod);
    const comparison = reviewPeriod === 7 ? 'previous week' : 'previous 30 days';
    const s = report.summary;
    app.innerHTML = `<section class="weekly-view">
      <div class="page-head"><div><h1>Trends</h1><div class="date-sub">${escapeHtml(report.dateRange)}</div></div></div>
      <div class="average-selector review-selector" aria-label="Trend period"><button id="review-7" aria-pressed="${reviewPeriod === 7}">7 days</button><button id="review-30" aria-pressed="${reviewPeriod === 30}">30 days</button></div>
      <div class="week-nav"><button class="date-button" id="prev-week" aria-label="Previous period">‹</button><label class="week-picker-label" for="week-picker"><strong>${reviewPeriod === 7 ? escapeHtml(formatWeekLabel(selectedWeekStart)) : '30 days ending ' + escapeHtml(formatShortDay(selectedTrendEnd))}</strong><span>${reviewPeriod === 7 ? 'Select week' : 'Select end date'}</span></label><input id="week-picker" class="week-picker" type="date" value="${reviewPeriod === 7 ? selectedWeekStart : selectedTrendEnd}"/><button class="date-button" id="next-week" aria-label="Next period">›</button></div>
      <div class="weekly-grid">
        <div class="card metric-card primary-metric"><span>Average morning weight</span><strong>${s.averageWeightKg == null ? '—' : `${formatWeight(s.averageWeightKg)} kg`}</strong><small>${s.weightEntries} weigh-in${s.weightEntries === 1 ? '' : 's'}${s.weightChangeKg == null ? '' : ` · ${signedWeight(s.weightChangeKg)} kg vs ${comparison}`}</small></div>
        <div class="card metric-card"><span>Average recorded protein</span><strong>${s.loggedNutritionDays ? `${roundMacro(s.averageProteinG)} g` : '—'}</strong><small>${s.loggedNutritionDays} logged day${s.loggedNutritionDays === 1 ? '' : 's'}</small></div>
        <div class="card metric-card"><span>Average recorded calories</span><strong>${s.loggedNutritionDays ? Math.round(s.averageCalories).toLocaleString() : '—'}</strong><small>${s.loggedNutritionDays ? 'kcal / logged day' : 'No meals logged'}</small></div>
        <div class="card metric-card"><span>Workouts</span><strong>${s.strengthWorkouts + s.runs + s.longBikeRides}</strong><small>${s.strengthWorkouts} strength · ${s.runs} run · ${s.longBikeRides} bike</small></div>
        <div class="card metric-card"><span>Creatine</span><strong>${s.creatineDays}/${reviewPeriod}</strong><small>days taken</small></div>
      </div>
      <div class="card trend-card"><div class="trend-head"><strong>Weight trend</strong><small>Morning weigh-ins · longer-term changes matter more than daily noise</small></div>${weightTrendSvg(report.days)}</div>
      <div class="section-kicker">Daily overview</div>
      <div class="card daily-review">${report.days.map(d => `<div class="daily-review-row"><div><strong>${escapeHtml(formatShortDay(d.date))}</strong><small>${d.weightKg == null ? 'No weigh-in' : `${formatWeight(d.weightKg)} kg`}</small></div><div class="daily-review-macros"><strong>${d.hasNutrition ? `${roundMacro(d.proteinG)} g protein` : 'No meals logged'}</strong><small>${d.hasNutrition ? `${Math.round(d.calories)} kcal recorded` : '—'}</small></div></div>`).join('')}</div>
      <div class="section-kicker">Export ${reviewPeriod === 7 ? 'this week' : 'these 30 days'}</div>
      <div class="card export-card"><div><strong>Full nutrition + weight report</strong><small>Includes daily data, activities, creatine, meals and ingredient-level detail.</small></div><div class="export-actions"><button class="primary-button" id="export-csv">Export CSV</button><button class="secondary-button" id="export-json">Export JSON</button></div></div>
    </section>`;
    document.getElementById('review-7').onclick = () => { reviewPeriod = 7; renderWeekly(); };
    document.getElementById('review-30').onclick = () => { reviewPeriod = 30; renderWeekly(); };
    document.getElementById('prev-week').onclick = () => { if (reviewPeriod === 7) selectedWeekStart = shiftDate(selectedWeekStart, -7); else selectedTrendEnd = shiftDate(selectedTrendEnd, -30); renderWeekly(); };
    document.getElementById('next-week').onclick = () => { if (reviewPeriod === 7) selectedWeekStart = shiftDate(selectedWeekStart, 7); else selectedTrendEnd = shiftDate(selectedTrendEnd, 30); renderWeekly(); };
    document.getElementById('week-picker').onchange = e => { if (e.target.value) { if (reviewPeriod === 7) selectedWeekStart = weekStartKey(e.target.value); else selectedTrendEnd = e.target.value; renderWeekly(); } };
    document.getElementById('export-csv').onclick = () => exportWeeklyReport(report, 'csv');
    document.getElementById('export-json').onclick = () => exportWeeklyReport(report, 'json');
  }

  function buildWeeklyReport(startDate, period = 7) {
    const dates = Array.from({ length: period }, (_, i) => shiftDate(startDate, i));
    const days = dates.map(date => {
      const source = state.days[date] || { date, entries: [] };
      const totals = dayTotals(source);
      const activities = source.activities || {};
      const entries = Array.isArray(source.entries) ? source.entries : [];
      return { date, weightKg: hasWeight(source) ? Number(source.weightKg) : null, hasNutrition: entries.length > 0, calories: totals.calories, proteinG: totals.protein, creatine: Boolean(source.creatine), strengthWorkout: Boolean(activities.strength), run: Boolean(activities.run), longBikeRide: Boolean(activities.longBike), meals: entries.map(entry => ({ id: entry.id, section: MEAL_LABELS[entry.category] || entry.category || '', name: entry.name || entry.description || 'Meal', description: entry.description || '', calories: num(entry.calories), proteinG: num(entry.protein), manualWeightG: entry.manualWeightG != null ? num(entry.manualWeightG) : null, ingredients: activeIngredients(entry.ingredients) })) };
    });
    const weights = days.map(d => d.weightKg).filter(v => v != null);
    const previousWeights = Array.from({ length: period }, (_, i) => shiftDate(startDate, -period + i)).map(date => state.days[date]).filter(hasWeight).map(day => Number(day.weightKg));
    const averageWeightKg = averageNumbers(weights);
    const previousAverageWeightKg = averageNumbers(previousWeights);
    const loggedDays = days.filter(d => d.hasNutrition);
    const summary = {
      averageWeightKg,
      previousAverageWeightKg,
      weightChangeKg: averageWeightKg == null || previousAverageWeightKg == null ? null : averageWeightKg - previousAverageWeightKg,
      weightEntries: weights.length,
      loggedNutritionDays: loggedDays.length,
      averageCalories: averageNumbers(loggedDays.map(d => d.calories)) || 0,
      averageProteinG: averageNumbers(loggedDays.map(d => d.proteinG)) || 0,
      strengthWorkouts: days.filter(d => d.strengthWorkout).length,
      runs: days.filter(d => d.run).length,
      longBikeRides: days.filter(d => d.longBikeRide).length,
      creatineDays: days.filter(d => d.creatine).length
    };
    return { periodDays: period, weekStart: startDate, weekEnd: dates[period - 1], dateRange: `${formatLongDate(startDate)} – ${formatLongDate(dates[period - 1])}`, summary, days };
  }

  function rollingWeightSummary(endDate, period = 7) {
    const current = Array.from({ length: period }, (_, i) => state.days[shiftDate(endDate, -i)]).filter(hasWeight).map(day => Number(day.weightKg));
    const previous = Array.from({ length: period }, (_, i) => state.days[shiftDate(endDate, -period - i)]).filter(hasWeight).map(day => Number(day.weightKg));
    const averageKg = averageNumbers(current), previousAverageKg = averageNumbers(previous);
    return { averageKg, previousAverageKg, count: current.length, changeKg: averageKg == null || previousAverageKg == null ? null : averageKg - previousAverageKg };
  }

  function renderWeightAverage(trend, period = 7) {
    if (trend.averageKg == null) return `Log morning weight to see a ${period}-day average`;
    return `<strong>${formatWeight(trend.averageKg)} kg</strong> average weight · ${trend.count} weigh-in${trend.count === 1 ? '' : 's'}${trend.changeKg == null ? '' : `<br>${signedWeight(trend.changeKg)} kg vs previous ${period} days`}`;
  }

  function weightTrendSvg(days) {
    const values = days.map((d, i) => d.weightKg == null ? null : { i, value: d.weightKg }).filter(Boolean);
    if (!values.length) return '<div class="trend-empty">No morning weigh-ins logged in this period.</div>';
    const min = Math.min(...values.map(p => p.value)), max = Math.max(...values.map(p => p.value)), range = max - min;
    const points = values.map(p => ({ ...p, x: 12 + p.i * 276 / Math.max(1, days.length - 1), y: range ? 48 - ((p.value - min) / range) * 34 : 31 }));
    const line = points.map(p => `${p.x},${p.y}`).join(' ');
    return `<svg class="weight-chart" viewBox="0 0 300 72" role="img" aria-label="Weight trend for the selected period"><polyline class="trend-line" points="${line}"/>${points.map(p => `<circle class="trend-dot" cx="${p.x}" cy="${p.y}" r="3"><title>${formatWeight(p.value)} kg</title></circle>`).join('')}${days.map((d, i) => days.length > 7 && i !== days.length - 1 && (i % 7 !== 0 || i > days.length - 4) ? '' : `<text x="${12 + i * 276 / Math.max(1, days.length - 1)}" y="68">${escapeHtml(days.length <= 7 ? formatWeekdayLetter(d.date) : String(parseLocalDate(d.date).getDate()))}</text>`).join('')}</svg>`;
  }

  async function exportWeeklyReport(report, format) {
    try {
      const isCsv = format === 'csv';
      const content = isCsv ? weeklyCsv(report) : JSON.stringify(report, null, 2);
      const filename = `protein-log-${report.weekStart}-to-${report.weekEnd}.${format}`;
      await shareOrDownload(content, isCsv ? 'text/csv;charset=utf-8' : 'application/json', filename);
    } catch { toast('Could not export this report'); }
  }

  function weeklyCsv(report) {
    const columns = ['week_start','week_end','weekly_average_weight_kg','weight_change_vs_previous_week_kg','weight_entries','logged_nutrition_days','average_recorded_calories','average_recorded_protein_g','weekly_strength_workouts','weekly_runs','weekly_long_bike_rides','creatine_days_out_of_7','date','morning_weight_kg','nutrition_logged','daily_calories','daily_protein_g','creatine','strength_workout','run','long_bike_ride','meal_section','meal_name','food_name','quantity_g','item_calories','item_protein_g','meal_calories','meal_protein_g','meal_description'];
    const rows = [];
    const weekly = { week_start: report.weekStart, week_end: report.weekEnd, weekly_average_weight_kg: report.summary.averageWeightKg == null ? '' : roundExport(report.summary.averageWeightKg), weight_change_vs_previous_week_kg: report.summary.weightChangeKg == null ? '' : roundExport(report.summary.weightChangeKg), weight_entries: report.summary.weightEntries, logged_nutrition_days: report.summary.loggedNutritionDays, average_recorded_calories: report.summary.loggedNutritionDays ? roundExport(report.summary.averageCalories) : '', average_recorded_protein_g: report.summary.loggedNutritionDays ? roundExport(report.summary.averageProteinG) : '', weekly_strength_workouts: report.summary.strengthWorkouts, weekly_runs: report.summary.runs, weekly_long_bike_rides: report.summary.longBikeRides, creatine_days_out_of_7: report.summary.creatineDays };
    report.days.forEach(day => {
      const daily = { ...weekly, date: day.date, morning_weight_kg: day.weightKg ?? '', nutrition_logged: yesNo(day.hasNutrition), daily_calories: day.hasNutrition ? roundExport(day.calories) : '', daily_protein_g: day.hasNutrition ? roundExport(day.proteinG) : '', creatine: yesNo(day.creatine), strength_workout: yesNo(day.strengthWorkout), run: yesNo(day.run), long_bike_ride: yesNo(day.longBikeRide) };
      if (!day.meals.length) { rows.push(daily); return; }
      day.meals.forEach(meal => {
        const mealBase = { ...daily, meal_section: meal.section, meal_name: meal.name, meal_calories: roundExport(meal.calories), meal_protein_g: roundExport(meal.proteinG), meal_description: meal.description };
        if (!meal.ingredients.length) { rows.push({ ...mealBase, food_name: meal.name, quantity_g: meal.manualWeightG ?? '', item_calories: roundExport(meal.calories), item_protein_g: roundExport(meal.proteinG) }); return; }
        meal.ingredients.forEach(item => {
          const amount = num(item.amount), factor = amount / 100;
          rows.push({ ...mealBase, food_name: item.name || 'Ingredient', quantity_g: amount, item_calories: roundExport(factor * num(item.caloriesPer100g)), item_protein_g: roundExport(factor * num(item.proteinPer100g)) });
        });
      });
    });
    const headers = report.periodDays === 30 ? columns.map(column => column.replace(/^week_/, 'period_').replace(/^weekly_/, 'period_').replace('previous_week', 'previous_30_days').replace('out_of_7', 'out_of_30')) : columns;
    return [headers.join(','), ...rows.map(row => columns.map(column => csvCell(row[column] ?? '')).join(','))].join('\n');
  }

  async function shareOrDownload(content, mimeType, filename) {
    const file = typeof File !== 'undefined' ? new File([content], filename, { type: mimeType }) : null;
    if (file && navigator.share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Protein Log nutrition report' }); return; }
      catch (err) { if (err?.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function mealBadge(meal) {
    const quality = meal.quality || (meal.source === 'manual' ? 'manual' : '');
    return quality ? `<small class="meal-quality">${quality === 'manual' ? 'Manual' : 'Edited'}</small>` : '';
  }
  function ingredientEditFingerprint(ingredients) {
    // Compare the editable nutrition/identity fields, never portion sizes.
    // Match the displayed precision so saving a rounded AI value is not an edit.
    return JSON.stringify(ingredients.map(i => [String(i.name || '').trim(), roundInput(i.proteinPer100g), roundInput(i.caloriesPer100g)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  }
  function mealFingerprint(meal) {
    // A recipe is its ingredients and nutrition, not its portion size or AI title.
    // Normalize legacy meals using the same conservative fallbacks as the editor.
    const normalized = prepareIngredientEditor(normalizeExisting(meal));
    const ingredients = normalized.ingredients.map(i => [i.name.trim().toLowerCase().replace(/\s+/g, ' '), roundInput(i.proteinPer100g), roundInput(i.caloriesPer100g)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return JSON.stringify(ingredients);
  }
  function mealLibrary(query = '', category = null) {
    const variants = new Map();
    const add = (meal, date = '') => {
      const section = MEAL_TYPES.includes(meal.category) ? meal.category : 'snacks';
      if (category && section !== category) return;
      const key = section + ':' + mealFingerprint(meal), current = variants.get(key);
      const searchText = [meal.name, meal.description, ...(meal.ingredients || []).map(i => i.name)].join(' ').toLowerCase();
      if (!current) variants.set(key, { meal: { ...clone(meal), category: section }, date, count: date ? 1 : 0, searchText });
      else {
        if (date) current.count++;
        current.searchText += ' ' + searchText;
        if (date && date >= current.date) { const quality = current.meal.quality; current.meal = { ...clone(meal), category: section }; current.date = date; if (!current.meal.quality && quality) current.meal.quality = quality; }
        if (meal.quality) current.meal.quality = meal.quality;
      }
    };
    state.savedMeals.forEach(meal => add(meal));
    Object.entries(state.days).forEach(([date, day]) => (day.entries || []).forEach(meal => add(meal, date)));
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return [...variants.values()].filter(item => terms.every(term => item.searchText.includes(term)))
      .sort((a, b) => b.count - a.count || b.date.localeCompare(a.date) || String(a.meal.name || '').localeCompare(String(b.meal.name || '')));
  }
  function libraryResultsHtml(items, grouped = true, expanded = false) {
    if (!items.length) return '<div class="empty-card">No matching meals yet.</div>';
    const card = (item, index) => `<button class="card library-meal" data-library-index="${index}"><span class="library-title"><strong>${escapeHtml(item.meal.name || item.meal.description || 'Meal')}</strong>${mealBadge(item.meal)}</span><span class="library-ingredients">${escapeHtml((item.meal.ingredients || []).map(i => `${roundInput(i.amount)} g ${i.name}`).join(' · ') || item.meal.description || '')}</span><span class="library-macros">${roundMacro(item.meal.protein)} g protein · ${Math.round(num(item.meal.calories))} kcal</span><small>${item.date ? `Used ${item.count} time${item.count === 1 ? '' : 's'} · Last logged ${escapeHtml(formatLongDate(item.date))}` : 'Previously saved meal'}</small></button>`;
    if (!grouped) return items.map(card).join('');
    return MEAL_TYPES.map(category => {
      const cards = items.map((item, index) => item.meal.category === category ? card(item, index) : '').join('');
      const count = items.filter(item => item.meal.category === category).length;
      return cards ? `<details class="library-section"${expanded ? ' open' : ''}><summary><span>${MEAL_LABELS[category]}</span><small>${count} meal${count === 1 ? '' : 's'}</small><span class="library-chevron" aria-hidden="true">⌄</span></summary>${cards}</details>` : '';
    }).join('');
  }
  function bindLibraryResults(query, container, choose) {
    const items = mealLibrary(query);
    container.innerHTML = libraryResultsHtml(items, true, Boolean(query.trim()));
    container.querySelectorAll('[data-library-index]').forEach(button => button.onclick = () => choose(clone(items[Number(button.dataset.libraryIndex)].meal)));
  }
  function renderSaved() {
    app.innerHTML = '<div class="page-head"><h1>Meals</h1></div><div class="settings-help">Most-used meals first in each section. Choose one and adjust quantities.</div><div class="field"><input id="library-search" type="search" aria-label="Search meals" placeholder="Search meals or ingredients" /></div><div id="library-results"></div>';
    const input = document.getElementById('library-search'), results = document.getElementById('library-results');
    const update = () => bindLibraryResults(input.value, results, meal => openMealLibrary(null, meal));
    input.oninput = update; update();
  }
  function openMealLibrary(category = null, selectedMeal = null) {
    lockPage();
    modalRoot.innerHTML = `<div class="modal-backdrop"><div class="sheet"><div class="sheet-handle"></div><div class="sheet-head"><h2>Find a meal</h2><button class="close-button" id="close-library" aria-label="Close meal search">×</button></div>${category ? '' : `<div class="field"><label for="library-category">Add to</label><select id="library-category">${mealOptions(selectedMeal?.category || 'breakfast')}</select></div>`}<div class="field"><input id="meal-search" type="search" aria-label="Search previous meals" placeholder="Search meals or ingredients" /></div><div id="meal-search-results"></div></div></div>`;
    document.getElementById('close-library').onclick = closeModal;
    const input = document.getElementById('meal-search'), results = document.getElementById('meal-search-results');
    const choose = meal => openFoodModal(category || document.getElementById('library-category').value, null, meal);
    if (selectedMeal) {
      results.innerHTML = libraryResultsHtml([{ meal: selectedMeal, date: '', count: 0 }], false);
      results.querySelectorAll('[data-library-index]').forEach(button => button.onclick = () => choose(selectedMeal));
    } else bindLibraryResults('', results, choose);
    input.oninput = () => bindLibraryResults(input.value, results, choose);
  }

  function renderSettings() {
    app.innerHTML = `<h1>Settings</h1><div class="section-kicker">Appearance</div><div class="card settings-group"><div class="settings-row"><label class="settings-label" for="theme-select">Theme</label><select id="theme-select"><option value="system" ${(state.settings.theme || 'system') === 'system' ? 'selected' : ''}>System default</option><option value="light" ${state.settings.theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${state.settings.theme === 'dark' ? 'selected' : ''}>Dark</option></select></div></div><div class="section-kicker">Targets</div><div class="card settings-group"><div class="settings-row"><label class="settings-label" for="protein-target">Daily protein target</label><input id="protein-target" type="number" inputmode="decimal" min="1" step="1" value="${Number(state.settings.proteinTarget) || 160}" /></div><div class="settings-row"><label class="settings-label" for="calorie-target">Daily calorie guide</label><input id="calorie-target" type="number" inputmode="numeric" min="1" step="50" value="${Number(state.settings.calorieTarget) || 2500}" /><div class="settings-help">Calories are shown as a neutral guide. Protein remains the primary target.</div></div></div><div class="section-kicker">Claude</div><div class="card settings-group"><div class="settings-row"><label class="settings-label" for="claude-api-key">Claude API key</label><input id="claude-api-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…" value="${escapeAttr(state.settings.claudeApiKey || '')}" /><div class="settings-help">Stored only in this browser. AI analysis is optional; meals can always be entered manually.</div></div></div><div class="card settings-group"><div class="settings-row"><strong>Storage</strong><div class="settings-help">Meals, targets, creatine checks, activities, weight, appearance and your Claude key stay in Safari on this iPhone.</div></div></div>`;
    document.getElementById('theme-select').onchange = e => { state.settings.theme = e.target.value; applyTheme(); saveState(); toast('Theme saved'); };
    bindSetting('protein-target', 'proteinTarget', 160, 'Protein target saved');
    bindSetting('calorie-target', 'calorieTarget', 2500, 'Calorie goal saved');
    document.getElementById('claude-api-key').onchange = e => { state.settings.claudeApiKey = e.target.value.trim(); saveState(); toast('Claude API key saved locally'); };
  }
  function bindSetting(id, key, fallback, message) { document.getElementById(id).onchange = e => { state.settings[key] = Math.max(1, Number(e.target.value) || fallback); saveState(); toast(message); }; }

  function openFoodModal(category, existing = null, reused = null) {
    lockPage();
    const originalMeal = existing || reused;
    let draft = originalMeal ? prepareIngredientEditor(normalizeExisting(originalMeal)) : { name: '', description: '', protein: 0, calories: 0, ingredients: [], manualTotals: { protein: false, calories: false } };
    let analyzedWithAI = originalMeal?.source === 'ai';
    let nameEdited = Boolean(originalMeal);
    let quality = originalMeal?.quality || (originalMeal?.source === 'manual' ? 'manual' : '');
    let ingredientBaseline = ingredientEditFingerprint(draft.ingredients);
    const markIngredientEdit = () => { if (ingredientEditFingerprint(draft.ingredients) !== ingredientBaseline && quality !== 'manual') quality = 'edited'; };
    let entryMode = originalMeal ? 'ingredients' : 'choice';
    modalRoot.innerHTML = `<div class="modal-backdrop"><div class="sheet"><div class="sheet-handle"></div><div class="sheet-head"><h2>${existing ? 'Edit meal' : `Add ${MEAL_LABELS[category]}`}</h2><button class="close-button" id="close-sheet">×</button></div><div id="food-editor"></div></div></div>`;
    document.getElementById('close-sheet').onclick = closeModal;
    renderFoodEditor();

    function renderFoodEditor() {
      const root = document.getElementById('food-editor');
      const showNutrition = entryMode !== 'choice';
      modalRoot._ingredients = draft.ingredients;
      const ingredientEditor = showNutrition ? `<div class="ingredient-editor"><div class="ingredient-editor-head"><strong>Ingredients</strong><button class="secondary-button add-ingredient" id="add-food-ingredient">+ Add ingredient</button></div><div class="ingredient-head"><span>Ingredient</span><span>Amount</span></div><div class="ingredient-list">${draft.ingredients.map((ing, i) => ingredientRowHtml(ing, i)).join('')}</div><div class="settings-help">Enter each ingredient separately. Totals update automatically.</div></div><div class="calculated-total" id="calculated-meal-total">Meal total: <strong>${roundMacro(draft.protein)} g protein · ${Math.round(draft.calories)} kcal</strong></div>` : '';
      const saveControls = showNutrition ? `${existing ? '<div class="copy-entry-action"><button class="secondary-button" id="copy-entry">Copy meal</button><small>Copy these values to paste on another day</small></div>' : ''}<div class="modal-actions">${existing ? '<button class="secondary-button danger" id="delete-entry">Delete</button>' : '<button class="secondary-button" id="cancel-entry">Cancel</button>'}<button class="primary-button" id="save-entry">${existing ? 'Save meal' : 'Add meal'}</button></div>` : '<div class="modal-actions single"><button class="secondary-button" id="cancel-entry">Cancel</button></div>';
      root.innerHTML = `${!existing ? '<button class="secondary-button search-meal-button" id="search-previous-meals">Find a previous meal</button>' : ''}<div class="field"><label for="meal-name">Meal name</label><input id="meal-name" placeholder="e.g. Skyr with muesli" value="${escapeAttr(draft.name || '')}" /></div><div class="field"><label for="food-text">Description for Claude (optional for manual entry)</label><textarea id="food-text" placeholder="e.g. skyr with muesli">${escapeHtml(draft.description || draft.name || '')}</textarea></div><div class="analysis-action"><button class="primary-button" id="analyze-food">Analyze with Claude</button>${entryMode === 'choice' ? '<button class="manual-entry-button" id="manual-food">Enter manually</button>' : '<small>Run again if the description changes</small>'}</div><div id="food-error"></div>${ingredientEditor}${saveControls}`;
      if (entryMode === 'choice') {
        const suggestions = mealLibrary('', category).slice(0, 3);
        if (suggestions.length) {
          root.insertAdjacentHTML('beforeend', `<div class="meal-suggestions"><h3 class="section-kicker">Most used for ${MEAL_LABELS[category].toLowerCase()}</h3><div class="settings-help">Choose a meal, then adjust quantities.</div>${libraryResultsHtml(suggestions, false)}</div>`);
          root.querySelectorAll('[data-library-index]').forEach(button => button.onclick = () => openFoodModal(category, null, clone(suggestions[Number(button.dataset.libraryIndex)].meal)));
        }
      }
      document.getElementById('meal-name').oninput = e => { draft.name = e.target.value; nameEdited = true; };
      const searchPrevious = document.getElementById('search-previous-meals');
      if (searchPrevious) searchPrevious.onclick = () => openMealLibrary(category);
      document.getElementById('food-text').oninput = e => { draft.description = e.target.value; };
      document.getElementById('analyze-food').onclick = async () => {
        const text = document.getElementById('food-text').value.trim() || document.getElementById('meal-name').value.trim();
        if (!text) return showInlineError('food-error', 'Enter a meal name or description first.');
        const button = document.getElementById('analyze-food'); button.disabled = true; button.textContent = 'Analyzing…';
        try { const result = await analyzeFood(text, category); draft = prepareIngredientEditor({ ...result, name: nameEdited && draft.name.trim() ? draft.name.trim() : result.name, description: text, manualTotals: { protein: false, calories: false } }); analyzedWithAI = true; quality = ''; ingredientBaseline = ingredientEditFingerprint(draft.ingredients); entryMode = 'analyzed'; renderFoodEditor(); }
        catch (err) { button.disabled = false; button.textContent = 'Analyze with Claude'; showInlineError('food-error', err.message || 'Could not analyze that meal.'); }
      };
      const manualButton = document.getElementById('manual-food'); if (manualButton) manualButton.onclick = () => { draft = prepareIngredientEditor({ ...draft, description: document.getElementById('food-text').value, ingredients: [blankIngredient()], manualTotals: { protein: false, calories: false } }); quality = 'manual'; ingredientBaseline = ingredientEditFingerprint(draft.ingredients); entryMode = 'manual'; renderFoodEditor(); };
      const cancel = document.getElementById('cancel-entry'); if (cancel) cancel.onclick = closeModal;
      if (!showNutrition) return;
      document.getElementById('add-food-ingredient').onclick = () => { syncDraft(); draft.ingredients.push(blankIngredient()); markIngredientEdit(); renderFoodEditor(); };
      if (existing) {
        document.getElementById('copy-entry').onclick = () => {
          syncDraft();
          state.copiedMeal = mealCopySnapshot({ ...draft, category, quality });
          selectedDate = localDateKey(new Date());
          activateToday();
          saveState(); closeModal(); renderToday(); toast('Meal copied — ready to paste today');
        };
      }
      root.querySelectorAll('.ingredient-row input').forEach(input => input.addEventListener('input', () => { draft.ingredients = readIngredientRows(); markIngredientEdit(); draft = calculateFromIngredients({ ...draft, manualTotals: { protein: false, calories: false } }); updateCalculatedTotal(); }));
      root.querySelectorAll('[data-remove-ingredient]').forEach(button => button.onclick = () => { syncDraft(); draft.ingredients.splice(Number(button.dataset.removeIngredient), 1); if (!draft.ingredients.length) draft.ingredients.push(blankIngredient()); markIngredientEdit(); draft = calculateFromIngredients(draft); renderFoodEditor(); });
      const del = document.getElementById('delete-entry'); if (del) del.onclick = () => { const d = getDay(selectedDate); d.entries = d.entries.filter(e => e.id !== existing.id); saveState(); closeModal(); renderToday(); };
      document.getElementById('save-entry').onclick = () => {
        syncDraft();
        if (!draft.name.trim() && !draft.description.trim()) return showInlineError('food-error', 'Enter a meal name or description.');
        if (!draft.ingredients.length) return showInlineError('food-error', 'Add at least one ingredient.');
        const d = getDay(selectedDate);
        const description = draft.description.trim();
        const entry = { id: existing?.id || uid(), category, description, name: draft.name.trim() || description, quality, protein: num(draft.protein), calories: num(draft.calories), manualTotals: { protein: false, calories: false }, ingredients: activeIngredients(draft.ingredients), source: analyzedWithAI ? 'ai' : (originalMeal?.source || 'manual'), ...(existing?.savedMealId ? { savedMealId: existing.savedMealId } : {}) };
        const idx = d.entries.findIndex(e => e.id === entry.id);
        if (idx >= 0) d.entries[idx] = entry; else d.entries.push(entry);
        saveState(); closeModal(); activateToday(); renderToday();
        toast(existing ? 'Meal updated' : 'Meal added');
      };
      function syncDraft() { draft.name = document.getElementById('meal-name').value; draft.description = document.getElementById('food-text').value; if (root.querySelectorAll('.ingredient-row').length) draft.ingredients = readIngredientRows(); markIngredientEdit(); draft = calculateFromIngredients({ ...draft, manualTotals: { protein: false, calories: false }, manualWeightG: undefined, per100Totals: null }); }
      function updateCalculatedTotal() { const el = document.getElementById('calculated-meal-total'); if (el) el.innerHTML = `Meal total: <strong>${roundMacro(draft.protein)} g protein · ${Math.round(draft.calories)} kcal</strong>`; }
    }
  }

  function openExistingEntry(id) { const entry = getDay(selectedDate).entries.find(e => e.id === id); if (entry) openFoodModal(entry.category, entry); }
  async function analyzeFood(text, mealType) {
    const apiKey = (state.settings.claudeApiKey || '').trim();
    if (!apiKey) { const demo = localEstimate(text); if (demo) return demo; throw new Error('Add your Claude API key in Settings first.'); }
    if (!apiKey.startsWith('sk-ant-')) throw new Error('That does not look like an Anthropic API key. It should begin with sk-ant-.');
    const system = `You are the nutrition analysis engine for a personal iPhone food tracker. The user may write in English or Danish. Estimate practical everyday nutrition with protein as the primary measurement and calories as the only secondary measurement. Explicit quantities are constraints, not a total meal budget. A weight directly before an ingredient belongs to that ingredient alone, even when other foods follow with "and", "with", "og" or "med". Keep every stated ingredient weight exactly; estimate sensible portions independently only for ingredients with no stated amount. Example: "200g of chicken and cabbage with bread" means chicken amount=200, plus an estimated cabbage portion and an estimated bread portion; NEVER divide the 200g among chicken, cabbage and bread. Danish example: "200 g kylling med kål og brød" also fixes chicken at 200 g. Only distribute a weight across a mixed dish when the user explicitly describes a total, combined weight or a serving of that mixed dish (for example "200g in total of chicken, cabbage and bread" or "200g chicken and cabbage stew"). Preserve separate weights such as "200g chicken and 50g bread". Do not shrink stated weights to fit typical portions or calorie assumptions. Use grams for ingredient amounts whenever possible; convert pieces, scoops and millilitres to a practical edible gram weight. Return ONLY valid JSON exactly shaped as: {"name":"short meal name","protein":0,"calories":0,"ingredients":[{"name":"ingredient","amount":0,"proteinPer100g":0,"caloriesPer100g":0}]}. Do not return any other nutrition fields. Totals should equal the sum of amount/100 multiplied by each per-100g value, allowing normal rounding.`;
    let response;
    try { response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1400, temperature: 0, system, messages: [{ role: 'user', content: `Meal type: ${mealType}.\nFood: ${text}` }] }) }); } catch { throw new Error('Could not reach Claude. Check your internet connection and try again.'); }
    if (!response.ok) { let detail = ''; try { detail = (await response.json())?.error?.message || ''; } catch {} if (response.status === 401) throw new Error('Claude rejected the API key. Check the key in Settings.'); if (response.status === 429) throw new Error('Claude rate limit reached. Try again shortly.'); throw new Error(detail || `Claude API returned ${response.status}.`); }
    const data = await response.json(); let output = data?.content?.find(block => block.type === 'text')?.text || ''; output = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let raw; try { raw = JSON.parse(output); } catch { throw new Error('Claude returned nutrition data in an unexpected format. Try Analyze again.'); }
    const normalized = normalizeAIResult(raw); if (!normalized) throw new Error('Claude returned incomplete nutrition data. Try Analyze again.'); return normalized;
  }

  function normalizeAIResult(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.ingredients)) return null;
    const ingredients = activeIngredients(raw.ingredients);
    if (!ingredients.length) return null;
    return calculateFromIngredients({ name: String(raw.name || 'Meal'), protein: 0, calories: 0, ingredients });
  }
  function normalizeExisting(item) {
    const ingredients = activeIngredients(item?.ingredients);
    const totalAmount = ingredients.reduce((sum, ingredient) => sum + num(ingredient.amount), 0);
    const fallbackProtein = totalAmount ? num(item.protein) * 100 / totalAmount : 0;
    const fallbackCalories = totalAmount ? num(item.calories) * 100 / totalAmount : 0;
    return { id: item.id, quality: item.quality || (item.source === 'manual' ? 'manual' : ''), name: item.name || item.description || 'Meal', description: item.description || item.name || '', category: MEAL_TYPES.includes(item.category) ? item.category : 'snacks', protein: num(item.protein), calories: num(item.calories), manualTotals: normalizeManualTotals(item.manualTotals, true), ...(item.manualWeightG != null ? { manualWeightG: num(item.manualWeightG) } : {}), per100Totals: normalizePer100Totals(item.per100Totals, item, totalAmount || num(item.manualWeightG)), ingredients: ingredients.map(ingredient => ({ ...ingredient, proteinPer100g: ingredient.proteinPer100g != null && Number.isFinite(Number(ingredient.proteinPer100g)) ? num(ingredient.proteinPer100g) : fallbackProtein, caloriesPer100g: ingredient.caloriesPer100g != null && Number.isFinite(Number(ingredient.caloriesPer100g)) ? num(ingredient.caloriesPer100g) : fallbackCalories })), usageCount: num(item.usageCount), source: item.source, savedMealId: item.savedMealId };
  }
  function calculateFromIngredients(meal) { if (!meal.ingredients.length) return meal; return { ...meal, protein: meal.ingredients.reduce((s, i) => s + num(i.amount) * num(i.proteinPer100g) / 100, 0), calories: meal.ingredients.reduce((s, i) => s + num(i.amount) * num(i.caloriesPer100g) / 100, 0) }; }
  function totalIngredientAmount(ingredients) { return (Array.isArray(ingredients) ? ingredients : []).reduce((sum, ingredient) => sum + num(ingredient.amount), 0); }
  function normalizePer100Totals(value, meal, amount = totalIngredientAmount(meal?.ingredients) || num(meal?.manualWeightG)) { if (!amount) return value ? { protein: num(value.protein), calories: num(value.calories) } : null; return { protein: Number.isFinite(Number(value?.protein)) ? num(value.protein) : num(meal?.protein) * 100 / amount, calories: Number.isFinite(Number(value?.calories)) ? num(value.calories) : num(meal?.calories) * 100 / amount }; }
  function blankIngredient() { return { name: '', amount: 0, proteinPer100g: 0, caloriesPer100g: 0 }; }
  function prepareIngredientEditor(meal) {
    let ingredients = activeIngredients(meal?.ingredients);
    if (!ingredients.length) {
      const amount = num(meal?.manualWeightG) || (num(meal?.protein) || num(meal?.calories) ? 100 : 0);
      const per100 = normalizePer100Totals(meal?.per100Totals, meal, amount) || { protein: 0, calories: 0 };
      ingredients = [{ name: meal?.name || meal?.description || '', amount, proteinPer100g: per100.protein, caloriesPer100g: per100.calories }];
    }
    return calculateFromIngredients({ ...meal, ingredients, manualTotals: { protein: false, calories: false }, manualWeightG: undefined, per100Totals: null });
  }
  function editorNutrition(meal) { const ingredientAmount = totalIngredientAmount(meal.ingredients), amount = ingredientAmount || num(meal.manualWeightG), isManualPer100 = meal.manualWeightG != null, usesPer100 = ingredientAmount > 0 || isManualPer100, per100Totals = normalizePer100Totals(meal.per100Totals, meal, amount) || { protein: 0, calories: 0 }; return { amount, usesPer100, isManualPer100, proteinValue: usesPer100 ? per100Totals.protein : meal.protein, caloriesValue: usesPer100 ? per100Totals.calories : meal.calories, per100Totals }; }
  function applyEditorValue(meal, field, value) { const nutrition = editorNutrition(meal), next = num(value), manualTotals = { ...normalizeManualTotals(meal.manualTotals), [field]: true }; if (!nutrition.usesPer100) return { ...meal, [field]: next, manualTotals }; const per100Totals = { ...nutrition.per100Totals, [field]: next }; return { ...meal, [field]: next * nutrition.amount / 100, manualTotals, per100Totals }; }
  function applyManualWeight(meal, value) { const nutrition = editorNutrition(meal), amount = num(value), per100Totals = nutrition.per100Totals || { protein: 0, calories: 0 }; return { ...meal, manualWeightG: amount, per100Totals, protein: per100Totals.protein * amount / 100, calories: per100Totals.calories * amount / 100, manualTotals: { protein: true, calories: true } }; }
  function recalculateUnfixedTotals(meal) { const calculated = calculateFromIngredients(meal), amount = totalIngredientAmount(meal.ingredients), currentPer100 = normalizePer100Totals(meal.per100Totals, meal, amount), manual = normalizeManualTotals(meal.manualTotals); const protein = manual.protein ? (amount && currentPer100 ? currentPer100.protein * amount / 100 : meal.protein) : calculated.protein; const calories = manual.calories ? (amount && currentPer100 ? currentPer100.calories * amount / 100 : meal.calories) : calculated.calories; return { ...meal, protein, calories, per100Totals: amount ? { protein: manual.protein ? currentPer100.protein : protein * 100 / amount, calories: manual.calories ? currentPer100.calories : calories * 100 / amount } : null };
  }
  function localEstimate(text) { const s = text.toLowerCase(); if (!s.includes('100g oats') && !s.includes('100 g oats')) return null; const ingredients = [{ name: 'Oats', amount: 100, proteinPer100g: 13.2, caloriesPer100g: 379 }, { name: 'Milk', amount: 258, proteinPer100g: 3.4, caloriesPer100g: 61 }]; return calculateFromIngredients({ name: 'Oats with milk', ingredients }); }

  function ingredientRowHtml(ing, i) { return `<div class="ingredient-row"><input aria-label="Ingredient" data-ing-index="${i}" data-ing-field="name" value="${escapeAttr(ing.name || '')}" /><div class="amount-input"><input aria-label="Amount in grams" data-ing-index="${i}" data-ing-field="amount" inputmode="decimal" value="${escapeAttr(roundInput(ing.amount))}" /><span>g</span></div><div class="ingredient-nutrients"><label><span>Protein /100g</span><input aria-label="Protein per 100 grams" data-ing-index="${i}" data-ing-field="proteinPer100g" inputmode="decimal" value="${escapeAttr(roundInput(ing.proteinPer100g))}" /></label><label><span>kcal /100g</span><input aria-label="Calories per 100 grams" data-ing-index="${i}" data-ing-field="caloriesPer100g" inputmode="decimal" value="${escapeAttr(roundInput(ing.caloriesPer100g))}" /></label></div><button class="ingredient-remove" type="button" data-remove-ingredient="${i}" aria-label="Remove ingredient">×</button></div>`; }
  function readIngredientRows() { return [...document.querySelectorAll('.ingredient-row')].map(row => { const values = {}; row.querySelectorAll('input').forEach(input => { const field = input.dataset.ingField; values[field] = field === 'name' ? input.value.trim() : num(input.value); }); return { name: values.name || 'Ingredient', amount: num(values.amount), proteinPer100g: num(values.proteinPer100g), caloriesPer100g: num(values.caloriesPer100g) }; }); }
  function mealOptions(selected) { return MEAL_TYPES.map(t => `<option value="${t}" ${t === selected ? 'selected' : ''}>${MEAL_LABELS[t]}</option>`).join(''); }
  function hasWeight(day) { return Boolean(day) && Number.isFinite(Number(day.weightKg)) && Number(day.weightKg) > 0; }
  function averageNumbers(values) { const valid = values.map(Number).filter(Number.isFinite); return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null; }
  function weekStartKey(key) { const date = parseLocalDate(key), weekday = date.getDay() || 7; date.setDate(date.getDate() - weekday + 1); return localDateKey(date); }
  function weekDates(startDate) { return Array.from({ length: 7 }, (_, i) => shiftDate(startDate, i)); }
  function formatWeight(value) { return Number(value).toFixed(1); }
  function signedWeight(value) { const rounded = Number(value).toFixed(1); return Number(value) > 0 ? `+${rounded}` : rounded; }
  function formatShortDay(key) { return new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' }).format(parseLocalDate(key)); }
  function formatWeekdayLetter(key) { return new Intl.DateTimeFormat('en', { weekday: 'narrow' }).format(parseLocalDate(key)); }
  function formatWeekLabel(key) { const date = parseLocalDate(key), target = new Date(date.valueOf()); target.setDate(target.getDate() + 3); const firstThursday = new Date(target.getFullYear(), 0, 4, 12); firstThursday.setDate(firstThursday.getDate() + (4 - (firstThursday.getDay() || 7))); const week = 1 + Math.round((target - firstThursday) / 604800000); return `Week ${week} · ${formatShortDay(key)}`; }
  function roundExport(value) { return Math.round(num(value) * 100) / 100; }
  function yesNo(value) { return value ? 'yes' : 'no'; }
  function csvCell(value) { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
  function getDay(date) { if (!state.days[date]) state.days[date] = { date, entries: [] }; if (!Array.isArray(state.days[date].entries)) state.days[date].entries = []; return state.days[date]; }
  function dayTotals(day) { const entries = Array.isArray(day?.entries) ? day.entries : []; return { protein: sum(entries, 'protein'), calories: sum(entries, 'calories') }; }
  function sevenDayNutritionAverage(endDate) { return nutritionAverage(endDate, 7); }
  function nutritionAverage(endDate, period = 7) { const loggedDays = Array.from({ length: period }, (_, i) => state.days[shiftDate(endDate, -i)]).filter(day => Array.isArray(day?.entries) && day.entries.length); return { count: loggedDays.length, protein: averageNumbers(loggedDays.map(day => dayTotals(day).protein)) || 0, calories: averageNumbers(loggedDays.map(day => dayTotals(day).calories)) || 0 }; }
  function sum(items, field) { return items.reduce((s, x) => s + num(x[field]), 0); }
  function num(v) { const normalized = typeof v === 'string' ? v.trim().replace(/\s/g, '').replace(',', '.') : v; const n = Number(normalized); return Number.isFinite(n) ? n : 0; }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function mealCopySnapshot(meal) {
    return { quality: meal.quality || (meal.source === 'manual' ? 'manual' : ''), name: meal.name || meal.description || 'Meal', description: meal.description || '', category: MEAL_TYPES.includes(meal.category) ? meal.category : 'snacks', protein: num(meal.protein), calories: num(meal.calories), manualTotals: normalizeManualTotals(meal.manualTotals, true), ...(meal.manualWeightG != null ? { manualWeightG: num(meal.manualWeightG) } : {}), ...(meal.per100Totals ? { per100Totals: { ...meal.per100Totals } } : {}), ingredients: activeIngredients(meal.ingredients), source: 'copy' };
  }
  function activeIngredients(ingredients) { return (Array.isArray(ingredients) ? ingredients : []).map(item => ({ name: String(item?.name || 'Ingredient'), amount: num(item?.amount), proteinPer100g: Number.isFinite(Number(item?.proteinPer100g)) ? num(item.proteinPer100g) : null, caloriesPer100g: Number.isFinite(Number(item?.caloriesPer100g)) ? num(item.caloriesPer100g) : null })); }
  function normalizeManualTotals(value, legacyFallback = false) { return { protein: typeof value?.protein === 'boolean' ? value.protein : legacyFallback, calories: typeof value?.calories === 'boolean' ? value.calories : legacyFallback }; }
  function hasNumberInput(id) { const value = document.getElementById(id)?.value.trim().replace(',', '.'); return value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0; }
  function roundInput(value) { const n = num(value); return Math.round(n * 100) / 100; }
  function selectNumericInputContent(event) { const input = event.target; if (!(input instanceof HTMLInputElement) || !input.matches('[inputmode="decimal"],[inputmode="numeric"],input[type="number"]') || !input.value) return; const selectAll = () => { if (document.activeElement === input) input.select(); }; selectAll(); setTimeout(selectAll, 0); }
  function applyTheme() { const choice = state.settings.theme || 'system'; const resolved = choice === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : choice; document.documentElement.dataset.theme = resolved; const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = resolved === 'dark' ? '#111312' : '#f5f5f7'; }
  function lockPage() { if (document.body.classList.contains('modal-open')) return; lockedScrollY = window.scrollY; document.body.style.top = `-${lockedScrollY}px`; document.body.classList.add('modal-open'); }
  function closeModal() { modalRoot.innerHTML = ''; document.body.classList.remove('modal-open'); document.body.style.top = ''; window.scrollTo(0, lockedScrollY); }
  function showInlineError(id, message) { const el = document.getElementById(id); if (el) el.innerHTML = `<div class="inline-error">${escapeHtml(message)}</div>`; }
  function toast(message) { toastRoot.textContent = message; toastRoot.classList.add('show'); setTimeout(() => toastRoot.classList.remove('show'), 1600); }
  function roundMacro(v) { const n = num(v); return Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : n.toFixed(1); }
  function localDateKey(d) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${day}`; }
  function parseLocalDate(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); }
  function shiftDate(key, amount) { const d = parseLocalDate(key); d.setDate(d.getDate() + amount); return localDateKey(d); }
  function formatDate(key) { return new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' }).format(parseLocalDate(key)); }
  function formatLongDate(key) { return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric' }).format(parseLocalDate(key)); }
  function escapeHtml(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function escapeAttr(v) { return escapeHtml(v); }
})();
