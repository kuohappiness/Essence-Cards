import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
await mkdir('dist/tests', { recursive: true });
await build({
  entryPoints: ['src/main.ts'], outfile: 'dist/tests/workflows.mjs', bundle: true, format: 'esm', platform: 'node',
  tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
  define: { __EC_FRAMEWORK__: '"react"', __ecT0: '0', 'process.env.NODE_ENV': '"production"' },
  plugins: [{
    name: 'in-memory-host',
    setup(b) {
      b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export class Plugin {} export class ItemView {} export class PluginSettingTab {} export class Setting {} export class Component {} export class Notice {} export const MarkdownRenderer = {}; export const Platform = {isIosApp:false,isAndroidApp:false}; export const apiVersion="test";' }));
      b.onLoad({ filter: /src[\\/]data.ts$/ }, () => ({ contents: 'export const createData = async () => {}; export const ensureFolder = async () => {};', loader: 'ts' }));
    }
  }]
});
const { default: Prototype } = await import(pathToFileURL(resolve('dist/tests/workflows.mjs')).href);
function harness(failAppend = false) {
  const plugin = new Prototype(), files = new Map(), reports = [], sessions = [];
  plugin.settings = { mode: 'fullscreen', intercept: true, minutes: 2, deviceCode: 'abcd1234' };
  plugin.reporter = { write: async (kind, data) => { reports.push({ kind, data }); return kind + '.json'; } };
  let appendCount = 0;
  plugin.app = { vault: { adapter: {
    exists: async p => files.has(p), read: async p => files.get(p),
    write: async (p, s) => { files.set(p, s); },
    append: async (p, s) => { if (failAppend && ++appendCount === 1) throw Error('模擬寫入失敗'); files.set(p, files.get(p) + s); }
  } } };
  plugin.open = async onRate => {
    let i = 0, view = null, revealed = false; const history = [];
    const metrics = { animations: [], markdown: [], opening: () => ({}) };
    const control = {
      reveal: () => { revealed = true; },
      rate: async rating => {
        assert.ok(revealed || view !== null);
        if (view !== null) { const row = history[view]; row.recordTime = onRate?.({ ...row, rating }, row.recordTime); row.rating = rating; }
        else {
          const row = { card: { lt: String(i).padStart(6,'0'), v: String(i).padStart(8,'0') }, rating, typed: '' };
          row.recordTime = onRate?.(row); history.push(row); i++; revealed = false;
        }
      },
      back: async () => { view = history.length - 1; metrics.animations.push({ kind: '上一張' }); },
      forward: async () => { view = null; metrics.animations.push({ kind: '回到目前' }); },
      restart: () => { i = 0; history.length = 0; revealed = false; view = null; },
      done: () => i === 12
    };
    const s = { metrics, control: { current: control }, ready: async () => {}, close: async () => { s.closed = true; plugin.session = undefined; }, render() {}, closed: false };
    plugin.session = s; sessions.push(s); return s;
  };
  return { plugin, files, reports, sessions };
}
async function virtualTime(action) {
  const originalPerformance = globalThis.performance, originalNow = Date.now, originalRaf = globalThis.requestAnimationFrame;
  let now = 0;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  Date.now = () => 1792400000000 + now;
  globalThis.requestAnimationFrame = fn => { queueMicrotask(() => fn(now)); return 1; };
  try { await action(ms => { now += ms; }); }
  finally { Object.defineProperty(globalThis, 'performance', { configurable: true, value: originalPerformance }); Date.now = originalNow; globalThis.requestAnimationFrame = originalRaf; }
}
test('自動量測流程：開關十次、一輪十二張、五組往返、最後清理', async () => {
  await virtualTime(async advance => {
    const { plugin, reports, sessions } = harness();
    plugin.wait = async ms => advance(ms);
    await plugin.automate();
    assert.equal(sessions.length, 11);
    assert.ok(sessions.every(s => s.closed));
    assert.equal(reports[0].kind, '自動'); assert.equal(reports[0].data.completed, true);
    assert.equal(reports[0].data.openings.length, 10);
    assert.equal(reports[0].data.simulatedNavigationPairs, 5);
    assert.equal(plugin.run, undefined);
  });
});
test('連續流程：背景 append、每十次 undo 改評、讀回比對', async () => {
  await virtualTime(async advance => {
    const { plugin, reports, files } = harness();
    plugin.wait = async ms => advance(ms);
    await plugin.continuous();
    const result = reports[0].data;
    assert.equal(result.completed, true);
    assert.equal(result.ratings, 11);
    assert.equal(result.appends.length, 13);
    assert.equal(result.verification[0].matches, true);
    const rows = [...files.values()][0].trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 13);
    assert.equal(rows[10].undo, rows[9].t);
    assert.equal(rows[11].lt, rows[9].lt);
    assert.notEqual(rows[11].r, rows[9].r);
    assert.equal(new Set(rows.map(r => r.t)).size, rows.length);
    assert.equal(plugin.run, undefined);
  });
});
test('追加失敗會留下錯誤與讀回差異，不誤報完成', async () => {
  await virtualTime(async advance => {
    const { plugin, reports } = harness(true);
    plugin.wait = async ms => advance(ms);
    await plugin.continuous();
    assert.equal(reports[0].data.completed, false);
    assert.equal(reports[0].data.verification[0].matches, false);
    assert.match(reports[0].data.errors[0], /模擬寫入失敗/);
    assert.equal(plugin.run, undefined);
  });
});
test('手動中止自動量測也會關閉畫面並保存未完成的結果', async () => {
  const { plugin, reports, sessions } = harness();
  plugin.wait = async () => { plugin.cancelRun(); throw Error('已停止'); };
  await plugin.automate();
  assert.equal(reports[0].data.completed, false);
  assert.ok(sessions.every(s => s.closed));
  assert.equal(plugin.run, undefined);
});
