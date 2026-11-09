import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { isDeckPath } from '../src/core/deck/index.ts';
import { isLogPath } from '../src/core/study/index.ts';
import { createState } from '../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// 考試切面（tasks/record-gaps.md §2、§6 第 19～31 條）：真正的 createState，假的 Files。檔名裡的鍵是另外用 Python 的 hashlib 算的字面值。

const DELAY = 30;
const FOLDER = 'Essence Cards/紀錄/考試切面/';
const SCOPE = 'Essence Cards/考試範圍/2026-10-28 國二上.md';
const NATURE = 'Essence Cards/學業/國二上/自然/國二上自然 2-1 水溶液.md';
const ENGLISH = 'Essence Cards/學業/國二上/英文/國二上英文 L1 單字.md';
const OUTSIDE = 'Essence Cards/學業/國二上/自然/國二上自然 9-1.md';
const KEY = '4e4ddf5dff5c';
const FILE = `${FOLDER}2026-10-28 ${KEY} PC-test.jsonl`;
const at = (text: string): number => Date.parse(text + '+08:00');
const OPEN = at('2026-10-28T06:58:03.120');

const head = (code: string, extra = '', subject = '自然'): string => `---\n年級學期: 國二上\n科目: ${subject}\n單元: "${code}"\n${extra}---\n`;
const goal = (id: string, extra = ''): string => `- 目標 ${id} ^${id}\n${extra}    - 問 ${id} :: 答 ${id}\n`;
const scope = (start = '2026-10-28', end = '2026-10-29', extra = '', id = '識別碼: x7f3k2\n'): string =>
  `---\n${id}考試開始: ${start}\n考試結束: ${end}\n${extra}---\n- 國二上 自然 2\n- 國二上 英文 L1\n`;
const NATURE_TEXT = head('2-1', '狀態: 啟用\n') + goal('k3m9x2');
const ENGLISH_TEXT = head('L1', '', '英文') + goal('p7q2w8');
const VAULT = { [SCOPE]: scope(), [NATURE]: NATURE_TEXT, [ENGLISH]: ENGLISH_TEXT };

interface Options { now?: number; device?: string; unread?: string[] }
const pump = async (t: TestContext, ms = DELAY): Promise<void> => {
  t.mock.timers.tick(ms);
  for (let i = 0; i < 15; i++) await new Promise<void>(resolve => setImmediate(resolve));
};
const mocked = new WeakSet<TestContext>();
async function open(t: TestContext, memory: MemoryFiles, options: Options = {}) {
  if (!mocked.has(t)) t.mock.timers.enable({ apis: ['setTimeout'] });
  mocked.add(t);
  let clock = options.now ?? OPEN;
  const errors: [unknown, string][] = [];
  for (const path of options.unread ?? []) memory.failing.add(path);
  const state = createState({ files: memory.files, device: options.device ?? 'PC-test', delay: DELAY, fillIds: false, now: () => clock, offset: () => 480, onError: (error, source) => { errors.push([error, source]); } });
  t.after(() => state.close());
  await state.ready();
  await pump(t, 0);
  return { state, errors, setNow: (ms: number) => { clock = ms; }, pump: (ms?: number) => pump(t, ms) };
}
const launch = (t: TestContext, vault: Record<string, string>, options: Options = {}) => {
  const memory = createMemoryFiles(vault);
  return open(t, memory, options).then(h => ({ ...h, memory }));
};
const written = (memory: MemoryFiles): string[] => [...memory.texts.keys()].filter(path => path.startsWith(FOLDER)).sort();
const rows = (memory: MemoryFiles, path = FILE): Record<string, unknown>[] => (memory.texts.get(path) ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
const header = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ t: '2026-10-28T05:00:00.000+08:00', exam: 'x7f3k2', scope: SCOPE, start: '2026-10-28', end: '2026-10-29', units: [], decks: 1, ...extra });
const lines = (...items: unknown[]): string => items.map(item => JSON.stringify(item)).join('\n') + '\n';

