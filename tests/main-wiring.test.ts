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
import { desktopOnly, embedRules } from '../tools/build.mjs';
import { isObserved } from './helpers/observed.ts';

// src/main.ts 的接線（W5 §4-1）：用共用的 obsidian 替身（tests/helpers/obsidian.ts）在 Node 跑正式建置的程式碼，不是 Obsidian 實機。
const root = fileURLToPath(new URL('../', import.meta.url));
/** AI 製卡的規則組（tasks/ai-cards-mvp.md §1）：和真的建置一樣嵌進去。 */
const cardRules = JSON.stringify(JSON.stringify(await embedRules(root)));
const bundle = async (dev: boolean, plugins: BuildPlugin[] = []) => (await build({
  absWorkingDir: root, entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', plugins: [desktopOnly(root), ...plugins],
  external: ['obsidian', '@codemirror/state', '@codemirror/view'], write: false, define: { 'process.env.NODE_ENV': '"production"', DEV: String(dev), BUILD: '"0.0.1+test"', CARD_RULES: cardRules },
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
      contents: "export function openReview(options) { return { close() { options.onEvent?.({ kind: 'closed' }); options.onClose?.(); } }; } export function openPreview() {}", loader: 'js',
    }));
  },
}]);

interface BackupLike { runner: { status(): { ready: boolean; failure: { step: string; message: string } | null } } }
interface PluginLike {
  onload(): void; onunload(): void; startReview(pick: { subject: string }): { close(): void } | null;
  state: { ready(): Promise<unknown>; answer(entry: unknown): string; fillIds(path: string): Promise<boolean>; writeBlock(): string | null; onChange(listener: () => void): () => void } | null;
  backup: BackupLike | null;
  restoreFlow: RestoreFlowLike | null;
  review: unknown;
  openEntry(): unknown;
}
interface RestoreFlowLike {
  list(): Promise<{ rows: unknown[] }>;
  compare(row: unknown): Promise<unknown>;
  apply(comparison: unknown, chosen: ReadonlySet<string>): Promise<{ stopped: unknown; backup: string | null; files: { path: string; outcome: string }[] }>;
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
    // 鎖定、編輯畫面的標示（D-047），以及告訴離開筆記的備援「這篇開著」的 ViewPlugin。
    assert.equal(extensions(), desktop ? 3 : 0);
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
  assert.deepEqual((h.text(own) ?? '').trim().split('\n').filter(line => !isObserved(line)).map(line => (JSON.parse(line) as { set: string; val: string })).map(line => [line.set, line.val]), [['app', '0.0.1+test']]);
  const device = own.slice(own.lastIndexOf(' ') + 1, -'.jsonl'.length);
  const lines = (h.notices.at(-1) ?? '').split('\n');
  assert.deepEqual(lines.slice(0, 3), ['Essence Cards：0.0.1+test', `這台（${device}）：已記下這一版`, '各裝置最後回報的版本（不是即時狀態：還沒同步或還沒重開的裝置看不出來）：']);
  assert.ok(lines.includes('・iPhone-7f3a：0.0.1+5d357fa（2026-10-30 07:02）'), lines.join('\n'));
  assert.ok(lines.some(line => line.startsWith(`・${device}：0.0.1+test（`)), lines.join('\n'));
});

// 任務說明 2-2、entry-and-catalog §8：手機用 Obsidian 的通知提示一次；電腦由入口的提醒一區與狀態列提示，不再跳通知。
void test('§8 電腦上有內容需要新版：不跳通知，狀態列寫一項提醒，點了打開入口；沒有提醒時不顯示', async t => {
  const newer = 'Essence Cards/新寫法.md';
  const h = host({ ...deck, [newer]: '---\n需要版本: 9.0.0\n---\n- 目標 ^bbbbbb\n    - Q :: A\n' }, { desktop: true });
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  await wait(20);
  assert.ok(!h.notices.includes('Essence Cards：有內容需要新版才讀得懂，請更新外掛'));
  assert.equal(h.statusBar.length, 1);
  assert.equal(h.statusBar[0].textContent, 'Essence Cards：1 項提醒');
  assert.equal(h.statusBar[0].style.display, '');
  const plain = host(deck, { desktop: true });
  t.after(() => { plain.plugin.onunload(); });
  plain.plugin.onload();
  plain.layoutReady();
  await plain.plugin.state?.ready();
  await wait(20);
  assert.equal(plain.statusBar[0].style.display, 'none');
  assert.equal(plain.statusBar[0].textContent, '');
});

