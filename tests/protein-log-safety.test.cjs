const assert = require('node:assert/strict');
const { boot, fixture } = require('./protein-log-copy.test.cjs');

async function test() {
  const app = boot(fixture);
  const backup = app.api.fullBackup();
  assert.equal(backup.data.settings.claudeApiKey, undefined);
  assert.equal(app.api.state.settings.claudeApiKey, 'test-placeholder');
  assert.deepEqual(JSON.parse(JSON.stringify(backup.data.days)), fixture.days);
  assert.deepEqual(JSON.parse(JSON.stringify(backup.data.savedMeals)), fixture.savedMeals);
  const restored = app.api.readBackup(JSON.stringify(backup));
  app.api.state.days['2026-08-19'].weightKg = 84;
  app.api.saveState();
  assert.deepEqual(JSON.parse(app.storage.get('proteinLog.v1.recovery')), fixture);
  const before = app.storage.get('proteinLog.v1');
  app.api.restoreData(restored);
  assert.equal(app.api.state.days['2026-08-19'].weightKg, 82.7);
  assert.equal(app.api.state.settings.claudeApiKey, 'test-placeholder');
  assert.equal(app.storage.get('proteinLog.v1.beforeRestore'), before);
  app.api.saveState();
  assert.equal(app.storage.get('proteinLog.v1.beforeRestore'), before);
  const durable = app.storage.get('proteinLog.v1');
  app.api.confirmRestore(restored); // harness declines confirmation
  assert.equal(app.storage.get('proteinLog.v1'), durable);
  for (const invalid of [
    { ...backup, backupVersion: 99 }, { days: {} },
    { ...backup, data: { ...backup.data, days: [] } },
    { ...backup, data: { ...backup.data, days: { '2026-02-30': { entries: [] } } } },
    { ...backup, data: { ...backup.data, days: { '2026-08-19': { entries: [{ ingredients: 'bad' }] } } } },
    { ...backup, data: { ...backup.data, savedMeals: [{ protein: 'oops' }] } }
  ]) assert.throws(() => app.api.readBackup(JSON.stringify(invalid)));
  assert.throws(() => app.api.readBackup('{"app":"Protein Log","backupVersion":1,"data":{"__proto__":{},"settings":{},"days":{},"savedMeals":[]}}'));
  assert.equal(app.storage.get('proteinLog.v1'), durable);
  app.storageControl.failKey = 'proteinLog.v1';
  assert.throws(() => app.api.restoreData({ ...restored, days: {} }), /Storage full/);
  assert.equal(app.api.state.days['2026-08-19'].weightKg, 82.7);
  assert.equal(app.storage.get('proteinLog.v1'), durable);
  assert.throws(() => app.api.saveState(), /Storage full/);
  assert.match(app.alerts.at(-1), /could not be saved/);
  app.storageControl.failKey = null;
  app.storage.set('proteinLog.v1', '{broken');
  app.api.loadState();
  assert.throws(() => app.api.saveState(), /recovery/);
  assert.equal(app.storage.get('proteinLog.v1'), '{broken');
  // Valid recovery remains usable and restores durable writes.
  app.api.restoreData(restored);
  app.api.saveState();
  assert.equal(app.stored().days['2026-08-19'].weightKg, 82.7);

  const exp = boot(fixture);
  exp.context.File = class { constructor(parts, name) { this.parts = parts; this.name = name; } };
  exp.context.navigator = { canShare: () => true, share: async () => { throw { name: 'AbortError' }; } };
  const report = exp.api.buildWeeklyReport('2026-08-17');
  assert.equal(exp.api.reportExportStatus(report), 'Not exported');
  await exp.api.exportWeeklyReport(report, 'csv');
  assert.equal(exp.api.reportExportStatus(report), 'Not exported');
  exp.context.navigator.share = async () => { throw new Error('share failed'); };
  await exp.api.exportWeeklyReport(report, 'csv');
  assert.equal(exp.api.reportExportStatus(report), 'Not exported');
  exp.context.navigator.share = async () => {};
  await exp.api.exportWeeklyReport(report, 'csv');
  assert.equal(exp.api.reportExportStatus(report), 'Exported');
  assert.equal(boot(exp.stored()).api.reportExportStatus(report), 'Exported');
  assert.match(exp.api.exportWeekOptions(), /Exported/);
  const fresh = boot(fixture);
  fresh.api.restoreData(fresh.api.readBackup(JSON.stringify(exp.api.fullBackup())));
  assert.equal(fresh.api.reportExportStatus(report), 'Exported');
  exp.api.state.days['2026-08-19'].weightKg = 83;
  assert.match(exp.api.reportExportStatus(exp.api.buildWeeklyReport('2026-08-17')), /Changed since export/);
  const month = exp.api.buildWeeklyReport('2026-08-01', 30);
  assert.equal(exp.api.reportExportStatus(month), 'Not exported');
  exp.storageControl.failKey = 'proteinLog.v1';
  await exp.api.exportWeeklyReport(month, 'json');
  assert.equal(exp.api.reportExportStatus(month), 'Not exported');
  // Download fallback only marks an export after the download click succeeds.
  exp.storageControl.failKey = null;
  exp.context.navigator = {};
  exp.context.Blob = class {};
  exp.context.URL = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };
  let downloaded = false;
  exp.document.createElement = () => ({ click() { downloaded = true; }, remove() {} });
  exp.document.body.appendChild = () => {};
  await exp.api.exportWeeklyReport(month, 'json');
  assert.equal(downloaded, true);
  assert.equal(exp.api.reportExportStatus(month), 'Exported');
  const confirmed = boot(fixture);
  confirmed.document.documentElement = { dataset: {} };
  confirmed.document.querySelector = () => null;
  confirmed.context.window.confirm = () => true;
  confirmed.api.confirmRestore(restored);
  assert.match(confirmed.node('app').innerHTML, /Export full backup/);
  assert.equal(confirmed.stored().days['2026-08-19'].weightKg, 82.7);
  // Recovering from a missing primary must not silently start an empty log.
  confirmed.storage.delete('proteinLog.v1');
  confirmed.api.loadState();
  assert.throws(() => confirmed.api.saveState(), /recovery/);
  console.log('PASS: backup round-trip, validation, recovery, cancelled/failed restore, storage failure alerts, key exclusion, and durable/cancelled/stale export status.');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
