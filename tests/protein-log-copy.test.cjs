const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../protein-log/app.js'), 'utf8');

// Exercise the real app logic and event handlers without touching browser storage.
function boot(initial) {
  let stored = JSON.stringify(initial), nextId = 0;
  const nodes = new Map();
  function parse(html) {
    for (const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>([\s\S]*?)(?=<\/\1>|$)/g)) {
      const [, tag, attrs, id, body] = match;
      const node = element(id);
      node.checked = /\bchecked\b/.test(attrs);
      node.value = /\bvalue="([^"]*)"/.exec(attrs)?.[1] || '';
      if (tag === 'textarea') node.value = body;
      if (tag === 'select') node.value = /<option value="([^"]+)" selected/.exec(body)?.[1] || /<option value="([^"]+)"/.exec(body)?.[1] || '';
      parse(body);
    }
  }
  function element(id) {
    if (nodes.has(id)) return nodes.get(id);
    const node = { value: '', checked: false, disabled: false, textContent: '', style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, querySelectorAll() { return []; }, insertAdjacentHTML(_, html) { parse(html); } };
    Object.defineProperty(node, 'innerHTML', { get() { return node.html || ''; }, set(html) { node.html = html; parse(html); } });
    nodes.set(id, node); return node;
  }
  let ingredientRows = [];
  const document = { getElementById: element, querySelectorAll(selector) { return selector === '.ingredient-row' ? ingredientRows : []; }, body: element('body') };
  const timers = [];
  const context = { document, localStorage: { getItem() { return stored; }, setItem(_, value) { stored = value; } }, window: { scrollY: 0, scrollTo() {}, matchMedia() { return { matches: false }; } }, performance: { now() { return 100; } }, crypto: { randomUUID() { return `new-${++nextId}`; } }, setTimeout(fn) { timers.push(fn); }, Intl, Date };
  vm.createContext(context);
  const instrumented = source.replace('  init();', '  globalThis.api = { state, renderToday, renderWeekly, openFoodModal, openExistingEntry, mealCopySnapshot, mealLibrary, mealFingerprint, mealBadge, nutritionAverage, rollingWeightSummary, proteinColor, normalizeAIResult, prepareIngredientEditor, calculateFromIngredients, sevenDayNutritionAverage, buildWeeklyReport, weeklyCsv, navigateDayBySwipe, startDaySwipe, moveDaySwipe, finishDaySwipe, getDate() { return selectedDate; }, setDate(date) { selectedDate = date; }, setWeek(date) { selectedWeekStart = date; } };');
  vm.runInContext(instrumented, context);
  return { api: context.api, node: element, stored: () => JSON.parse(stored), setRows(rows) { ingredientRows = rows; }, document, flushTimers() { while (timers.length) timers.shift()(); } };
}

const legacyIngredient = { name: 'Pancakes', amount: 150, unit: 'g', proteinPer100g: 12.5, carbsPer100g: 22, fatPer100g: 6, caloriesPer100g: 192, estimated: true };
const original = { id: 'original', name: 'Pancakes', description: 'Pancakes with milk', category: 'breakfast', protein: 18.75, carbs: 33, fat: 9, calories: 288, estimated: true, source: 'saved', savedMealId: 'recipe', ingredients: [legacyIngredient] };
const recipe = { ...original, id: 'recipe', usageCount: 4 };
const fixture = { settings: { proteinTarget: 160, calorieTarget: 2500, carbTarget: 300, theme: 'dark', claudeApiKey: 'test-placeholder' }, days: {
  '2026-08-17': { date: '2026-08-17', entries: [{ id: 'second', name: 'Skyr', category: 'snacks', protein: 20, calories: 130 }] },
  '2026-08-18': { date: '2026-08-18', entries: [] },
  '2026-08-19': { date: '2026-08-19', weightKg: 82.7, creatine: true, activities: { run: true }, entries: [original] }
}, savedMeals: [recipe] };

const app = boot(fixture);
assert.equal(app.api.state.settings.carbTarget, 300, 'legacy settings remain loadable');
assert.equal(app.api.state.days['2026-08-19'].entries[0].fat, 9, 'legacy log data is not destroyed on load');
assert.equal(app.api.state.copiedMeal, null, 'legacy storage loads without a clipboard');

