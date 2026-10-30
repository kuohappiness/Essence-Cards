import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import vm from 'node:vm';
import type { Files } from '../src/core/files.ts';
import { createErrorLog, errorLogPath, ERROR_FOLDER, hasOwnFrame, isErrorLogPath } from '../src/core/errors/index.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';

// 正式版的錯誤紀錄（D-155、tasks/error-log.md §1）：記錄器只靠 Files；預期值取自 syntax.md §9 的範例與自編的字串。
const syntax = readFileSync(new URL('../docs/syntax.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const section = syntax.slice(syntax.indexOf('## 9. 錯誤紀錄'));
const examples = /```\n紀錄\/錯誤\/(.+)\n\n([^]*?)\n```/.exec(section);
if (!examples) throw Error('syntax.md §9 的範例不見了');
const [, exampleName, exampleText] = examples;
const exampleLines = exampleText.split('\n');

const DEVICE = 'iPhone-7f3a';
const BUILD = '0.1.0+1a2b3c4';
const OBSIDIAN = '1.14.5';
const DECK = 'Essence Cards/國二上/自然/2-2 水溶液（卡片）.md';
const at = (t: string): number => Date.parse(t);
const FILE = ERROR_FOLDER + '/2026-11 ' + DEVICE + ' 錯誤.jsonl';
const lines = (text: string | undefined): string[] => (text ?? '').split('\n').filter(line => line !== '');

/** 時間可以撥的記錄器；offset 固定 +08:00。 */
function setup(files: Files, start = at('2026-11-02T20:15:03.250+08:00')) {
  const clock = { now: start };
  const log = createErrorLog({ files, device: DEVICE, build: BUILD, obsidian: OBSIDIAN, now: () => clock.now, offset: () => 480 });
  return { log, clock };
}

/** 帶自己程式位置的錯誤（Obsidian 載入外掛時的 stack 寫法）。 */
function ownError(message: string, frame = 'at Xe (plugin:essence-cards:1:20345)', Kind: ErrorConstructor = Error): Error {
  const error = new Kind(message);
  error.stack = `${Kind.name}: ${message}\n    ${frame}\n    at Ye (plugin:essence-cards-x:3:4)\n    at app://obsidian.md/app.js:1:2`;
  return error;
}

void test('§1 檔名與資料夾：照 syntax.md §9', () => {
  assert.equal(ERROR_FOLDER + '/' + exampleName, errorLogPath(at('2026-11-02T20:15:03.250+08:00'), 480, DEVICE));
  assert.equal(errorLogPath(at('2026-10-31T16:30:00.000Z'), 480, DEVICE), FILE, '年月照當地時間');
  assert.ok(isErrorLogPath(FILE));
  assert.ok(isErrorLogPath(ERROR_FOLDER + '/2026-11 ' + DEVICE + ' 錯誤 2.jsonl'), 'iCloud 的衝突副本也是');
  assert.ok(!isErrorLogPath('Essence Cards/紀錄/2026-11 ' + DEVICE + '.jsonl'));
  assert.ok(!isErrorLogPath('Essence Cards/紀錄/錯誤.jsonl'));
});

void test('§1 欄位與順序：render、read（第 10 次）、report 的那一行逐字等於 syntax.md §9 的範例', async () => {
  const memory = createMemoryFiles();
  const { log, clock } = setup(memory.files);
  log.record('render', ownError("Cannot read properties of undefined (reading 'text')", 'at Xe (plugin:essence-cards:1:20345)', TypeError), { path: DECK });
  clock.now = at('2026-11-02T20:31:40.512+08:00');
  const read = Error('Error: UNKNOWN: unknown error, open');
  read.stack = undefined;
  for (let i = 0; i < 10; i++) log.record('read', read, { path: 'Essence Cards/紀錄/2026-11 Windows-2c9e.jsonl' });
  clock.now = at('2026-11-03T19:42:10.118+08:00');
  log.report({ kind: 'content', path: DECK, lt: 'k3m9x2', v: 'a1b2c3d4' });
  await wait(10);
  const written = lines(memory.texts.get(ERROR_FOLDER + '/' + exampleName));
  // 第 1 次的 read 不帶 n，範例只列出第 10 次那一行。
  assert.deepEqual([written[0], written[2], written[3]], exampleLines);
  assert.equal(written[1], '{"t":"2026-11-02T20:31:40.512+08:00","build":"0.1.0+1a2b3c4","obsidian":"1.14.5","where":"read","msg":"Error: UNKNOWN: unknown error, open","path":"Essence Cards/紀錄/2026-11 Windows-2c9e.jsonl"}');
  assert.equal(written.length, 4);
});

void test('§1 截斷：msg 一萬字加長 path 加長 stack，那一行 ≤ 2,000 bytes、還是合法 JSON，中文字不會切成半個', async () => {
  const memory = createMemoryFiles();
  const { log } = setup(memory.files);
  const frames = Array.from({ length: 200 }, (_, i) => `at f${String(i)} (plugin:essence-cards:1:${String(i)})`).join('\n    ');
  const error = Error('錯'.repeat(10_000));
  error.stack = 'Error: x\n    ' + frames;
  log.record('render', error, { path: 'Essence Cards/' + '長'.repeat(1_000) + '.md' });
  // 跳脫字元與四個 byte 的字也算：msg 全是 emoji 與要跳脫的引號。
  log.record('ui', '😀"\n'.repeat(3_000));
  await wait(10);
  const written = lines(memory.texts.get(FILE));
  assert.equal(written.length, 2);
  for (const line of written) {
    assert.ok(new TextEncoder().encode(line).length <= 2000, String(new TextEncoder().encode(line).length));
    const value = JSON.parse(line) as Record<string, string>;
    assert.ok(!line.includes('\\ud'), '沒有切開的代理對');
    assert.ok(value.msg.endsWith('…'), '截過的 msg 結尾是「…」');
    assert.ok(new TextEncoder().encode(line).length > 1900, '截到剛好放得下，不是整欄丟掉');
  }
  const first = JSON.parse(written[0]) as Record<string, string | undefined>;
  // 依序截短 stack、path、msg：msg 太長時 stack 與 path 先截完（整欄拿掉）。
  assert.equal(first.stack, undefined);
  assert.equal(first.path, undefined);
  assert.match(first.msg ?? '', /^錯+…$/);
});

void test('§1 截斷的順序：只有 stack 太長時只截 stack，path 與 msg 原樣', async () => {
  const memory = createMemoryFiles();
  const { log } = setup(memory.files);
  const error = Error('短訊息');
  error.stack = 'Error: 短訊息\n' + Array.from({ length: 200 }, (_, i) => `    at f${String(i)} (plugin:essence-cards:1:${String(i)})`).join('\n');
  log.record('render', error, { path: DECK });
  await wait(10);
  const value = JSON.parse(lines(memory.texts.get(FILE))[0]) as Record<string, string>;
  assert.equal(value.msg, '短訊息');
  assert.equal(value.path, DECK);
  assert.ok(value.stack.startsWith('at f0 (plugin:essence-cards:1:0)\nat f1 (plugin:essence-cards:1:1)\n'));
  assert.ok(value.stack.endsWith('…'));
});

void test('§1 非 Error 值與會拋錯的物件：record 不拋錯，每種都寫出一行', async () => {
  const memory = createMemoryFiles();
  const { log } = setup(memory.files);
  const circular: Record<string, unknown> = { a: 1 };
  circular.self = circular;
  const hostile = { toString() { throw Error('toString 壞了'); }, toJSON() { throw Error('toJSON 壞了'); } };
  const getter = Object.defineProperty({}, 'message', { get() { throw Error('message 壞了'); } });
  const stackGetter = Object.defineProperty(Error('有 message'), 'stack', { get() { throw Error('stack 壞了'); } });
  const proxy = new Proxy({}, { get() { throw Error('Proxy 壞了'); }, getPrototypeOf() { throw Error('Proxy 壞了'); } });
  const values: [unknown, string][] = [
    ['只是字串', '只是字串'], [null, 'null'], [undefined, 'undefined'], [42, '42'], [Symbol('s'), 'Symbol(s)'],
    [circular, '[object Object]'], [{ code: 'E1' }, '{"code":"E1"}'], [hostile, '[object Object]'], [getter, '[object Object]'],
    [stackGetter, '有 message'], [proxy, '（無法轉成文字）'], [Error(''), 'Error'],
  ];
  for (const [index, [value]] of values.entries()) assert.doesNotThrow(() => { log.record('uncaught', value, { path: 'p' + String(index) }); });
  await wait(10);
  assert.deepEqual(lines(memory.texts.get(FILE)).map(line => (JSON.parse(line) as { msg: string }).msg), values.map(([, msg]) => msg));
});

void test('§1 自己的程式位置：只留 plugin:essence-cards: 的那幾層；只有別人的 frame 時沒有 stack', async () => {
  const memory = createMemoryFiles();
  const { log } = setup(memory.files);
  log.record('ui', ownError('一'));
  const other = Error('二');
  other.stack = 'Error: 二\n    at a (plugin:essence-cards-x:1:2)\n    at b (plugin:my-essence-cards:3:4)\n    at c (app://obsidian.md/app.js:5:6)';
  log.record('ui', other);
  // iPhone（WebKit）的寫法：函式名稱@位置。
  const webkit = Error('三');
  webkit.stack = 'onload@plugin:essence-cards:1:20345\nother@plugin:essence-cards-x:1:2';
  log.record('ui', webkit);
  await wait(10);
  const stacks = lines(memory.texts.get(FILE)).map(line => (JSON.parse(line) as { stack?: string }).stack);
  assert.deepEqual(stacks, ['at Xe (plugin:essence-cards:1:20345)', undefined, 'onload@plugin:essence-cards:1:20345']);
  assert.equal(hasOwnFrame(ownError('x')), true);
  assert.equal(hasOwnFrame(other), false);
  assert.equal(hasOwnFrame('plugin:essence-cards:1:2'), false, '字串沒有 stack');
  assert.equal(hasOwnFrame(null), false);
});

void test('§1 去重：同一個錯誤 1,000 次剛好 4 行，n 是沒有、10、100、1000；不同 path 的同一句訊息算兩個', async () => {
  const memory = createMemoryFiles();
  const { log } = setup(memory.files);
  for (let i = 0; i < 1_000; i++) log.record('read', ownError('讀不到'), { path: 'Essence Cards/a.md' });
  log.record('read', ownError('讀不到'), { path: 'Essence Cards/b.md' });
  // 沒有自己的程式位置時用 msg 分：訊息不同算兩個，相同算一個。
  log.record('write', '寫不進去 1');
  log.record('write', '寫不進去 2');
  log.record('write', '寫不進去 1');
  // 第一個自己的程式位置不同，算兩個。
  log.record('ui', ownError('同一句', 'at A (plugin:essence-cards:1:1)'));
  log.record('ui', ownError('同一句', 'at B (plugin:essence-cards:1:2)'));
  await wait(20);
  const written = lines(memory.texts.get(FILE)).map(line => JSON.parse(line) as { where: string; path?: string; n?: number; msg: string });
  assert.deepEqual(written.filter(line => line.path === 'Essence Cards/a.md').map(line => line.n), [undefined, 10, 100, 1000]);
  assert.equal(written.filter(line => line.path === 'Essence Cards/b.md').length, 1);
  assert.deepEqual(written.filter(line => line.where === 'write').map(line => line.msg), ['寫不進去 1', '寫不進去 2']);
  assert.equal(written.filter(line => line.where === 'ui').length, 2);
});

void test('§1 去重表最多 500 個鍵：之後的新鍵照第 1 次寫', async () => {
  const memory = createMemoryFiles();
  const { log, clock } = setup(memory.files);
  // 分批記，不撞到等待中最多 50 筆的上限。
  for (let i = 0; i < 500; i++) {
    log.record('read', '錯誤 ' + String(i));
    if (i % 40 === 39) await wait(5);
  }
  // 換到下個月（11 月的檔已經到上限）：第 501 個鍵記兩次，表滿了，每次都當第 1 次寫（不帶 n）；表裡的舊鍵照常計數。
  clock.now = at('2026-12-01T08:00:00.000+08:00');
  for (let i = 0; i < 2; i++) log.record('read', '新的錯誤');
  log.record('read', '錯誤 0');
  await wait(20);
  assert.equal(lines(memory.texts.get(FILE)).length, 300);
  const december = lines(memory.texts.get(ERROR_FOLDER + '/2026-12 ' + DEVICE + ' 錯誤.jsonl')).map(line => JSON.parse(line) as { msg: string; n?: number });
  assert.deepEqual(december.map(line => [line.msg, line.n]), [['新的錯誤', undefined], ['新的錯誤', undefined]]);
});

void test('§1 月上限：當月已經 298 行再記 5 個，剛好 300 行、最後一行是 limit；重新載入後不再寫；同時記 10 次也不超過', async () => {
  const old = Array.from({ length: 298 }, (_, i) => `{"t":"2026-11-01T08:00:00.000+08:00","build":"0.0.9","obsidian":"1.14.5","where":"read","msg":"舊的 ${String(i)}"}`).join('\n') + '\n';
  const memory = createMemoryFiles({ [FILE]: old });
  const { log } = setup(memory.files);
  for (let i = 0; i < 5; i++) log.record('ui', '新的 ' + String(i));
  await wait(20);
  const written = lines(memory.texts.get(FILE));
  assert.equal(written.length, 300);
  assert.equal(written[298], '{"t":"2026-11-02T20:15:03.250+08:00","build":"0.1.0+1a2b3c4","obsidian":"1.14.5","where":"ui","msg":"新的 0"}');
  assert.equal(written[299], '{"t":"2026-11-02T20:15:03.250+08:00","build":"0.1.0+1a2b3c4","obsidian":"1.14.5","where":"limit"}');
  // 模擬重新載入：新的記錄器讀到 limit，這個月不再寫。
  const { log: reloaded } = setup(memory.files);
  for (let i = 0; i < 3; i++) reloaded.record('ui', '重新載入後 ' + String(i));
  await wait(20);
  assert.equal(lines(memory.texts.get(FILE)).length, 300);

  // 同時記 10 個（不等待）：當月的檔只讀一次，名額在 append 之前就預留。
  const busy = createMemoryFiles({ [FILE]: old });
  const { log: burst } = setup(busy.files);
  for (let i = 0; i < 10; i++) burst.record('ui', '同時 ' + String(i));
  await wait(20);
  assert.equal(lines(busy.texts.get(FILE)).length, 300);
  assert.equal(busy.reads.filter(path => path === FILE).length, 1);
});

void test('§1 讀不到當月的檔：這次載入一行都不寫，record 不拋錯；別的月份照常', async () => {
  const memory = createMemoryFiles();
  memory.failing.add(FILE);
  const { log, clock } = setup(memory.files);
  for (let i = 0; i < 3; i++) assert.doesNotThrow(() => { log.record('read', '錯誤 ' + String(i)); });
  await wait(20);
  memory.failing.delete(FILE);
  log.record('read', '讀得到了也不寫');
  await wait(20);
  assert.equal(memory.texts.get(FILE), undefined);
  assert.equal(memory.reads.filter(path => path === FILE).length, 1, '同一次載入只讀一次');
  clock.now = at('2026-12-01T00:00:00.000+08:00');
  log.record('read', '十二月');
  await wait(20);
  assert.equal(lines(memory.texts.get(ERROR_FOLDER + '/2026-12 ' + DEVICE + ' 錯誤.jsonl')).length, 1);
});

void test('§1 換月：跨過當地的月底後寫到新的檔、重新算行數', async () => {
  const full = Array.from({ length: 299 }, () => '{"where":"read"}').join('\n') + '\n';
  const memory = createMemoryFiles({ [FILE]: full });
  const { log, clock } = setup(memory.files, at('2026-11-30T23:59:59.999+08:00'));
  log.record('ui', '十一月最後一刻');
  clock.now = at('2026-12-01T00:00:00.000+08:00');
  log.record('ui', '十二月第一刻');
  log.record('ui', '十二月第二個');
  await wait(20);
  assert.equal(lines(memory.texts.get(FILE)).at(-1), '{"t":"2026-11-30T23:59:59.999+08:00","build":"0.1.0+1a2b3c4","obsidian":"1.14.5","where":"limit"}');
  assert.deepEqual(lines(memory.texts.get(ERROR_FOLDER + '/2026-12 ' + DEVICE + ' 錯誤.jsonl')).map(line => (JSON.parse(line) as { msg: string }).msg), ['十二月第一刻', '十二月第二個']);
});

void test('§1 寫不進去：append 拒絕或永遠不回來，record 照樣立即回來、沒有未處理的拒絕、等待中的寫入不超過 50 筆', async t => {
  const unhandled: unknown[] = [];
  const listener = (reason: unknown): void => { unhandled.push(reason); };
  process.on('unhandledRejection', listener);
  t.after(() => { process.off('unhandledRejection', listener); });

  const failing = createMemoryFiles();
  failing.control.failAppend = true;
  const { log } = setup(failing.files);
  for (let i = 0; i < 5; i++) log.record('write', '錯誤 ' + String(i));
  await wait(20);
  assert.equal(failing.texts.get(FILE), undefined);

  // 永遠不回來的 append（或讀）：同步的 record 立刻回來，排著的不超過 50 筆。
  let appends = 0, reads = 0;
  const stuck: Files = {
    list: () => Promise.resolve([]),
    read: () => { reads++; return Promise.resolve(null); },
    readBytes: () => Promise.resolve(null),
    modify: () => new Promise(() => {}),
    append: () => { appends++; return new Promise(() => {}); },
    watch: () => () => {},
  };
  const { log: hanging } = setup(stuck);
  const started = performance.now();
  for (let i = 0; i < 200; i++) hanging.record('write', '錯誤 ' + String(i));
  assert.ok(performance.now() - started < 200);
  await wait(20);
  assert.equal(reads, 1);
  assert.equal(appends, 50);
  // append 同步拋錯（例如路徑不合法）也接住。
  const throwing: Files = { ...stuck, append: () => { throw Error('同步拋錯'); } };
  const { log: sync } = setup(throwing);
  assert.doesNotThrow(() => { sync.record('write', 'x'); });
  await wait(20);
  assert.deepEqual(unhandled, []);
});

void test('§1 時區不合法（formatTime 拋錯）時 record 不拋錯、不寫', async () => {
  const memory = createMemoryFiles();
  const log = createErrorLog({ files: memory.files, device: DEVICE, build: BUILD, obsidian: OBSIDIAN, offset: () => 5000 });
  assert.doesNotThrow(() => { log.record('ui', 'x'); log.report({ kind: 'other', path: DECK, lt: 'a', v: 'b' }); });
  await wait(10);
  assert.deepEqual([...memory.texts.keys()], []);
});

void test('§1 after：第一次讀寫之前先等它（layout ready 之前不碰檔案）', async () => {
  const memory = createMemoryFiles();
  let open = (): void => {};
  const after = new Promise<void>(resolve => { open = resolve; });
  const log = createErrorLog({ files: memory.files, device: DEVICE, build: BUILD, obsidian: OBSIDIAN, now: () => at('2026-11-02T20:15:03.250+08:00'), offset: () => 480, after });
  log.record('init', '載入時的錯');
  await wait(10);
  assert.deepEqual(memory.reads, []);
  open();
  await wait(10);
  assert.equal(lines(memory.texts.get(FILE)).length, 1);
});

// tasks/error-log.md §8（D-160 第 4 點）：學生回報記進同一個檔；去重的鍵是 lt、v、kind。
void test('§8 report：同一張卡同一項 12 次只有 2 行（第 1 次與 n: 10）；同一張卡不同項、不同卡同一項各算一個', async () => {
  const memory = createMemoryFiles();
  const { log } = setup(memory.files);
  const card = { path: DECK, lt: 'k3m9x2', v: 'a1b2c3d4' };
  for (let i = 0; i < 12; i++) log.report({ kind: 'content', ...card });
  log.report({ kind: 'audio', ...card });
  log.report({ kind: 'content', ...card, v: 'ffffffff' });
  log.report({ kind: 'content', ...card, lt: 'p7q2w8' });
  await wait(10);
  const written = lines(memory.texts.get(FILE));
  assert.deepEqual(written, [
    '{"t":"2026-11-02T20:15:03.250+08:00","build":"0.1.0+1a2b3c4","obsidian":"1.14.5","where":"report","kind":"content","path":"Essence Cards/國二上/自然/2-2 水溶液（卡片）.md","lt":"k3m9x2","v":"a1b2c3d4"}',
    '{"t":"2026-11-02T20:15:03.250+08:00","build":"0.1.0+1a2b3c4","obsidian":"1.14.5","where":"report","kind":"content","path":"Essence Cards/國二上/自然/2-2 水溶液（卡片）.md","lt":"k3m9x2","v":"a1b2c3d4","n":10}',
    '{"t":"2026-11-02T20:15:03.250+08:00","build":"0.1.0+1a2b3c4","obsidian":"1.14.5","where":"report","kind":"audio","path":"Essence Cards/國二上/自然/2-2 水溶液（卡片）.md","lt":"k3m9x2","v":"a1b2c3d4"}',
    '{"t":"2026-11-02T20:15:03.250+08:00","build":"0.1.0+1a2b3c4","obsidian":"1.14.5","where":"report","kind":"content","path":"Essence Cards/國二上/自然/2-2 水溶液（卡片）.md","lt":"k3m9x2","v":"ffffffff"}',
    '{"t":"2026-11-02T20:15:03.250+08:00","build":"0.1.0+1a2b3c4","obsidian":"1.14.5","where":"report","kind":"content","path":"Essence Cards/國二上/自然/2-2 水溶液（卡片）.md","lt":"p7q2w8","v":"a1b2c3d4"}',
  ]);
  // 錯誤與回報的鍵分開：同樣的字串當錯誤記，不算同一個。
  log.record('render', 'k3m9x2', { path: DECK });
  await wait(10);
  assert.equal(lines(memory.texts.get(FILE)).length, 6);
});

void test('§8 report：月上限與寫不進去照 §1（共用每月 300 行）', async () => {
  const old = Array.from({ length: 299 }, () => '{"where":"read"}').join('\n') + '\n';
  const memory = createMemoryFiles({ [FILE]: old });
  const { log } = setup(memory.files);
  log.report({ kind: 'stuck', path: DECK, lt: 'a', v: 'b' });
  log.report({ kind: 'other', path: DECK, lt: 'a', v: 'b' });
  await wait(10);
  const written = lines(memory.texts.get(FILE));
  assert.equal(written.length, 300);
  assert.match(written[299], /"where":"limit"\}$/);
  const failing = createMemoryFiles();
  failing.control.failAppend = true;
  const { log: broken } = setup(failing.files);
  assert.doesNotThrow(() => { broken.report({ kind: 'display', path: DECK, lt: 'a', v: 'b' }); });
});

// Codex L2 的 R3：只認 stack 裡的 frame，不把錯誤訊息那一行（或多行訊息）當成自己的程式位置。
void test('§1 R3 訊息裡有 plugin:essence-cards:、frame 全是別人的：不算自己的錯，也不留成 stack', async () => {
  const memory = createMemoryFiles();
  const { log } = setup(memory.files);
  const other = Error('other-plugin cannot fetch plugin:essence-cards:1:20345');
  other.stack = ['Error: other-plugin cannot fetch plugin:essence-cards:1:20345', '    at fetcher (plugin:other-plugin:4:5)', '    at app://obsidian.md/app.js:6:7'].join('\n');
  assert.equal(hasOwnFrame(other), false);
  // 多行的訊息：第二行看起來像 frame 也不算（V8 的 stack 開頭是整段訊息）。
  const multiline = Error('第一行\n    at fake (plugin:essence-cards:9:9)');
  multiline.stack = 'Error: 第一行\n    at fake (plugin:essence-cards:9:9)\n    at real (plugin:other-plugin:1:1)';
  assert.equal(hasOwnFrame(multiline), false);
  // 訊息含位址、frame 也有自己的：只留真正的 frame。
  const mixed = Error('see plugin:essence-cards:1:1');
  mixed.stack = 'Error: see plugin:essence-cards:1:1\n    at own (plugin:essence-cards:7:8)';
  assert.equal(hasOwnFrame(mixed), true);
  log.record('ui', other);
  log.record('ui', mixed);
  // WebKit：沒有訊息行；匿名函式、global code、只有位址的 frame 都認得。
  const webkit = Error('w');
  webkit.stack = '@plugin:essence-cards:1:2\nglobal code@plugin:essence-cards:3:4\nplugin:essence-cards:5:6\nother@plugin:other-plugin:1:1';
  log.record('render', webkit);
  await wait(10);
  const stacks = lines(memory.texts.get(FILE)).map(line => (JSON.parse(line) as { stack?: string }).stack);
  assert.deepEqual(stacks, [undefined, 'at own (plugin:essence-cards:7:8)', '@plugin:essence-cards:1:2\nglobal code@plugin:essence-cards:3:4\nplugin:essence-cards:5:6']);
});

// Codex 再審的 F1：V8 的匿名 async frame（`at async 位置`，沒有名稱與括號）也是自己的程式位置。用真的 V8 產生 stack。
void test('§1 F1 V8 真的產生的 `at async plugin:essence-cards:行:欄` 認得', async () => {
  const external = async (): Promise<never> => { await wait(1); throw Error('external-crash'); };
  const context = vm.createContext({ external });
  const error = await (vm.runInContext('(async () => { await external(); })()', context, { filename: 'plugin:essence-cards' }) as Promise<never>).catch((reason: unknown) => reason);
  const stack = (error as Error).stack ?? '';
  assert.match(stack, /\n\s+at async plugin:essence-cards:\d+:\d+/, stack);
  assert.equal(hasOwnFrame(error), true);
  const memory = createMemoryFiles();
  const { log } = setup(memory.files);
  log.record('uncaught', error);
  await wait(10);
  assert.match((JSON.parse(lines(memory.texts.get(FILE))[0]) as { stack: string }).stack, /^at async plugin:essence-cards:\d+:\d+$/);
});

