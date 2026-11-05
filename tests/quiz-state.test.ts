import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state/index.ts';
import type { QuizResolved, State, StateOptions } from '../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// 小考檔接上 state（tasks/quiz-mark.md §1、§5）：真正的 createState，假的 Files。清晨 4 點的邊界用非零時區（UTC+8）測。

const FOLDER = 'Essence Cards/考試範圍/小考/';
const EXAM = 'Essence Cards/考試範圍/2026-11-20 國二上.md';
const WORDS = 'Essence Cards/學業/國二上英文 L3 單字.md', GRAMMAR = 'Essence Cards/學業/國二上英文 L3 文法.md', NATURE = 'Essence Cards/學業/自然 2-1.md';
const at = (text: string): number => Date.parse(text + '+08:00');
const NOON = at('2026-11-05T12:00:00');
const head = (term: string, subject: string, unit: string, extra = ''): string => `---\n年級學期: ${term}\n科目: ${subject}\n單元: "${unit}"\n${extra}---\n`;
const targets = (...ids: string[]): string => ids.map(id => `- 目標 ${id} ^${id}\n    - ${id} 的題目 :: 答\n`).join('');
const DECKS: Record<string, string> = {
  [WORDS]: head('國二上', '英文', 'L3 Vocabulary') + targets('w1', 'w2', 'w3'),
  [GRAMMAR]: head('國二上', '英文', 'L3 Vocabulary') + targets('g1'),
  [NATURE]: head('國二上', '自然', '2-1') + targets('n1'),
};
const L3 = { unit: { term: '國二上', subject: '英文', code: 'L3' } };
const quizText = (date: string, line = '- 國二上 英文 L3', id = 'q4m8t2', extra = ''): string => `---\n識別碼: ${id}\n小考日期: ${date}\n${extra}---\n${line}\n`;
const link = (path: string): string => `- [[${path.replace(/\.md$/, '')}]]`;

interface Harness { state: State; memory: MemoryFiles; changed: () => number; errors: unknown[]; setNow: (ms: number) => void }
async function make(t: TestContext, initial: Record<string, string>, more: Partial<StateOptions> = {}, now = NOON): Promise<Harness> {
  const memory = createMemoryFiles({ ...DECKS, ...initial });
  let clock = now, changes = 0;
  const errors: unknown[] = [];
  const state = createState({ files: memory.files, device: 'PC-test', delay: 1, fillIds: true, now: () => clock, offset: () => 480, onError: error => { errors.push(error); }, random: () => 0, ...more });
  t.after(() => state.close());
  state.onChange(() => { changes++; });
  await state.ready();
  return { state, memory, errors, changed: () => changes, setNow(ms) { clock = ms; } };
}
/** 等檔案通知讀完（delay 是 1 毫秒的真計時器）。 */
const settled = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 30); });
const dates = (state: State): (string | null)[] => state.quizzes().map(row => row.date);

// ── 生效與到期 ──

void test('§1 生效到小考日期隔天清晨 4 點：03:59:59.999 還在、04:00 消失，不寫檔，檔案留著', async t => {
  const original = quizText('2026-11-05');
  const h = await make(t, { [FOLDER + '2026-11-05 小考.md']: original }, {}, at('2026-11-04T23:00:00'));
  assert.deepEqual(dates(h.state), ['2026-11-05'], '小考日前已顯示');
  h.setNow(at('2026-11-05T12:00:00'));
  assert.deepEqual(dates(h.state), ['2026-11-05'], '當天');
  h.setNow(at('2026-11-06T03:59:59.999'));
  assert.deepEqual(dates(h.state), ['2026-11-05'], '隔天 03:59:59.999');
  h.setNow(at('2026-11-06T04:00:00'));
  assert.deepEqual(dates(h.state), [], '隔天 04:00');
  assert.equal(h.memory.texts.get(FOLDER + '2026-11-05 小考.md'), original, '檔案一個字都沒變');
  assert.deepEqual(h.errors, []);
});