void test('§8 手機模式：狀態列沒有，需要新版的通知還在；讀不到的通知也在', async t => {
  quiet(t);
  const newer = 'Essence Cards/新寫法.md';
  const h = host({ ...deck, [newer]: '---\n需要版本: 9.0.0\n---\n- 目標 ^bbbbbb\n    - Q :: A\n' });
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  await wait(20);
  assert.deepEqual(h.statusBar, []);
  assert.ok(h.notices.includes('Essence Cards：有內容需要新版才讀得懂，請更新外掛'));
  const failing = host(deck, { failRead: path => path === 'Essence Cards/a.md' });
  t.after(() => { failing.plugin.onunload(); });
  failing.plugin.onload();
  failing.layoutReady();
  await failing.plugin.state?.ready();
  await wait(20);
  assert.ok(failing.notices.includes('Essence Cards：有些卡組或複習紀錄暫時讀不到，會自動再試'));
});

void test('§8 狀態列跟著 unread：從有變沒有時一行消失，不用重開', async t => {
  quiet(t);
  let failing = true;
  const h = host(deck, { desktop: true, failRead: path => failing && path === 'Essence Cards/a.md' });
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  await wait(20);
  assert.equal(h.statusBar[0].textContent, 'Essence Cards：1 項提醒');
  failing = false;
  await wait(1200);
  assert.equal(h.statusBar[0].style.display, 'none');
});

void test('§1 圖示與命令打開入口，「目錄」直接開目錄；開始複習的選單與命令拿掉了；Obsidian 啟動時不自動打開', async t => {
  const opened: { screen?: string }[] = [];
  const h = host(deck, {}, reviewBundled);
  t.after(() => { h.plugin.onunload(); });
  const closes: string[] = [];
  h.obsidian.__openEntry = (options: { screen?: string; onClose?: () => void }) => {
    opened.push(options);
    return { refresh() {}, show(screen: string) { closes.push('show ' + screen); }, close() { closes.push('close'); options.onClose?.(); } };
  };
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  assert.equal(opened.length, 0, '啟動時不打開');
  assert.equal(h.commands.has('start-review'), false);
  assert.deepEqual(h.ribbons.map(ribbon => ribbon.title), ['Essence Cards：打開入口']);
  h.ribbons[0].callback({});
  assert.equal(opened[0].screen, 'entry');
  h.commands.get('open-catalog')?.callback?.();
  assert.deepEqual(closes, ['show catalog'], '已經開著就換畫面，不開第二層');
  h.plugin.onunload();
  assert.ok(closes.includes('close'), '停用外掛時入口關掉');
  // Codex L2 的 F1：停用之後不開畫面，也就不會寫紀錄。
  const before = opened.length;
  h.commands.get('open-catalog')?.callback?.();
  assert.equal(opened.length, before, '停用之後不開入口');
  let reviews = 0;
  h.obsidian.__openReview = () => { reviews++; return { close() {}, session: {} }; };
  assert.equal(h.plugin.startReview({ subject: '自然' }), null);
  assert.equal(reviews, 0, '停用之後不開複習');
});

void test('§1 複習中點出處：複習與入口都關掉，筆記開在最上層；複習關掉時入口的數字重新取', async t => {
  const h = host(deck, {}, reviewBundled);
  t.after(() => { h.plugin.onunload(); });
  const calls: string[] = [];
  let options: { onLink?: () => void; onClose?: () => void } = {};
  h.obsidian.__openEntry = (each: { onClose?: () => void }) => ({ refresh() { calls.push('refresh'); }, show() {}, close() { calls.push('close entry'); each.onClose?.(); } });
  h.obsidian.__openReview = (each: { onLink?: () => void; onClose?: () => void }) => { options = each; return { close() { each.onClose?.(); }, session: {} }; };
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  h.commands.get('open-entry')?.callback?.();
  h.plugin.startReview({ subject: '自然' });
  options.onClose?.();
  assert.deepEqual(calls.at(-1), 'refresh');
  options.onLink?.();
  assert.equal(calls.at(-1), 'close entry');
});

// 任務說明 2-2：手機沒有提醒一區，載入時用 Obsidian 的通知提示一次。
void test('2-2 接線：有內容需要新版時，手機載入後提示一次；版本命令列出是哪幾篇', async t => {
  const newer = 'Essence Cards/新寫法.md';
  const h = host({ ...deck, [newer]: '---\n需要版本: 9.0.0\n---\n- 目標 ^bbbbbb\n    - Q :: A\n' });
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
  const plain = host(deck);
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
    builder.onLoad({ filter: /.*/, namespace: 'ui-stub' }, () => ({ contents: "export function openReview(options) { return require('obsidian').__openReview(options); } export function openPreview(options, session) { return require('obsidian').__openPreview(options, session); } export function openEntry(options) { return require('obsidian').__openEntry(options); }", loader: 'js' }));
  },
}]);

