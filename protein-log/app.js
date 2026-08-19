(() => {
  'use strict';

  const STORAGE_KEY = 'proteinLog.v1';
  const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snacks'];
  const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' };
  const state = loadState();
  let activeTab = 'today';
  let selectedDate = localDateKey(new Date());
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
      if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
      const today = localDateKey(new Date());
      if (dx > 0) selectedDate = shiftDate(selectedDate, -1);
      else if (selectedDate < today) selectedDate = shiftDate(selectedDate, 1);
      renderToday();
    }, { passive: true });
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
    render();
  }

  function defaultState() { return { settings: { proteinTarget: 160, calorieTarget: 2500, carbTarget: 300, theme: 'system', claudeApiKey: '' }, days: {}, savedMeals: [] }; }
  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed) return defaultState();
      const base = defaultState();
      return { settings: { ...base.settings, ...(parsed.settings || {}) }, days: parsed.days || {}, savedMeals: Array.isArray(parsed.savedMeals) ? parsed.savedMeals : [] };
    } catch { return defaultState(); }
  }
  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function render() { if (activeTab === 'today') renderToday(); else if (activeTab === 'saved') renderSaved(); else renderSettings(); }

  function renderToday() {
    const day = getDay(selectedDate);
    const totals = dayTotals(day);
    const proteinTarget = Number(state.settings.proteinTarget) || 160;
    const calorieTarget = Math.max(1, Number(state.settings.calorieTarget) || 2500);
    const carbTarget = Math.max(1, Number(state.settings.carbTarget) || 300);
    const pct = Math.min(1, totals.protein / proteinTarget);
    const proteinOver = Math.max(0, totals.protein - proteinTarget);
    const calorieOver = Math.max(0, totals.calories - calorieTarget);
    const carbOver = Math.max(0, totals.carbs - carbTarget);
    const today = localDateKey(new Date());
    const isToday = selectedDate === today;
    const canNext = selectedDate < today;
    const average = sevenDayProteinAverage(selectedDate);
    const quick = [...state.savedMeals].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
    app.innerHTML = `<section class="day-view">
      <div class="date-nav"><button class="date-button" id="prev-day" aria-label="Previous day">‹</button><div class="date-center"><label class="date-click-target" for="date-picker"><div class="date-label">${escapeHtml(isToday ? 'Today' : formatDate(selectedDate))}</div><div class="date-sub">${escapeHtml(formatLongDate(selectedDate))}</div></label><input class="date-picker" id="date-picker" type="date" max="${today}" value="${selectedDate}" /></div><button class="date-button" id="next-day" aria-label="Next day" ${canNext ? '' : 'disabled'}>›</button></div>
      <div class="card progress-card"><div class="progress-ring" style="--progress:${Math.round(pct * 360)}deg"><div class="ring-content"><div class="ring-consumed">${roundMacro(totals.protein)} g eaten</div><div class="ring-number">${roundMacro(Math.max(0, proteinTarget - totals.protein))} g</div><div class="ring-target">protein left</div><div class="over-target">${proteinOver ? `+${roundMacro(proteinOver)} g over` : ''}</div></div></div><div class="top-stats"><div><strong>${Math.round(totals.calories).toLocaleString()}</strong><span>kcal ${calorieOver ? `<em>+${Math.round(calorieOver)} kcal</em>` : ''}</span></div><div><strong>${roundMacro(totals.carbs)} g</strong><span>carbs ${carbOver ? `<em>+${roundMacro(carbOver)} g</em>` : ''}</span></div></div><div class="average-stat"><strong>${roundMacro(average)} g</strong> daily protein average · last 7 days</div></div>
      <label class="card creatine-row"><input id="creatine" type="checkbox" ${day.creatine ? 'checked' : ''}/><span class="checkmark">✓</span><span><strong>Creatine</strong><small>Mark as taken today</small></span></label>
      ${MEAL_TYPES.map(type => renderMealSection(type, day)).join('')}
      ${quick.length ? `<div class="quick-wrap"><div class="section-kicker">Quick add</div><div class="quick-row">${quick.map(m => `<button class="quick-add" data-quick-id="${m.id}"><span class="quick-add-name">${escapeHtml(m.name)}</span><span class="quick-add-macro">${roundMacro(m.protein)} g protein · ${roundMacro(m.carbs)} g carbs · ${Math.round(m.calories)} kcal</span></button>`).join('')}</div></div>` : ''}
    </section>`;
    document.getElementById('prev-day').onclick = () => { selectedDate = shiftDate(selectedDate, -1); renderToday(); };
    document.getElementById('next-day').onclick = () => { if (canNext) { selectedDate = shiftDate(selectedDate, 1); renderToday(); } };
    document.getElementById('date-picker').onchange = e => { if (e.target.value) { selectedDate = e.target.value; renderToday(); } };
    document.getElementById('creatine').onchange = e => { day.creatine = e.target.checked; saveState(); };
    document.querySelectorAll('[data-add-meal]').forEach(btn => btn.onclick = () => openFoodModal(btn.dataset.addMeal));
    document.querySelectorAll('[data-entry-id]').forEach(btn => btn.onclick = () => openExistingEntry(btn.dataset.entryId));
    document.querySelectorAll('[data-quick-id]').forEach(btn => btn.onclick = () => quickAdd(btn.dataset.quickId));
  }

  function renderMealSection(type, day) {
    const entries = day.entries.filter(e => e.category === type);
    const protein = sum(entries, 'protein'), carbs = sum(entries, 'carbs');
    return `<div class="card meal-card"><div class="meal-header"><div><div class="meal-title">${MEAL_LABELS[type]}</div><div class="meal-subtitle">${entries.length ? `${roundMacro(protein)} g protein · ${roundMacro(carbs)} g carbs` : 'No food added'}</div></div><button class="add-button" data-add-meal="${type}">+ Add</button></div>${entries.length ? entries.map(e => `<button class="meal-entry" data-entry-id="${e.id}"><span><strong>${escapeHtml(e.name || e.description || 'Meal')}</strong>${e.source === 'saved' ? '<small>Saved meal</small>' : ''}</span><span class="entry-macros"><strong>${roundMacro(e.protein)} g protein</strong><small>${roundMacro(e.carbs)} g carbs · ${Math.round(e.calories)} kcal</small></span></button>`).join('') : '<div class="meal-empty">Nothing here yet.</div>'}</div>`;
  }

  function renderSaved() {
    const meals = [...state.savedMeals].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
    app.innerHTML = `<div class="page-head"><h1>Saved meals</h1><button class="primary-button" id="new-saved">+ New</button></div>${meals.length ? meals.map(m => `<div class="card saved-card"><div class="saved-info"><div class="saved-title-row"><strong>${escapeHtml(m.name)}</strong><span class="saved-category">${MEAL_LABELS[m.category]}</span></div><small class="saved-nutrition">${roundMacro(m.protein)} g protein · ${roundMacro(m.carbs)} g carbs · ${Math.round(m.calories)} kcal</small></div><button class="secondary-button" data-saved-edit="${m.id}">Edit</button></div>`).join('') : '<div class="card empty-card">No saved meals yet.</div>'}`;
    document.getElementById('new-saved').onclick = () => openSavedModal();
    document.querySelectorAll('[data-saved-edit]').forEach(btn => btn.onclick = () => openSavedModal(btn.dataset.savedEdit));
  }

  function renderSettings() {
    app.innerHTML = `<h1>Settings</h1><div class="section-kicker">Appearance</div><div class="card settings-group"><div class="settings-row"><label class="settings-label" for="theme-select">Theme</label><select id="theme-select"><option value="system" ${(state.settings.theme || 'system') === 'system' ? 'selected' : ''}>System default</option><option value="light" ${state.settings.theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${state.settings.theme === 'dark' ? 'selected' : ''}>Dark</option></select></div></div><div class="section-kicker">Goals</div><div class="card settings-group"><div class="settings-row"><label class="settings-label" for="protein-target">Daily protein target</label><input id="protein-target" type="number" inputmode="decimal" min="1" step="1" value="${Number(state.settings.proteinTarget) || 160}" /></div><div class="settings-row"><label class="settings-label" for="calorie-target">Daily calorie goal</label><input id="calorie-target" type="number" inputmode="numeric" min="1" step="50" value="${Number(state.settings.calorieTarget) || 2500}" /></div><div class="settings-row"><label class="settings-label" for="carb-target">Daily carb goal</label><input id="carb-target" type="number" inputmode="decimal" min="1" step="10" value="${Number(state.settings.carbTarget) || 300}" /><div class="settings-help">Calories and carbs stay secondary; the day view highlights when you go over either goal.</div></div></div><div class="section-kicker">Claude</div><div class="card settings-group"><div class="settings-row"><label class="settings-label" for="claude-api-key">Claude API key</label><input id="claude-api-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…" value="${escapeAttr(state.settings.claudeApiKey || '')}" /><div class="settings-help">Stored only in this browser. Protein Log sends meals directly to Anthropic Claude.</div></div></div><div class="card settings-group"><div class="settings-row"><strong>Storage</strong><div class="settings-help">Meals, goals, creatine checks, appearance and your Claude key stay in Safari on this iPhone.</div></div></div>`;
    document.getElementById('theme-select').onchange = e => { state.settings.theme = e.target.value; applyTheme(); saveState(); toast('Theme saved'); };
    bindSetting('protein-target', 'proteinTarget', 160, 'Protein target saved');
    bindSetting('calorie-target', 'calorieTarget', 2500, 'Calorie goal saved');
    bindSetting('carb-target', 'carbTarget', 300, 'Carb goal saved');
    document.getElementById('claude-api-key').onchange = e => { state.settings.claudeApiKey = e.target.value.trim(); saveState(); toast('Claude API key saved locally'); };
  }
  function bindSetting(id, key, fallback, message) { document.getElementById(id).onchange = e => { state.settings[key] = Math.max(1, Number(e.target.value) || fallback); saveState(); toast(message); }; }

  function openFoodModal(category, existing = null) {
    lockPage();
    let analyzed = existing ? normalizeExisting(existing) : null;
    modalRoot.innerHTML = `<div class="modal-backdrop"><div class="sheet"><div class="sheet-handle"></div><div class="sheet-head"><h2>${existing ? 'Edit meal' : `Add ${MEAL_LABELS[category]}`}</h2><button class="close-button" id="close-sheet">×</button></div><div class="field"><label>What did you eat?</label><textarea id="food-text" placeholder="e.g. 100g oats with milk, 10 raisins and 5 almonds">${escapeHtml(existing?.description || '')}</textarea></div><button class="primary-button" id="analyze-food">Analyze</button><div id="food-error"></div><div id="food-result"></div></div></div>`;
    document.getElementById('close-sheet').onclick = closeModal;
    if (analyzed) renderFoodResult();
    document.getElementById('analyze-food').onclick = async () => { const text = document.getElementById('food-text').value.trim(); if (!text) return; try { analyzed = await analyzeFood(text, category); renderFoodResult(); } catch (err) { showInlineError('food-error', err.message || 'Could not analyze that meal.'); } };
    function renderFoodResult() {
      const root = document.getElementById('food-result');
      modalRoot._ingredients = analyzed.ingredients;
      root.innerHTML = `<div class="card result-summary"><strong>~${roundMacro(analyzed.protein)} g protein</strong><span>~${roundMacro(analyzed.carbs)} g carbs · ~${Math.round(analyzed.calories)} kcal</span></div>${analyzed.ingredients.length ? `<div class="section-kicker">Ingredients</div><div class="ingredient-head"><span>Ingredient</span><span>Amount</span><span>Protein /100g</span><span>Carbs /100g</span></div><div class="ingredient-list">${analyzed.ingredients.map((ing, i) => ingredientRowHtml(ing, i)).join('')}</div><div class="settings-help">Edit grams, protein or carbs per 100 g. The meal updates automatically.</div>` : ''}<div class="modal-actions">${existing ? '<button class="secondary-button danger" id="delete-entry">Delete</button>' : '<button class="secondary-button" id="cancel-entry">Cancel</button>'}<button class="primary-button" id="save-entry">${existing ? 'Save meal' : 'Add meal'}</button></div>`;
      root.querySelectorAll('.ingredient-row input').forEach(input => input.addEventListener('input', () => {
        analyzed.ingredients = readIngredientRows();
        analyzed = calculateFromIngredients(analyzed);
        root.querySelector('.result-summary').innerHTML = `<strong>~${roundMacro(analyzed.protein)} g protein</strong><span>~${roundMacro(analyzed.carbs)} g carbs · ~${Math.round(analyzed.calories)} kcal</span>`;
      }));
      const cancel = document.getElementById('cancel-entry'); if (cancel) cancel.onclick = closeModal;
      const del = document.getElementById('delete-entry'); if (del) del.onclick = () => { const d = getDay(selectedDate); d.entries = d.entries.filter(e => e.id !== existing.id); saveState(); closeModal(); renderToday(); };
      document.getElementById('save-entry').onclick = () => { const d = getDay(selectedDate); const entry = { id: existing?.id || uid(), category, description: document.getElementById('food-text').value.trim(), name: analyzed.name || 'Meal', protein: num(analyzed.protein), carbs: num(analyzed.carbs), calories: num(analyzed.calories), ingredients: analyzed.ingredients || [], source: existing?.source || 'ai' }; const idx = d.entries.findIndex(e => e.id === entry.id); if (idx >= 0) d.entries[idx] = entry; else d.entries.push(entry); saveState(); closeModal(); renderToday(); };
    }
  }

  function openExistingEntry(id) { const entry = getDay(selectedDate).entries.find(e => e.id === id); if (entry) openFoodModal(entry.category, entry); }
  function openSavedModal(id = null) {
    lockPage();
    const existing = id ? state.savedMeals.find(m => m.id === id) : null;
    let analyzed = existing ? normalizeExisting(existing) : null;
    renderBody();
    function renderBody() {
      modalRoot.innerHTML = `<div class="modal-backdrop"><div class="sheet"><div class="sheet-handle"></div><div class="sheet-head"><h2>${existing ? 'Edit saved meal' : 'New saved meal'}</h2><button class="close-button" id="close-saved">×</button></div><div id="saved-body"></div></div></div>`;
      document.getElementById('close-saved').onclick = closeModal;
      const body = document.getElementById('saved-body');
      if (!analyzed) {
        body.innerHTML = `<div class="field"><label>Meal description</label><textarea id="saved-description" placeholder="e.g. Huel Black, two scoops"></textarea></div><div class="field"><label>Usually added to</label><select id="saved-category">${mealOptions('breakfast')}</select></div><div id="saved-error"></div><div class="modal-actions single"><button class="primary-button" id="analyze-saved">Analyze</button></div>`;
        document.getElementById('analyze-saved').onclick = async () => { const text = document.getElementById('saved-description').value.trim(), category = document.getElementById('saved-category').value; if (!text) return; try { const result = await analyzeFood(text, category); analyzed = { ...result, description: text, category, id: uid(), usageCount: 0 }; renderBody(); } catch (err) { showInlineError('saved-error', err.message || 'Could not analyze that meal.'); } };
      } else {
        modalRoot._ingredients = analyzed.ingredients;
        body.innerHTML = `<div class="field"><label>Name</label><input id="saved-name" value="${escapeAttr(analyzed.name || '')}" /></div><div class="field"><label>Default meal</label><select id="saved-category">${mealOptions(analyzed.category || 'breakfast')}</select></div><div class="macro-grid three"><div class="field"><label>Protein (g)</label><input id="saved-protein" type="number" step="0.1" min="0" value="${num(analyzed.protein)}" /></div><div class="field"><label>Carbs (g)</label><input id="saved-carbs" type="number" step="0.1" min="0" value="${num(analyzed.carbs)}" /></div><div class="field"><label>Calories</label><input id="saved-calories" type="number" step="1" min="0" value="${num(analyzed.calories)}" /></div></div><div class="section-kicker">Ingredients</div><div class="ingredient-head"><span>Ingredient</span><span>Amount</span><span>Protein /100g</span><span>Carbs /100g</span></div><div class="ingredient-list">${analyzed.ingredients.map((ing, i) => ingredientRowHtml(ing, i)).join('') || '<div class="meal-empty">No ingredient breakdown.</div>'}</div><div class="settings-help">You can correct totals or ingredient reference values manually.</div><div class="modal-actions">${existing ? '<button class="secondary-button danger" id="delete-saved">Delete</button>' : '<button class="secondary-button" id="back-saved">Back</button>'}<button class="primary-button" id="save-saved">Save</button></div>`;
        const back = document.getElementById('back-saved'); if (back) back.onclick = () => { analyzed = null; renderBody(); };
        const del = document.getElementById('delete-saved'); if (del) del.onclick = () => { state.savedMeals = state.savedMeals.filter(m => m.id !== existing.id); saveState(); closeModal(); renderSaved(); };
        document.getElementById('save-saved').onclick = () => { const meal = { id: existing?.id || analyzed.id || uid(), name: document.getElementById('saved-name').value.trim() || 'Saved meal', description: analyzed.description || '', category: document.getElementById('saved-category').value, protein: num(document.getElementById('saved-protein').value), carbs: num(document.getElementById('saved-carbs').value), calories: num(document.getElementById('saved-calories').value), ingredients: readIngredientRows(), usageCount: existing?.usageCount || analyzed.usageCount || 0 }; const idx = state.savedMeals.findIndex(m => m.id === meal.id); if (idx >= 0) state.savedMeals[idx] = meal; else state.savedMeals.push(meal); saveState(); closeModal(); renderSaved(); };
      }
    }
  }

  function quickAdd(id) { const meal = state.savedMeals.find(m => m.id === id); if (!meal) return; meal.usageCount = (meal.usageCount || 0) + 1; getDay(selectedDate).entries.push({ id: uid(), category: meal.category, description: meal.description || meal.name, name: meal.name, protein: num(meal.protein), carbs: num(meal.carbs), calories: num(meal.calories), ingredients: clone(meal.ingredients || []), source: 'saved', savedMealId: meal.id }); saveState(); renderToday(); toast(`${meal.name} added`); }

  async function analyzeFood(text, mealType) {
    const apiKey = (state.settings.claudeApiKey || '').trim();
    if (!apiKey) { const demo = localEstimate(text); if (demo) return demo; throw new Error('Add your Claude API key in Settings first.'); }
    if (!apiKey.startsWith('sk-ant-')) throw new Error('That does not look like an Anthropic API key. It should begin with sk-ant-.');
    const system = `You are the nutrition analysis engine for a personal iPhone food tracker. The user may write in English or Danish. Estimate practical everyday nutrition, with protein primary and calories and carbohydrates secondary. Use grams for ingredient amounts whenever possible; convert pieces, scoops and millilitres to an estimated edible gram weight. Preserve stated gram quantities and mark estimated=false; inferred or converted gram quantities are estimated=true. Return ONLY valid JSON exactly shaped as: {"name":"short meal name","protein":0,"carbs":0,"calories":0,"ingredients":[{"name":"ingredient","amount":0,"unit":"g","estimated":false,"proteinPer100g":0,"carbsPer100g":0,"caloriesPer100g":0}]}. Totals must equal the sum of amount/100 multiplied by each per-100g value (allowing normal rounding).`;
    let response;
    try { response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1400, temperature: 0, system, messages: [{ role: 'user', content: `Meal type: ${mealType}.\nFood: ${text}` }] }) }); } catch { throw new Error('Could not reach Claude. Check your internet connection and try again.'); }
    if (!response.ok) { let detail = ''; try { detail = (await response.json())?.error?.message || ''; } catch {} if (response.status === 401) throw new Error('Claude rejected the API key. Check the key in Settings.'); if (response.status === 429) throw new Error('Claude rate limit reached. Try again shortly.'); throw new Error(detail || `Claude API returned ${response.status}.`); }
    const data = await response.json(); let output = data?.content?.find(block => block.type === 'text')?.text || ''; output = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let raw; try { raw = JSON.parse(output); } catch { throw new Error('Claude returned nutrition data in an unexpected format. Try Analyze again.'); }
    const normalized = normalizeAIResult(raw); if (!normalized) throw new Error('Claude returned incomplete nutrition data. Try Analyze again.'); return normalized;
  }

  function normalizeAIResult(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.ingredients)) return null;
    const ingredients = raw.ingredients.map(i => ({ name: String(i.name || 'Ingredient'), amount: num(i.amount), unit: 'g', estimated: Boolean(i.estimated), proteinPer100g: num(i.proteinPer100g), carbsPer100g: num(i.carbsPer100g), caloriesPer100g: num(i.caloriesPer100g) }));
    if (![raw.protein, raw.carbs, raw.calories].every(v => Number.isFinite(Number(v)))) return null;
    return calculateFromIngredients({ name: String(raw.name || 'Meal'), protein: num(raw.protein), carbs: num(raw.carbs), calories: num(raw.calories), ingredients });
  }
  function normalizeExisting(item) { const source = clone(item), totalAmount = (source.ingredients || []).reduce((s, i) => s + num(i.amount), 0); return { ...source, protein: num(item.protein), carbs: num(item.carbs), calories: num(item.calories), ingredients: (source.ingredients || []).map(i => ({ ...i, amount: num(i.amount), unit: i.unit || 'g', proteinPer100g: Number.isFinite(Number(i.proteinPer100g)) ? num(i.proteinPer100g) : (totalAmount ? num(item.protein) * 100 / totalAmount : 0), carbsPer100g: Number.isFinite(Number(i.carbsPer100g)) ? num(i.carbsPer100g) : (totalAmount ? num(item.carbs) * 100 / totalAmount : 0), caloriesPer100g: Number.isFinite(Number(i.caloriesPer100g)) ? num(i.caloriesPer100g) : (totalAmount ? num(item.calories) * 100 / totalAmount : 0) })) }; }
  function calculateFromIngredients(meal) { if (!meal.ingredients.length) return meal; return { ...meal, protein: meal.ingredients.reduce((s, i) => s + num(i.amount) * num(i.proteinPer100g) / 100, 0), carbs: meal.ingredients.reduce((s, i) => s + num(i.amount) * num(i.carbsPer100g) / 100, 0), calories: meal.ingredients.reduce((s, i) => s + num(i.amount) * num(i.caloriesPer100g) / 100, 0) }; }
  function localEstimate(text) { const s = text.toLowerCase(); if (!s.includes('100g oats') && !s.includes('100 g oats')) return null; const ingredients = [{ name: 'Oats', amount: 100, unit: 'g', estimated: false, proteinPer100g: 13.2, carbsPer100g: 67.7, caloriesPer100g: 379 }, { name: 'Milk', amount: 258, unit: 'g', estimated: true, proteinPer100g: 3.4, carbsPer100g: 4.8, caloriesPer100g: 61 }]; return calculateFromIngredients({ name: 'Oats with milk', ingredients }); }

  function ingredientRowHtml(ing, i) { return `<div class="ingredient-row"><input aria-label="Ingredient" data-ing-index="${i}" data-ing-field="name" value="${escapeAttr(ing.name || '')}" /><div class="amount-input"><input aria-label="Amount in grams" data-ing-index="${i}" data-ing-field="amount" inputmode="decimal" value="${escapeAttr(ing.amount ?? '')}" /><span>g</span></div><input aria-label="Protein per 100 grams" data-ing-index="${i}" data-ing-field="proteinPer100g" inputmode="decimal" value="${escapeAttr(ing.proteinPer100g ?? 0)}" /><input aria-label="Carbs per 100 grams" data-ing-index="${i}" data-ing-field="carbsPer100g" inputmode="decimal" value="${escapeAttr(ing.carbsPer100g ?? 0)}" /></div>`; }
  function readIngredientRows() { return [...document.querySelectorAll('.ingredient-row')].map(row => { const old = {}; row.querySelectorAll('input').forEach(input => { const field = input.dataset.ingField; old[field] = field === 'name' ? input.value.trim() : num(input.value); }); const idx = Number(row.querySelector('input').dataset.ingIndex); const source = modalRoot._ingredients?.[idx] || {}; return { ...source, ...old, unit: 'g', estimated: source.estimated || false }; }); }
  function mealOptions(selected) { return MEAL_TYPES.map(t => `<option value="${t}" ${t === selected ? 'selected' : ''}>${MEAL_LABELS[t]}</option>`).join(''); }
  function getDay(date) { if (!state.days[date]) state.days[date] = { date, entries: [] }; if (!Array.isArray(state.days[date].entries)) state.days[date].entries = []; return state.days[date]; }
  function dayTotals(day) { return { protein: sum(day.entries, 'protein'), carbs: sum(day.entries, 'carbs'), calories: sum(day.entries, 'calories') }; }
  function sevenDayProteinAverage(endDate) { let total = 0; for (let i = 0; i < 7; i++) total += dayTotals(state.days[shiftDate(endDate, -i)] || { entries: [] }).protein; return total / 7; }
  function sum(items, field) { return items.reduce((s, x) => s + num(x[field]), 0); }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
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
