import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state/index.ts';
import type { State } from '../src/state/index.ts';
import { createSettingsStore } from '../src/core/settings/index.ts';
import type { SemesterPick, SettingsValue } from '../src/core/settings/index.ts';
import { entryView, examSubject } from '../src/review/entry.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// 設定接上 state（tasks/settings-page.md §3、§7）：真正的 createState，假的 Files。

const DELAY = 30;
const OFFSET = 480;
const at = (text: string): number => Date.parse(text + '+08:00');
const NOON = at('2026-11-09T12:00:00');
const tick = async (t: TestContext, ms = DELAY): Promise<void> => {
  t.mock.timers.tick(ms);
  for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve));
};
const ids = (n: number, prefix = 'a'): string[] => Array.from({ length: n }, (_, i) => prefix + String(i).padStart(4, '0'));
const deck = (term: string, subject: string, code: string, list: string[]): string =>
  `---\n年級學期: ${term}\n科目: ${subject}\n單元: "${code}"\n---\n` + list.map(id => `- 目標 ${id} ^${id}\n    - 問 ${id} :: 答 ${id}\n`).join('');
const FORTY = { 'Essence Cards/英文 L1.md': deck('國二上', '英文', 'L1', ids(40)) };
const value = (capMinutes = 30, retention = 0.8, more: Partial<SettingsValue> = {}): SettingsValue => ({ settings: { capMinutes, retention, filter: [] }, semester: null, examCountdown: true, known: true, ...more });
const pick = (text: string, setOn: string): SemesterPick => ({ value: text, setOn });
const LOG = 'Essence Cards/紀錄/2026-11 PC-test.jsonl';
const answer = (when: string, lt: string): string => `{"t":"${when}+08:00","lt":"${lt}","r":"good","v":"a1b2c3d4"}\n`;

interface Harness { state: State; memory: MemoryFiles; changes: () => number; setNow: (ms: number) => void }
const mocked = new WeakSet<TestContext>();
function make(t: TestContext, initial: Record<string, string>, options: { first?: Promise<SettingsValue>; now?: number } = {}): Harness {
  if (!mocked.has(t)) t.mock.timers.enable({ apis: ['setTimeout'] });
  mocked.add(t);
  const memory = createMemoryFiles(initial);
  let clock = options.now ?? NOON, changes = 0;
  const state = createState({ files: memory.files, device: 'PC-test', delay: DELAY, fillIds: true, now: () => clock, offset: () => OFFSET, settingsFirst: options.first, random: () => 0 });
  t.after(() => state.close());
  state.onChange(() => { changes++; });
  return { state, memory, changes: () => changes, setNow: ms => { clock = ms; } };
}
async function ready(t: TestContext, harness: Harness): Promise<void> {
  const loaded = harness.state.ready();
  for (let i = 0; i < 6; i++) await tick(t, 0);
  await tick(t, 2000);
  await loaded;
}

void test('settingsFirst：第一次排今天的份就用它，只排一次', async t => {
  const h = make(t, FORTY, { first: Promise.resolve(value(5)) });
  await ready(t, h);
  assert.equal(h.state.today().share.length, 20, '5 分鐘放得下 20 張（每張 15 秒）');
  assert.equal(h.changes(), 0);
  assert.equal(h.state.currentSettings().known, true);
});

void test('沒傳 settingsFirst：照 settings 或預設，known 是 true', async t => {
  const h = make(t, FORTY);
  await ready(t, h);
  assert.equal(h.state.today().share.length, 40);
  assert.equal(h.state.currentSettings().settings.capMinutes, 30);
  assert.equal(h.state.currentSettings().known, true);
});

void test('store 的第一次讀 3 秒才回來：ready 在 2 秒多完成、用預設值；回來後重排一次', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  mocked.add(t);
  let answer: (content: unknown) => void = () => {};
  const store = createSettingsStore({ load: () => new Promise(resolve => { answer = resolve; }), save: () => Promise.resolve(), today: () => '2026-11-09' });
  const h = make(t, FORTY, { first: store.first() });
  store.onChange(next => { h.state.applySettings(next); });
  await ready(t, h);
  assert.equal(h.state.currentSettings().known, false);
  assert.equal(h.state.today().share.length, 40);
  assert.equal(h.changes(), 0);
  answer({ capMinutes: 5 });
  await tick(t, 0);
  assert.equal(h.state.currentSettings().known, true);
  assert.equal(h.state.today().share.length, 20);
  assert.equal(h.changes(), 1);
});

void test('settingsFirst 交出 known 是 false 的預設值：之後讀到才重排一次', async t => {
  const h = make(t, FORTY, { first: Promise.resolve(value(30, 0.8, { known: false })) });
  await ready(t, h);
  assert.equal(h.state.today().share.length, 40);
  assert.equal(h.state.currentSettings().known, false);
  h.state.applySettings(value(5));
  assert.equal(h.changes(), 1);
  assert.equal(h.state.today().share.length, 20);
  assert.equal(h.state.currentSettings().known, true);
});