interface Line { where: string; msg?: string; path?: string; stack?: string; kind?: string; lt?: string; v?: string }
/** 這台的錯誤紀錄（當月的檔）裡的每一行。 */
function errorLines(h: ReturnType<typeof host>): Line[] {
  const path = [...h.texts.keys()].find(key => /^Essence Cards\/紀錄\/錯誤\/\d{4}-\d{2} (?:Windows|iPhone)-[0-9a-f]{4} 錯誤\.jsonl$/.test(key));
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

// D-173：只有名稱的 stack 只在 iPhone 收（Codex L2 的 F2：其他主機完全不變）。
void test('D-173 補網：只有名稱的 stack，iPhone 收、留整段；不是 iPhone 不收', async t => {
  const named = (message: string): Error => { const error = Error(message); error.stack = 'kq@\n@'; return error; };
  const fire = async (options: Omit<StubOptions, 'texts'>): Promise<Line[]> => {
    const h = host(deck, options);
    const plugin = h.plugin as PluginLike & { unload(): void };
    plugin.onload();
    t.after(() => { plugin.unload(); });
    h.layoutReady();
    await plugin.state?.ready();
    h.window.dispatchEvent(errorEvent(named('同步拋錯')));
    h.window.dispatchEvent(rejection(named('非同步拒絕')));
    await wait(20);
    return errorLines(h);
  };
  assert.deepEqual((await fire({ ios: true })).map(line => [line.where, line.msg, line.stack]), [['uncaught', '同步拋錯', 'kq@\n@'], ['uncaught', '非同步拒絕', 'kq@\n@']]);
  assert.deepEqual(await fire({}), [], '手機但不是 iPhone');
  assert.deepEqual(await fire({ desktop: true }), [], '電腦');
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
  quiet(t);
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

// Codex 第三輪的 G2：state 的拒絕值是不准查原型的 Proxy（F3 的同一個值）時，備份那邊的錯誤處理也不能自己拋錯：
// init 只有 state 那一行，備份受阻的提示照常出，沒有未處理的拒絕。
void test('D-155 補充 G2：state 拒絕的值不准查原型時，備份的錯誤處理照常提示、不留下未處理的拒絕', async t => {
  quiet(t);
  const unhandled: unknown[] = [];
  const listener = (reason: unknown): void => { unhandled.push(reason instanceof Error ? reason.message : 'not an Error'); };
  process.on('unhandledRejection', listener);
  t.after(() => { process.off('unhandledRejection', listener); });
  const original = new Proxy({}, { getPrototypeOf() { throw Error('prototype-check-crash'); } });
  const h = host(deck, { desktop: true, failWatch: () => original });
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  h.layoutReady();
  const reason = await h.plugin.state?.ready().then(() => null, (error: unknown) => error);
  assert.equal(reason, original);
  await wait(100);
  assert.deepEqual(errorLines(h).map(line => line.where), ['init']);
  assert.deepEqual(h.notices, ['Essence Cards：備份失敗，暫停修改卡組；複習照常。到設定頁看原因']);
  assert.deepEqual(unhandled, []);
});

// Codex 第四輪的 H1：Error.message 是 Symbol 或轉文字會拋錯的物件時，讀得到，但串接成原因時才出錯；整個原因要在保護範圍內做成字串。
for (const [name, message, shown] of [
  ['Symbol', Symbol('message'), '備份的功能載入失敗：Symbol(message)'],
  ['轉文字會拋錯的物件', { toString() { throw Error('message-text-crash'); } }, '備份的功能載入失敗：（原因無法轉成文字）'],
] as const) void test(`D-155 補充 H1：state 拒絕的 Error.message 是${name}時，備份的錯誤處理照常提示、不留下未處理的拒絕`, async t => {
  quiet(t);
  const unhandled: unknown[] = [];
  const listener = (reason: unknown): void => { unhandled.push(reason instanceof Error ? reason.message : 'not an Error'); };
  process.on('unhandledRejection', listener);
  t.after(() => { process.off('unhandledRejection', listener); });
  const original = Error('original');
  (original as { message: unknown }).message = message;
  const h = host(deck, { desktop: true, failWatch: () => original });
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  h.layoutReady();
  const reason = await h.plugin.state?.ready().then(() => null, (error: unknown) => error);
  assert.equal(reason, original);
  await wait(100);
  assert.deepEqual(errorLines(h).map(line => line.where), ['init']);
  assert.deepEqual(h.notices, ['Essence Cards：備份失敗，暫停修改卡組；複習照常。到設定頁看原因']);
  assert.equal((h.plugin as unknown as { backupError: string | null }).backupError, shown);
  assert.deepEqual(unhandled, []);
});

// 外掛內的還原（tasks/plugin-restore.md §3-2、§5）：從外掛物件走到底，Obsidian 的那一層（開著的分頁、入口、舊畫面）是真的程式。
void test('還原接線：開始就關掉複習與入口、期間不開新的；開著的那篇先存、換空白、寫完開回；內容回到備份', async t => {
  quiet(t);
  const path = 'Essence Cards/a.md', original = deck[path], broken = original.replace('Q :: A', 'Q :: 改壞');
  const h = host(deck, { desktop: true }, devNoScreen);
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  await h.backedUp();
  const flow = h.plugin.restoreFlow;
  assert.ok(flow);
  const { rows } = await flow.list();
  assert.equal(rows.length, 1);
  h.texts.set(path, broken);
  const comparison = await flow.compare(rows[0]);
  h.openTab(path);
  const tab = h.leaves[h.leaves.length - 1];
  const view = tab.view as { saves: number };
  assert.ok(h.plugin.startReview({ subject: '自然' }));
  assert.ok(h.plugin.review);
  const running = flow.apply(comparison, new Set([path]));
  assert.equal(h.plugin.review, null);
  assert.equal(h.plugin.openEntry(), null);
  assert.equal(h.plugin.startReview({ subject: '自然' }), null);
  assert.ok(h.notices.includes('Essence Cards：正在還原，等它做完再開'));
  assert.equal(h.plugin.state?.writeBlock(), 'restore');
  const result = await running;
  assert.equal(result.stopped, null);
  assert.ok(result.backup);
  assert.deepEqual(result.files.map(file => [file.path, file.outcome]), [[path, '已還原']]);
  assert.equal(h.text(path), original);
  assert.equal(view.saves, 1);
  assert.deepEqual(tab.history, [{ type: 'empty' }, { state: { file: path } }, { cursor: 7 }]);
  assert.equal(h.plugin.state?.writeBlock(), null);
  assert.ok(h.plugin.startReview({ subject: '自然' }));
  assert.deepEqual(h.writes.filter(write => write.includes(path) && !write.startsWith('rename')), ['modifyBinary ' + path]);
});

const DATA = '.obsidian/plugins/essence-cards/data.json';
/** 外掛載入、第一份備份做好，回傳那一份在清單裡的列（之後才改的內容都是「備份之後」）。 */
async function restoreReady(t: test.TestContext, texts: Record<string, string>, options: Omit<StubOptions, 'texts'> = {}) {
  quiet(t);
  const h = host(texts, { desktop: true, ...options }, devNoScreen);
  t.after(() => { h.plugin.onunload(); });
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  await h.backedUp();
  const flow = h.plugin.restoreFlow;
  assert.ok(flow);
  const { rows } = await flow.list();
  assert.equal(rows.length, 1);
  return { h, flow, row: rows[0] };
}

for (const [name, before] of [['有效的設定', '{"capMinutes":60}'], ['壞掉的 JSON', '壞掉'], ['沒有檔', null]] as const) {
  void test(`還原接線：設定是${name}時，比對之後才同步來的新內容不蓋掉，也不拿來當底（L2 的 R4）`, async t => {
    const path = 'Essence Cards/a.md';
    const { h, flow, row } = await restoreReady(t, { ...deck, [DATA]: '{"capMinutes":45}' }, { data: { capMinutes: 45 } });
    h.texts.set(path, deck[path].replace('Q :: A', 'Q :: 改壞'));
    if (before === null) h.texts.delete(DATA); else h.texts.set(DATA, before);
    const comparison = await flow.compare(row);
    const vault = h.app.vault as { modifyBinary: (file: unknown, data: ArrayBuffer) => Promise<void> };
    const write = vault.modifyBinary;
    vault.modifyBinary = (file, data) => { h.texts.set(DATA, '{"capMinutes":75,"fresh":1}'); return write(file, data); };
    const saves = h.data.saves;
    const result = await flow.apply(comparison, new Set([path, DATA]));
    assert.deepEqual(result.files.map(file => [file.path, file.outcome]).sort(), [[DATA, '跳過'], [path, '已還原']].sort());
    assert.equal(h.data.saves, saves);
    assert.equal(h.text(DATA), '{"capMinutes":75,"fresh":1}');
  });
  void test(`還原接線：設定是${name}、沒有人改時，寫回備份的值`, async t => {
    const { h, flow, row } = await restoreReady(t, { ...deck, [DATA]: '{"capMinutes":45}' }, { data: { capMinutes: 45 } });
    if (before === null) h.texts.delete(DATA); else h.texts.set(DATA, before);
    const comparison = await flow.compare(row);
    const result = await flow.apply(comparison, new Set([DATA]));
    assert.deepEqual(result.files.map(file => [file.path, file.outcome]), [[DATA, '已還原']]);
    assert.equal((h.data.content as { capMinutes: number }).capMinutes, 45);
  });
}

/** 還原前的備份讀到這篇時呼叫一次：這時分頁已經換成空白、還沒開始寫。 */
function duringBackup(h: Awaited<ReturnType<typeof restoreReady>>['h'], path: string, act: () => void): void {
  const vault = h.app.vault as { readBinary: (file: { path: string }) => Promise<ArrayBuffer> };
  const read = vault.readBinary;
  let done = false;
  vault.readBinary = file => { if (!done && file.path === path) { done = true; act(); } return read(file); };
}
const STILL = 'Essence Cards/a.md';
const brokenDeck = deck[STILL].replace('Q :: A', 'Q :: 改壞');

void test('還原接線：備份期間又打開那一篇：不寫、內容不動，原本的分頁照樣開回（L2 的 R1）', async t => {
  const { h, flow, row } = await restoreReady(t, deck);
  h.texts.set(STILL, brokenDeck);
  const comparison = await flow.compare(row);
  h.openTab(STILL);
  const tab = h.leaves[0];
  duringBackup(h, STILL, () => { h.openTab(STILL); });
  const result = await flow.apply(comparison, new Set([STILL]));
  assert.deepEqual(result.files.map(file => [file.path, file.outcome]), [[STILL, '跳過']]);
  assert.match((result.files[0] as unknown as { reason: string }).reason, /又被打開了/);
  assert.equal(h.text(STILL), brokenDeck);
  assert.deepEqual(h.writes.filter(write => write.startsWith('modifyBinary')), []);
  assert.deepEqual(tab.history, [{ type: 'empty' }, { state: { file: STILL } }, { cursor: 7 }]);
});

void test('還原接線：空白分頁在還原期間被關掉或拿去開別篇：不換回來（L2 的 R1）', async t => {
  for (const act of ['關掉', '開別篇'] as const) {
    const { h, flow, row } = await restoreReady(t, deck);
    h.texts.set(STILL, brokenDeck);
    const comparison = await flow.compare(row);
    h.openTab(STILL);
    const tab = h.leaves[0];
    duringBackup(h, STILL, () => { if (act === '關掉') h.leaves.length = 0; else tab.view = {}; });
    const result = await flow.apply(comparison, new Set([STILL]));
    assert.deepEqual(result.files.map(file => [file.path, file.outcome]), [[STILL, '已還原']], act);
    assert.deepEqual(tab.history, [{ type: 'empty' }], act);
  }
});

void test('還原接線：存檔的等待期間分頁換了別篇：不換成空白（L2 的 R1）', async t => {
  const { h, flow, row } = await restoreReady(t, deck);
  h.texts.set(STILL, brokenDeck);
  const comparison = await flow.compare(row);
  h.openTab(STILL);
  const tab = h.leaves[0];
  (tab.view as { save(): Promise<void> }).save = () => { tab.view = {}; return Promise.resolve(); };
  await flow.apply(comparison, new Set([STILL]));
  assert.deepEqual(tab.history, []);
});

void test('還原接線：寫入逾時、結果未定時，回來之前不能比對或還原；回來之後內容對（L2 的 R2）', async t => {
  const { h, flow, row } = await restoreReady(t, deck);
  h.texts.set(STILL, brokenDeck);
  const comparison = await flow.compare(row);
  let release = (): void => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const vault = h.app.vault as { modifyBinary: (file: unknown, data: ArrayBuffer) => Promise<void> };
  const write = vault.modifyBinary;
  let called = false;
  vault.modifyBinary = async (file, data) => { called = true; await gate; await write(file, data); };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const turn = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });
  let finished = false;
  const running = flow.apply(comparison, new Set([STILL])).finally(() => { finished = true; });
  for (let i = 0; i < 20000 && !called; i++) await turn();
  assert.ok(called);
  for (let i = 0; i < 2000 && !finished; i++) { t.mock.timers.tick(30_000); await turn(); }
  const result = await running;
  assert.deepEqual(result.files.map(file => [file.path, file.outcome]), [[STILL, '失敗']]);
  assert.equal(h.plugin.state?.writeBlock(), null);
  await assert.rejects(flow.compare(row), /還沒回來/);
  await assert.rejects(flow.apply(comparison, new Set([STILL])), /還沒回來/);
  release();
  for (let i = 0; i < 200; i++) { t.mock.timers.tick(100); await turn(); }
  t.mock.timers.reset();
  assert.equal(h.text(STILL), deck[STILL]);
  await flow.compare(row);
});

void test('還原接線：設定頁的按鈕打開還原視窗', async t => {
  const { h } = await restoreReady(t, deck);
  (h.settingTabs[0] as { host: { openRestore(): void } }).host.openRestore();
  for (let i = 0; i < 100 && !h.modals.length; i++) await wait(5);
  assert.equal(h.modals.length, 1);
  assert.equal(h.modals[0].titleEl.text, '還原');
  await wait(20);
  h.modals[0].close();
});

void test('還原接線：Mac 與 Linux 沒有還原的流程，開發命令也走不到（L2 的 R9）', async t => {
  const real = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...real, value: 'darwin' });
  t.after(() => { Object.defineProperty(process, 'platform', real); });
  const h = host(deck, { desktop: true }, devNoScreen);
  t.after(() => { h.plugin.onunload(); });
  quiet(t);
  h.plugin.onload();
  h.layoutReady();
  await h.plugin.state?.ready();
  for (let i = 0; i < 300 && !h.plugin.backup; i++) await wait(10);
  await wait(20);
  assert.ok(h.plugin.backup);
  assert.equal(h.plugin.restoreFlow, null);
});