void test('19 開始日第一次 ready：寫出一份，檔名、檔頭照規格，每篇 text 等於原文', async t => {
  const { memory } = await launch(t, VAULT);
  assert.deepEqual(written(memory), [FILE]);
  assert.deepEqual(rows(memory), [
    { t: '2026-10-28T06:58:03.120+08:00', exam: 'x7f3k2', scope: SCOPE, start: '2026-10-28', end: '2026-10-29', units: ['國二上 自然 2', '國二上 英文 L1'], decks: 2 },
    { path: NATURE, text: NATURE_TEXT },
    { path: ENGLISH, text: ENGLISH_TEXT },
  ]);
});

void test('20 CRLF、emoji、不成對的代理字元、引號、反斜線：JSON.parse 取回的 text 逐字相同', async t => {
  const lone = String.fromCharCode(0xD83D);
  const text = head('2-1').replaceAll('\n', '\r\n') + `- 目標 "引號" C:\\路徑 😀 ${lone} ^k3m9x2\r\n    - 問 :: 答\r\n`;
  const { memory } = await launch(t, { [SCOPE]: scope(), [NATURE]: text });
  assert.equal(rows(memory)[1].text, text);
});

for (const [name, vault, now] of [
  ['開始日 03:59', VAULT, at('2026-10-28T03:59:00.000')],
  ['還沒開始', VAULT, at('2026-10-20T12:00:00.000')],
  ['結束日之後', VAULT, at('2026-10-30T12:00:00.000')],
  ['提前結束', { ...VAULT, [SCOPE]: scope('2026-10-28', '2026-10-29', '提前結束: 2026-10-27\n') }, OPEN],
  ['沒有日期', { ...VAULT, [SCOPE]: '---\n識別碼: x7f3k2\n---\n- 國二上 自然 2\n' }, OPEN],
  ['日期有問題', { ...VAULT, [SCOPE]: scope('2026-10-30', '2026-10-28') }, OPEN],
  ['小考', { [NATURE]: NATURE_TEXT, 'Essence Cards/考試範圍/小考/2026-10-28 自然.md': scope() }, OPEN],
] as const) void test('21 不寫：' + name, async t => {
  const { memory } = await launch(t, vault, { now });
  assert.deepEqual(written(memory), []);
});

void test('21 結束日當天 04:00 前還算考試期間（清晨 4 點換日）：照寫', async t => {
  const { memory } = await launch(t, VAULT, { now: at('2026-10-30T03:59:00.000') });
  assert.deepEqual(written(memory), [FILE]);
});

void test('22 第二次 ready 不寫', async t => {
  const memory = createMemoryFiles(VAULT);
  const first = await open(t, memory);
  const before = memory.texts.get(FILE);
  await first.state.close();
  await open(t, memory, { now: OPEN + 60_000 });
  assert.deepEqual(written(memory), [FILE]);
  assert.equal(memory.texts.get(FILE), before);
});

void test('22 資料夾裡只有別台的同一份：這台照寫自己的', async t => {
  const other = `${FOLDER}2026-10-28 ${KEY} iPhone-7f3a.jsonl`;
  const text = lines(header(), { path: NATURE, text: 'x' });
  const { memory } = await launch(t, { ...VAULT, [other]: text });
  assert.deepEqual(written(memory), [FILE, other].sort());
  assert.equal(memory.texts.get(other), text);
});

void test('23 兩份無識別碼、同一天開始：結束第一份後第二份寫得出來，鍵各自不同', async t => {
  const a = 'Essence Cards/考試範圍/段考.md', b = 'Essence Cards/考試範圍/段考 2.md';
  const first = `${FOLDER}2026-10-28 9aa1b688a39f PC-test.jsonl`, second = `${FOLDER}2026-10-28 7354776b6cd3 PC-test.jsonl`;
  const h = await launch(t, { [a]: scope('2026-10-28', '2026-10-29', '', ''), [b]: scope('2026-10-28', '2026-10-29', '', ''), [NATURE]: NATURE_TEXT });
  // 同一天開始照路徑排，`段考 2.md` 在 `段考.md` 前面。
  assert.deepEqual(written(h.memory), [first]);
  assert.equal(rows(h.memory, first)[0].exam, null);
  h.memory.write(b, scope('2026-10-28', '2026-10-29', '提前結束: 2026-10-28\n', ''));
  await h.pump();
  assert.deepEqual(written(h.memory), [first, second].sort());
});