void test('§1 同一個識別碼 11/5 與 11/7 兩份：11/6 清晨 4 點還是待修正，不換成 11/7', async t => {
  const h = await make(t, { [FOLDER + 'a.md']: quizText('2026-11-05'), [FOLDER + 'b.md']: quizText('2026-11-07') }, {}, at('2026-11-06T04:00:00'));
  assert.deepEqual(h.state.quizzes().map(row => row.problem), ['copies']);
});

void test('§1 別台裝置改的、晚到的副本：讀到就跟著變，只通知畫面', async t => {
  const h = await make(t, {});
  assert.deepEqual(h.state.quizzes(), []);
  const today = h.state.today();
  const before = h.changed();
  h.memory.write(FOLDER + '2026-11-05 小考.md', quizText('2026-11-05'));
  await settled();
  assert.deepEqual(dates(h.state), ['2026-11-05']);
  assert.ok(h.changed() > before, '畫面收到通知');
  assert.equal(h.state.today(), today, '不重排今天的份');
  // 取消的那一份先到、舊副本晚到：還是取消（格式查核第 4 點）。
  h.memory.write(FOLDER + '2026-11-05 小考.md', quizText('2026-11-05', undefined, undefined, '取消: 2026-11-05\n'));
  await settled();
  assert.deepEqual(h.state.quizzes(), []);
  h.memory.write(FOLDER + '2026-11-05 小考 2.md', quizText('2026-11-05'));
  await settled();
  assert.deepEqual(h.state.quizzes(), []);
});

void test('§1 刪掉小考檔：那一列跟著消失', async t => {
  const h = await make(t, { [FOLDER + 'a.md']: quizText('2026-11-05') });
  assert.equal(h.state.quizzes().length, 1);
  h.memory.remove(FOLDER + 'a.md');
  await settled();
  assert.deepEqual(h.state.quizzes(), []);
});

// ── §5 不改的 ──

void test('§5 小考不改排程；段考不讀小考檔，小考不讀段考的；兩邊同時生效各算各的', async t => {
  const exam = '---\n識別碼: x7f3k2\n考試開始: 2026-11-20\n---\n- 國二上 自然 2-1\n';
  const plain = await make(t, { [EXAM]: exam });
  const withQuiz = await make(t, { [EXAM]: exam, [FOLDER + 'a.md']: quizText('2026-11-06') });
  const share = (state: State): unknown => state.today().share.map(item => [item.lt, item.lane]);
  assert.deepEqual(share(withQuiz.state), share(plain.state), '今天的份一模一樣');
  assert.equal(withQuiz.state.exam().path, EXAM);
  assert.deepEqual(withQuiz.state.quizzes().map(row => row.subject), ['英文']);
  assert.deepEqual(plain.state.quizzes(), []);
  assert.deepEqual(withQuiz.state.scope({ unit: withQuiz.state.quizzes()[0].refs.flatMap(ref => 'unit' in ref ? [ref.unit] : [])[0], since: 0 })?.total, 4, '全部卡只算那個單元');
});

// ── 設定 ──

void test('§1 設定：建新檔、檔名是小考日期加小考、識別碼 6 碼第一個是字母；立刻看得到、只通知一次，不寫紀錄', async t => {
  const h = await make(t, {});
  const before = h.changed();
  assert.deepEqual(await h.state.setQuiz(L3, '2026-11-07', null), { kind: 'done' });
  assert.equal(h.changed(), before + 1);
  const text = h.memory.texts.get(FOLDER + '2026-11-07 小考.md') ?? '';
  assert.match(text, /^---\n識別碼: [a-z][a-z0-9]{5}\n小考日期: 2026-11-07\n---\n- 國二上 英文 L3\n$/);
  assert.deepEqual(dates(h.state), ['2026-11-07']);
  await h.state.flush();
  const logs = [...h.memory.texts].filter(([path]) => path.endsWith('.jsonl')).map(([, each]) => each).join('');
  assert.doesNotMatch(logs, /quiz|小考/, '不寫 set: quiz');
});