void test('還原接線：比對時讀不到備份或 vault：丟錯給畫面，也記進錯誤紀錄（L2 的 R10）', async t => {
  const { h, flow, row } = await restoreReady(t, deck);
  const gone = { ...(row as { stored: object }), stored: { ...(row as { stored: object }).stored, name: '不存在.zip' } };
  await assert.rejects(flow.compare(gone), /讀不到備份/);
  h.texts.set(STILL, '\0\0');
  await assert.rejects(flow.compare(row), /內容不完整/);
  await h.plugin.state?.ready();
  let lines: { where: string; msg: string }[] = [];
  for (let i = 0; i < 200 && lines.length < 2; i++) {
    await wait(10);
    lines = [...h.texts].filter(([path]) => path.startsWith('Essence Cards/紀錄/錯誤/')).flatMap(([, text]) => text.split('\n').filter(Boolean).map(line => JSON.parse(line) as { where: string; msg: string })).filter(line => line.where === 'restore');
  }
  assert.deepEqual(lines.map(line => line.msg.split('：')[0]), ['讀備份', '讀 vault']);
});

void test('還原接線：等第一個分頁存檔時第二個分頁換了別篇：不存它、不換成空白（L2 的 R17）', async t => {
  const other = 'Essence Cards/b.md';
  const both = { ...deck, [other]: deck[STILL].replace('aaaaaa', 'bbbbbb') };
  const { h, flow, row } = await restoreReady(t, both);
  h.texts.set(STILL, brokenDeck);
  h.texts.set(other, both[other].replace('Q :: A', 'Q :: 改壞'));
  const comparison = await flow.compare(row);
  h.openTab(STILL);
  h.openTab(other);
  const [first, second] = h.leaves as unknown as { view: { save(): Promise<void>; saves: number; file: { path: string } }; history: unknown[] }[];
  const realSave = first.view.save.bind(first.view);
  first.view.save = () => { second.view.file = { path: 'Essence Cards/unrelated.md' }; return realSave(); };
  await flow.apply(comparison, new Set([STILL, other]));
  assert.equal(second.view.saves, 0);
  assert.deepEqual(second.history, []);
});