void test('23 識別碼 term/1: A：路徑只有一層，檔頭保留原值', async t => {
  const { memory } = await launch(t, { [SCOPE]: scope('2026-10-28', '2026-10-29', '', '識別碼: "term/1: A"\n'), [NATURE]: NATURE_TEXT });
  const path = `${FOLDER}2026-10-28 21a71643eff5 PC-test.jsonl`;
  assert.deepEqual(written(memory), [path]);
  assert.equal(rows(memory, path)[0].exam, 'term/1: A');
});

const ROW = { path: NATURE, text: 'x' };
for (const [name, text] of [
  ['空檔', ''],
  ['截斷', JSON.stringify(header()).slice(0, 30)],
  ['檔頭對但行數不符', lines(header())],
  ['多一行', lines(header(), ROW, { path: ENGLISH, text: 'y' })],
  ['path 重複', lines(header({ decks: 2 }), ROW, ROW)],
  ['鍵不符', lines(header({ exam: 'other1' }), ROW)],
  ['開始日不符', lines(header({ start: '2026-10-27' }), ROW)],
  ['下面不是 path 與 text', lines(header(), { path: NATURE })],
] as const) void test('24 這台的檔無效：舊檔逐字不變，另寫序號 2：' + name, async t => {
  const { memory } = await launch(t, { ...VAULT, [FILE]: text });
  assert.equal(memory.texts.get(FILE), text);
  const next = `${FOLDER}2026-10-28 ${KEY} PC-test 2.jsonl`;
  assert.deepEqual(written(memory), [next, FILE]);
  assert.equal(rows(memory, next).length, 3);
});

void test('24 這台的檔讀不到：這次不寫；有效：不寫', async t => {
  const unreadable = await launch(t, { ...VAULT, [FILE]: 'x' }, { unread: [FILE] });
  assert.deepEqual(written(unreadable.memory), [FILE]);
  assert.equal(unreadable.memory.texts.get(FILE), 'x');
  const text = lines(header(), ROW);
  const valid = await launch(t, { ...VAULT, [FILE]: text });
  assert.deepEqual(written(valid.memory), [FILE]);
  assert.equal(valid.memory.texts.get(FILE), text);
});

const LINKED = '    - 出處：國二上 2-1\n';
for (const [name, text, included] of [
  ['範圍內的草稿', head('2-1', '狀態: 草稿\n') + goal('a'), true],
  ['範圍內的暫停', head('2-1', '狀態: 暫停\n') + goal('a'), true],
  ['範圍外', head('9-1') + goal('a'), false],
  ['範圍外、出處也在範圍外', head('9-1') + goal('a', '    - 出處：國二上 8-1\n'), false],
  ['出處連到範圍，草稿', head('9-1', '狀態: 草稿\n') + goal('a', LINKED), true],
  ['出處連到範圍，暫停', head('9-1', '狀態: 暫停\n') + goal('a', LINKED), true],
  ['出處連到範圍，需要新版', head('9-1', '需要版本: 99.0.0\n') + goal('a', LINKED), true],
  ['出處連到範圍，沒有 ID', head('9-1') + `- 目標\n${LINKED}    - 問 :: 答\n`, true],
  ['出處連到範圍，ID 在同一篇重複', head('9-1') + goal('a', LINKED) + goal('a'), true],
  ['出處連到範圍，啟用篇裡暫停的目標', head('9-1') + goal('a', LINKED + '    - 狀態：暫停\n'), true],
  ['轉錄稿', head('2-1', '來源類型: 課堂錄音\n') + goal('a'), false],
] as const) void test('25 哪幾篇：' + name, async t => {
  const { memory } = await launch(t, { [SCOPE]: scope(), [ENGLISH]: ENGLISH_TEXT, [OUTSIDE]: text });
  assert.deepEqual(rows(memory).slice(1).map(row => row.path), included ? [OUTSIDE, ENGLISH].sort() : [ENGLISH]);
});