void test('§1 設定單篇：內文是完整路徑的連結', async t => {
  const h = await make(t, {}, { resolveLink: link => link + '.md' === WORDS ? { kind: 'file', path: WORDS } : { kind: 'none' } });
  assert.deepEqual(await h.state.setQuiz({ deck: WORDS }, '2026-11-06', null), { kind: 'done' });
  assert.match(h.memory.texts.get(FOLDER + '2026-11-06 小考.md') ?? '', /\n- \[\[Essence Cards\/學業\/國二上英文 L3 單字\]\]\n$/);
  const [row] = h.state.quizzes();
  assert.deepEqual(row.refs, [{ deck: WORDS }]);
  assert.equal(row.count, 3);
  assert.equal(h.state.scope({ deck: WORDS, since: 0 })?.total, 3, '全部卡只算那一篇');
});

void test('§1 撞名：原名與 2 都有了就用 3，已有的檔（含空檔）一個字都不動', async t => {
  const other = '別人寫的\n';
  const h = await make(t, { [FOLDER + '2026-11-07 小考.md']: '', [FOLDER + '2026-11-07 小考 2.md']: other });
  assert.deepEqual(await h.state.setQuiz(L3, '2026-11-07', null), { kind: 'done' });
  assert.equal(h.memory.texts.get(FOLDER + '2026-11-07 小考.md'), '', '空檔不動');
  assert.equal(h.memory.texts.get(FOLDER + '2026-11-07 小考 2.md'), other);
  assert.match(h.memory.texts.get(FOLDER + '2026-11-07 小考 3.md') ?? '', /小考日期: 2026-11-07/);
});

void test('§1 零位元組的檔和不存在分得出來：Obsidian 的 modify 兩種都交空字串', async t => {
  const h = await make(t, { [FOLDER + '2026-11-07 小考.md']: '' });
  await h.state.setQuiz(L3, '2026-11-07', null);
  assert.deepEqual([...h.memory.texts.keys()].filter(path => path.startsWith(FOLDER)).sort(), [FOLDER + '2026-11-07 小考 2.md', FOLDER + '2026-11-07 小考.md']);
});

void test('L2 R2 寫之前才出現的空檔（別台裝置、別的編輯器）也不蓋掉，換下一個後綴', async t => {
  const memory = createMemoryFiles({ ...DECKS });
  const target = FOLDER + '2026-11-07 小考.md';
  // 外掛決定寫哪裡之後、真的寫之前，那個路徑多了一個零位元組的檔（不送通知：state 還不知道）。
  const files = { ...memory.files, modify(path: string, edit: (text: string, exists: boolean) => string) { if (path === target && !memory.texts.has(path)) memory.texts.set(path, ''); return memory.files.modify(path, edit); } };
  const state = createState({ files, device: 'PC-test', delay: 1, fillIds: false, now: () => NOON, offset: () => 480, onError() {}, random: () => 0 });
  t.after(() => state.close());
  await state.ready();
  assert.deepEqual(await state.setQuiz(L3, '2026-11-07', null), { kind: 'done' });
  assert.equal(memory.texts.get(target), '', '空檔不動');
  assert.match(memory.texts.get(FOLDER + '2026-11-07 小考 2.md') ?? '', /小考日期: 2026-11-07/);
});

void test('§1 撞名的檔讀不到（iCloud 佔位檔）：不知道是什麼，不蓋掉', async t => {
  const h = await make(t, {});
  h.memory.failing.add(FOLDER + '2026-11-07 小考.md');
  h.memory.texts.set(FOLDER + '2026-11-07 小考.md', '別人的');
  // 建檔不先讀，在不在交給 modify 判斷（L2 R2）：記憶體的 modify 讀得到內容，所以換下一個後綴；真的 Obsidian 讀不到時 modify 失敗，一樣不蓋掉。
  const result = await h.state.setQuiz(L3, '2026-11-07', null);
  assert.equal(result.kind, 'done');
  assert.equal(h.memory.texts.get(FOLDER + '2026-11-07 小考.md'), '別人的');
  assert.match(h.memory.texts.get(FOLDER + '2026-11-07 小考 2.md') ?? '', /小考日期: 2026-11-07/);
});