void test('還原接線：設定排進隊伍之後路徑才換成連結（內容相同）：不寫（L2 的 R13）', async t => {
  const { h, flow, row } = await restoreReady(t, { ...deck, [DATA]: '{"capMinutes":45}' }, { data: { capMinutes: 45 } });
  h.texts.set(DATA, '{"capMinutes":60}');
  const comparison = await flow.compare(row);
  const plugin = h.plugin as unknown as { store: { restore: (...args: unknown[]) => unknown }; backup: { desktop: { noLinks: (path: string) => Promise<void> } } };
  let queued = false;
  const restoreNow = plugin.store.restore.bind(plugin.store);
  plugin.store.restore = (...args) => { queued = true; return restoreNow(...args); };
  const noLinks = plugin.backup.desktop.noLinks.bind(plugin.backup.desktop);
  plugin.backup.desktop.noLinks = path => queued && path === DATA ? Promise.reject(Error('路徑上有連結')) : noLinks(path);
  const saves = h.data.saves;
  const result = await flow.apply(comparison, new Set([DATA]));
  assert.deepEqual(result.files.map(file => [file.path, file.outcome]), [[DATA, '跳過']]);
  assert.equal(h.data.saves, saves);
  assert.equal(h.text(DATA), '{"capMinutes":60}');
});