void test('改上限：重排一次，份跟著變，調回來回到原本的份', async t => {
  const h = make(t, FORTY);
  await ready(t, h);
  const before = h.state.today().share.map(item => item.lt);
  h.state.applySettings(value(5));
  assert.equal(h.changes(), 1);
  assert.equal(h.state.today().share.length, 20);
  h.state.applySettings(value(30));
  assert.equal(h.changes(), 2);
  assert.deepEqual(h.state.today().share.map(item => item.lt), before);
});

void test('調低上限：答過的不重出、作答還在；完成數算新的份裡的', async t => {
  const list = ids(40);
  const first = make(t, { ...FORTY, [LOG]: answer('2026-11-09T11:00:00.000', list[0]) });
  await ready(t, first);
  assert.deepEqual([first.state.progress().done, first.state.progress().total], [1, 40]);
  first.state.applySettings(value(5));
  assert.deepEqual([first.state.progress().done, first.state.progress().total], [1, 20]);

  const late = make(t, { ...FORTY, [LOG]: answer('2026-11-09T11:00:00.000', list[25]) });
  await ready(t, late);
  assert.deepEqual([late.state.progress().done, late.state.progress().total], [1, 40]);
  late.state.applySettings(value(5));
  assert.deepEqual([late.state.progress().done, late.state.progress().total], [0, 20]);
  assert.equal(late.state.history().reviews.length, 1);
  const shown = late.state.next({ subject: '英文' });
  assert.ok(shown.kind === 'card');
  assert.notEqual(shown.card.lt, list[25], '不重出');
  late.state.applySettings(value(30));
  assert.deepEqual([late.state.progress().done, late.state.progress().total], [1, 40]);
});

void test('手上的卡移出份內：那一張照樣可以記作答，下一張照新的份', async t => {
  const h = make(t, FORTY);
  await ready(t, h);
  const list = ids(40);
  h.state.applySettings(value(5));
  assert.ok(!h.state.today().share.some(item => item.lt === list[30]));
  assert.notEqual(h.state.answer({ lt: list[30], r: 'good', v: 'a1b2c3d4' }), null);
  const next = h.state.next({ subject: '英文' });
  assert.ok(next.kind === 'card');
  assert.ok(h.state.today().share.some(item => item.lt === next.card.lt));
});

void test('調高保持率：到期日變早', async t => {
  // 3 天前答對：FSRS 的穩定度約 2～3 天，80% 還沒到期（間隔 > 3 天），95% 已經到期（間隔約 1 天）。
  const h = make(t, { 'Essence Cards/英文 L1.md': deck('國二上', '英文', 'L1', ['a0000']), [LOG]: answer('2026-11-06T12:00:00.000', 'a0000') });
  await ready(t, h);
  assert.equal(h.state.today().share.length, 0);
  h.state.applySettings(value(30, 0.95));
  assert.equal(h.state.today().share.length, 1);
});

void test('值完全相同：不重排、不通知、不寫', async t => {
  const h = make(t, FORTY, { first: Promise.resolve(value(30)) });
  await ready(t, h);
  const today = h.state.today();
  const log = h.memory.texts.get(LOG);
  for (let i = 0; i < 10; i++) h.state.applySettings(value(30));
  assert.equal(h.state.today(), today);
  assert.equal(h.changes(), 0);
  assert.equal(h.memory.texts.get(LOG), log);
});

void test('只有學期或考試倒數變：通知一次，不重排', async t => {
  const h = make(t, FORTY);
  await ready(t, h);
  const today = h.state.today();
  h.state.applySettings(value(30, 0.8, { semester: pick('國二上', '2026-09-15') }));
  assert.equal(h.changes(), 1);
  assert.equal(h.state.today(), today);
  h.state.applySettings(value(30, 0.8, { semester: pick('國二上', '2026-09-15'), examCountdown: false }));
  assert.equal(h.changes(), 2);
  assert.equal(h.state.today(), today);
  assert.equal(h.state.currentSettings().examCountdown, false);
});

void test('known 由 false 變 true、值相同：不重排也不通知', async t => {
  const h = make(t, FORTY, { first: Promise.resolve(value(30, 0.8, { known: false })) });
  await ready(t, h);
  const today = h.state.today();
  h.state.applySettings(value(30));
  assert.equal(h.state.today(), today);
  assert.equal(h.changes(), 0);
  assert.equal(h.state.currentSettings().known, true);
});