void test('§1 取消後再設：建新檔、新的識別碼；舊檔留著', async t => {
  let seed = 0;
  const h = await make(t, {}, { random: () => (seed += 0.137) % 1 });
  await h.state.setQuiz(L3, '2026-11-07', null);
  const first = h.state.quizzes()[0];
  await h.state.cancelQuiz(first);
  assert.deepEqual(h.state.quizzes(), []);
  await h.state.setQuiz(L3, '2026-11-07', null);
  const second = h.state.quizzes()[0];
  assert.notEqual(second.id, first.id);
  assert.deepEqual(second.paths, [FOLDER + '2026-11-07 小考 2.md']);
  assert.match(h.memory.texts.get(FOLDER + '2026-11-07 小考.md') ?? '', /取消: 2026-11-05/);
});

void test('§1 打開畫面之後別台裝置已經設了同一個目標：不再建一份，請畫面重看', async t => {
  const h = await make(t, {});
  h.memory.texts.set(FOLDER + 'a.md', quizText('2026-11-06'));
  h.memory.notify(FOLDER + 'a.md');
  assert.deepEqual(await h.state.setQuiz(L3, '2026-11-07', null), { kind: 'blocked', reason: 'changed' });
  assert.equal(h.memory.texts.has(FOLDER + '2026-11-07 小考.md'), false);
});

void test('§1 寫不出來的目標：檔名有連結不能用的字、連結解析不回那一篇', async t => {
  const h = await make(t, {}, { resolveLink: () => ({ kind: 'several' }) });
  assert.deepEqual(await h.state.setQuiz({ deck: 'Essence Cards/a|b.md' }, '2026-11-07', null), { kind: 'blocked', reason: 'special' });
  assert.deepEqual(await h.state.setQuiz({ deck: WORDS }, '2026-11-07', null), { kind: 'blocked', reason: 'special' });
  assert.deepEqual([...h.memory.texts.keys()].filter(path => path.startsWith(FOLDER)), []);
});

// ── 改日期與取消 ──

void test('§1 改日期：只改那一行，檔名不變，以屬性為準', async t => {
  const original = '---\r\n# 老師說的\r\n識別碼: q4m8t2\r\n小考日期: "2026-11-05" # 第三節\r\n---\r\n- 國二上 英文 L3\r\n';
  const h = await make(t, { [FOLDER + '2026-11-05 小考.md']: original });
  const [row] = h.state.quizzes();
  assert.deepEqual(await h.state.setQuiz(L3, '2026-11-07', row), { kind: 'done' });
  assert.equal(h.memory.texts.get(FOLDER + '2026-11-05 小考.md'), original.replace('2026-11-05" #', '2026-11-07" #'));
  assert.deepEqual(dates(h.state), ['2026-11-07']);
});

void test('§1 改日期改每一份副本：只改一份會變成兩份不一樣', async t => {
  const h = await make(t, { [FOLDER + 'a.md']: quizText('2026-11-05'), [FOLDER + 'a 2.md']: quizText('2026-11-05') });
  const [row] = h.state.quizzes();
  assert.deepEqual(await h.state.setQuiz(L3, '2026-11-07', row), { kind: 'done' });
  assert.equal(h.memory.texts.get(FOLDER + 'a.md'), quizText('2026-11-07'));
  assert.equal(h.memory.texts.get(FOLDER + 'a 2.md'), quizText('2026-11-07'));
  assert.deepEqual(h.state.quizzes().map(each => [each.problem, each.date]), [[null, '2026-11-07']]);
});

void test('§1 改日期：打開畫面之後才同步來的副本也一起改', async t => {
  const h = await make(t, { [FOLDER + 'a.md']: quizText('2026-11-05') });
  const [row] = h.state.quizzes();
  h.memory.write(FOLDER + 'a 2.md', quizText('2026-11-05'));
  assert.deepEqual(await h.state.setQuiz(L3, '2026-11-07', row), { kind: 'done' });
  assert.equal(h.memory.texts.get(FOLDER + 'a 2.md'), quizText('2026-11-07'));
});