void test('還原接線：查連結的時候同步進來新的設定：不蓋掉，跳過（L2 的 R18）', async t => {
  const { h, flow, row } = await restoreReady(t, { ...deck, [DATA]: '{"capMinutes":45}' }, { data: { capMinutes: 45 } });
  h.texts.set(DATA, '{"capMinutes":60}');
  const comparison = await flow.compare(row);
  const plugin = h.plugin as unknown as { store: { restore: (...args: unknown[]) => unknown }; backup: { desktop: { noLinks: (path: string) => Promise<void> } } };
  let queued = false;
  const restoreNow = plugin.store.restore.bind(plugin.store);
  plugin.store.restore = (...args) => { queued = true; return restoreNow(...args); };
  const noLinks = plugin.backup.desktop.noLinks.bind(plugin.backup.desktop);
  const newer = '{"capMinutes":90,"later":true}';
  // 路徑一直是一般檔案，只是內容在查連結的時候換了。
  plugin.backup.desktop.noLinks = async path => { await noLinks(path); if (queued && path === DATA) h.texts.set(DATA, newer); };
  const saves = h.data.saves;
  const result = await flow.apply(comparison, new Set([DATA]));
  assert.deepEqual(result.files.map(file => [file.path, file.outcome]), [[DATA, '跳過']]);
  assert.equal(h.data.saves, saves);
  assert.equal(h.text(DATA), newer);
});

