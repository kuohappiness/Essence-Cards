import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, type Plugin as BuildPlugin } from 'esbuild';
import { createObsidianStub, type StubOptions } from './helpers/obsidian.ts';
import { desktopOnly } from '../tools/build.mjs';

// src/main.ts 的接線（W5 §4-1）：用共用的 obsidian 替身（tests/helpers/obsidian.ts）在 Node 跑正式建置的程式碼，不是 Obsidian 實機。
const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = async (dev: boolean, plugins: BuildPlugin[] = []) => (await build({
  absWorkingDir: root, entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', plugins: [desktopOnly(root), ...plugins],
  external: ['obsidian', '@codemirror/state', '@codemirror/view'], write: false, define: { 'process.env.NODE_ENV': '"production"', DEV: String(dev), BUILD: '"0.0.1+test"' },
})).outputFiles[0].text;
const bundled = await bundle(false);
/** 開發版（給 iPhone 的開發命令也在裡面）。 */
const devBundled = await bundle(true);
/** 開發版，複習畫面（src/ui/host.tsx）換成替身：不畫任何東西，關掉時照 host.tsx 送 closed 事件。替身沒有 DOM，畫不了真的畫面。 */
const devNoScreen = await bundle(true, [{
  name: 'host-stub',
  setup(builder) {
    builder.onResolve({ filter: /\/host\.tsx$/ }, () => ({ path: 'host', namespace: 'stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: "export function openReview(options) { return { close() { options.onEvent?.({ kind: 'closed' }); options.onClose?.(); } }; }", loader: 'js',
    }));
  },
}]);

interface BackupLike { runner: { status(): { ready: boolean; failure: { step: string; message: string } | null } } }
interface PluginLike {
  onload(): void; onunload(): void; startReview(pick: { subject: string }): { close(): void } | null;
  state: { ready(): Promise<unknown>; answer(entry: unknown): string; fillIds(path: string): Promise<boolean>; writeBlock(): string | null; onChange(listener: () => void): () => void } | null;
  backup: BackupLike | null;
}

/** 電腦的替身用的暫存資料夾：vault 的位置與備份位置（外掛內的備份真的寫在這裡，D-150）。 */
const temporary: string[] = [];
after(() => Promise.all(temporary.map(dir => rm(dir, { recursive: true, force: true }))));
const tempDir = (): string => { const dir = mkdtempSync(join(tmpdir(), 'essence-wiring-')); temporary.push(dir); return dir; };
const MANIFEST = '.obsidian/plugins/essence-cards/manifest.json';

/**
 * 建好替身、載入外掛（正式版或開發版）並建立外掛物件。電腦的替身有真的 vault 位置與備份位置（暫存資料夾），外掛載入後自己做一份
 * 備份、打開寫入的閘門；backedUp() 等到那時候。
 */
function host(texts: Record<string, string>, options: Omit<StubOptions, 'texts'> = {}, code = bundled) {
  const desktop = options.desktop ? { vaultPath: tempDir(), localStorage: { 'essence-cards-backup-folder': tempDir() } } : {};
  const stub = createObsidianStub({ ...desktop, ...options, texts: options.desktop ? { [MANIFEST]: '{"id":"essence-cards"}', ...texts } : texts });
  const { default: Plugin } = stub.load<{ default: new (app: unknown, manifest: unknown) => PluginLike }>(code);
  const plugin = new Plugin(stub.app, { id: 'essence-cards', version: '0.0.1' });
  async function backedUp(): Promise<void> {
    for (let i = 0; i < 300 && !plugin.backup?.runner.status().ready; i++) await wait(10);
    assert.ok(plugin.backup?.runner.status().ready, '外掛載入後的備份沒有成功：' + JSON.stringify(plugin.backup?.runner.status().failure));
  }
  return { ...stub, plugin, backedUp, uri: (params: Record<string, string>) => { stub.protocol.get('essence-cards-dev')?.(params); } };
}

