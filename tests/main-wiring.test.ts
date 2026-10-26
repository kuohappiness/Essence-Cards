import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createObsidianStub, type StubOptions } from './helpers/obsidian.ts';

// src/main.ts 的接線（W5 §4-1）：用共用的 obsidian 替身（tests/helpers/obsidian.ts）在 Node 跑正式建置的程式碼，不是 Obsidian 實機。
const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = async (dev: boolean) => (await build({
  absWorkingDir: root, entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
  external: ['obsidian', '@codemirror/state', '@codemirror/view'], write: false, define: { 'process.env.NODE_ENV': '"production"', DEV: String(dev) },
})).outputFiles[0].text;
const bundled = await bundle(false);
/** 開發版（給 iPhone 的開發命令也在裡面）。 */
const devBundled = await bundle(true);

interface PluginLike { onload(): void; onunload(): void; state: { ready(): Promise<unknown>; answer(entry: unknown): string; fillIds(path: string): Promise<boolean> } | null }

/** 建好替身、載入外掛（正式版或開發版）並建立外掛物件。 */
function host(texts: Record<string, string>, options: Omit<StubOptions, 'texts'> = {}, code = bundled) {
  const stub = createObsidianStub({ ...options, texts });
  const { default: Plugin } = stub.load<{ default: new (app: unknown, manifest: unknown) => PluginLike }>(code);
  const plugin = new Plugin(stub.app, { id: 'essence-cards', version: '0.0.1' });
  return { ...stub, plugin, uri: (params: Record<string, string>) => { stub.protocol.get('essence-cards-dev')?.(params); } };
}

const deck = { 'Essence Cards/a.md': '---\n科目: 自然\n---\n- 目標 ^aaaaaa\n    - Q :: A\n' };
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
    const { plugin, commands, extensions, layoutReady, text } = host(missing, { desktop });
    t.after(() => { plugin.onunload(); });
    plugin.onload();
    assert.equal(commands.has('save'), desktop);
    // 鎖定，以及告訴離開筆記的備援「這篇開著」的 ViewPlugin。
    assert.equal(extensions(), desktop ? 2 : 0);
    layoutReady();
    assert.ok(plugin.state);
    await plugin.state.ready();
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
    assert.deepEqual(h.writes, []);
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
  await wait(1100);
  assert.deepEqual(h.writes, []);
  h.closeTabs();
  await wait(1200);
  assert.deepEqual(h.writes, ['process ' + path]);
  assert.match(h.text(path) ?? '', /^- 新目標 \^[a-z0-9]{6}\n/);
});