void test('ready 之前呼叫 applySettings：第一次排程用它，較晚完成的 settingsFirst 不蓋掉', async t => {
  let finish!: (value: SettingsValue) => void;
  const first = new Promise<SettingsValue>(resolve => { finish = resolve; });
  const h = make(t, FORTY, { first });
  h.state.applySettings(value(5));
  finish(value(30, 0.8, { known: false }));
  await ready(t, h);
  assert.equal(h.state.today().share.length, 20);
  assert.equal(h.changes(), 0);
  assert.equal(h.state.currentSettings().known, true);
});

void test('close 之後不通知、不改值', async t => {
  const h = make(t, FORTY);
  await ready(t, h);
  await h.state.close();
  h.state.applySettings(value(5));
  assert.equal(h.changes(), 0);
  assert.equal(h.state.currentSettings().settings.capMinutes, 30);
});

void test('同一時段換日與設定變動：最後的份同時用新的日子與新的設定', async t => {
  const h = make(t, FORTY);
  await ready(t, h);
  h.setNow(at('2026-11-10T04:00:00'));
  h.state.applySettings(value(5));
  const today = h.state.today();
  assert.equal(today.share.length, 20);
  assert.equal(h.state.input().settings.capMinutes, 5);
  assert.equal(today.day, Math.floor((at('2026-11-10T04:00:00') + OFFSET * 60_000 - 4 * 3_600_000) / 86_400_000));
});

void test('目前學期：照 state 的時鐘算，清晨 4 點換', async t => {
  const h = make(t, FORTY, { now: at('2027-02-01T03:59:00'), first: Promise.resolve(value(30, 0.8, { semester: pick('國二上', '2026-09-15') })) });
  await ready(t, h);
  assert.equal(h.state.currentSettings().semester, '國二上');
  h.setNow(at('2027-02-01T04:00:00'));
  assert.equal(h.state.currentSettings().semester, '國二下');
  h.state.applySettings(value(30, 0.8, { semester: pick('國二下', '2027-03-01') }));
  h.setNow(at('2027-08-01T03:59:00'));
  assert.equal(h.state.currentSettings().semester, '國二下');
  h.setNow(at('2027-08-01T04:00:00'));
  assert.equal(h.state.currentSettings().semester, '國三上');
  h.state.applySettings(value(30, 0.8));
  assert.equal(h.state.currentSettings().semester, null);
});

void test('目錄預設展開目前學期；沒有卡組或沒設定照舊是最新的；不影響排程', async t => {
  const files = { 'Essence Cards/a.md': deck('國二上', '英文', 'L1', ['a0000']), 'Essence Cards/b.md': deck('國二下', '英文', 'L2', ['b0000']) };
  const h = make(t, files);
  await ready(t, h);
  assert.equal(h.state.catalog().latest, '國二下');
  const today = h.state.today();
  h.state.applySettings(value(30, 0.8, { semester: pick('國二上', '2026-09-15') }));
  assert.equal(h.state.catalog().latest, '國二上');
  assert.equal(h.state.examCatalog()?.latest, '國二上');
  assert.equal(h.state.today(), today);
  h.state.applySettings(value(30, 0.8, { semester: pick('高一上', '2026-09-15') }));
  assert.equal(h.state.catalog().latest, '國二下', '目前學期沒有卡組');
});

void test('目錄：卡組寫別名時，交出去的是群組的原字', async t => {
  const h = make(t, { 'Essence Cards/a.md': deck('八上', '英文', 'L1', ['a0000']), 'Essence Cards/b.md': deck('國二下', '英文', 'L2', ['b0000']) });
  await ready(t, h);
  h.state.applySettings(value(30, 0.8, { semester: pick('國二上', '2026-09-15') }));
  assert.equal(h.state.catalog().latest, '八上');
  assert.equal(h.state.examCatalog()?.latest, '八上');
});

void test('考試倒數關掉：入口的倒數不見，目錄的倒數與排程不變；打開就回來', async t => {
  const scope = `---\n識別碼: x7f3k2\n考試開始: 2026-11-20\n考試結束: 2026-11-21\n---\n- 國二上 英文 L1\n`;
  const h = make(t, { ...FORTY, 'Essence Cards/考試範圍/2026-11-20 國二上.md': scope });
  await ready(t, h);
  const counts = (): unknown[] => { const view = entryView(h.state); return view.kind === 'ready' ? view.rows.map(row => row.countdown) : []; };
  assert.deepEqual(counts(), [11]);
  const before = h.state.today();
  h.state.applySettings(value(30, 0.8, { examCountdown: false }));
  assert.deepEqual(counts(), [null]);
  assert.equal(examSubject(h.state, '國二上', '英文'), '距離考試：11 天（11/20）');
  assert.equal(h.state.today(), before);
  h.state.applySettings(value());
  assert.deepEqual(counts(), [11]);
});