const deck = { 'Essence Cards/a.md': '---\n科目: 自然\n---\n- 目標 ^aaaaaa\n    - Q :: A\n' };
/** 寫入動作（h.writes）裡不是複習紀錄的：紀錄檔本身，以及第一次寫紀錄時建立的上層資料夾。 */
const notLog = (write: string): boolean => !/^(?:folder Essence Cards(?:\/紀錄)?|\w+ Essence Cards\/紀錄\/.*)$/.test(write);
/** 外掛會把錯誤印到 console.error；測試期間收起來，不讓輸出看起來像失敗。 */
function quiet(t: test.TestContext): void {
  const original = console.error;
  console.error = () => {};
  t.after(() => { console.error = original; });
}

// Codex 審查 W5 的 F5：寫不進去時，切到背景與停用外掛的 flush／close 不能留下沒人接的 rejection。
void test('接線：寫不進去時只提示一次，切到背景與停用不留下未處理的 rejection', async t => {
  quiet(t);
  const unhandled: unknown[] = [];
  const listener = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', listener);
  t.after(() => { process.off('unhandledRejection', listener); });
  {
    const { plugin, notices, callsBeforeReady, layoutReady, hide } = host(deck, { failWrite: true });
    t.after(() => { plugin.onunload(); });
    plugin.onload();
    layoutReady();
    assert.equal(callsBeforeReady(), 0);
    assert.ok(plugin.state);
    await plugin.state.ready();
    plugin.state.answer({ lt: 'aaaaaa', r: 'good', v: '12345678' });
    plugin.state.answer({ lt: 'aaaaaa', r: 'good', v: '12345678' });
    await wait(50);
    hide();
    plugin.onunload();
    await wait(100);
    assert.deepEqual(notices, ['Essence Cards：複習紀錄暫時寫不進去，會自動再試']);
    assert.deepEqual(unhandled, []);
  }
});

// Codex 審查 W5 的 F3 與第 11 點：讀不到時的提示要如實，而且真的會自己重試。
void test('接線：啟動時讀不到紀錄，提示讀不到並自己重試到讀完', async t => {
  quiet(t);
  let failing = true;
  const log = 'Essence Cards/紀錄/2026-10 Windows-0000.jsonl';
  const { plugin, notices, layoutReady } = host({ ...deck, [log]: '' }, { failRead: path => failing && path === log });
  t.after(() => { plugin.onunload(); });
  plugin.onload();
  layoutReady();
  assert.ok(plugin.state);
  const ready = plugin.state.ready();
  await wait(50);
  assert.deepEqual(notices, ['Essence Cards：有些卡組或複習紀錄暫時讀不到，會自動再試']);
  failing = false;
  await ready;
  plugin.onunload();
  assert.equal(notices.length, 1);
});

void test('接線：補 ID、存檔命令與編輯器的鎖定只在電腦；手機的 state 不寫卡組', async t => {
  const missing = { 'Essence Cards/b.md': '- 新目標\n    - Q :: A\n' };
  for (const desktop of [false, true]) {
    const { plugin, commands, extensions, layoutReady, text, backedUp } = host(missing, { desktop });
    t.after(() => { plugin.onunload(); });
    plugin.onload();
    assert.equal(commands.has('save'), desktop);
    // 鎖定，以及告訴離開筆記的備援「這篇開著」的 ViewPlugin。
    assert.equal(extensions(), desktop ? 2 : 0);
    layoutReady();
    assert.ok(plugin.state);
    await plugin.state.ready();
    if (desktop) await backedUp();
    assert.equal(await plugin.state.fillIds('Essence Cards/b.md'), desktop);
    assert.equal(/\^[a-z0-9]{6}\n/.test(text('Essence Cards/b.md') ?? ''), desktop);
    plugin.onunload();
  }
});