void test('26 有讀不到的卡組不寫，補齊後寫，內容相同也寫', async t => {
  const h = await launch(t, VAULT, { unread: [ENGLISH] });
  assert.deepEqual(written(h.memory), []);
  h.memory.failing.delete(ENGLISH);
  await h.pump(1000);
  assert.deepEqual(written(h.memory), [FILE]);
});

void test('26 範圍檔讀不到不寫，補齊後寫', async t => {
  const h = await launch(t, VAULT, { unread: [SCOPE] });
  assert.deepEqual(written(h.memory), []);
  h.memory.failing.delete(SCOPE);
  await h.pump(1000);
  await h.pump(1000);
  assert.deepEqual(written(h.memory), [FILE]);
});

void test('26 只有紀錄檔讀不到：照寫', async t => {
  const log = 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl';
  const { memory } = await launch(t, { ...VAULT, [log]: '{}\n' }, { unread: [log] });
  assert.deepEqual(written(memory), [FILE]);
});

void test('26 開著跨過清晨 4 點：下一次 today() 後寫出', async t => {
  const h = await launch(t, VAULT, { now: at('2026-10-28T03:59:00.000') });
  assert.deepEqual(written(h.memory), []);
  h.setNow(at('2026-10-28T04:00:00.000'));
  h.state.today();
  await h.pump(0);
  assert.deepEqual(written(h.memory), [FILE]);
  assert.equal(rows(h.memory)[0].t, '2026-10-28T04:00:00.000+08:00');
});

void test('26 範圍檔還在讀時不寫：另一份提前結束的副本還沒讀到', async t => {
  const h = await launch(t, VAULT, { now: at('2026-10-28T03:59:00.000') });
  h.memory.write('Essence Cards/考試範圍/2026-10-28 國二上 2.md', scope('2026-10-28', '2026-10-29', '提前結束: 2026-10-28\n'));
  h.setNow(at('2026-10-28T04:00:00.000'));
  h.state.today();
  await h.pump(0);
  assert.deepEqual(written(h.memory), []);
});

/** 列切面資料夾時停住，放行前可以改東西。 */
function holdList(memory: MemoryFiles): { release: () => void; held: () => boolean } {
  const original = memory.files.list.bind(memory.files);
  let release = (): void => {}, held = false;
  memory.files.list = async folder => {
    if (folder + '/' === FOLDER) { held = true; await new Promise<void>(resolve => { release = resolve; }); }
    return original(folder);
  };
  return { release: () => { release(); }, held: () => held };
}

void test('27 等待期間跨過 04:00：這次不寫，下一次 today() 寫', async t => {
  const memory = createMemoryFiles(VAULT);
  const hold = holdList(memory);
  const h = await open(t, memory);
  assert.equal(hold.held(), true);
  h.setNow(at('2026-10-29T04:00:00.000'));
  hold.release();
  await h.pump(0);
  assert.deepEqual(written(memory), []);
  h.state.today();
  await h.pump(0);
  hold.release();
  await h.pump(0);
  assert.deepEqual(written(memory), [FILE]);
});

void test('27 等待期間範圍結束：這次不寫', async t => {
  const memory = createMemoryFiles(VAULT);
  const hold = holdList(memory);
  const h = await open(t, memory);
  memory.write(SCOPE, scope('2026-10-28', '2026-10-29', '提前結束: 2026-10-28\n'));
  await h.pump();
  hold.release();
  await h.pump(0);
  assert.deepEqual(written(memory), []);
});