void test('§1 手寫沒有識別碼：第一次寫入補上；各自是一份小考', async t => {
  const original = '---\n小考日期: 2026-11-05\n---\n- 國二上 英文 L3\n';
  const h = await make(t, { [FOLDER + 'a.md']: original });
  const [row] = h.state.quizzes();
  assert.equal(row.id, null);
  assert.deepEqual(await h.state.setQuiz(L3, '2026-11-07', row), { kind: 'done' });
  assert.match(h.memory.texts.get(FOLDER + 'a.md') ?? '', /^---\n識別碼: [a-z][a-z0-9]{5}\n小考日期: 2026-11-07\n---\n/);
});

void test('§1 取消：多一行 取消，檔案留著；03:59 與 04:00 寫不同的學習日', async t => {
  for (const [now, day] of [[at('2026-11-06T03:59:00'), '2026-11-05'], [at('2026-11-06T04:00:00'), '2026-11-06']] as const) {
    const original = quizText('2026-11-07');
    const h = await make(t, { [FOLDER + 'a.md']: original }, {}, now);
    assert.deepEqual(await h.state.cancelQuiz(h.state.quizzes()[0]), { kind: 'done' });
    assert.equal(h.memory.texts.get(FOLDER + 'a.md'), quizText('2026-11-07', undefined, undefined, `取消: ${day}\n`));
    assert.deepEqual(h.state.quizzes(), [], '立刻生效');
  }
});

void test('§1 取消一份，不同識別碼的另一份接手', async t => {
  const h = await make(t, { [FOLDER + 'a.md']: quizText('2026-11-05', undefined, 'aaaaa1'), [FOLDER + 'b.md']: quizText('2026-11-07', undefined, 'aaaaa2') });
  assert.deepEqual(dates(h.state), ['2026-11-05']);
  await h.state.cancelQuiz(h.state.quizzes()[0]);
  assert.deepEqual(dates(h.state), ['2026-11-07']);
});

void test('§1 擋下來不寫：屬性區壞掉、同一個路徑換成另一個識別碼、檔不見、已經取消', async t => {
  const h = await make(t, { [FOLDER + 'a.md']: quizText('2026-11-05') });
  const [row] = h.state.quizzes();
  // 別台裝置改了、state 還沒讀到（回呼裡拿到的才是最新的）。
  const set = (text: string): void => { h.memory.texts.set(FOLDER + 'a.md', text); };
  const broken = '---\n識別碼: q4m8t2\n小考日期: [2026\n---\n- 國二上 英文 L3\n';
  set(broken);
  assert.deepEqual(await h.state.setQuiz(L3, '2026-11-07', row), { kind: 'blocked', reason: 'broken' });
  assert.equal(h.memory.texts.get(FOLDER + 'a.md'), broken);
  const other = quizText('2026-11-05', undefined, 'zzzzz9');
  set(other);
  assert.deepEqual(await h.state.setQuiz(L3, '2026-11-07', row), { kind: 'blocked', reason: 'changed' });
  assert.deepEqual(await h.state.cancelQuiz(row), { kind: 'blocked', reason: 'changed' });
  assert.equal(h.memory.texts.get(FOLDER + 'a.md'), other);
  const cancelled = quizText('2026-11-05', undefined, undefined, '取消: 2026-11-04\n');
  set(cancelled);
  assert.deepEqual(await h.state.setQuiz(L3, '2026-11-07', row), { kind: 'blocked', reason: 'changed' });
  assert.equal(h.memory.texts.get(FOLDER + 'a.md'), cancelled);
});