// Codex 審查第二部分的 F4：開發版也會裝到 iPhone（W6 的實機測試），會寫卡組的開發命令在手機上不註冊、URI 也不執行。
void test('接線：開發版在手機上沒有 lock、save 命令，直接用 URI 叫也不寫任何檔案；電腦上有', async t => {
  const trial = 'Essence Cards/W5 範例/補 ID 試用（卡片）.md';
  for (const desktop of [false, true]) {
    const h = host({ [trial]: '- 能說明蒸發 ^aaaaaa\n    - Q :: A\n' }, { desktop }, devBundled);
    t.after(() => { h.plugin.onunload(); });
    h.plugin.onload();
    await wait(20);
    h.layoutReady();
    await h.plugin.state?.ready();
    for (const code of ['lock', 'save']) assert.equal(h.commands.has('dev-' + code), desktop, code);
    assert.ok(h.commands.has('dev-today'));
    if (desktop) continue;
    for (const run of ['save', 'lock']) h.uri({ run });
    await wait(100);
    // 紀錄之外什麼都沒寫（每台裝置載入時在自己的紀錄寫版本行，任務說明 2-1）。
    assert.deepEqual(h.writes.filter(notLog), []);
    assert.deepEqual(h.notices.filter(n => n.includes('只在電腦上執行')).length, 2);
    assert.equal(h.text(trial), '- 能說明蒸發 ^aaaaaa\n    - Q :: A\n');
  }
});

// Codex 第三次審查的 T1：layout 已經 ready 時重新啟用外掛，第一個事件就是關掉原本開著的卡組，也要補一次。
void test('接線：重新啟用外掛時已經開著的卡組，啟用時不寫，第一個事件就是關掉時補一次', async t => {
  const path = 'Essence Cards/b.md';
  const h = host({ [path]: '- 新目標\n    - Q :: A\n' }, { desktop: true });
  t.after(() => { h.plugin.onunload(); });
  h.openTab(path);
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  await h.backedUp();
  await wait(1100);
  assert.deepEqual(h.writes.filter(notLog), []);
  h.closeTabs();
  await wait(1200);
  assert.deepEqual(h.writes.filter(notLog), ['process ' + path]);
  assert.match(h.text(path) ?? '', /^- 新目標 \^[a-z0-9]{6}\n/);
});

// W6 §7 前提：「版本」命令顯示建置時寫進 main.js 的版本（manifest 的版本加 git commit），不在執行時讀 manifest。
void test('W6 版本命令顯示建置版本；layout ready 之前只有版本', async () => {
  const h = host(deck);
  h.plugin.onload();
  h.commands.get('version')?.callback?.();
  await wait(20);
  assert.deepEqual(h.notices, ['Essence Cards：0.0.1+test\n外掛還在載入，稍後再看各裝置的版本']);
  h.plugin.onunload();
});

// 任務說明 2-1：BUILD 由外層傳進 state；載入時在這台的紀錄寫版本行，「版本」命令列出每台裝置最後回報的版本。
void test('2-1 接線：載入後這台的紀錄有版本行，版本命令列出這台與別台裝置的最後回報', async t => {
  const phone = 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl';
  const h = host({ ...deck, [phone]: JSON.stringify({ t: '2026-10-30T07:02:11.020+08:00', set: 'app', val: '0.0.1+5d357fa' }) + '\n' }, { desktop: true });
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  // 版本命令先等排隊的紀錄寫完才顯示。
  h.commands.get('version')?.callback?.();
  await wait(50);
  const own = [...h.texts.keys()].find(path => /^Essence Cards\/紀錄\/\d{4}-\d{2} Windows-[0-9a-f]{4}\.jsonl$/.test(path));
  assert.ok(own, '這台的紀錄檔');
  assert.deepEqual((h.text(own) ?? '').trim().split('\n').map(line => (JSON.parse(line) as { set: string; val: string })).map(line => [line.set, line.val]), [['app', '0.0.1+test']]);
  const device = own.slice(own.lastIndexOf(' ') + 1, -'.jsonl'.length);
  const lines = (h.notices.at(-1) ?? '').split('\n');
  assert.deepEqual(lines.slice(0, 3), ['Essence Cards：0.0.1+test', `這台（${device}）：已記下這一版`, '各裝置最後回報的版本（不是即時狀態：還沒同步或還沒重開的裝置看不出來）：']);
  assert.ok(lines.includes('・iPhone-7f3a：0.0.1+5d357fa（2026-10-30 07:02）'), lines.join('\n'));
  assert.ok(lines.some(line => line.startsWith(`・${device}：0.0.1+test（`)), lines.join('\n'));
});

