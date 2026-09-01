(() => {
  'use strict';

  const STORAGE_KEY = 'proteinLog.v1';
  const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snacks'];
  const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' };
  const state = loadState();
  let activeTab = 'today';
  let selectedDate = localDateKey(new Date());
  let selectedWeekStart = weekStartKey(selectedDate);
  let touchStart = null;
  let lockedScrollY = 0;
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const toastRoot = document.getElementById('toast-root');

  init();

  function init() {
    applyTheme();
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = () => { if ((state.settings.theme || 'system') === 'system') applyTheme(); };
    if (colorScheme.addEventListener) colorScheme.addEventListener('change', syncSystemTheme);
    else if (colorScheme.addListener) colorScheme.addListener(syncSystemTheme);
    document.querySelectorAll('.tab-button').forEach(btn => btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-button').forEach(x => x.classList.toggle('active', x === btn));
      render();
    }));
    app.addEventListener('touchstart', e => {
      if (activeTab !== 'today' || modalRoot.innerHTML || e.touches.length !== 1) return;
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
    app.addEventListener('touchend', e => {
      if (!touchStart || activeTab !== 'today') return;
      const dx = e.changedTouches[0].clientX - touchStart.x;
      const dy = e.changedTouches[0].clientY - touchStart.y;
      touchStart = null;
      navigateDayBySwipe(dx, dy);
    }, { passive: true });
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

  function renderToday() {
    const day = getDay(selectedDate);
    const totals = dayTotals(day);
    const proteinTarget = Number(state.settings.proteinTarget) || 160;
    const calorieTarget = Math.max(1, Number(state.settings.calorieTarget) || 2500);
    const pct = Math.min(1, totals.protein / proteinTarget);
    const targetLow = proteinTarget * .85;
    const targetHigh = proteinTarget * 1.15;
    const proteinStatus = totals.protein >= targetLow && totals.protein <= targetHigh
      ? 'Within target range'
      : totals.protein < targetLow
        ? `${roundMacro(Math.max(0, proteinTarget - totals.protein))} g to target`
        : `${roundMacro(totals.protein - targetHigh)} g above target range`;
    const today = localDateKey(new Date());
    const isToday = selectedDate === today;
    const canNext = selectedDate < today;
    const average = sevenDayNutritionAverage(selectedDate);
    const weightTrend = rollingWeightSummary(selectedDate);
    const activities = day.activities || {};
    const quick = [...state.savedMeals].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
    app.innerHTML = `<section class="day-view">
      <div class="date-nav"><button class="date-button" id="prev-day" aria-label="Previous day">‹</button><div class="date-center"><label class="date-click-target" for="date-picker"><div class="date-label">${escapeHtml(isToday ? 'Today' : formatDate(selectedDate))}</div><div class="date-sub">${escapeHtml(formatLongDate(selectedDate))}</div></label><input class="date-picker" id="date-picker" type="date" max="${today}" value="${selectedDate}" /></div><button class="date-button" id="next-day" aria-label="Next day" ${canNext ? '' : 'disabled'}>›</button></div>
      <div class="card progress-card"><div class="progress-ring" style="--progress:${Math.round(pct * 360)}deg"><div class="ring-content"><div class="ring-number">${roundMacro(totals.protein)} g</div><div class="ring-target">protein eaten</div><div class="ring-consumed">Target ${roundMacro(proteinTarget)} g</div><div class="over-target ${totals.protein >= targetLow && totals.protein <= targetHigh ? 'in-range' : ''}">${proteinStatus}</div></div></div><div class="top-stats single-stat"><div><strong>${Math.round(totals.calories).toLocaleString()}</strong><span>kcal recorded · ${Math.round(calorieTarget).toLocaleString()} kcal guide</span></div></div><div class="average-stat">${average.count ? `<strong>${roundMacro(average.protein)} g</strong> average recorded protein · ${average.count} logged day${average.count === 1 ? '' : 's'} · last 7 days` : 'No recorded meals in the last 7 days'}</div><div class="weight-average">${renderWeightAverage(weightTrend)}</div></div>
      ${state.copiedMeal ? `<div class="card copied-meal-card"><div class="copied-meal-heading"><div><small>Copied meal</small><strong>${escapeHtml(state.copiedMeal.name)}</strong></div><button class="close-button" id="clear-copied-meal" aria-label="Clear copied meal">×</button></div><div class="copy-controls"><select id="paste-category" aria-label="Paste meal section">${mealOptions(state.copiedMeal.category)}</select><button class="primary-button" id="paste-meal">Paste meal</button></div><div class="copy-footer"><span>To: ${escapeHtml(isToday ? 'Today' : formatDate(selectedDate))}</span>${isToday ? '' : '<button class="copy-today" id="copy-go-today">Go to today</button>'}</div></div>` : ''}
      ${MEAL_TYPES.map(type => renderMealSection(type, day)).join('')}
      ${quick.length ? `<div class="quick-wrap"><div class="section-kicker">Quick add</div><div class="quick-row">${quick.map(m => `<button class="quick-add" data-quick-id="${m.id}"><span class="quick-add-name">${escapeHtml(m.name)}</span><span class="quick-add-macro">${roundMacro(m.protein)} g protein · ${Math.round(num(m.calories))} kcal</span></button>`).join('')}</div></div>` : ''}
      <label class="card creatine-row"><input id="creatine" type="checkbox" ${day.creatine ? 'checked' : ''}/><span class="checkmark">✓</span><span><strong>Creatine</strong><small>Mark as taken today</small></span></label>
      <div class="card activity-card"><div class="activity-head"><strong>Activity</strong><small>Optional markers for this day</small></div><div class="activity-grid">${activityToggle('strength', 'Strength workout', activities.strength)}${activityToggle('run', 'Run', activities.run)}${activityToggle('longBike', 'Longer bike ride', activities.longBike)}</div></div>
      <div class="card weight-card"><div><strong>Morning body weight</strong><small>${hasWeight(day) ? `${formatWeight(day.weightKg)} kg logged for this day` : 'Optional daily weigh-in'}</small></div><div class="weight-controls"><div class="weight-input"><input id="morning-weight" aria-label="Morning body weight in kilograms" type="number" inputmode="decimal" min="1" step="0.1" placeholder="82.7" value="${hasWeight(day) ? escapeAttr(day.weightKg) : ''}" /><span>kg</span></div><button class="secondary-button" id="save-weight">Save</button>${hasWeight(day) ? '<button class="weight-delete" id="delete-weight" aria-label="Delete morning weight">×</button>' : ''}</div></div>
    </section>`;
    document.getElementById('prev-day').onclick = () => { selectedDate = shiftDate(selectedDate, -1); renderToday(); };
    document.getElementById('next-day').onclick = () => { if (canNext) { selectedDate = shiftDate(selectedDate, 1); renderToday(); } };
    document.getElementById('date-picker').onchange = e => { if (e.target.value) { selectedDate = e.target.value; renderToday(); } };
    document.getElementById('creatine').onchange = e => { day.creatine = e.target.checked; saveState(); };
    document.getElementById('save-weight').onclick = () => { const value = num(document.getElementById('morning-weight').value); if (value <= 0) return toast('Enter a valid weight in kg'); day.weightKg = Math.round(value * 10) / 10; saveState(); renderToday(); toast('Morning weight saved'); };
    const deleteWeight = document.getElementById('delete-weight'); if (deleteWeight) deleteWeight.onclick = () => { delete day.weightKg; saveState(); renderToday(); toast('Weight entry deleted'); };
    document.querySelectorAll('[data-activity]').forEach(input => input.onchange = () => { day.activities = { ...(day.activities || {}), [input.dataset.activity]: input.checked }; saveState(); });
    document.querySelectorAll('[data-add-meal]').forEach(btn => btn.onclick = () => openFoodModal(btn.dataset.addMeal));
    document.querySelectorAll('[data-entry-id]').forEach(btn => btn.onclick = () => openExistingEntry(btn.dataset.entryId));
    document.querySelectorAll('[data-quick-id]').forEach(btn => btn.onclick = () => quickAdd(btn.dataset.quickId));
    const pasteMeal = document.getElementById('paste-meal');
    if (pasteMeal) pasteMeal.onclick = () => {
      const category = document.getElementById('paste-category').value;
      getDay(selectedDate).entries.push({ ...mealCopySnapshot(state.copiedMeal), id: uid(), category });
      saveState(); renderToday(); toast('Meal pasted');
    };
    const clearCopy = document.getElementById('clear-copied-meal');
    if (clearCopy) clearCopy.onclick = () => { state.copiedMeal = null; saveState(); renderToday(); };
    const goToday = document.getElementById('copy-go-today');
    if (goToday) goToday.onclick = () => { selectedDate = localDateKey(new Date()); renderToday(); };
  }

  function renderMealSection(type, day) {
    const entries = day.entries.filter(e => e.category === type);
    const protein = sum(entries, 'protein'), calories = sum(entries, 'calories');
    return `<div class="card meal-card"><div class="meal-header"><div><div class="meal-title">${MEAL_LABELS[type]}</div><div class="meal-subtitle">${entries.length ? `${roundMacro(protein)} g protein · ${Math.round(calories)} kcal` : 'No food added'}</div></div><button class="add-button" data-add-meal="${type}">+ Add</button></div>${entries.length ? entries.map(e => `<button class="meal-entry" data-entry-id="${e.id}"><span><strong>${escapeHtml(e.name || e.description || 'Meal')}</strong><span class="entry-badges">${e.source === 'saved' ? '<small>Saved meal</small>' : ''}</span></span><span class="entry-macros"><strong>${roundMacro(e.protein)} g protein</strong><small>${Math.round(num(e.calories))} kcal</small></span></button>`).join('') : '<div class="meal-empty">Nothing here yet.</div>'}</div>`;
  }

  function activityToggle(key, label, checked) {
    return `<label class="activity-toggle"><input type="checkbox" data-activity="${key}" ${checked ? 'checked' : ''}/><span class="activity-check">✓</span><span>${label}</span></label>`;
  }

  function renderWeekly() {
    const report = buildWeeklyReport(selectedWeekStart);
    const s = report.summary;
    app.innerHTML = `<section class="weekly-view">
      <div class="page-head"><div><h1>Weekly review</h1><div class="date-sub">${escapeHtml(report.dateRange)}</div></div></div>
      <div class="week-nav"><button class="date-button" id="prev-week" aria-label="Previous week">‹</button><label class="week-picker-label" for="week-picker"><strong>${escapeHtml(formatWeekLabel(selectedWeekStart))}</strong><span>Select week</span></label><input id="week-picker" class="week-picker" type="date" value="${selectedWeekStart}"/><button class="date-button" id="next-week" aria-label="Next week">›</button></div>
      <div class="weekly-grid">
        <div class="card metric-card primary-metric"><span>Average morning weight</span><strong>${s.averageWeightKg == null ? '—' : `${formatWeight(s.averageWeightKg)} kg`}</strong><small>${s.weightEntries} weigh-in${s.weightEntries === 1 ? '' : 's'}${s.weightChangeKg == null ? '' : ` · ${signedWeight(s.weightChangeKg)} kg vs previous week`}</small></div>
        <div class="card metric-card"><span>Average recorded protein</span><strong>${s.loggedNutritionDays ? `${roundMacro(s.averageProteinG)} g` : '—'}</strong><small>${s.loggedNutritionDays} logged day${s.loggedNutritionDays === 1 ? '' : 's'}</small></div>
        <div class="card metric-card"><span>Average recorded calories</span><strong>${s.loggedNutritionDays ? Math.round(s.averageCalories).toLocaleString() : '—'}</strong><small>${s.loggedNutritionDays ? 'kcal / logged day' : 'No meals logged'}</small></div>
        <div class="card metric-card"><span>Workouts</span><strong>${s.strengthWorkouts + s.runs + s.longBikeRides}</strong><small>${s.strengthWorkouts} strength · ${s.runs} run · ${s.longBikeRides} bike</small></div>
        <div class="card metric-card"><span>Creatine</span><strong>${s.creatineDays}/7</strong><small>days taken</small></div>
      </div>
      <div class="card trend-card"><div class="trend-head"><strong>Weight trend</strong><small>Morning weigh-ins · weekly changes matter more than daily noise</small></div>${weightTrendSvg(report.days)}</div>
      <div class="section-kicker">Daily overview</div>
      <div class="card daily-review">${report.days.map(d => `<div class="daily-review-row"><div><strong>${escapeHtml(formatShortDay(d.date))}</strong><small>${d.weightKg == null ? 'No weigh-in' : `${formatWeight(d.weightKg)} kg`}</small></div><div class="daily-review-macros"><strong>${d.hasNutrition ? `${roundMacro(d.proteinG)} g protein` : 'No meals logged'}</strong><small>${d.hasNutrition ? `${Math.round(d.calories)} kcal recorded` : '—'}</small></div></div>`).join('')}</div>
      <div class="section-kicker">Export this week</div>
      <div class="card export-card"><div><strong>Full nutrition + weight report</strong><small>Includes daily data, activities, creatine, meals and ingredient-level detail.</small></div><div class="export-actions"><button class="primary-button" id="export-csv">Export CSV</button><button class="secondary-button" id="export-json">Export JSON</button></div></div>
    </section>`;
    document.getElementById('prev-week').onclick = () => { selectedWeekStart = shiftDate(selectedWeekStart, -7); renderWeekly(); };
    document.getElementById('next-week').onclick = () => { selectedWeekStart = shiftDate(selectedWeekStart, 7); renderWeekly(); };
    document.getElementById('week-picker').onchange = e => { if (e.target.value) { selectedWeekStart = weekStartKey(e.target.value); renderWeekly(); } };
    document.getElementById('export-csv').onclick = () => exportWeeklyReport(report, 'csv');
    document.getElementById('export-json').onclick = () => exportWeeklyReport(report, 'json');
  }

  function buildWeeklyReport(startDate) {
    const dates = weekDates(startDate);
    const days = dates.map(date => {
      const source = state.days[date] || { date, entries: [] };
      const totals = dayTotals(source);
      const activities = source.activities || {};
      const entries = Array.isArray(source.entries) ? source.entries : [];
      return { date, weightKg: hasWeight(source) ? Number(source.weightKg) : null, hasNutrition: entries.length > 0, calories: totals.calories, proteinG: totals.protein, creatine: Boolean(source.creatine), strengthWorkout: Boolean(activities.strength), run: Boolean(activities.run), longBikeRide: Boolean(activities.longBike), meals: entries.map(entry => ({ id: entry.id, section: MEAL_LABELS[entry.category] || entry.category || '', name: entry.name || entry.description || 'Meal', description: entry.description || '', calories: num(entry.calories), proteinG: num(entry.protein), manualWeightG: entry.manualWeightG != null ? num(entry.manualWeightG) : null, ingredients: activeIngredients(entry.ingredients) })) };
    });
    const weights = days.map(d => d.weightKg).filter(v => v != null);
    const previousWeights = weekDates(shiftDate(startDate, -7)).map(date => state.days[date]).filter(hasWeight).map(day => Number(day.weightKg));
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
    return { weekStart: startDate, weekEnd: dates[6], dateRange: `${formatLongDate(startDate)} – ${formatLongDate(dates[6])}`, summary, days };
  }

  function rollingWeightSummary(endDate) {
    const current = Array.from({ length: 7 }, (_, i) => state.days[shiftDate(endDate, -i)]).filter(hasWeight).map(day => Number(day.weightKg));
    const previous = Array.from({ length: 7 }, (_, i) => state.days[shiftDate(endDate, -7 - i)]).filter(hasWeight).map(day => Number(day.weightKg));
    const averageKg = averageNumbers(current), previousAverageKg = averageNumbers(previous);
    return { averageKg, previousAverageKg, count: current.length, changeKg: averageKg == null || previousAverageKg == null ? null : averageKg - previousAverageKg };
  }

  function renderWeightAverage(trend) {
    if (trend.averageKg == null) return 'Log morning weight to see a 7-day average';
    const comparison = trend.changeKg == null ? `${trend.count} weigh-in${trend.count === 1 ? '' : 's'}` : `${signedWeight(trend.changeKg)} kg vs previous week`;
    return `<strong>${formatWeight(trend.averageKg)} kg</strong> 7-day weight average · ${comparison}`;
  }

  function weightTrendSvg(days) {
    const values = days.map((d, i) => d.weightKg == null ? null : { i, value: d.weightKg }).filter(Boolean);
    if (!values.length) return '<div class="trend-empty">No morning weigh-ins logged this week.</div>';
    const min = Math.min(...values.map(p => p.value)), max = Math.max(...values.map(p => p.value)), range = max - min;
    const points = values.map(p => ({ ...p, x: 12 + p.i * 46, y: range ? 48 - ((p.value - min) / range) * 34 : 31 }));
    const line = points.map(p => `${p.x},${p.y}`).join(' ');
    return `<svg class="weight-chart" viewBox="0 0 300 72" role="img" aria-label="Weight trend for the selected week"><polyline class="trend-line" points="${line}"/>${points.map(p => `<circle class="trend-dot" cx="${p.x}" cy="${p.y}" r="3"><title>${formatWeight(p.value)} kg</title></circle>`).join('')}${days.map((d, i) => `<text x="${12 + i * 46}" y="68">${escapeHtml(formatWeekdayLetter(d.date))}</text>`).join('')}</svg>`;
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
    return [columns.join(','), ...rows.map(row => columns.map(column => csvCell(row[column] ?? '')).join(','))].join('\n');
  }

  async function shareOrDownload(content, mimeType, filename) {
    const file = typeof File !== 'undefined' ? new File([content], filename, { type: mimeType }) : null;
    if (file && navigator.share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Protein Log weekly report' }); return; }
      catch (err) { if (err?.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderSaved() {
    const meals = [...state.savedMeals].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
    app.innerHTML = `<div class="page-head"><h1>Saved meals</h1><button class="primary-button" id="new-saved">+ New</button></div>${meals.length ? meals.map(m => `<div class="card saved-card"><div class="saved-info"><div class="saved-title-row"><strong>${escapeHtml(m.name)}</strong><span class="saved-category">${MEAL_LABELS[m.category] || MEAL_LABELS.snacks}</span></div><small class="saved-nutrition">${roundMacro(m.protein)} g protein · ${Math.round(num(m.calories))} kcal</small></div><button class="secondary-button" data-saved-edit="${m.id}">Edit</button></div>`).join('') : '<div class="card empty-card">No saved meals yet.</div>'}`;
    document.getElementById('new-saved').onclick = () => openSavedModal();
    document.querySelectorAll('[data-saved-edit]').forEach(btn => btn.onclick = () => openSavedModal(btn.dataset.savedEdit));
  }

  function renderSettings() {
    app.innerHTML = `<h1>Settings</h1><div class="section-kicker">Appearance</div><div class="card settings-group"><div class="settings-row"><label class="settings-label" for="theme-select">Theme</label><select id="theme-select"><option value="system" ${(state.settings.theme || 'system') === 'system' ? 'selected' : ''}>System default</option><option value="light" ${state.settings.theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${state.settings.theme === 'dark' ? 'selected' : ''}>Dark</option></select></div></div><div class="section-kicker">Targets</div><div class="card settings-group"><div class="settings-row"><label class="settings-label" for="protein-target">Daily protein target</label><input id="protein-target" type="number" inputmode="decimal" min="1" step="1" value="${Number(state.settings.proteinTarget) || 160}" /></div><div class="settings-row"><label class="settings-label" for="calorie-target">Daily calorie guide</label><input id="calorie-target" type="number" inputmode="numeric" min="1" step="50" value="${Number(state.settings.calorieTarget) || 2500}" /><div class="settings-help">Calories are shown as a neutral guide. Protein remains the primary target.</div></div></div><div class="section-kicker">Claude</div><div class="card settings-group"><div class="settings-row"><label class="settings-label" for="claude-api-key">Claude API key</label><input id="claude-api-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…" value="${escapeAttr(state.settings.claudeApiKey || '')}" /><div class="settings-help">Stored only in this browser. AI analysis is optional; meals can always be entered manually.</div></div></div><div class="card settings-group"><div class="settings-row"><strong>Storage</strong><div class="settings-help">Meals, targets, creatine checks, activities, weight, appearance and your Claude key stay in Safari on this iPhone.</div></div></div>`;
    document.getElementById('theme-select').onchange = e => { state.settings.theme = e.target.value; applyTheme(); saveState(); toast('Theme saved'); };
    bindSetting('protein-target', 'proteinTarget', 160, 'Protein target saved');
    bindSetting('calorie-target', 'calorieTarget', 2500, 'Calorie goal saved');
    document.getElementById('claude-api-key').onchange = e => { state.settings.claudeApiKey = e.target.value.trim(); saveState(); toast('Claude API key saved locally'); };
  }
  function bindSetting(id, key, fallback, message) { document.getElementById(id).onchange = e => { state.settings[key] = Math.max(1, Number(e.target.value) || fallback); saveState(); toast(message); }; }

  function openFoodModal(category, existing = null) {
    lockPage();
    let draft = existing ? prepareIngredientEditor(normalizeExisting(existing)) : { name: '', description: '', protein: 0, calories: 0, ingredients: [], manualTotals: { protein: false, calories: false } };
    let analyzedWithAI = existing?.source === 'ai';
    let entryMode = existing ? 'ingredients' : 'choice';
    const linkedSavedMeal = existing?.savedMealId ? state.savedMeals.find(meal => meal.id === existing.savedMealId) : null;
    let saveToSavedMeals = false;
    modalRoot.innerHTML = `<div class="modal-backdrop"><div class="sheet"><div class="sheet-handle"></div><div class="sheet-head"><h2>${existing ? 'Edit meal' : `Add ${MEAL_LABELS[category]}`}</h2><button class="close-button" id="close-sheet">×</button></div><div id="food-editor"></div></div></div>`;
    document.getElementById('close-sheet').onclick = closeModal;
    renderFoodEditor();

    function renderFoodEditor() {
      const root = document.getElementById('food-editor');
      const showNutrition = entryMode !== 'choice';
      modalRoot._ingredients = draft.ingredients;
      const ingredientEditor = showNutrition ? `<div class="ingredient-editor"><div class="ingredient-editor-head"><strong>Ingredients</strong><button class="secondary-button add-ingredient" id="add-food-ingredient">+ Add ingredient</button></div><div class="ingredient-head"><span>Ingredient</span><span>Amount</span></div><div class="ingredient-list">${draft.ingredients.map((ing, i) => ingredientRowHtml(ing, i)).join('')}</div><div class="settings-help">Enter each ingredient separately. Totals update automatically.</div></div><div class="calculated-total" id="calculated-meal-total">Meal total: <strong>${roundMacro(draft.protein)} g protein · ${Math.round(draft.calories)} kcal</strong></div>` : '';
      const saveControls = showNutrition ? `${saveToSavedToggleHtml(saveToSavedMeals, Boolean(linkedSavedMeal))}${existing ? '<div class="copy-entry-action"><button class="secondary-button" id="copy-entry">Copy meal</button><small>Copy these values to paste on another day</small></div>' : ''}<div class="modal-actions">${existing ? '<button class="secondary-button danger" id="delete-entry">Delete</button>' : '<button class="secondary-button" id="cancel-entry">Cancel</button>'}<button class="primary-button" id="save-entry">${existing ? 'Save meal' : 'Add meal'}</button></div>` : '<div class="modal-actions single"><button class="secondary-button" id="cancel-entry">Cancel</button></div>';
      root.innerHTML = `<div class="field"><label>Meal name or description</label><textarea id="food-text" placeholder="e.g. skyr with muesli">${escapeHtml(draft.description || draft.name || '')}</textarea></div><div class="analysis-action"><button class="primary-button" id="analyze-food">Analyze with Claude</button>${entryMode === 'choice' ? '<button class="manual-entry-button" id="manual-food">Enter manually</button>' : '<small>Run again if the description changes</small>'}</div><div id="food-error"></div>${ingredientEditor}${saveControls}`;
      document.getElementById('food-text').oninput = e => { draft.description = e.target.value; };
      document.getElementById('analyze-food').onclick = async () => {
        const text = document.getElementById('food-text').value.trim();
        if (!text) return showInlineError('food-error', 'Enter a meal name or description first.');
        const button = document.getElementById('analyze-food'); button.disabled = true; button.textContent = 'Analyzing…';
        try { const result = await analyzeFood(text, category); draft = prepareIngredientEditor({ ...result, description: text, manualTotals: { protein: false, calories: false } }); analyzedWithAI = true; entryMode = 'analyzed'; renderFoodEditor(); }
        catch (err) { button.disabled = false; button.textContent = 'Analyze with Claude'; showInlineError('food-error', err.message || 'Could not analyze that meal.'); }
      };
      const manualButton = document.getElementById('manual-food'); if (manualButton) manualButton.onclick = () => { draft = prepareIngredientEditor({ ...draft, description: document.getElementById('food-text').value, ingredients: [blankIngredient()], manualTotals: { protein: false, calories: false } }); entryMode = 'manual'; renderFoodEditor(); };
      const cancel = document.getElementById('cancel-entry'); if (cancel) cancel.onclick = closeModal;
      if (!showNutrition) return;
      document.getElementById('add-food-ingredient').onclick = () => { syncDraft(); draft.ingredients.push(blankIngredient()); renderFoodEditor(); };
      if (existing) {
        document.getElementById('copy-entry').onclick = () => {
          syncDraft();
          state.copiedMeal = mealCopySnapshot({ ...draft, category });
          saveState(); closeModal(); renderToday(); toast('Meal copied — choose a day and paste');
        };
      }
      root.querySelectorAll('.ingredient-row input').forEach(input => input.addEventListener('input', () => { draft.ingredients = readIngredientRows(); draft = calculateFromIngredients({ ...draft, manualTotals: { protein: false, calories: false } }); updateCalculatedTotal(); }));
      root.querySelectorAll('[data-remove-ingredient]').forEach(button => button.onclick = () => { syncDraft(); draft.ingredients.splice(Number(button.dataset.removeIngredient), 1); if (!draft.ingredients.length) draft.ingredients.push(blankIngredient()); draft = calculateFromIngredients(draft); renderFoodEditor(); });
      document.getElementById('save-to-saved').onchange = e => { saveToSavedMeals = e.target.checked; };
      const del = document.getElementById('delete-entry'); if (del) del.onclick = () => { const d = getDay(selectedDate); d.entries = d.entries.filter(e => e.id !== existing.id); saveState(); closeModal(); renderToday(); };
      document.getElementById('save-entry').onclick = () => {
        syncDraft();
        if (!draft.description.trim()) return showInlineError('food-error', 'Enter a meal name or description.');
        if (!draft.ingredients.length) return showInlineError('food-error', 'Add at least one ingredient.');
        const d = getDay(selectedDate);
        const description = draft.description.trim();
        const entry = { id: existing?.id || uid(), category, description, name: analyzedWithAI && draft.name ? draft.name : description, protein: num(draft.protein), calories: num(draft.calories), manualTotals: { protein: false, calories: false }, ingredients: activeIngredients(draft.ingredients), source: existing?.source || (analyzedWithAI ? 'ai' : 'manual'), ...(existing?.savedMealId ? { savedMealId: existing.savedMealId } : {}) };
        if (document.getElementById('save-to-saved').checked) {
          const currentSaved = entry.savedMealId ? state.savedMeals.find(meal => meal.id === entry.savedMealId) : null;
          const savedMeal = { id: currentSaved?.id || uid(), name: entry.name, description, category, protein: entry.protein, calories: entry.calories, manualTotals: { ...entry.manualTotals }, ingredients: clone(entry.ingredients), usageCount: currentSaved?.usageCount || 0 };
          const savedIndex = state.savedMeals.findIndex(meal => meal.id === savedMeal.id);
          if (savedIndex >= 0) state.savedMeals[savedIndex] = savedMeal; else state.savedMeals.push(savedMeal);
          entry.savedMealId = savedMeal.id;
          entry.source = 'saved';
        }
        const idx = d.entries.findIndex(e => e.id === entry.id);
        if (idx >= 0) d.entries[idx] = entry; else d.entries.push(entry);
        saveState(); closeModal(); renderToday();
        toast(saveToSavedMeals ? (existing ? 'Meal and saved copy updated' : 'Meal added and saved') : (existing ? 'Meal updated' : 'Meal added'));
      };
      function syncDraft() { draft.description = document.getElementById('food-text').value; if (root.querySelectorAll('.ingredient-row').length) draft.ingredients = readIngredientRows(); draft = calculateFromIngredients({ ...draft, manualTotals: { protein: false, calories: false }, manualWeightG: undefined, per100Totals: null }); }
      function updateCalculatedTotal() { const el = document.getElementById('calculated-meal-total'); if (el) el.innerHTML = `Meal total: <strong>${roundMacro(draft.protein)} g protein · ${Math.round(draft.calories)} kcal</strong>`; }
    }
  }

  function openExistingEntry(id) { const entry = getDay(selectedDate).entries.find(e => e.id === id); if (entry) openFoodModal(entry.category, entry); }
  function openSavedModal(id = null) {
    lockPage();
    const existing = id ? state.savedMeals.find(m => m.id === id) : null;
    let draft = existing ? prepareIngredientEditor(normalizeExisting(existing)) : { name: '', description: '', category: 'breakfast', protein: 0, calories: 0, ingredients: [], manualTotals: { protein: false, calories: false }, usageCount: 0 };
    let analyzedWithAI = false;
    let entryMode = existing ? 'ingredients' : 'choice';
    renderBody();
    function renderBody() {
      modalRoot.innerHTML = `<div class="modal-backdrop"><div class="sheet"><div class="sheet-handle"></div><div class="sheet-head"><h2>${existing ? 'Edit saved meal' : 'New saved meal'}</h2><button class="close-button" id="close-saved">×</button></div><div id="saved-body"></div></div></div>`;
      document.getElementById('close-saved').onclick = closeModal;
      const body = document.getElementById('saved-body');
      const showNutrition = entryMode !== 'choice';
      modalRoot._ingredients = draft.ingredients;
      const ingredientEditor = showNutrition ? `<div class="ingredient-editor"><div class="ingredient-editor-head"><strong>Ingredients</strong><button class="secondary-button add-ingredient" id="add-saved-ingredient">+ Add ingredient</button></div><div class="ingredient-head"><span>Ingredient</span><span>Amount</span></div><div class="ingredient-list">${draft.ingredients.map((ing, i) => ingredientRowHtml(ing, i)).join('')}</div><div class="settings-help">Enter each ingredient separately. Totals update automatically.</div></div><div class="calculated-total" id="calculated-saved-total">Meal total: <strong>${roundMacro(draft.protein)} g protein · ${Math.round(draft.calories)} kcal</strong></div>` : '';
      const saveControls = showNutrition ? `<div class="modal-actions">${existing ? '<button class="secondary-button danger" id="delete-saved">Delete</button>' : '<button class="secondary-button" id="cancel-saved">Cancel</button>'}<button class="primary-button" id="save-saved">Save</button></div>` : '<div class="modal-actions single"><button class="secondary-button" id="cancel-saved">Cancel</button></div>';
      body.innerHTML = `<div class="field"><label>Name</label><input id="saved-name" placeholder="e.g. skyr with muesli" value="${escapeAttr(draft.name || draft.description || '')}" /></div><div class="field"><label>Default meal</label><select id="saved-category">${mealOptions(draft.category || 'breakfast')}</select></div><div class="analysis-action"><button class="primary-button" id="analyze-saved">Analyze with Claude</button>${entryMode === 'choice' ? '<button class="manual-entry-button" id="manual-saved">Enter manually</button>' : '<small>Run again if the name changes</small>'}</div><div id="saved-error"></div>${ingredientEditor}${saveControls}`;
      document.getElementById('saved-name').oninput = e => { draft.name = e.target.value; draft.description = e.target.value; };
      document.getElementById('saved-category').onchange = e => { draft.category = e.target.value; };
      document.getElementById('analyze-saved').onclick = async () => { const text = document.getElementById('saved-name').value.trim(), category = document.getElementById('saved-category').value; if (!text) return showInlineError('saved-error', 'Enter a meal name first.'); const button = document.getElementById('analyze-saved'); button.disabled = true; button.textContent = 'Analyzing…'; try { const result = await analyzeFood(text, category); draft = prepareIngredientEditor({ ...result, description: text, category, id: existing?.id || uid(), usageCount: existing?.usageCount || 0, manualTotals: { protein: false, calories: false } }); analyzedWithAI = true; entryMode = 'analyzed'; renderBody(); } catch (err) { button.disabled = false; button.textContent = 'Analyze with Claude'; showInlineError('saved-error', err.message || 'Could not analyze that meal.'); } };
      const manualButton = document.getElementById('manual-saved'); if (manualButton) manualButton.onclick = () => { draft = prepareIngredientEditor({ ...draft, name: document.getElementById('saved-name').value, description: document.getElementById('saved-name').value, category: document.getElementById('saved-category').value, ingredients: [blankIngredient()], manualTotals: { protein: false, calories: false } }); entryMode = 'manual'; renderBody(); };
      const cancel = document.getElementById('cancel-saved'); if (cancel) cancel.onclick = closeModal;
      if (!showNutrition) return;
      document.getElementById('add-saved-ingredient').onclick = () => { syncSavedDraft(); draft.ingredients.push(blankIngredient()); renderBody(); };
      body.querySelectorAll('.ingredient-row input').forEach(input => input.addEventListener('input', () => { draft.ingredients = readIngredientRows(); draft = calculateFromIngredients({ ...draft, manualTotals: { protein: false, calories: false } }); updateSavedTotal(); }));
      body.querySelectorAll('[data-remove-ingredient]').forEach(button => button.onclick = () => { syncSavedDraft(); draft.ingredients.splice(Number(button.dataset.removeIngredient), 1); if (!draft.ingredients.length) draft.ingredients.push(blankIngredient()); draft = calculateFromIngredients(draft); renderBody(); });
      const del = document.getElementById('delete-saved'); if (del) del.onclick = () => { state.savedMeals = state.savedMeals.filter(m => m.id !== existing.id); saveState(); closeModal(); renderSaved(); };
      document.getElementById('save-saved').onclick = () => { const name = document.getElementById('saved-name').value.trim(); if (!name) return showInlineError('saved-error', 'Enter a meal name.'); syncSavedDraft(); if (!draft.ingredients.length) return showInlineError('saved-error', 'Add at least one ingredient.'); const meal = { id: existing?.id || draft.id || uid(), name, description: name, category: document.getElementById('saved-category').value, protein: num(draft.protein), calories: num(draft.calories), manualTotals: { protein: false, calories: false }, ingredients: activeIngredients(draft.ingredients), usageCount: existing?.usageCount || draft.usageCount || 0 }; const idx = state.savedMeals.findIndex(m => m.id === meal.id); if (idx >= 0) state.savedMeals[idx] = meal; else state.savedMeals.push(meal); saveState(); closeModal(); renderSaved(); };
      function syncSavedDraft() { if (body.querySelectorAll('.ingredient-row').length) draft.ingredients = readIngredientRows(); draft = calculateFromIngredients({ ...draft, manualTotals: { protein: false, calories: false }, manualWeightG: undefined, per100Totals: null }); }
      function updateSavedTotal() { const el = document.getElementById('calculated-saved-total'); if (el) el.innerHTML = `Meal total: <strong>${roundMacro(draft.protein)} g protein · ${Math.round(draft.calories)} kcal</strong>`; }
    }
  }

  function quickAdd(id) { const meal = state.savedMeals.find(m => m.id === id); if (!meal) return; meal.usageCount = (meal.usageCount || 0) + 1; getDay(selectedDate).entries.push({ id: uid(), category: MEAL_TYPES.includes(meal.category) ? meal.category : 'snacks', description: meal.description || meal.name, name: meal.name, protein: num(meal.protein), calories: num(meal.calories), manualTotals: normalizeManualTotals(meal.manualTotals, true), ...(meal.manualWeightG != null ? { manualWeightG: num(meal.manualWeightG) } : {}), ...(meal.per100Totals ? { per100Totals: { ...meal.per100Totals } } : {}), ingredients: activeIngredients(meal.ingredients), source: 'saved', savedMealId: meal.id }); saveState(); renderToday(); toast(`${meal.name} added`); }

  async function analyzeFood(text, mealType) {
    const apiKey = (state.settings.claudeApiKey || '').trim();
    if (!apiKey) { const demo = localEstimate(text); if (demo) return demo; throw new Error('Add your Claude API key in Settings first.'); }
    if (!apiKey.startsWith('sk-ant-')) throw new Error('That does not look like an Anthropic API key. It should begin with sk-ant-.');
    const system = `You are the nutrition analysis engine for a personal iPhone food tracker. The user may write in English or Danish. Estimate practical everyday nutrition with protein as the primary measurement and calories as the only secondary measurement. Use grams for ingredient amounts whenever possible; convert pieces, scoops and millilitres to a practical edible gram weight. Return ONLY valid JSON exactly shaped as: {"name":"short meal name","protein":0,"calories":0,"ingredients":[{"name":"ingredient","amount":0,"proteinPer100g":0,"caloriesPer100g":0}]}. Do not return any other nutrition fields. Totals should equal the sum of amount/100 multiplied by each per-100g value, allowing normal rounding.`;
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
    return { id: item.id, name: item.name || item.description || 'Meal', description: item.description || item.name || '', category: MEAL_TYPES.includes(item.category) ? item.category : 'snacks', protein: num(item.protein), calories: num(item.calories), manualTotals: normalizeManualTotals(item.manualTotals, true), ...(item.manualWeightG != null ? { manualWeightG: num(item.manualWeightG) } : {}), per100Totals: normalizePer100Totals(item.per100Totals, item, totalAmount || num(item.manualWeightG)), ingredients: ingredients.map(ingredient => ({ ...ingredient, proteinPer100g: ingredient.proteinPer100g != null && Number.isFinite(Number(ingredient.proteinPer100g)) ? num(ingredient.proteinPer100g) : fallbackProtein, caloriesPer100g: ingredient.caloriesPer100g != null && Number.isFinite(Number(ingredient.caloriesPer100g)) ? num(ingredient.caloriesPer100g) : fallbackCalories })), usageCount: num(item.usageCount), source: item.source, savedMealId: item.savedMealId };
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
  function saveToSavedToggleHtml(checked, updatesExisting) { return `<label class="save-toggle"><input id="save-to-saved" type="checkbox" ${checked ? 'checked' : ''}/><span class="mini-check">✓</span><span><strong>${updatesExisting ? 'Update Saved Meal' : 'Save to Saved Meals'}</strong><small>${updatesExisting ? 'Keep the reusable saved copy in sync' : 'Add this meal as a reusable Quick Add'}</small></span></label>`; }
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
  function sevenDayNutritionAverage(endDate) { const loggedDays = Array.from({ length: 7 }, (_, i) => state.days[shiftDate(endDate, -i)]).filter(day => Array.isArray(day?.entries) && day.entries.length); return { count: loggedDays.length, protein: averageNumbers(loggedDays.map(day => dayTotals(day).protein)) || 0, calories: averageNumbers(loggedDays.map(day => dayTotals(day).calories)) || 0 }; }
  function sum(items, field) { return items.reduce((s, x) => s + num(x[field]), 0); }
  function num(v) { const normalized = typeof v === 'string' ? v.trim().replace(/\s/g, '').replace(',', '.') : v; const n = Number(normalized); return Number.isFinite(n) ? n : 0; }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function mealCopySnapshot(meal) {
    return { name: meal.name || meal.description || 'Meal', description: meal.description || '', category: MEAL_TYPES.includes(meal.category) ? meal.category : 'snacks', protein: num(meal.protein), calories: num(meal.calories), manualTotals: normalizeManualTotals(meal.manualTotals, true), ...(meal.manualWeightG != null ? { manualWeightG: num(meal.manualWeightG) } : {}), ...(meal.per100Totals ? { per100Totals: { ...meal.per100Totals } } : {}), ingredients: activeIngredients(meal.ingredients), source: 'copy' };
  }
  function activeIngredients(ingredients) { return (Array.isArray(ingredients) ? ingredients : []).map(item => ({ name: String(item?.name || 'Ingredient'), amount: num(item?.amount), proteinPer100g: Number.isFinite(Number(item?.proteinPer100g)) ? num(item.proteinPer100g) : null, caloriesPer100g: Number.isFinite(Number(item?.caloriesPer100g)) ? num(item.caloriesPer100g) : null })); }
  function normalizeManualTotals(value, legacyFallback = false) { return { protein: typeof value?.protein === 'boolean' ? value.protein : legacyFallback, calories: typeof value?.calories === 'boolean' ? value.calories : legacyFallback }; }
  function hasNumberInput(id) { const value = document.getElementById(id)?.value.trim().replace(',', '.'); return value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0; }
  function roundInput(value) { const n = num(value); return Math.round(n * 100) / 100; }
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