void test('§1 那一份已經不在：不重建', async t => {
  const h = await make(t, { [FOLDER + 'a.md']: quizText('2026-11-05') });
  const [row] = h.state.quizzes();
  h.memory.remove(FOLDER + 'a.md');
  await settled();
  assert.deepEqual(await h.state.setQuiz(L3, '2026-11-07', row), { kind: 'blocked', reason: 'changed' });
  assert.deepEqual(await h.state.cancelQuiz(row), { kind: 'blocked', reason: 'changed' });
  assert.equal(h.memory.texts.has(FOLDER + 'a.md'), false);
});

void test('§1 寫不進去：回報失敗，不丟錯', async t => {
  const h = await make(t, { [FOLDER + 'a.md']: quizText('2026-11-05') });
  h.memory.control.failModify = true;
  const result = await h.state.setQuiz(L3, '2026-11-07', h.state.quizzes()[0]);
  assert.equal(result.kind, 'failed');
  assert.deepEqual(dates(h.state), ['2026-11-05'], '畫面照原本的');
});

void test('§1 小考檔讀不到：不擋卡組與段考；寫入要等，列進提醒', async t => {
  const memory = { [FOLDER + 'a.md']: quizText('2026-11-05') };
  const h = await make(t, memory);
  h.memory.failing.add(FOLDER + 'b.md');
  h.memory.write(FOLDER + 'b.md', quizText('2026-11-05', undefined, 'bbbbb2'));
  await settled();
  assert.deepEqual(h.state.unread(), [FOLDER + 'b.md']);
  assert.deepEqual(await h.state.setQuiz(L3, '2026-11-07', h.state.quizzes()[0]), { kind: 'blocked', reason: 'unread' });
  assert.equal(h.memory.texts.get(FOLDER + 'a.md'), memory[FOLDER + 'a.md']);
  assert.ok(h.state.today(), '今天的份照常');
  h.memory.failing.clear();
});

void test('§1 關閉之後不寫；排隊中的寫入等它寫完才算關好', async t => {
  const h = await make(t, {});
  const going = h.state.setQuiz(L3, '2026-11-07', null);
  await h.state.close();
  await going;
  assert.deepEqual(await h.state.setQuiz(L3, '2026-11-08', null), { kind: 'blocked', reason: 'closed' });
  assert.equal(h.memory.texts.has(FOLDER + '2026-11-08 小考.md'), false);
});

void test('§1 還沒 ready：quizzes 是空的，寫入回 loading', async t => {
  const memory = createMemoryFiles({ ...DECKS, [FOLDER + 'a.md']: quizText('2026-11-05') });
  const state = createState({ files: memory.files, device: 'PC-test', delay: 1, fillIds: true, now: () => NOON, offset: () => 480 });
  t.after(() => state.close());
  assert.deepEqual(state.quizzes(), []);
  assert.deepEqual(await state.setQuiz(L3, '2026-11-07', null), { kind: 'blocked', reason: 'loading' });
  await state.ready();
  assert.deepEqual(dates(state), ['2026-11-05']);
});

// ── 連結 ──

/** Obsidian 改名時自動更新連結的樣子：Obsidian 把小考檔裡的連結改掉，通知小考檔。 */
const byPath = (memory: () => MemoryFiles) => (link: string): QuizResolved => {
  const hits = [...memory().texts.keys()].filter(path => path === link + '.md' || path.endsWith('/' + link + '.md'));
  return hits.length === 1 ? { kind: 'file', path: hits[0] } : hits.length ? { kind: 'several' } : { kind: 'none' };
};