// 任務說明 2-2：入口的「給家長」一區還沒做，先在載入時用 Obsidian 的通知提示一次。
void test('2-2 接線：有內容需要新版時，載入後提示一次；版本命令列出是哪幾篇', async t => {
  const newer = 'Essence Cards/新寫法.md';
  const h = host({ ...deck, [newer]: '---\n需要版本: 9.0.0\n---\n- 目標 ^bbbbbb\n    - Q :: A\n' }, { desktop: true });
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  await wait(20);
  assert.deepEqual(h.notices, ['Essence Cards：有內容需要新版才讀得懂，請更新外掛']);
  h.commands.get('version')?.callback?.();
  await wait(50);
  assert.deepEqual((h.notices.at(-1) ?? '').split('\n').slice(-2), ['有內容需要新版才讀得懂，請更新外掛：1 篇卡組不出題', '・' + newer]);
  // 沒有需要新版的內容時不提示。
  const plain = host(deck, { desktop: true });
  t.after(() => { plain.plugin.onunload(); });
  plain.plugin.onload();
  plain.layoutReady();
  await plain.plugin.state?.ready();
  await wait(20);
  assert.deepEqual(plain.notices, []);
});

// 技術債 A10：開發版的接線集中在 dev 模組。main.ts 只在一處看 DEV（載入 dev 模組），提示、事件與鎖定的紀錄由 dev 模組訂閱。
void test('A10 src/main.ts 只有一處 DEV（宣告之外），沒有 null as 的開發用欄位', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  const uses = [...source.matchAll(/\bDEV\b/g)].length;
  assert.equal(uses, 2, 'declare const DEV 加上一處 if (DEV)，實際 ' + String(uses));
  assert.ok(!source.includes('null as'), 'main.ts 不該再有 null as 宣告的開發用欄位');
  assert.ok(!source.includes('devLog'), 'devLog 搬到 dev 模組');
});

// 技術債「開發命令的結果檔只記 manifest 的版本」：結果檔的 plugin 記建置版本 BUILD（版本加 commit），審查者才能從結果檔核對跑的是哪一次建置。
void test('開發命令的結果檔：plugin 是建置版本 BUILD，不是 manifest 的版本', async t => {
  const h = host(deck, { desktop: true }, devBundled);
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  await wait(20);
  h.layoutReady();
  await h.plugin.state?.ready();
  h.uri({ run: 'unread' });
  await wait(100);
  const path = [...h.texts.keys()].find(key => key.startsWith('Essence W5/結果/unread '));
  assert.ok(path, '有結果檔');
  assert.equal((JSON.parse(h.text(path) ?? '{}') as { plugin?: string }).plugin, '0.0.1+test');
});