/** 卡住之後把還原推過每一個時間上限。 */
async function pastLimit<T>(t: test.TestContext, work: Promise<T>): Promise<T> {
  let done = false;
  void work.finally(() => { done = true; }).catch(() => {});
  for (let i = 0; i < 30; i++) await new Promise(resolve => { setImmediate(resolve); }); // 先走到卡住的地方，閘門的起跑上限才不會先到
  for (let i = 0; i < 40 && !done; i++) { t.mock.timers.tick(30_000); await new Promise(resolve => { setImmediate(resolve); }); }
  return work;
}
const turns = async (): Promise<void> => { for (let i = 0; i < 10; i++) await new Promise(resolve => { setImmediate(resolve); }); };
function stallOne(owner: unknown, key: string, nth = 1): () => void {
  const object = owner as Record<string, (...args: unknown[]) => unknown>;
  const real = object[key].bind(object);
  let calls = 0, release = (): void => {};
  object[key] = (...args) => ++calls === nth ? new Promise<void>(resolve => { release = resolve; }).then(() => real(...args)) : real(...args);
  return () => { release(); };
}

void test('還原接線：存檔逾時之後，舊存檔回來之前不能比對，下一輪不會被它蓋掉（L2 的 R19）', async t => {
  const { h, flow, row } = await restoreReady(t, deck);
  h.texts.set(STILL, brokenDeck);
  const comparison = await flow.compare(row);
  h.openTab(STILL);
  const release = stallOne(h.leaves[0].view, 'save');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = await pastLimit(t, flow.apply(comparison, new Set([STILL])));
  assert.match((result.stopped as { step: string }).step, /存檔/);
  await assert.rejects(flow.compare(row), /還沒回來/);
  await assert.rejects(flow.apply(comparison, new Set([STILL])), /還沒回來/);
  release();
  await turns();
  t.mock.timers.reset();
  await flow.compare(row);
});

void test('還原接線：關分頁逾時、晚一點才變成空白：回來之前不能比對，回來之後開回原來那篇（L2 的 R19）', async t => {
  const { h, flow, row } = await restoreReady(t, deck);
  h.texts.set(STILL, brokenDeck);
  const comparison = await flow.compare(row);
  h.openTab(STILL);
  const tab = h.leaves[0] as unknown as { view: unknown; history: unknown[] };
  const view = tab.view;
  const release = stallOne(tab, 'setViewState');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = await pastLimit(t, flow.apply(comparison, new Set([STILL])));
  assert.match((result.stopped as { step: string }).step, /關分頁/);
  await assert.rejects(flow.compare(row), /還沒回來/);
  release();
  await turns();
  assert.equal(tab.view, view);
  assert.equal(tab.history.length, 3);
  t.mock.timers.reset();
  await flow.compare(row);
});

void test('還原接線：一個分頁存檔卡住、另一個開回也卡住：兩件都回來才能比對（L2 的 R19）', async t => {
  const other = 'Essence Cards/b.md';
  const both = { ...deck, [other]: deck[STILL].replace('aaaaaa', 'bbbbbb') };
  const { h, flow, row } = await restoreReady(t, both);
  h.texts.set(STILL, brokenDeck);
  h.texts.set(other, both[other].replace('Q :: A', 'Q :: 改壞'));
  const comparison = await flow.compare(row);
  h.openTab(STILL);
  h.openTab(other);
  const reopen = stallOne(h.leaves[0], 'setViewState', 2);
  const save = stallOne(h.leaves[1].view, 'save');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = await pastLimit(t, flow.apply(comparison, new Set([STILL, other])));
  assert.match((result.stopped as { step: string }).step, /存檔/);
  await assert.rejects(flow.compare(row), /還沒回來/);
  save();
  await turns();
  await assert.rejects(flow.compare(row), /還沒回來/);
  reopen();
  await turns();
  t.mock.timers.reset();
  await flow.compare(row);
});

/**
 * 逐一卡住還原期間的每一次 I/O（L2 的 R6、R11、R12，D-197 的重整）：不論卡在哪一次，閘門都要放開、結果交回；
 * 放開之後沒有新的寫入；卡住的是寫入時，它回來之前不能比對。新增的等待只要經過這些介面，自動算進來。
 */