app.api.setDate('2026-08-19');
app.api.renderToday();
const renderedDay = app.node('app').innerHTML;
assert.ok(!/carb|fat|estimated/i.test(renderedDay), 'removed nutrition and estimate labels are absent from the day UI');
assert.match(renderedDay, /18\.8 g eaten/, 'eaten protein remains visible');
assert.match(renderedDay, /ring-number">141\.3 g/, 'remaining protein is the primary ring number');
assert.ok(!/Within target range/i.test(renderedDay));
assert.match(renderedDay, /Find a meal/);
assert.ok(!/Quick add a meal/.test(renderedDay));

const rolling = app.api.sevenDayNutritionAverage('2026-08-19');
assert.equal(rolling.count, 2, 'empty days are excluded from the rolling average');
assert.equal(rolling.protein, 19.375);
app.api.navigateDayBySwipe(100, 5);
assert.equal(app.api.getDate(), '2026-08-18', 'horizontal swipe changes day');
assert.equal(app.api.navigateDayBySwipe(20, 100), false, 'vertical scrolling is not treated as a day swipe');
app.api.setDate('2026-08-19');

app.api.openExistingEntry('original');
assert.ok(!/save-to-saved/.test(app.node('food-editor').innerHTML), 'all meals are automatically reusable');
assert.match(app.node('food-editor').innerHTML, /Ingredients/);
assert.match(app.node('food-editor').innerHTML, /Protein \/100g/);
assert.match(app.node('food-editor').innerHTML, /Meal total:/);
assert.ok(!/<details|id="meal-protein"|id="meal-calories"/.test(app.node('food-editor').innerHTML), 'ingredients are visible and meal totals are read-only');
app.node('copy-entry').onclick();
const today = new Date();
const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
assert.equal(app.api.getDate(), todayKey, 'copy opens today');
assert.deepEqual(app.stored().days, fixture.days, 'copy must not change logged data');
assert.deepEqual(app.stored().savedMeals, fixture.savedMeals, 'copy must not change saved recipes');
assert.equal(app.stored().copiedMeal.protein, 18.75);
assert.equal(app.stored().copiedMeal.calories, 288);
assert.equal(app.stored().copiedMeal.per100Totals, undefined);
assert.equal(app.stored().copiedMeal.ingredients[0].proteinPer100g, 12.5);
assert.equal(app.stored().copiedMeal.ingredients[0].caloriesPer100g, 192);
assert.equal(app.stored().copiedMeal.carbs, undefined);
assert.equal(app.stored().copiedMeal.fat, undefined);
assert.equal(app.stored().copiedMeal.estimated, undefined);
assert.equal(app.stored().copiedMeal.savedMealId, undefined);
assert.deepEqual(Object.keys(app.stored().copiedMeal.ingredients[0]).sort(), ['amount', 'caloriesPer100g', 'name', 'proteinPer100g']);

app.api.setDate('2026-08-20');
app.api.renderToday();
app.node('paste-category').value = 'lunch';
app.node('paste-meal').onclick();
const pasted = app.api.state.days['2026-08-20'].entries[0];
assert.equal(pasted.category, 'lunch');
assert.equal(pasted.id, 'new-1');
assert.equal(pasted.savedMealId, undefined);
assert.equal(app.api.state.copiedMeal, null, 'clipboard clears after a single paste');
pasted.ingredients[0].amount = 50;
assert.equal(app.api.state.days['2026-08-19'].entries[0].ingredients[0].amount, 150);

app.api.openFoodModal('breakfast', null, app.api.state.savedMeals[0]);
app.node('meal-name').value = 'Pancakes with extra milk';
app.node('save-entry').onclick();
const reusedMeal = app.api.state.days['2026-08-20'].entries[1];
assert.notEqual(reusedMeal.id, pasted.id);
assert.equal(reusedMeal.name, 'Pancakes with extra milk');
reusedMeal.ingredients[0].amount = 25;
assert.equal(app.api.state.savedMeals[0].ingredients[0].amount, 150, 'library reuse stays independent');
assert.equal(reusedMeal.carbs, undefined);

const manual = boot(fixture);
manual.api.setDate('2026-08-20');
manual.api.openFoodModal('dinner');
assert.ok(!/Meal totals|Manual nutrition/.test(manual.node('food-editor').innerHTML), 'nutrition fields are hidden in the default entry flow');
assert.match(manual.node('food-editor').innerHTML, /Analyze with Claude/);
assert.match(manual.node('food-editor').innerHTML, /Enter manually/);
manual.node('food-text').value = 'Canteen chicken and rice'; manual.node('food-text').oninput({ target: manual.node('food-text') });
manual.node('manual-food').onclick();
assert.match(manual.node('food-editor').innerHTML, /Ingredients/);
assert.match(manual.node('food-editor').innerHTML, /\+ Add ingredient/);
assert.match(manual.node('food-editor').innerHTML, /Amount in grams/);
assert.ok(!/Manual values per 100 g|id="meal-protein"|id="meal-calories"/.test(manual.node('food-editor').innerHTML));
const combined = manual.api.calculateFromIngredients({ ingredients: [
  { name: 'Skyr', amount: 200, proteinPer100g: 11, caloriesPer100g: 63 },
  { name: 'Muesli', amount: 40, proteinPer100g: 10, caloriesPer100g: 380 }
] });
assert.equal(combined.protein, 26, 'meal protein is calculated from separate ingredients');
assert.equal(combined.calories, 278, 'meal calories are calculated from separate ingredients');
const migratedManual = manual.api.prepareIngredientEditor({ name: 'Old manual meal', manualWeightG: 250, per100Totals: { protein: 20.5, calories: 200 }, protein: 51.25, calories: 500, ingredients: [] });
assert.equal(migratedManual.ingredients[0].amount, 250, 'v17.3 manual meals remain editable as one ingredient');
assert.equal(migratedManual.protein, 51.25);
assert.equal(migratedManual.calories, 500);

const ai = app.api.normalizeAIResult({ name: 'AI meal', protein: 30, calories: 400, carbs: 100, fat: 20, ingredients: [{ name: 'Chicken', amount: 200, proteinPer100g: 20, caloriesPer100g: 150, carbsPer100g: 5 }] });
assert.equal(ai.carbs, undefined, 'unwanted AI fields are ignored');
assert.deepEqual(Object.keys(ai.ingredients[0]).sort(), ['amount', 'caloriesPer100g', 'name', 'proteinPer100g']);
assert.equal(ai.protein, 40, 'AI totals are calculated from its ingredient rows');
assert.equal(ai.calories, 300);

const report = app.api.buildWeeklyReport('2026-08-17');
assert.equal(report.summary.loggedNutritionDays, 3);
assert.equal(report.summary.weightEntries, 1);
assert.equal(report.summary.runs, 1);
assert.equal(report.days[1].hasNutrition, false);
assert.equal(report.days[1].proteinG, 0);
assert.ok(!('carbsG' in report.days[0]));
assert.ok(!('fatG' in report.days[0]));
const csv = app.api.weeklyCsv(report);
assert.match(csv, /average_recorded_protein_g/);
assert.match(csv, /weight_entries/);
assert.match(csv, /strength_workout/);
assert.ok(!/carb|fat|estimated/i.test(csv), 'weekly export contains only active nutrition fields');

const reloaded = boot(app.stored());
assert.equal(reloaded.api.state.copiedMeal, null, 'used copy remains cleared after reload');
const legacyCopy = reloaded.api.mealCopySnapshot({ name: 'Old meal', protein: '13,5', calories: 250, carbs: 88, fat: 10 });
assert.equal(legacyCopy.protein, 13.5);
assert.equal(legacyCopy.carbs, undefined);
assert.equal(legacyCopy.ingredients.length, 0);


const variants = boot(fixture);
variants.api.state.days['2026-08-20'] = { entries: [
  { ...JSON.parse(JSON.stringify(original)), id: 'identical' },
  { ...JSON.parse(JSON.stringify(original)), id: 'variant', ingredients: [{ ...legacyIngredient, amount: 200 }], protein: 25, calories: 384, quality: 'edited' }
] };
const library = variants.api.mealLibrary('pancakes');
assert.equal(library.length, 2, 'same name with different contents stays separate; exact repeats group');
assert.equal(library.find(x => x.count === 2).meal.protein, 18.75);
assert.equal(variants.api.mealLibrary('milk').length, 2, 'search includes descriptions');
assert.match(variants.api.mealBadge({ quality: 'edited' }), /Edited/);
assert.match(variants.api.mealBadge({ source: 'manual' }), /Manual/);
assert.equal(variants.api.mealBadge(original), '', 'legacy estimates are not marked edited without evidence');
assert.equal(variants.api.mealCopySnapshot({ ...original, quality: 'edited' }).quality, 'edited');
assert.equal(variants.api.nutritionAverage('2026-08-19', 30).count, 2);
variants.api.state.days['2026-08-01'] = { entries: [{ protein: 100, calories: 800 }], weightKg: 81 };
assert.equal(variants.api.nutritionAverage('2026-08-19', 30).count, 3);
assert.equal(variants.api.nutritionAverage('2026-08-19', 7).count, 2);
assert.equal(variants.api.rollingWeightSummary('2026-08-19', 30).count, 2);
assert.equal(variants.api.rollingWeightSummary('2026-08-19', 7).count, 1);
assert.equal(variants.api.proteinColor(50), variants.api.proteinColor(99));
assert.notEqual(variants.api.proteinColor(110), variants.api.proteinColor(130));
assert.equal(variants.api.proteinColor(160), variants.api.proteinColor(200));
variants.api.setDate('2026-08-18');
variants.api.renderToday();
const emptyLayout = variants.node('app').innerHTML;
assert.ok(emptyLayout.indexOf('weight-card') < emptyLayout.indexOf('meal-card'));
assert.ok(emptyLayout.indexOf('creatine-row') < emptyLayout.indexOf('meal-card'));
variants.api.setDate('2026-08-19');
variants.api.renderToday();
const filledLayout = variants.node('app').innerHTML;
assert.ok(filledLayout.indexOf('weight-card') > filledLayout.indexOf('activity-card'));
assert.ok(filledLayout.indexOf('creatine-row') > filledLayout.indexOf('activity-card'));
assert.match(filledLayout, /calorie-bar/);
assert.match(filledLayout, /data-average-period="30"/);
const untouched = JSON.stringify(variants.api.state.days);
const preview = variants.api.renderToday('2026-08-02');
assert.match(preview, /day-view/);
assert.equal(JSON.stringify(variants.api.state.days), untouched, 'swipe previews do not create empty history entries');

// Exercise the ingredient input event through the real editor handlers.
const edited = boot(fixture);
edited.api.setDate('2026-08-19');
let editHandler;
const fieldValues = { name: 'Pancakes', amount: '200', proteinPer100g: '15,5', caloriesPer100g: '210' };
const inputs = Object.entries(fieldValues).map(([ingField,value]) => ({ dataset: { ingField }, value, addEventListener(_, handler) { editHandler = handler; } }));
const row = { querySelectorAll() { return inputs; } };
edited.node('food-editor').querySelectorAll = selector => selector === '.ingredient-row input' ? inputs : selector === '.ingredient-row' ? [row] : [];
// readIngredientRows uses document.querySelectorAll, supplied by the test harness below.
edited.setRows([row]);
edited.api.openExistingEntry('original');
editHandler();
edited.node('meal-name').value = 'My corrected pancakes';
edited.node('save-entry').onclick();
const corrected = edited.api.state.days['2026-08-19'].entries[0];
assert.equal(corrected.name, 'My corrected pancakes');
assert.equal(corrected.quality, 'edited');
assert.equal(corrected.protein, 31);
assert.equal(corrected.calories, 420);
assert.equal(edited.api.state.savedMeals[0].name, 'Pancakes');
assert.equal(edited.api.state.savedMeals[0].protein, 18.75);
// Quantity changes still recalculate totals, but do not indicate corrected nutrition.
function changeIngredientFields(changes, quality = '') {
  const initial = JSON.parse(JSON.stringify(fixture));
  initial.days['2026-08-19'].entries[0].quality = quality;
  const portion = boot(initial);
  portion.api.setDate('2026-08-19');
  let handler;
  const fields = { name: 'Pancakes', amount: '200', proteinPer100g: '12,5', caloriesPer100g: '192', ...changes };
  const fieldsInputs = Object.entries(fields).map(([ingField, value]) => ({ dataset: { ingField }, value, addEventListener(_, fn) { handler = fn; } }));
  const ingredientRow = { querySelectorAll() { return fieldsInputs; } };
  portion.node('food-editor').querySelectorAll = selector => selector === '.ingredient-row input' ? fieldsInputs : selector === '.ingredient-row' ? [ingredientRow] : [];
  portion.setRows([ingredientRow]);
  portion.api.openExistingEntry('original');
  handler();
  portion.node('save-entry').onclick();
  return portion.api.state.days['2026-08-19'].entries[0];
}
const portionOnly = changeIngredientFields({});
assert.equal(portionOnly.quality, '', 'quantity-only changes do not add Edited');
assert.equal(portionOnly.protein, 25);
assert.equal(portionOnly.calories, 384);
assert.equal(changeIngredientFields({ proteinPer100g: '15' }).quality, 'edited', 'protein corrections add Edited');
assert.equal(changeIngredientFields({ caloriesPer100g: '210' }).quality, 'edited', 'calorie corrections add Edited');
assert.equal(changeIngredientFields({ name: 'Protein pancakes' }).quality, 'edited', 'changing an ingredient adds Edited');
assert.equal(changeIngredientFields({}, 'edited').quality, 'edited', 'resizing a corrected meal retains its badge');
assert.equal(changeIngredientFields({}, 'manual').quality, 'manual', 'resizing a manual meal retains Manual');

const swipe = boot(fixture);
swipe.api.setDate('2026-08-19');
const currentView = { style: {} }, adjacentView = { style: {}, querySelectorAll() { return []; }, setAttribute() {}, remove() {} };
swipe.node('app').querySelector = () => currentView;
swipe.node('app').clientWidth = 390;
swipe.node('app').appendChild = () => {};
swipe.document.createElement = () => adjacentView;
const touch = (x,y) => ({ touches: [{ clientX:x,clientY:y }], target: { closest() { return null; } }, cancelable:true, preventDefault() {} });
swipe.api.startDaySwipe(touch(100,100));
swipe.api.moveDaySwipe(touch(240,104));
assert.equal(currentView.style.transform, 'translate3d(140px,0,0)', 'day follows finger before release');
assert.match(adjacentView.innerHTML, /day-view/, 'neighbouring day is rendered during drag');
swipe.api.finishDaySwipe({}); swipe.flushTimers();
assert.equal(swipe.api.getDate(), '2026-08-18', 'completed drag selects previous day');
swipe.api.startDaySwipe(touch(100,100));
swipe.api.moveDaySwipe(touch(130,100));
swipe.api.finishDaySwipe(null); swipe.flushTimers();
assert.equal(swipe.api.getDate(), '2026-08-18', 'cancelled drag keeps selected day');
swipe.api.startDaySwipe(touch(100,100)); swipe.api.moveDaySwipe(touch(102,170)); swipe.api.finishDaySwipe({}); swipe.flushTimers();
assert.equal(swipe.api.getDate(), '2026-08-18', 'vertical movement is left to page scrolling');
const trends = boot(fixture);
trends.api.state.days['2026-07-25'] = { date: '2026-07-25', weightKg: 83, entries: [] };
const month = trends.api.buildWeeklyReport('2026-08-01', 30);
assert.equal(month.days.length, 30);
assert.equal(month.weekEnd, '2026-08-30');
assert.equal(month.summary.loggedNutritionDays, 2);
assert.equal(month.summary.averageProteinG, 19.375, 'empty days do not lower 30-day report averages');
assert.equal(month.summary.weightEntries, 1);
assert.ok(Math.abs(month.summary.weightChangeKg + 0.3) < 0.0001);
const monthCsv = trends.api.weeklyCsv(month);
assert.match(monthCsv, /^period_start,period_end,period_average_weight_kg,weight_change_vs_previous_30_days_kg/);
assert.match(monthCsv, /creatine_days_out_of_30/);
assert.match(monthCsv, /Pancakes/);
trends.api.renderWeekly();
trends.node('review-30').onclick();
trends.node('week-picker').onchange({ target: { value: '2026-08-30' } });
assert.equal((trends.node('app').innerHTML.match(/class="daily-review-row"/g) || []).length, 30);
assert.match(trends.node('app').innerHTML, /1\/30/);
assert.match(trends.node('app').innerHTML, /vs previous 30 days/);
assert.match(trends.node('app').innerHTML, /Export these 30 days/);
trends.node('prev-week').onclick();
assert.equal(trends.node('week-picker').value, '2026-07-31');
trends.node('next-week').onclick();
assert.equal(trends.node('week-picker').value, '2026-08-30');
trends.node('review-7').onclick();
assert.equal((trends.node('app').innerHTML.match(/class="daily-review-row"/g) || []).length, 7);
assert.equal(trends.api.proteinColor(90), '#b56a62');
assert.equal(trends.api.proteinColor(140), '#237a52');
assert.match(source, /chicken amount=200/);
assert.match(source, /NEVER divide the 200g among chicken, cabbage and bread/);
console.log('PASS: independent meals, quantity-only edits, copy/paste, 7\/30-day reports and exports, remaining protein ring, prompt weight constraints and swipe gestures.');