void test('27 等待期間選定的範圍換了：舊的不寫，換成新的那一份', async t => {
  const memory = createMemoryFiles(VAULT);
  const hold = holdList(memory);
  const h = await open(t, memory);
  memory.write(SCOPE, scope().replace('x7f3k2', 'y9k2m4'));
  await h.pump();
  hold.release();
  await h.pump(0);
  hold.release();
  await h.pump(0);
  assert.deepEqual(written(memory), [`${FOLDER}2026-10-28 6fc089a6a4f1 PC-test.jsonl`]);
});

void test('27 同一個鍵兩個觸發同時到：只寫一份', async t => {
  const memory = createMemoryFiles(VAULT);
  const hold = holdList(memory);
  let writes = 0;
  const modify = memory.files.modify.bind(memory.files);
  memory.files.modify = (path, edit) => { if (path.startsWith(FOLDER)) writes++; return modify(path, edit); };
  const h = await open(t, memory);
  h.setNow(OPEN + 1000);
  memory.notify(NATURE);
  await h.pump();
  hold.release();
  await h.pump(0);
  hold.release();
  await h.pump(0);
  assert.equal(writes, 1);
  assert.deepEqual(written(memory), [FILE]);
});

void test('28 零篇不寫，之後有卡組再寫', async t => {
  const h = await launch(t, { [SCOPE]: scope() });
  assert.deepEqual(written(h.memory), []);
  h.memory.write(NATURE, NATURE_TEXT);
  await h.pump();
  assert.deepEqual(written(h.memory), [FILE]);
});

void test('29 改開始日：新的開始日寫第二份，第一份逐字不變', async t => {
  const h = await launch(t, VAULT);
  const before = h.memory.texts.get(FILE);
  h.memory.write(SCOPE, scope('2026-10-29', '2026-10-30'));
  h.setNow(at('2026-10-29T08:00:00.000'));
  await h.pump();
  assert.deepEqual(written(h.memory), [FILE, `${FOLDER}2026-10-29 ${KEY} PC-test.jsonl`]);
  assert.equal(h.memory.texts.get(FILE), before);
});

void test('29 只改結束日：不多一份，檔頭不變', async t => {
  const h = await launch(t, VAULT);
  const before = h.memory.texts.get(FILE);
  h.memory.write(SCOPE, scope('2026-10-28', '2026-10-31'));
  await h.pump();
  assert.deepEqual(written(h.memory), [FILE]);
  assert.equal(h.memory.texts.get(FILE), before);
});

void test('30 切面不算紀錄也不算卡組：歷史相同，裡面的 ^id 不算占用', async t => {
  assert.equal(isLogPath(FILE), false);
  assert.equal(isDeckPath(FILE), false);
  const copy = lines(header({ decks: 1 }), { path: 'Essence Cards/別篇.md', text: goal('k3m9x2') });
  const withFile = await launch(t, { ...VAULT, [FILE]: copy });
  const without = await launch(t, VAULT);
  assert.deepEqual(withFile.state.history(), without.state.history());
  assert.deepEqual(withFile.state.conflicts(), []);
  assert.equal(withFile.state.decks().length, 2);
});

void test('31 寫失敗：today() 照常，錯誤報 write，同一次執行不重試；換日再試', async t => {
  const memory = createMemoryFiles(VAULT);
  const modify = memory.files.modify.bind(memory.files);
  let writes = 0;
  memory.files.modify = (path, edit) => {
    if (!path.startsWith(FOLDER)) return modify(path, edit);
    writes++;
    return writes === 1 ? Promise.reject(Error('寫不進去')) : modify(path, edit);
  };
  const h = await open(t, memory);
  assert.equal(writes, 1);
  assert.deepEqual(h.errors.map(([, source]) => source), ['write']);
  h.state.today();
  memory.notify(NATURE);
  await h.pump();
  assert.equal(writes, 1);
  h.setNow(at('2026-10-29T08:00:00.000'));
  h.state.today();
  await h.pump(0);
  assert.equal(writes, 2);
  assert.deepEqual(written(memory), [FILE]);
});