void test('§1 連結的例子：改名且連結跟著改 → 還是那一篇；沒跟著改 → 找不到，不退回單元；修好之後只練選中的那一篇', async t => {
  let memory: MemoryFiles | null = null;
  const h = await make(t, { [FOLDER + 'a.md']: quizText('2026-11-05', link(WORDS)) }, { resolveLink: byPath(() => memory as MemoryFiles) });
  memory = h.memory;
  assert.deepEqual(h.state.quizzes()[0].refs, [{ deck: WORDS }]);
  // 改名、Obsidian 沒更新連結（使用者拒絕）。
  const renamed = 'Essence Cards/學業/L3 單字（新）.md';
  h.memory.rename(WORDS, renamed);
  await settled();
  const lost = h.state.quizzes()[0];
  assert.equal(lost.problem, 'missing');
  assert.equal(lost.count, 0);
  assert.deepEqual(lost.refs, []);
  // 家長照說明修好（或 Obsidian 自動更新）：連結換成新的。
  h.memory.write(FOLDER + 'a.md', quizText('2026-11-05', link(renamed)));
  await settled();
  const fixed = h.state.quizzes()[0];
  assert.equal(fixed.problem, null);
  assert.deepEqual(fixed.refs, [{ deck: renamed }]);
  assert.equal(fixed.count, 3, '只有那一篇的三個目標，文法篇不算');
  assert.equal(h.state.scope({ deck: renamed, since: 0 })?.total, 3);
});

void test('§1 只搬資料夾、連結沒跟著改：完整路徑找不到；寫檔名的照樣找得到', async t => {
  let memory: MemoryFiles | null = null;
  const name = WORDS.slice(WORDS.lastIndexOf('/') + 1).replace(/\.md$/, '');
  const h = await make(t, { [FOLDER + 'a.md']: quizText('2026-11-05', link(WORDS), 'aaaaa1'), [FOLDER + 'b.md']: quizText('2026-11-05', `- [[${name}]]`, 'aaaaa2') }, { resolveLink: byPath(() => memory as MemoryFiles) });
  memory = h.memory;
  assert.equal(h.state.quizzes().length, 1, '兩份指向同一篇');
  h.memory.rename(WORDS, 'Essence Cards/別的/' + name + '.md');
  await settled();
  assert.deepEqual(h.state.quizzes().map(row => row.problem).sort(), [null, 'missing'].sort());
});

void test('§1 重名：認不出是哪一篇，走待修正', async t => {
  let memory: MemoryFiles | null = null;
  const h = await make(t, { [FOLDER + 'a.md']: quizText('2026-11-05', '- [[同名]]'), 'Essence Cards/甲/同名.md': targets('s1'), 'Essence Cards/乙/同名.md': targets('s2') }, { resolveLink: byPath(() => memory as MemoryFiles) });
  memory = h.memory;
  assert.equal(h.state.quizzes()[0].problem, 'several');
});

void test('§1 那一篇被暫停：入口那一列還在，全部卡是 0', async t => {
  let memory: MemoryFiles | null = null;
  const h = await make(t, { [FOLDER + 'a.md']: quizText('2026-11-05', link(WORDS)) }, { resolveLink: byPath(() => memory as MemoryFiles) });
  memory = h.memory;
  h.memory.write(WORDS, head('國二上', '英文', 'L3 Vocabulary', '狀態: 暫停\n') + targets('w1', 'w2', 'w3'));
  await settled();
  const [row] = h.state.quizzes();
  assert.equal(row.problem, null);
  assert.equal(row.count, 0);
});

void test('§1 設定時寫檔卡住：逾時回失敗，原因寫得出來，不寫檔', async t => {
  const memory = createMemoryFiles({ ...DECKS });
  let release = (): void => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  // 小考資料夾的寫入在進入回呼之前卡住（iCloud 的檔還在下載、磁碟忙）。
  const files = { ...memory.files, modify: (path: string, edit: (text: string, exists: boolean) => string) => path.startsWith(FOLDER) ? gate.then(() => memory.files.modify(path, edit)) : memory.files.modify(path, edit) };
  const state = createState({ files, device: 'PC-test', delay: 1, fillIds: false, writeTimeout: 20, now: () => NOON, offset: () => 480, onError() {}, random: () => 0 });
  t.after(() => state.close());
  await state.ready();
  const result = await state.setQuiz(L3, '2026-11-06', null);
  assert.equal(result.kind, 'failed');
  assert.match(result.kind === 'failed' ? String(result.error) : '', /逾時/);
  release();
  await settled();
  assert.equal(memory.texts.has(FOLDER + '2026-11-06 小考.md'), false, '逾時之後才進入回呼的不寫');
});