const RESTORE_WRITES = new Set(['modifyBinary', 'createBinary', 'saveData']);

function stallEachCall(h: Awaited<ReturnType<typeof restoreReady>>['h'], at: number) {
  type Fn = (...args: unknown[]) => unknown;
  const box = { calls: 0, stalled: null as string | null, release: (): void => {}, finished: false, writesAfter: [] as string[] };
  const hook = (owner: Record<string, unknown>, key: string, label: string): void => {
    const real = owner[key];
    if (typeof real !== 'function') return;
    owner[key] = (...args: unknown[]) => {
      const n = box.calls++;
      if (box.finished && RESTORE_WRITES.has(key)) box.writesAfter.push(label);
      if (n !== at) return (real as Fn).apply(owner, args);
      box.stalled = label;
      return new Promise<void>(resolve => { box.release = resolve; }).then(() => (real as Fn).apply(owner, args));
    };
  };
  const hookAll = (owner: unknown, prefix: string, keys: readonly string[]): void => { for (const key of keys) hook(owner as Record<string, unknown>, key, prefix + key); };
  hookAll(h.app.vault, 'vault.', ['read', 'cachedRead', 'readBinary', 'modify', 'modifyBinary', 'create', 'createBinary', 'createFolder']);
  hookAll((h.app.vault as { adapter: unknown }).adapter, 'adapter.', ['exists', 'read', 'readBinary', 'list', 'write', 'writeBinary', 'mkdir', 'stat']);
  const plugin = h.plugin as unknown as { saveData: Fn; loadData: Fn; backup: { desktop: { noLinks: Fn; host: Record<string, unknown> } } };
  hookAll(plugin, 'plugin.', ['saveData', 'loadData']);
  hookAll(plugin.backup.desktop, 'desktop.', ['noLinks']);
  hookAll(plugin.backup.desktop.host, 'host.', ['prepare', 'write', 'list', 'read', 'remove']);
  for (const leaf of h.leaves) {
    hookAll(leaf, 'leaf.', ['setViewState']);
    hookAll(leaf.view, 'view.', ['save']);
  }
  return box;
}

void test('還原接線：不論卡在哪一次 I/O，閘門都放開、結果交回，放開之後沒有新的寫入（D-197 的重整）', async t => {
  const failures: string[] = [];
  const reached: string[] = [];
  for (let at = 0; at < 400; at++) {
    const texts = { ...deck, [DATA]: '{"capMinutes":45}', 'Essence Cards/紀錄/2026-11 iPhone-dead.jsonl': '{"t":"2026-11-08T10:00:00.000+08:00","lt":"aaaaaa","r":"good","v":"12345678"}\n' };
    const { h, flow, row } = await restoreReady(t, texts, { data: { capMinutes: 45 } });
    h.texts.set(STILL, brokenDeck);
    h.texts.set(DATA, '{"capMinutes":60}');
    h.texts.delete('Essence Cards/紀錄/2026-11 iPhone-dead.jsonl');
    const comparison = await flow.compare(row);
    h.openTab(STILL);
    const box = stallEachCall(h, at);
    // 真的 I/O（備份的 zip）要真的時間：卡住之前照真實時間走，卡住之後才一次推 30 秒。
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const turn = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });
    let last = performance.now(), overdue = 0;
    const tick = (): void => {
      const now = performance.now();
      t.mock.timers.tick(box.stalled ? 30_000 : Math.floor(now - last));
      if (box.stalled) overdue++;
      if (box.stalled || now - last >= 1) last = now;
    };
    let failed: unknown = null;
    const running = flow.apply(comparison, new Set([STILL, DATA])).catch((error: unknown) => { failed = error; return null; }).finally(() => { box.finished = true; });
    while (!box.finished && overdue < 60) { tick(); await turn(); await turn(); }
    const label = `第 ${String(at)} 次（${box.stalled ?? '沒卡到'}）`;
    if (!box.finished) failures.push(label + '：一直沒有交回結果');
    else {
      await running;
      if (h.plugin.state?.writeBlock() === 'restore') failures.push(label + '：閘門沒放開');
      if (box.stalled && RESTORE_WRITES.has(box.stalled.split('.')[1]) && !failed) {
        const refused = await flow.compare(row).then(() => false, () => true);
        if (!refused) failures.push(label + '：寫入還沒回來就能比對');
      }
    }
    box.release();
    for (let i = 0; i < 40; i++) { tick(); await turn(); }
    if (box.writesAfter.length) failures.push(`${label}：放開之後又寫了 ${box.writesAfter.join('、')}`);
    t.mock.timers.reset();
    h.plugin.onunload();
    if (box.stalled === null) break;
    reached.push(box.stalled);
  }
  assert.ok(reached.length > 20, '卡得到的點太少：' + String(reached.length));
  assert.deepEqual(failures, []);
});
