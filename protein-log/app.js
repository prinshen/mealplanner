(() => {
  'use strict';

  const STORAGE_KEY = 'proteinLog.v1';
  const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snacks'];
  const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' };

  const state = loadState();
  let activeTab = 'today';
  let selectedDate = localDateKey(new Date());

  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const toastRoot = document.getElementById('toast-root');

  init();

  function init() {
    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        document.querySelectorAll('.tab-button').forEach(x => x.classList.toggle('active', x === btn));
        render();
      });
    });

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    render();
  }

  function defaultState() {
    return {
      settings: {
        proteinTarget: 160,
        claudeApiKey: ''
      },
      days: {},
      savedMeals: []
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      return {
        settings: { ...base.settings, ...(parsed.settings || {}) },
        days: parsed.days || {},
        savedMeals: Array.isArray(parsed.savedMeals) ? parsed.savedMeals : []
      };
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function render() {
    if (activeTab === 'today') renderToday();
    if (activeTab === 'saved') renderSaved();
    if (activeTab === 'settings') renderSettings();
  }

  function renderToday() {
    const day = getDay(selectedDate);
    const totals = dayTotals(day);
    const target = Number(state.settings.proteinTarget) || 160;
    const pct = Math.min(1, totals.protein / target);
    const over = Math.max(0, totals.protein - target);
    const today = localDateKey(new Date());
    const isToday = selectedDate === today;
    const canNext = selectedDate < today;
    const quick = [...state.savedMeals]
      .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
      .slice(0, 4);

    app.innerHTML = `
      <section>
        <div class="date-nav">
          <button class="date-button" id="prev-day" aria-label="Previous day">‹</button>
          <div class="date-center">
            <label class="date-click-target" for="date-picker">
              <div class="date-label">${escapeHtml(isToday ? 'Today' : formatDate(selectedDate))}</div>
              <div class="date-sub">${escapeHtml(formatLongDate(selectedDate))}</div>
            </label>
            <input class="date-picker" id="date-picker" type="date" max="${today}" value="${selectedDate}" />
          </div>
          <button class="date-button" id="next-day" aria-label="Next day" ${canNext ? '' : 'disabled'}>›</button>
        </div>

        <div class="card progress-card">
          <div class="progress-ring" style="--progress:${Math.round(pct * 360)}deg">
            <div class="ring-content">
              <div class="ring-number">${roundMacro(totals.protein)} g</div>
              <div class="ring-target">of ${roundMacro(target)} g</div>
              <div class="over-target">${over > 0 ? `+${roundMacro(over)} g` : ''}</div>
            </div>
          </div>
          <div class="calories"><strong>${Math.round(totals.calories).toLocaleString()}</strong> kcal</div>
        </div>

        ${quick.length && selectedDate <= today ? `
          <div class="quick-wrap">
            <div class="section-kicker">Quick add</div>
            <div class="quick-row">
              ${quick.map(m => `
                <button class="quick-add" data-quick-id="${m.id}">
                  <span class="quick-add-name">${escapeHtml(m.name)}</span>
                  <span class="quick-add-macro">${roundMacro(m.protein)} g · ${Math.round(m.calories)} kcal</span>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${MEAL_TYPES.map(type => renderMealSection(type, day)).join('')}
      </section>
    `;

    document.getElementById('prev-day').onclick = () => { selectedDate = shiftDate(selectedDate, -1); renderToday(); };
    document.getElementById('next-day').onclick = () => { if (canNext) { selectedDate = shiftDate(selectedDate, 1); renderToday(); } };
    document.getElementById('date-picker').onchange = e => { if (e.target.value) { selectedDate = e.target.value; renderToday(); } };
    document.querySelectorAll('[data-add-meal]').forEach(btn => btn.onclick = () => openFoodModal(btn.dataset.addMeal));
    document.querySelectorAll('[data-entry-id]').forEach(btn => btn.onclick = () => openExistingEntry(btn.dataset.entryId));
    document.querySelectorAll('[data-quick-id]').forEach(btn => btn.onclick = () => quickAdd(btn.dataset.quickId));
  }

  function renderMealSection(type, day) {
    const entries = day.entries.filter(e => e.category === type);
    const protein = entries.reduce((sum, e) => sum + (Number(e.protein) || 0), 0);
    return `
      <div class="card meal-card">
        <div class="meal-header">
          <div>
            <div class="meal-title">${MEAL_LABELS[type]}</div>
            <div class="meal-subtitle">${entries.length ? `${roundMacro(protein)} g protein` : 'No food added'}</div>
          </div>
          <button class="add-button" data-add-meal="${type}">+ Add</button>
        </div>
        ${entries.length ? entries.map(e => `
          <button class="meal-entry" data-entry-id="${e.id}">
            <span><strong>${escapeHtml(e.name || e.description || 'Meal')}</strong>${e.source === 'saved' ? '<small>Saved meal</small>' : ''}</span>
            <span class="entry-macros"><strong>${roundMacro(e.protein)} g</strong><small>${Math.round(e.calories)} kcal</small></span>
          </button>
        `).join('') : '<div class="meal-empty">Nothing here yet.</div>'}
      </div>
    `;
  }

  function renderSaved() {
    const meals = [...state.savedMeals].sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
    app.innerHTML = `
      <div class="page-head"><h1>Saved meals</h1><button class="primary-button" id="new-saved">+ New</button></div>
      ${meals.length ? meals.map(m => `
        <div class="card saved-card">
          <div><strong>${escapeHtml(m.name)}</strong><small>${MEAL_LABELS[m.category]} · ${roundMacro(m.protein)} g · ${Math.round(m.calories)} kcal</small></div>
          <button class="secondary-button" data-saved-edit="${m.id}">Edit</button>
        </div>
      `).join('') : '<div class="card empty-card">No saved meals yet.</div>'}
    `;
    document.getElementById('new-saved').onclick = () => openSavedModal();
    document.querySelectorAll('[data-saved-edit]').forEach(btn => btn.onclick = () => openSavedModal(btn.dataset.savedEdit));
  }

  function renderSettings() {
    app.innerHTML = `
      <h1>Settings</h1>
      <div class="card settings-group">
        <div class="settings-row">
          <label class="settings-label" for="protein-target">Daily protein target</label>
          <input id="protein-target" type="number" inputmode="decimal" min="1" step="1" value="${Number(state.settings.proteinTarget) || 160}" />
          <div class="settings-help">The same target is used every day.</div>
        </div>
      </div>

      <div class="section-kicker">Claude</div>
      <div class="card settings-group">
        <div class="settings-row">
          <label class="settings-label" for="claude-api-key">Claude API key</label>
          <input id="claude-api-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…" value="${escapeAttr(state.settings.claudeApiKey || '')}" />
          <div class="settings-help">Stored only in this browser's local storage. Protein Log treats this as an Anthropic API key and calls Claude Haiku 4.5 directly. We can move it to Cloudflare later.</div>
        </div>
      </div>

      <div class="card settings-group"><div class="settings-row"><strong>Storage</strong><div class="settings-help">Meals, saved meals, target and the temporary Claude key are stored locally in Safari on this iPhone.</div></div></div>
    `;

    document.getElementById('protein-target').onchange = e => {
      state.settings.proteinTarget = Math.max(1, Number(e.target.value) || 160);
      saveState();
      toast('Protein target saved');
    };
    document.getElementById('claude-api-key').onchange = e => {
      state.settings.claudeApiKey = e.target.value.trim();
      saveState();
      toast('Claude API key saved locally');
    };
  }

  function openFoodModal(category, existing = null) {
    let analyzed = existing ? clone(existing) : null;
    modalRoot.innerHTML = `
      <div class="modal-backdrop"><div class="sheet"><div class="sheet-handle"></div>
        <div class="sheet-head"><h2>${existing ? 'Edit meal' : `Add ${MEAL_LABELS[category]}`}</h2><button class="close-button" id="close-sheet">×</button></div>
        <div class="field"><label>What did you eat?</label><textarea id="food-text" placeholder="e.g. 100g oats with milk, 10 raisins and 5 almonds">${escapeHtml(existing?.description || '')}</textarea></div>
        <button class="primary-button" id="analyze-food">Analyze</button>
        <div id="food-error"></div><div id="food-result"></div>
      </div></div>`;
    document.getElementById('close-sheet').onclick = closeModal;
    if (analyzed) renderFoodResult();
    document.getElementById('analyze-food').onclick = async () => {
      const text = document.getElementById('food-text').value.trim();
      if (!text) return;
      try {
        analyzed = await analyzeFood(text, category);
        renderFoodResult();
      } catch (err) { showInlineError('food-error', err.message || 'Could not analyze that meal.'); }
    };

    function renderFoodResult() {
      const root = document.getElementById('food-result');
      root.innerHTML = `
        <div class="card result-summary"><strong>~${roundMacro(analyzed.protein)} g protein</strong><span>~${Math.round(analyzed.calories)} kcal</span></div>
        ${(analyzed.ingredients || []).length ? `<div class="section-kicker">Ingredients</div><div class="ingredient-list">${analyzed.ingredients.map((ing, i) => ingredientRowHtml(ing, i)).join('')}</div><div class="settings-help">Correct ingredient amounts if needed, then tap Recalculate.</div><button class="secondary-button recalc" id="reanalyze">Recalculate</button>` : ''}
        <div class="modal-actions">${existing ? '<button class="secondary-button danger" id="delete-entry">Delete</button>' : '<button class="secondary-button" id="cancel-entry">Cancel</button>'}<button class="primary-button" id="save-entry">${existing ? 'Save meal' : 'Add meal'}</button></div>`;
      const cancel = document.getElementById('cancel-entry'); if (cancel) cancel.onclick = closeModal;
      const del = document.getElementById('delete-entry'); if (del) del.onclick = () => { const d = getDay(selectedDate); d.entries = d.entries.filter(e => e.id !== existing.id); saveState(); closeModal(); renderToday(); };
      document.getElementById('save-entry').onclick = () => {
        const d = getDay(selectedDate);
        const entry = { id: existing?.id || uid(), category, description: document.getElementById('food-text').value.trim(), name: analyzed.name || 'Meal', protein: Number(analyzed.protein) || 0, calories: Number(analyzed.calories) || 0, ingredients: analyzed.ingredients || [], source: 'ai' };
        const idx = d.entries.findIndex(e => e.id === entry.id); if (idx >= 0) d.entries[idx] = entry; else d.entries.push(entry);
        saveState(); closeModal(); renderToday();
      };
      const recalc = document.getElementById('reanalyze'); if (recalc) recalc.onclick = async () => {
        const ingredients = readIngredientRows();
        try { analyzed = await analyzeFood(document.getElementById('food-text').value.trim(), category, { ingredients }); renderFoodResult(); }
        catch (err) { showInlineError('food-error', err.message || 'Could not recalculate.'); }
      };
    }
  }

  function openExistingEntry(id) {
    const entry = getDay(selectedDate).entries.find(e => e.id === id);
    if (entry) openFoodModal(entry.category, entry);
  }

  function openSavedModal(id = null) {
    const existing = id ? state.savedMeals.find(m => m.id === id) : null;
    let analyzed = existing ? clone(existing) : null;
    renderBody();

    function renderBody() {
      modalRoot.innerHTML = `<div class="modal-backdrop"><div class="sheet"><div class="sheet-handle"></div><div class="sheet-head"><h2>${existing ? 'Edit saved meal' : 'New saved meal'}</h2><button class="close-button" id="close-saved">×</button></div><div id="saved-body"></div></div></div>`;
      document.getElementById('close-saved').onclick = closeModal;
      const body = document.getElementById('saved-body');
      if (!analyzed) {
        body.innerHTML = `<div class="field"><label>Meal description</label><textarea id="saved-description" placeholder="e.g. Huel Black, two scoops"></textarea></div><div class="field"><label>Usually added to</label><select id="saved-category">${mealOptions('breakfast')}</select></div><div id="saved-error"></div><div class="modal-actions single"><button class="primary-button" id="analyze-saved">Analyze</button></div>`;
        document.getElementById('analyze-saved').onclick = async () => {
          const text = document.getElementById('saved-description').value.trim(); const category = document.getElementById('saved-category').value; if (!text) return;
          try { const result = await analyzeFood(text, category); analyzed = { ...result, description: text, category, id: uid(), usageCount: 0 }; renderBody(); }
          catch (err) { showInlineError('saved-error', err.message || 'Could not analyze that meal.'); }
        };
      } else {
        body.innerHTML = `<div class="field"><label>Name</label><input id="saved-name" type="text" value="${escapeAttr(analyzed.name || '')}" /></div><div class="field"><label>Default meal</label><select id="saved-category">${mealOptions(analyzed.category || 'breakfast')}</select></div><div class="macro-grid"><div class="field"><label>Protein (g)</label><input id="saved-protein" type="number" inputmode="decimal" step="0.1" min="0" value="${Number(analyzed.protein || 0)}" /></div><div class="field"><label>Calories</label><input id="saved-calories" type="number" inputmode="decimal" step="1" min="0" value="${Number(analyzed.calories || 0)}" /></div></div><div class="section-kicker">Ingredients</div><div class="ingredient-list">${(analyzed.ingredients || []).map((ing, i) => ingredientRowHtml(ing, i)).join('') || '<div class="meal-empty">No ingredient breakdown.</div>'}</div><div class="settings-help">Saved meal protein and calories can be manually corrected. These values stay fixed when you Quick Add it.</div><div class="modal-actions">${existing ? '<button class="secondary-button danger" id="delete-saved">Delete</button>' : '<button class="secondary-button" id="back-saved">Back</button>'}<button class="primary-button" id="save-saved">Save</button></div>`;
        const back = document.getElementById('back-saved'); if (back) back.onclick = () => { analyzed = null; renderBody(); };
        const del = document.getElementById('delete-saved'); if (del) del.onclick = () => { state.savedMeals = state.savedMeals.filter(m => m.id !== existing.id); saveState(); closeModal(); renderSaved(); };
        document.getElementById('save-saved').onclick = () => {
          const meal = { id: existing?.id || analyzed.id || uid(), name: document.getElementById('saved-name').value.trim() || 'Saved meal', description: analyzed.description || '', category: document.getElementById('saved-category').value, protein: Number(document.getElementById('saved-protein').value) || 0, calories: Number(document.getElementById('saved-calories').value) || 0, ingredients: readIngredientRows(), usageCount: existing?.usageCount || analyzed.usageCount || 0 };
          const idx = state.savedMeals.findIndex(m => m.id === meal.id); if (idx >= 0) state.savedMeals[idx] = meal; else state.savedMeals.push(meal);
          saveState(); closeModal(); renderSaved();
        };
      }
    }
  }

  function quickAdd(id) {
    const meal = state.savedMeals.find(m => m.id === id); if (!meal) return;
    meal.usageCount = (meal.usageCount || 0) + 1;
    getDay(selectedDate).entries.push({ id: uid(), category: meal.category, description: meal.description || meal.name, name: meal.name, protein: Number(meal.protein) || 0, calories: Number(meal.calories) || 0, ingredients: clone(meal.ingredients || []), source: 'saved', savedMealId: meal.id });
    saveState(); renderToday(); toast(`${meal.name} added`);
  }

  async function analyzeFood(text, mealType, context = {}) {
    const apiKey = (state.settings.claudeApiKey || '').trim();
    if (!apiKey) {
      const demo = localEstimate(text);
      if (demo) return demo;
      throw new Error('Add your Claude API key in Settings first.');
    }
    if (!apiKey.startsWith('sk-ant-')) throw new Error('That does not look like an Anthropic API key. It should begin with sk-ant-.');

    const editedIngredients = Array.isArray(context.ingredients) && context.ingredients.length ? `\nThe user edited the ingredient list. Use these corrected ingredients and amounts as authoritative:\n${JSON.stringify(context.ingredients)}` : '';
    const system = `You are the nutrition analysis engine for a personal iPhone food tracker. The user may write in English or Danish. Estimate practical everyday nutrition, with protein as the primary metric and calories secondary. Make sensible estimates for unspecified quantities from normal eating context. Do not ask follow-up questions merely because an amount is missing. Preserve exact stated quantities and mark them estimated=false. Mark inferred quantities estimated=true. Do not add ingredients that are not reasonably implied. Return ONLY valid JSON, no markdown or explanation, exactly shaped as: {"name":"short natural meal name","protein":0,"calories":0,"ingredients":[{"name":"ingredient","amount":0,"unit":"g","estimated":false}]}. protein is total grams for the whole meal and calories is total kcal.`;
    const userText = `Meal type: ${mealType}.\nFood: ${text}${editedIngredients}`;

    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 900, temperature: 0, system, messages: [{ role: 'user', content: userText }] })
      });
    } catch { throw new Error('Could not reach Claude. Check your internet connection and try again.'); }

    if (!response.ok) {
      let detail = ''; try { const err = await response.json(); detail = err?.error?.message || ''; } catch {}
      if (response.status === 401) throw new Error('Claude rejected the API key. Check the key in Settings.');
      if (response.status === 429) throw new Error('Claude rate limit reached. Try again shortly.');
      throw new Error(detail || `Claude API returned ${response.status}.`);
    }

    const data = await response.json();
    let output = data?.content?.find(block => block.type === 'text')?.text || '';
    output = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let raw; try { raw = JSON.parse(output); } catch { throw new Error('Claude returned nutrition data in an unexpected format. Try Analyze again.'); }
    const normalized = normalizeAIResult(raw); if (!normalized) throw new Error('Claude returned incomplete nutrition data. Try Analyze again.');
    return normalized;
  }

  function normalizeAIResult(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const ingredients = Array.isArray(raw.ingredients) ? raw.ingredients.map(i => ({ name: String(i.name || 'Ingredient'), amount: Number(i.amount) || 0, unit: String(i.unit || 'g'), estimated: Boolean(i.estimated) })) : [];
    const protein = Number(raw.protein), calories = Number(raw.calories);
    if (!Number.isFinite(protein) || !Number.isFinite(calories)) return null;
    return { name: String(raw.name || 'Meal'), protein, calories, ingredients };
  }

  function localEstimate(text) {
    const s = text.toLowerCase();
    if (s.includes('100g oats') || s.includes('100 g oats')) return { name: 'Oats with milk', protein: 20.2, calories: 535, ingredients: [{ name: 'Oats', amount: 100, unit: 'g', estimated: false }, { name: 'Milk', amount: 250, unit: 'ml', estimated: true }, ...(s.includes('raisin') ? [{ name: 'Raisins', amount: 10, unit: 'pieces', estimated: false }] : []), ...(s.includes('almond') ? [{ name: 'Almonds', amount: 5, unit: 'pieces', estimated: false }] : []) ] };
    return null;
  }

  function ingredientRowHtml(ing, i) { return `<div class="ingredient-row"><input data-ing-index="${i}" data-ing-field="name" value="${escapeAttr(ing.name || '')}" /><input data-ing-index="${i}" data-ing-field="amount" inputmode="decimal" value="${escapeAttr(ing.amount ?? '')}" /><input data-ing-index="${i}" data-ing-field="unit" value="${escapeAttr(ing.unit || '')}" /></div>`; }
  function readIngredientRows() { const rows = []; document.querySelectorAll('.ingredient-row').forEach((row, i) => { const obj = { estimated: false }; row.querySelectorAll('input').forEach(input => { const field = input.dataset.ingField; obj[field] = field === 'amount' ? Number(input.value) || 0 : input.value.trim(); }); rows[i] = obj; }); return rows; }
  function mealOptions(selected) { return MEAL_TYPES.map(t => `<option value="${t}" ${t === selected ? 'selected' : ''}>${MEAL_LABELS[t]}</option>`).join(''); }
  function getDay(date) { if (!state.days[date]) state.days[date] = { date, entries: [] }; return state.days[date]; }
  function dayTotals(day) { return day.entries.reduce((a, e) => ({ protein: a.protein + (Number(e.protein) || 0), calories: a.calories + (Number(e.calories) || 0) }), { protein: 0, calories: 0 }); }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function closeModal() { modalRoot.innerHTML = ''; }
  function showInlineError(id, message) { const el = document.getElementById(id); if (el) el.innerHTML = `<div class="inline-error">${escapeHtml(message)}</div>`; }
  function toast(message) { toastRoot.textContent = message; toastRoot.classList.add('show'); setTimeout(() => toastRoot.classList.remove('show'), 1600); }
  function roundMacro(v) { const n = Number(v) || 0; return Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : n.toFixed(1); }
  function localDateKey(d) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${day}`; }
  function parseLocalDate(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); }
  function shiftDate(key, amount) { const d = parseLocalDate(key); d.setDate(d.getDate() + amount); return localDateKey(d); }
  function formatDate(key) { return new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' }).format(parseLocalDate(key)); }
  function formatLongDate(key) { return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric' }).format(parseLocalDate(key)); }
  function escapeHtml(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function escapeAttr(v) { return escapeHtml(v); }
})();