// tasks/error-log.md §2：主機建立唯一的記錄器，report()、每一處 console.error、畫面的錯與 window 的補網都交給它（D-155）。
/** 複習畫面換成替身：openReview 交給測試（stub.obsidian.__openReview），主機傳進去的回呼可以直接叫。 */
const reviewBundled = await bundle(false, [{
  name: 'ui-stub',
  setup(builder) {
    builder.onResolve({ filter: /\/ui\/index\.ts$/ }, () => ({ path: 'ui', namespace: 'ui-stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'ui-stub' }, () => ({ contents: "export function registerStart() {} export function openReview(options) { return require('obsidian').__openReview(options); }", loader: 'js' }));
  },
}]);

interface Line { where: string; msg?: string; path?: string; stack?: string; kind?: string; lt?: string; v?: string }
/** 這台的錯誤紀錄（當月的檔）裡的每一行。 */
function errorLines(h: ReturnType<typeof host>): Line[] {
  const path = [...h.texts.keys()].find(key => /^Essence Cards\/紀錄\/錯誤\/\d{4}-\d{2} Windows-[0-9a-f]{4} 錯誤\.jsonl$/.test(key));
  return path ? (h.text(path) ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line) as Line) : [];
}
/** 帶這個外掛自己程式位置的錯誤（Obsidian 載入外掛時的 stack 寫法）。 */
function ownError(message: string, frame = 'plugin:essence-cards:1:2345'): Error {
  const error = Error(message);
  error.stack = `Error: ${message}\n    at x (${frame})`;
  return error;
}
const errorEvent = (error: unknown): Event => Object.assign(new Event('error'), { error });
const rejection = (reason: unknown): Event => Object.assign(new Event('unhandledrejection'), { reason });

void test('§2 接線：read、write、close、listener 都記進錯誤紀錄，where 照 syntax.md §9', async t => {
  quiet(t);
  const unreadable = 'Essence Cards/讀不到.md';
  let failing = true;
  const h = host({ ...deck, [unreadable]: '- 目標 ^bbbbbb\n    - Q :: A\n' }, {
    desktop: true, failRead: path => failing && path === unreadable,
    // 複習紀錄寫不進去，錯誤紀錄寫得進去。
    failWrite: path => /^Essence Cards\/紀錄\/[^/]+\.jsonl$/.test(path),
  });
  h.plugin.onload();
  h.layoutReady();
  assert.ok(h.plugin.state);
  await h.plugin.state.ready();
  h.plugin.state.onChange(() => { throw Error('監聽者壞了'); });
  // 讀不到的那篇 1 秒後重試讀到了，重排：監聽者被叫到（替身的 vault 不送變動通知）。
  failing = false;
  await wait(1100);
  h.plugin.state.answer({ lt: 'aaaaaa', r: 'good', v: '12345678' });
  await wait(50);
  h.plugin.onunload();
  await wait(100);
  const lines = errorLines(h);
  assert.deepEqual([...new Set(lines.map(line => line.where))].sort(), ['close', 'listener', 'read', 'write']);
  assert.equal(lines.find(line => line.where === 'listener')?.msg, '監聽者壞了');
  assert.equal(lines.find(line => line.where === 'read')?.msg, '讀不到：' + unreadable);
});

void test('§2 接線：監看不了時記 init（ready() 拒絕不再被吞掉）', async t => {
  quiet(t);
  const h = host(deck, { failWatch: true });
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready().catch(() => {});
  await wait(20);
  assert.deepEqual(errorLines(h).map(line => [line.where, line.msg]), [['init', '監看不了']]);
});

void test('§2 接線：離開筆記時補 ID 失敗記 fill；外掛事件的監聽者丟錯記 event', async t => {
  quiet(t);
  const path = 'Essence Cards/b.md';
  const h = host({ [path]: '- 新目標\n    - Q :: A\n' }, { desktop: true, failWrite: target => target === path });
  t.after(() => { h.plugin.onunload(); });
  (h.plugin as unknown as { on(kind: string, listener: () => void): void }).on('event', () => { throw Error('事件的監聽者壞了'); });
  h.openTab(path);
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  h.closeTabs();
  await wait(1300);
  const lines = errorLines(h);
  assert.deepEqual([...new Set(lines.map(line => line.where))].sort(), ['event', 'fill']);
  assert.equal(lines.find(line => line.where === 'fill')?.msg, '寫不進去');
});

void test('§2 接線：複習畫面的 render（帶卡組的路徑）與 ui 交給記錄器，也印在 console', async t => {
  const printed: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { printed.push(args); };
  t.after(() => { console.error = original; });
  const h = host(deck, {}, reviewBundled);
  t.after(() => { h.plugin.onunload(); });
  let options: { onError?: (error: unknown, where: 'render' | 'ui', path?: string) => void } | null = null;
  h.obsidian.__openReview = (opened: typeof options) => { options = opened; return { session: {}, close() {} }; };
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  (h.plugin as unknown as { startReview(pick: unknown): unknown }).startReview({ subject: '自然' });
  assert.ok(options);
  const { onError } = options as { onError?: (error: unknown, where: 'render' | 'ui', path?: string) => void };
  onError?.(Error('顯示不出來'), 'render', 'Essence Cards/a.md');
  onError?.(ownError('React 壞了'), 'ui');
  await wait(20);
  assert.deepEqual(errorLines(h).map(line => [line.where, line.msg, line.path, line.stack]), [
    ['render', '顯示不出來', 'Essence Cards/a.md', undefined],
    ['ui', 'React 壞了', undefined, 'at x (plugin:essence-cards:1:2345)'],
  ]);
  assert.deepEqual(printed.map(args => args.slice(0, 2)), [['Essence Cards', 'render'], ['Essence Cards', 'ui']]);
});

void test('§2-4 補網：window 的 error 與 unhandledrejection 只收自己的程式位置；停用再啟用之後一次錯誤只記一次', async t => {
  const h = host(deck);
  const Plugin = (h.plugin as unknown as { constructor: new (app: unknown, manifest: unknown) => PluginLike & { unload(): void } }).constructor;
  const first = h.plugin as PluginLike & { unload(): void };
  first.onload();
  h.layoutReady();
  await first.state?.ready();
  // 停用（Obsidian 呼叫 unload，移除 registerDomEvent 登記的監聽）再啟用：新的外掛物件。
  first.unload();
  const second = new Plugin(h.app, { id: 'essence-cards', version: '0.0.1' });
  t.after(() => { second.unload(); });
  second.onload();
  await second.state?.ready();
  h.window.dispatchEvent(errorEvent(ownError('同步拋錯')));
  h.window.dispatchEvent(rejection(ownError('非同步拒絕', 'plugin:essence-cards:1:99')));
  // 別的外掛、沒有 stack 的字串、沒有 error 的事件都不收。
  h.window.dispatchEvent(errorEvent(ownError('別的外掛', 'plugin:essence-cards-x:1:2')));
  h.window.dispatchEvent(rejection('plugin:essence-cards:1:2'));
  h.window.dispatchEvent(new Event('error'));
  await wait(20);
  assert.deepEqual(errorLines(h).map(line => [line.where, line.msg]), [['uncaught', '同步拋錯'], ['uncaught', '非同步拒絕']]);
});

// tasks/error-log.md §8（D-160）：畫面的回報交給記錄器的 report，出一次提示；不寫複習紀錄。
void test('§8 接線：回報記進錯誤紀錄（where: report），出一次提示，不寫複習紀錄', async t => {
  const h = host(deck, {}, reviewBundled);
  t.after(() => { h.plugin.onunload(); });
  let options: { onReport?: (kind: string, card: { deck: string; lt: string; v: string }) => void } | null = null;
  h.obsidian.__openReview = (opened: typeof options) => { options = opened; return { session: {}, close() {} }; };
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  await wait(20);
  const logWrites = (): string[] => h.writes.filter(write => /^\w+ Essence Cards\/紀錄\/[^/]+\.jsonl$/.test(write));
  const before = logWrites().length;
  (h.plugin as unknown as { startReview(pick: unknown): unknown }).startReview({ subject: '自然' });
  const { onReport } = options as unknown as { onReport?: (kind: string, card: { deck: string; lt: string; v: string }) => void };
  assert.ok(onReport);
  onReport('content', { deck: 'Essence Cards/a.md', lt: 'aaaaaa', v: '12345678' });
  await wait(20);
  assert.deepEqual(errorLines(h).map(line => [line.where, line.kind, line.path, line.lt, line.v]), [['report', 'content', 'Essence Cards/a.md', 'aaaaaa', '12345678']]);
  assert.deepEqual(h.notices, ['已記下，可以跟家長說一聲']);
  assert.equal(logWrites().length, before, '複習紀錄沒有多寫');
});

// 外掛內的備份（tasks/plugin-backup.md §1-4、§1-6、§1-9）：電腦上載入後自己備份，成功才打開寫入的閘門；備份位置不能用時通知、閘門關著。
void test('備份接線：電腦上 state 讀完之後自己做一份 new-version 備份，成功前存檔受阻、成功後打開閘門；有 6 小時的計時器與設定分頁', async t => {
  const h = host({ 'Essence Cards/b.md': '- 新目標\n    - Q :: A\n' }, { desktop: true });
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  assert.equal(h.settingTabs.length, 1);
  h.layoutReady();
  assert.equal(h.plugin.state?.writeBlock(), 'loading');
  await h.plugin.state?.ready();
  await h.backedUp();
  assert.equal(h.plugin.state?.writeBlock(), null);
  const folder = h.storage('essence-cards-backup-folder') as string;
  const names = await readdir(folder);
  assert.equal(names.length, 1);
  // 替身的 BUILD（0.0.1+test）不是 BUILD 的寫法，檔名照 syntax §8 寫「未知」；清單與 localStorage 的 build 照實記。
  assert.match(names[0], /^Essence Cards 備份 \d{4}-\d{2}-\d{2} \d{6} 未知 [0-9a-f]{4}\.zip$/);
  const last = h.storage('essence-cards-backup-last') as { build: string; name: string };
  assert.deepEqual([last.build, last.name], ['0.0.1+test', names[0]]);
  assert.equal(h.timers().registerInterval, 1);
  assert.deepEqual(h.notices, []);
  assert.equal(await h.plugin.state?.fillIds('Essence Cards/b.md'), true);
});

void test('備份接線：備份位置在 vault 裡時失敗，通知一次、閘門關著（存檔受阻），不寫卡組', async t => {
  const vaultPath = tempDir();
  const h = host({ 'Essence Cards/b.md': '- 新目標\n    - Q :: A\n' }, { desktop: true, vaultPath, localStorage: { 'essence-cards-backup-folder': join(vaultPath, '備份') } });
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  for (let i = 0; i < 300 && !h.plugin.backup?.runner.status().failure; i++) await wait(10);
  const failure = h.plugin.backup?.runner.status().failure;
  assert.equal(failure?.step, '準備備份位置');
  assert.match(failure?.message ?? '', /在 vault 裡/);
  assert.deepEqual(h.notices, ['Essence Cards：備份失敗，暫停修改卡組；複習照常。到設定頁看原因']);
  assert.equal(h.plugin.state?.writeBlock(), 'backup');
  assert.equal(await h.plugin.state?.fillIds('Essence Cards/b.md'), false);
  assert.equal(h.text('Essence Cards/b.md'), '- 新目標\n    - Q :: A\n');
  assert.deepEqual(await readdir(vaultPath), []);
});

// D-148 第 3 點的驗收（手機替身）：手機上沒有載入電腦專用的資料夾（沒有 require Node 或 Electron）、沒有建立任何計時器，
// 設定分頁照樣加上（只寫「備份在電腦上做」）。正式建置的 main.js 另在 tests/build.test.ts 驗。
void test('備份接線：手機上不載入電腦專用的資料夾、不建立計時器，閘門不擋（手機本來就不寫卡組）', async t => {
  const h = host(deck);
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  await wait(50);
  assert.deepEqual([...new Set(h.required)].sort(), ['@codemirror/state', '@codemirror/view', 'obsidian']);
  assert.deepEqual(h.timers(), { setInterval: 0, registerInterval: 0 });
  assert.equal(h.plugin.backup, null);
  assert.equal(h.settingTabs.length, 1);
  assert.equal(h.plugin.state?.writeBlock(), 'phone');
});

void test('備份接線：同一個 BUILD 重開、記的那份還在時不重做，閘門直接打開；記的那份不見了就重做', async t => {
  const vaultPath = tempDir(), folder = tempDir();
  const first = host(deck, { desktop: true, vaultPath, localStorage: { 'essence-cards-backup-folder': folder } });
  t.after(() => { first.plugin.onunload(); });
  first.plugin.onload();
  first.layoutReady();
  await first.backedUp();
  first.plugin.onunload();
  const storage = { 'essence-cards-backup-folder': folder, 'essence-cards-backup-last': first.storage('essence-cards-backup-last') };
  const again = host(deck, { desktop: true, vaultPath, localStorage: storage });
  t.after(() => { again.plugin.onunload(); });
  again.plugin.onload();
  again.layoutReady();
  await again.backedUp();
  assert.equal((await readdir(folder)).length, 1);
  again.plugin.onunload();
  await rm(join(folder, (await readdir(folder))[0]));
  const gone = host(deck, { desktop: true, vaultPath, localStorage: storage });
  t.after(() => { gone.plugin.onunload(); });
  gone.plugin.onload();
  gone.layoutReady();
  await gone.backedUp();
  assert.equal((await readdir(folder)).length, 1);
});

// 開發命令的證據 W3 (a)（外掛架構檢查環節 5）：複習畫面的量測（dev-review 的 watchReview）不經過命令那一層，結果檔也要記 BUILD。
void test('W3 複習畫面的量測結果檔：plugin 也是建置版本 BUILD', async t => {
  const h = host(deck, { desktop: true }, devNoScreen);
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  await wait(20);
  h.layoutReady();
  await h.plugin.state?.ready();
  const review = h.plugin.startReview({ subject: '自然' });
  assert.ok(review);
  review.close();
  await wait(100);
  const path = [...h.texts.keys()].find(key => key.startsWith('Essence W6/結果/review '));
  assert.ok(path, '有量測的結果檔');
  const result = JSON.parse(h.text(path) ?? '{}') as { plugin?: string; open?: number };
  assert.deepEqual([result.plugin, typeof result.open], ['0.0.1+test', 'number']);
});

// D-155 補充（使用者 2026-10-31）：外掛內備份的錯也記進錯誤紀錄。備份失敗記 backup（同一個原因這次載入一次），
// 電腦上載入備份功能失敗記 init；state 初始化已經報過的不再記。
void test('D-155 補充：備份失敗記一行 backup（帶原本的錯誤），再看一次狀態也不多記', async t => {
  const vaultPath = tempDir();
  const h = host({ 'Essence Cards/b.md': '- 新目標\n    - Q :: A\n' }, { desktop: true, vaultPath, localStorage: { 'essence-cards-backup-folder': join(vaultPath, '備份') } });
  t.after(() => { h.plugin.onunload(); });
  quiet(t);
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  for (let i = 0; i < 300 && !h.plugin.backup?.runner.status().failure; i++) await wait(10);
  // 同一個原因再失敗一次（手動再做一次）：通知與紀錄都不多。
  await (h.plugin.backup?.runner as unknown as { backup(): Promise<void> }).backup();
  await wait(50);
  const lines = errorLines(h);
  assert.deepEqual(lines.map(line => line.where), ['backup']);
  assert.match(lines[0].msg ?? '', /在 vault 裡/);
});

void test('D-155 補充：電腦上載入備份功能失敗記一行 init；state 初始化已經報過的不再記一次', async t => {
  quiet(t);
  // 這個 vault 不在這台電腦的資料夾裡（adapter 不是 FileSystemAdapter）：備份功能載入失敗。
  const h = host(deck, { desktop: true, vaultPath: undefined });
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  await wait(50);
  assert.deepEqual(errorLines(h).map(line => [line.where, line.msg]), [['init', '這個 vault 不在這台電腦的資料夾裡']]);
  // 監看不了：state 已經記了 init；備份那邊等 ready() 拿到同一個拒絕，不再記。
  const watch = host(deck, { desktop: true, failWatch: true });
  t.after(() => { watch.plugin.onunload(); });
  const printed: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { printed.push(args); };
  t.after(() => { console.error = original; });
  watch.plugin.onload();
  watch.layoutReady();
  await watch.plugin.state?.ready().catch(() => {});
  await wait(100);
  assert.deepEqual(errorLines(watch).map(line => [line.where, line.msg]), [['init', '監看不了']]);
  assert.equal(printed.filter(args => args.some(arg => arg instanceof Error && arg.message === '監看不了')).length, 1, 'console 也只印一次');
});
