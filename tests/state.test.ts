import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { isDeckPath, parseDeck, readDecks } from '../src/core/deck/index.ts';
import { dayOf, encodeEntry, nextCard, planToday, progress, readHistory } from '../src/core/study/index.ts';
import type { Next, NewEntry } from '../src/core/study/index.ts';
import type { Files } from '../src/core/files.ts';
import { createState } from '../src/state/index.ts';
import type { LoadTimings, State, StateOptions } from '../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './helpers/memory-files.ts';

// W5 說明 §7：+08:00、now 由測試控制、delay 很小；只透過公開介面測。
// 技術債 A9：用記憶體 Files（契約 C1～C14 驗過，通知在寫入當下同步送出）加 node:test 的假計時器：
// `settle()` 讓 delay 過去並跑完排好的處理，所以不用等真的檔案系統，也沒有固定時間的 wait()。
const DELAY = 50;
const at = (text: string) => Date.parse(text);
const NATURAL = 'Essence Cards/國二上/自然/2-2（卡片）.md';
const ENGLISH = 'Essence Cards/英文/L1（卡片）.md';
const TRANSCRIPT = 'Essence Cards/教材庫/國二上自然 2-2.md';
const PC = 'Essence Cards/紀錄/2026-10 PC-test.jsonl';
const PHONE = 'Essence Cards/紀錄/2026-10 iPhone-test.jsonl';
const goal = (id: string) => `- 能說明 ${id} ^${id}\n    - 題目 ${id} :: 答案 ${id}\n`;
const naturalText = '---\n科目: 自然\n---\n' + goal('a') + goal('b');
const review = (t: string, lt: string, r = 'good') => encodeEntry(t, { lt, r: r as 'good', v: '12345678' });

const baseVault: Record<string, string> = {
  [NATURAL]: naturalText,
  [ENGLISH]: '---\n科目: 英文\n---\n- borrow 英翻中 ^e1\n    - borrow :: v. 借入\n- borrow 中翻英 ^z1\n    - Can I ＿＿ your pen?（借） :: borrow\n',
  [TRANSCRIPT]: '---\n來源類型: 課本\n---\n' + goal('zzzzz1'),
  ...Object.fromEntries(['考試範圍', '錯題本', '記憶錨點', '製卡規則', '紀錄'].map(folder => [`Essence Cards/${folder}/筆記.md`, goal('zzzzz2')])),
  'Essence Cards/筆記.txt': goal('zzzzz2'),
  '其他/外面（卡片）.md': goal('zzzzz3'),
  [PC]: review('2026-10-20T19:00:00.000+08:00', 'b', 'miss') + '\n',
  [PHONE]: review('2026-10-21T19:00:00.000+08:00', 'e1') + '\n' + review('2026-10-22T19:00:00.000+08:00', 'zzzzz2') + '\n',
  'Essence Cards/紀錄/舊/x.jsonl': review('2026-10-22T19:00:00.000+08:00', 'a') + '\n',
};

/** 同一個測試只能啟用一次假計時器。 */
const timed = new WeakSet<TestContext>();
function useFakeTimers(t: TestContext): { flush: () => Promise<void>; settle: (ms?: number) => Promise<void> } {
  if (!timed.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timed.add(t); }
  // 排好的處理在 Promise 裡接著跑：等一輪 setImmediate（沒有假化）讓它們全部跑完。
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  return { flush, settle: async (ms = DELAY + 1) => { t.mock.timers.tick(ms); await flush(); } };
}

interface Harness extends MemoryFiles {
  state: State;
  /** onChange 被呼叫的次數。 */
  changed: () => number;
  clock: { now: number; offset: number };
  /** onError 收到的 [錯誤, 來源]。 */
  errors: [unknown, string][];
  flush: () => Promise<void>;
  /** 讓 ms（預設剛好超過 delay）過去，並跑完排好的讀檔與重排。 */
  settle: (ms?: number) => Promise<void>;
}
async function setup(t: TestContext, options: Partial<StateOptions> & { vault?: Record<string, string> } = {}, start = at('2026-10-24T19:00:00.000+08:00')): Promise<Harness> {
  const { vault, ...rest } = options;
  const timers = useFakeTimers(t);
  const memory = createMemoryFiles(vault ?? baseVault);
  const clock = { now: start, offset: 480 };
  const errors: [unknown, string][] = [];
  const state = createState({ device: 'PC-test', delay: DELAY, fillIds: false, now: () => clock.now, offset: () => clock.offset,
    onError: (error, source) => { errors.push([error, source]); }, ...rest, files: memory.files });
  let changes = 0;
  state.onChange(() => { changes++; });
  t.after(() => state.close());
  return Promise.resolve({ ...memory, state, changed: () => changes, clock, errors, ...timers });
}
const ids = (items: { lt: string }[]) => items.map(item => item.lt);
const cardOf = (next: Next) => next.kind === 'card' ? next.card.lt : next.kind;

void test('isDeckPath 與 readDecks：Essence Cards 底下的 .md，五個系統資料夾以外；轉錄稿照樣讀', async t => {
  for (const path of [NATURAL, TRANSCRIPT, 'Essence Cards/紀錄.md', 'Essence Cards/紀錄2/x.md', 'Essence Cards/a/紀錄/x.md'])
    assert.equal(isDeckPath(path), true, path);
  for (const path of ['Essence Cards/紀錄/筆記.md', 'Essence Cards/錯題本/a/b.md', 'Essence Cards/筆記.txt', 'Essence Cards/x.MD', '其他/外面（卡片）.md', 'Essence Cards2/x.md', 'Essence Cards'])
    assert.equal(isDeckPath(path), false, path);
  const { files } = await setup(t);
  const decks = await readDecks(files);
  assert.deepEqual(decks.map(entry => entry.path), [NATURAL, TRANSCRIPT, ENGLISH]);
  assert.deepEqual(decks[0].deck, parseDeck(naturalText));
  assert.equal(decks[1].deck.props.isTranscript, true);
});

void test('T6 讀取：只讀卡組與紀錄資料夾正下方的紀錄，today 和直接 planToday 相同', async t => {
  const { state, files, clock } = await setup(t);
  assert.throws(() => state.today());
  assert.throws(() => state.input());
  assert.throws(() => state.answer({ lt: 'a', r: 'good', v: '12345678' }));
  assert.deepEqual(state.decks(), []);
  assert.deepEqual(state.history().reviews, []);
  const ready = state.ready();
  assert.equal(state.ready(), ready);
  const timings: LoadTimings = await ready;
  for (const key of ['decks', 'history', 'plan', 'total'] as const) assert.ok(typeof timings[key] === 'number' && timings[key] >= 0, key);
  assert.ok(timings.total >= Math.max(timings.decks, timings.history, timings.plan));
  assert.deepEqual(state.decks().map(entry => entry.path), [NATURAL, TRANSCRIPT, ENGLISH]);
  assert.deepEqual(state.history(), await readHistory(files));
  assert.deepEqual(state.history().reviews.map(entry => entry.lt), ['b', 'e1', 'zzzzz2']);
  const input = state.input();
  assert.deepEqual(input, { decks: state.decks(), history: state.history(), settings: { capMinutes: 30, retention: 0.8, filter: [] }, exam: null, now: clock.now, offset: 480 });
  const today = state.today();
  assert.deepEqual(today, planToday(input));
  // b 前一天 miss；e1 記得了，換出中翻英 z1。
  assert.deepEqual(ids(today.share), ['b', 'a', 'z1']);
  for (const item of [...today.share, ...today.more]) assert.ok(!item.lt.startsWith('zzzzz'), item.lt);
});

void test('T7 作答：寫進自己的紀錄、併進 history、不讀紀錄檔、不重排；取消與跨月', async t => {
  const { state, texts, reads, changed, clock, settle } = await setup(t, { vault: { [NATURAL]: naturalText } });
  await state.ready();
  reads.length = 0;
  const v = state.decks()[0].deck.targets[0].prompts[0].fingerprint;
  assert.equal(cardOf(state.next({ subject: '自然' })), 'a');
  const entry: NewEntry = { lt: 'a', r: 'good', v };
  const t1 = state.answer(entry);
  assert.equal(t1, '2026-10-24T19:00:00.000+08:00');
  await state.flush();
  const lines = (texts.get(PC) ?? '').trimEnd().split('\n');
  assert.equal(lines.at(-1), encodeEntry(t1, entry));
  assert.deepEqual(state.history().reviews.map(item => [item.t, item.lt, item.r, item.v]), [[t1, 'a', 'good', v]]);
  assert.equal(cardOf(state.next({ subject: '自然' })), 'b');

  clock.now += 5000;
  state.answer({ undo: t1 });
  assert.deepEqual(state.history().reviews, []);
  assert.equal(cardOf(state.next({ subject: '自然' })), 'a');
  await state.flush();
  // 自己的檔收到修改通知：不讀、不重排、不呼叫 onChange。
  await settle();
  assert.deepEqual(reads.filter(path => path.includes('/紀錄/')), []);
  assert.equal(changed(), 0);

  clock.now = at('2026-10-31T23:59:59.900+08:00');
  const t2 = state.answer({ lt: 'b', r: 'near', v });
  clock.now = at('2026-11-01T00:00:00.100+08:00');
  const t3 = state.answer({ lt: 'b', r: 'good', v });
  await state.flush();
  assert.match(texts.get(PC) ?? '', new RegExp(t2.replaceAll('.', '\\.').replaceAll('+', '\\+')));
  assert.equal(texts.get('Essence Cards/紀錄/2026-11 PC-test.jsonl'), encodeEntry(t3, { lt: 'b', r: 'good', v }) + '\n');
  assert.deepEqual(state.history().reviews.map(item => item.t), [t2, t3]);
  await settle();
  assert.deepEqual(reads.filter(path => path.includes('/紀錄/')), []);
  assert.equal(changed(), 0);
});

// Codex 審查 W5 的 F2：別台裝置已經取消某個 t，這台的時鐘剛好寫出同一個 t；記憶中和重新讀檔要相同。
void test('T7 作答：別台裝置先取消了同一個 t，作答後 history 仍和 readHistory 相同', async t => {
  const t0 = '2026-10-24T19:00:00.000+08:00';
  const { state, files } = await setup(t, { vault: { [NATURAL]: naturalText, [PHONE]: encodeEntry('2026-10-24T18:00:00.000+08:00', { undo: t0 }) + '\n' } });
  await state.ready();
  const v = state.decks()[0].deck.targets[0].prompts[0].fingerprint;
  assert.equal(state.answer({ lt: 'a', r: 'good', v }), t0);
  await state.flush();
  assert.deepEqual(state.history().reviews, []);
  assert.deepEqual(state.history(), await readHistory(files));
});

void test('T8 別台裝置的紀錄：只重讀那個檔、delay 內合併成一次、衝突副本不重複、刪除與內容沒變', async t => {
  const h = await setup(t);
  await h.state.ready();
  h.reads.length = 0;
  h.append(PHONE, review('2026-10-23T19:00:00.000+08:00', 'a', 'easy'));
  // delay 還沒到：不讀、不重排。
  await h.settle(DELAY / 2);
  assert.deepEqual(h.reads, []);
  assert.equal(h.changed(), 0);
  await h.settle();
  assert.equal(h.changed(), 1);
  assert.equal(h.state.history().reviews.some(entry => entry.lt === 'a' && entry.r === 'easy'), true);
  assert.deepEqual(h.state.today(), planToday(h.state.input()));
  assert.deepEqual(h.reads, [PHONE]);

  h.reads.length = 0;
  // 每隔半個 delay 一次、全部超過 delay：每次通知都重新計時，最後才讀一次。
  for (let i = 0; i < 5; i++) {
    h.append(PHONE, review(`2026-10-23T20:00:0${String(i)}.000+08:00`, 'b'));
    await h.settle(DELAY / 2);
  }
  assert.deepEqual(h.reads, []);
  await h.settle();
  assert.deepEqual(h.reads, [PHONE]);
  assert.equal(h.changed(), 2);
  const count = h.state.history().reviews.length;
  assert.equal(count, 3 + 1 + 5);

  // 自己檔的衝突副本：會讀，但作答不重複。
  h.reads.length = 0;
  h.write('Essence Cards/紀錄/2026-10 PC-test 2.jsonl', h.texts.get(PC) ?? '');
  await h.settle();
  assert.ok(h.reads.includes('Essence Cards/紀錄/2026-10 PC-test 2.jsonl'));
  assert.equal(h.state.history().reviews.length, count);

  // 通知了但內容沒變：讀了，不重排。
  const before = h.changed();
  h.reads.length = 0;
  h.write(PHONE, h.texts.get(PHONE) ?? '');
  await h.settle();
  assert.deepEqual(h.reads, [PHONE]);
  assert.equal(h.changed(), before);

  h.remove(PHONE);
  await h.settle();
  assert.equal(h.changed(), before + 1);
  assert.deepEqual(h.state.history().reviews.map(entry => entry.lt), ['b']);
});

void test('T9 卡組變動：只重讀那一篇；新增、刪除、改名、資料夾改名；系統資料夾與外面不理', async t => {
  const h = await setup(t);
  await h.state.ready();
  const paths = () => h.state.decks().map(entry => entry.path);
  h.reads.length = 0;
  h.write(NATURAL, naturalText + goal('c'));
  await h.settle();
  assert.deepEqual(h.reads, [NATURAL]);
  assert.equal(h.changed(), 1);
  assert.deepEqual(ids(h.state.today().share), ['b', 'a', 'c', 'z1']);

  const NEW = 'Essence Cards/國二上/自然/2-3（卡片）.md';
  h.write(NEW, goal('n1'));
  await h.settle();
  assert.ok(paths().includes(NEW), '新增卡組');
  h.remove(NEW);
  await h.settle();
  assert.ok(!paths().includes(NEW), '刪掉卡組');

  const RENAMED = 'Essence Cards/國二上/自然/2-2 水溶液（卡片）.md';
  h.rename(NATURAL, RENAMED);
  await h.settle();
  assert.ok(paths().includes(RENAMED) && !paths().includes(NATURAL), '改名');
  assert.deepEqual(h.state.decks().find(entry => entry.path === RENAMED)?.deck.targets.map(target => target.id), ['a', 'b', 'c']);

  h.rename('Essence Cards/英文', 'Essence Cards/English');
  await h.settle();
  assert.deepEqual(paths(), ['Essence Cards/English/L1（卡片）.md', RENAMED, TRANSCRIPT]);

  const before = h.changed();
  h.reads.length = 0;
  h.write('Essence Cards/錯題本/筆記.md', goal('zzzzz4'));
  h.write('其他/外面（卡片）.md', goal('zzzzz5'));
  await h.settle();
  assert.deepEqual(h.reads, []);
  assert.equal(h.changed(), before);

  // 通知了但卡組內容沒變：讀了，不重排。
  h.write(TRANSCRIPT, baseVault[TRANSCRIPT]);
  await h.settle();
  assert.deepEqual(h.reads, [TRANSCRIPT]);
  assert.equal(h.changed(), before);
});

void test('T10 換日：清晨 4 點重排，next 不回 stale，和直接 planToday＋nextCard 相同', async t => {
  const { state, clock } = await setup(t, { vault: { [NATURAL]: naturalText } }, at('2026-10-24T03:59:59.999+08:00'));
  await state.ready();
  const day = dayOf(clock.now, 480);
  assert.equal(state.today().day, day);
  clock.now = at('2026-10-24T04:00:00.000+08:00');
  assert.equal(state.today().day, day + 1);
  const next = state.next({ subject: '自然' });
  assert.notEqual(next.kind, 'stale');
  const direct = planToday(state.input());
  assert.deepEqual(next, nextCard(direct, state.input(), { subject: '自然' }));
  // today() 之前沒有呼叫時，next 自己也會先重排。
  clock.now = at('2026-10-25T04:00:00.000+08:00');
  assert.deepEqual(state.next({ subject: '自然' }), nextCard(planToday(state.input()), state.input(), { subject: '自然' }));
  assert.equal(state.today().day, day + 2);
});

void test('T10 換時區（Codex F3）：日編號相同也重排，舊的作答變成今天以前', async t => {
  const { state, clock } = await setup(t, { vault: { [NATURAL]: '---\n科目: 自然\n---\n' + goal('x') } }, at('2026-10-24T04:10:00.000+08:00'));
  await state.ready();
  const v = state.decks()[0].deck.targets[0].prompts[0].fingerprint;
  assert.equal(cardOf(state.next({ subject: '自然' })), 'x');
  state.answer({ lt: 'x', r: 'good', v });
  const before = state.today();
  clock.now = at('2026-10-24T19:00:00.000-05:00');
  clock.offset = -300;
  assert.equal(dayOf(clock.now, -300), before.day);
  const progressNow = state.progress();
  const today = state.today();
  assert.notEqual(today, before);
  assert.equal(today.offset, -300);
  const input = state.input();
  const direct = planToday(input);
  assert.deepEqual(today, direct);
  assert.deepEqual(progressNow, progress(direct, input));
  assert.deepEqual(state.next({ subject: '自然' }), nextCard(direct, input, { subject: '自然' }));
  assert.deepEqual(today.share, []);
  assert.deepEqual([progressNow.done, progressNow.total], [0, 0]);
  assert.deepEqual(state.next({ subject: '自然' }), { kind: 'done' });
});

void test('T6 讀的期間收到的通知：讀完後照檔案變動處理一次，不會漏掉', async t => {
  const { settle } = useFakeTimers(t);
  const memory = createMemoryFiles({ [PHONE]: review('2026-10-21T19:00:00.000+08:00', 'a') + '\n', [NATURAL.replace('國二上/自然/', '')]: naturalText });
  // 第一次讀 PHONE 時，檔案在讀完之後被別台裝置追加一行（通知由記憶體 Files 同步送出）。
  let first = true;
  const files: Files = {
    ...memory.files,
    async read(path) {
      const text = await memory.files.read(path);
      if (path === PHONE && first) {
        first = false;
        memory.append(PHONE, review('2026-10-22T19:00:00.000+08:00', 'b'));
      }
      return text;
    },
  };
  const state = createState({ files, device: 'PC-test', delay: DELAY, fillIds: false, now: () => at('2026-10-24T19:00:00.000+08:00'), offset: () => 480 });
  t.after(() => state.close());
  let changes = 0;
  state.onChange(() => { changes++; });
  await state.ready();
  assert.deepEqual(state.history().reviews.map(entry => entry.lt), ['a']);
  await settle();
  assert.equal(changes, 1);
  assert.deepEqual(state.history().reviews.map(entry => entry.lt), ['a', 'b']);
});

// Codex 審查 W5 的 F3：讀檔失敗後不能等「下一次通知」，也不能拖住同一批讀得到的檔。
void test('讀檔失敗：讀得到的照常處理，讀不到的自己重試；恢復後不用新的通知就更新', async t => {
  const h = await setup(t);
  await h.state.ready();
  h.failing.add(PHONE);
  h.append(PHONE, review('2026-10-23T19:00:00.000+08:00', 'a', 'easy'));
  h.write(NATURAL, naturalText + goal('c'));
  await h.settle();
  // 卡組不被讀不到的紀錄擋住。
  assert.equal(h.changed(), 1);
  assert.ok(h.state.decks()[0].deck.targets.some(target => target.id === 'c'));
  assert.ok(ids(h.state.today().share).includes('c'));
  assert.equal(h.state.history().reviews.some(entry => entry.r === 'easy'), false);
  assert.deepEqual(h.errors.map(([, source]) => source), ['read']);
  // 恢復之後沒有新的通知，第一次重試（1 秒後）就讀到。
  h.failing.delete(PHONE);
  await h.settle(999);
  assert.equal(h.changed(), 1, '1 秒還沒到');
  await h.settle(1);
  assert.equal(h.changed(), 2);
  assert.equal(h.state.history().reviews.some(entry => entry.lt === 'a' && entry.r === 'easy'), true);
  assert.deepEqual(h.state.today(), planToday(h.state.input()));
});

void test('讀檔失敗後 close：不再重試', async t => {
  const h = await setup(t);
  await h.state.ready();
  h.failing.add(PHONE);
  h.append(PHONE, review('2026-10-23T19:00:00.000+08:00', 'a') + '\n');
  await h.settle();
  assert.equal(h.errors.length, 1);
  await h.state.close();
  const count = h.reads.length;
  await h.settle(5000);
  assert.equal(h.reads.length, count);
});

// ---- 卡組讀不到就跳過那一篇（tasks/state-load.md §7） ----

const sources = (h: Harness) => h.errors.map(([, source]) => source);
const samePlan = (h: Harness) => { assert.deepEqual(h.state.today(), planToday(h.state.input())); };

void test('S1 第一次載入一篇卡組讀不到：ready() 照樣完成、跳過那一篇；重試的等待加倍，恢復後加進來、等待歸零', async t => {
  const h = await setup(t);
  h.failing.add(ENGLISH);
  await h.state.ready();
  assert.deepEqual(h.state.decks().map(entry => entry.path), [NATURAL, TRANSCRIPT]);
  assert.deepEqual(ids(h.state.today().share), ['b', 'a']);
  assert.deepEqual(h.state.unread(), [ENGLISH]);
  assert.deepEqual(sources(h), ['read']);
  samePlan(h);
  h.reads.length = 0;
  await h.settle(999);
  assert.deepEqual(h.reads, []);
  await h.settle(1);
  assert.deepEqual(h.reads, [ENGLISH]);
  assert.deepEqual(sources(h), ['read', 'read']);
  // 第二次失敗：下一次等 2 秒。
  await h.settle(1999);
  assert.deepEqual(h.reads, [ENGLISH]);
  h.failing.delete(ENGLISH);
  await h.settle(1);
  assert.deepEqual(h.reads, [ENGLISH, ENGLISH]);
  assert.deepEqual(h.state.decks().map(entry => entry.path), [NATURAL, TRANSCRIPT, ENGLISH]);
  assert.equal(h.changed(), 1);
  assert.deepEqual(h.state.unread(), []);
  assert.deepEqual(ids(h.state.today().share), ['b', 'a', 'z1']);
  assert.deepEqual(sources(h), ['read', 'read']);
  samePlan(h);
  // 讀到之後等待歸零：再讀不到一次，1 秒後就重試。
  h.failing.add(ENGLISH);
  h.notify(ENGLISH);
  await h.settle();
  assert.deepEqual(sources(h), ['read', 'read', 'read']);
  assert.deepEqual(h.state.unread(), [ENGLISH]);
  h.reads.length = 0;
  await h.settle(999);
  assert.deepEqual(h.reads, []);
  await h.settle(1);
  assert.deepEqual(h.reads, [ENGLISH]);
  // 讀不到的期間保留上一次讀到的內容。
  assert.deepEqual(h.state.decks().map(entry => entry.path), [NATURAL, TRANSCRIPT, ENGLISH]);
});

void test('S2 第一次載入一份別台裝置的紀錄讀不到：history 來自讀到的，恢復後和 readHistory 相同、重排一次', async t => {
  const h = await setup(t);
  h.failing.add(PHONE);
  await h.state.ready();
  assert.deepEqual(h.state.history().reviews.map(entry => entry.lt), ['b']);
  assert.deepEqual(h.state.unread(), [PHONE]);
  assert.deepEqual(sources(h), ['read']);
  samePlan(h);
  h.failing.delete(PHONE);
  await h.settle(1000);
  assert.equal(h.changed(), 1);
  assert.deepEqual(h.state.unread(), []);
  assert.deepEqual(h.state.history(), await readHistory(h.files));
  samePlan(h);
});

void test('S2 載入後才讀不到的紀錄：保留上一份內容、unread() 含它；恢復後照舊', async t => {
  const h = await setup(t);
  await h.state.ready();
  h.failing.add(PHONE);
  h.append(PHONE, review('2026-10-23T19:00:00.000+08:00', 'a', 'easy'));
  await h.settle();
  assert.deepEqual(h.state.history().reviews.map(entry => entry.lt), ['b', 'e1', 'zzzzz2']);
  assert.deepEqual(h.state.unread(), [PHONE]);
  h.failing.delete(PHONE);
  await h.settle(1000);
  assert.deepEqual(h.state.unread(), []);
  assert.deepEqual(h.state.history(), await readHistory(h.files));
  assert.equal(h.changed(), 1);
  samePlan(h);
});

// 規格沒列、實作時補的：自己的紀錄只有第一次讀不到才會重讀（通知不理），恢復前作答的行只在記憶裡。
void test('S2 自己的紀錄第一次讀不到：恢復前作答的行不丟（已經寫進檔、還沒寫進檔都一樣）', async t => {
  for (const failAppend of [false, true]) {
    const h = await setup(t, { vault: { [NATURAL]: naturalText, [PC]: review('2026-10-20T19:00:00.000+08:00', 'b', 'miss') + '\n' } });
    h.failing.add(PC);
    await h.state.ready();
    assert.deepEqual(h.state.unread(), [PC]);
    assert.deepEqual(h.state.history().reviews, []);
    h.control.failAppend = failAppend;
    const v = h.state.decks()[0].deck.targets[0].prompts[0].fingerprint;
    const t1 = h.state.answer({ lt: 'a', r: 'good', v });
    await h.flush();
    h.failing.delete(PC);
    await h.settle(1000);
    assert.deepEqual(h.state.unread(), []);
    assert.deepEqual(h.state.history().reviews.map(entry => [entry.lt, entry.t]), [['b', '2026-10-20T19:00:00.000+08:00'], ['a', t1]], String(failAppend));
    samePlan(h);
    h.control.failAppend = false;
    await h.state.flush();
    assert.deepEqual(h.state.history(), await readHistory(h.files));
    await h.state.close();
  }
});

void test('S3 只有 list 失敗才整個重試：ready() 等到列得出來才完成；重試中 close 會 reject', async t => {
  const h = await setup(t);
  h.control.failList = true;
  const ready = h.state.ready();
  await h.flush();
  assert.deepEqual(sources(h), ['read']);
  assert.throws(() => h.state.today());
  assert.deepEqual(h.state.unread(), []);
  await h.settle(1000);
  assert.deepEqual(sources(h), ['read', 'read']);
  // 第二次失敗：等 2 秒。
  h.control.failList = false;
  await h.settle(1999);
  assert.throws(() => h.state.today());
  await h.settle(1);
  await ready;
  assert.equal(h.state.ready(), ready);
  assert.deepEqual(sources(h), ['read', 'read']);
  assert.deepEqual(h.state.history(), await readHistory(h.files));
  assert.deepEqual(h.state.decks().map(entry => entry.path), [NATURAL, TRANSCRIPT, ENGLISH]);
  samePlan(h);

  const other = await setup(t);
  other.control.failList = true;
  const pending = other.state.ready();
  await other.flush();
  assert.equal(other.errors.length, 1);
  await other.state.close();
  await assert.rejects(pending);
});

void test('S4 讀不到期間被刪掉：從 unread() 拿掉、不再重試、沒有錯誤（有沒有通知都一樣）', async t => {
  for (const notified of [true, false]) {
    const h = await setup(t);
    h.failing.add(ENGLISH);
    await h.state.ready();
    h.failing.delete(ENGLISH);
    if (notified) h.remove(ENGLISH);
    else h.texts.delete(ENGLISH);
    await h.settle(1000);
    assert.deepEqual(h.state.unread(), [], String(notified));
    assert.deepEqual(sources(h), ['read']);
    assert.deepEqual(h.state.decks().map(entry => entry.path), [NATURAL, TRANSCRIPT]);
    h.reads.length = 0;
    await h.settle(120_000);
    assert.deepEqual(h.reads, [], String(notified));
    await h.state.close();
  }
});

void test('S5 連續讀不到：等 1、2、4…秒，最多 60 秒；close() 之後不再重試', async t => {
  const h = await setup(t);
  h.failing.add(ENGLISH);
  await h.state.ready();
  const waits = [1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000];
  for (const wait of waits) {
    const count = h.reads.length;
    await h.settle(wait - 1);
    assert.equal(h.reads.length, count, String(wait));
    await h.settle(1);
    assert.equal(h.reads.length, count + 1, String(wait));
  }
  assert.equal(h.errors.length, 1 + waits.length);
  await h.state.close();
  const count = h.reads.length;
  await h.settle(120_000);
  assert.equal(h.reads.length, count);
});

/** 數還在等的計時：在假計時器外面再包一層（只在這個測試裡，結束時還原）。 */
function countTimers(): { live: () => number; restore: () => void } {
  const ids = new Set<unknown>();
  const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
  globalThis.setTimeout = ((callback: () => void, ms?: number) => {
    const id = set(() => { ids.delete(id); callback(); }, ms);
    ids.add(id);
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout> | undefined) => { ids.delete(id); clear(id); }) as typeof clearTimeout;
  return { live: () => ids.size, restore: () => { globalThis.setTimeout = set; globalThis.clearTimeout = clear; } };
}

// Codex state-load L2 的 F2：onError 裡同步呼叫 close()（重入）時，回呼結束後不能再排重試，ready() 也不等下一次退避。
for (const failure of ['read', 'list'] as const) void test('S5 onError 裡 close()：不留下重試的計時，ready() 不用推進時間就 reject：' + failure, async t => {
  let closing: Promise<void> | undefined;
  const h = await setup(t, { onError: () => { closing ??= h.state.close(); } });
  const timers = countTimers();
  try {
    if (failure === 'read') h.failing.add(ENGLISH);
    else h.control.failList = true;
    let rejected = false;
    void h.state.ready().then(() => {}, () => { rejected = true; });
    await h.flush();
    await closing;
    await h.flush();
    assert.equal(rejected, true);
    assert.equal(timers.live(), 0);
  } finally {
    timers.restore();
  }
});

for (const path of [ENGLISH, PHONE]) void test('S6 第一次載入和之後的變動一致：' + path, async t => {
  const first = await setup(t);
  first.failing.add(path);
  await first.state.ready();
  assert.deepEqual(first.state.unread(), [path]);
  first.failing.delete(path);
  await first.settle(1000);

  const { [path]: text, ...rest } = baseVault;
  const later = await setup(t, { vault: rest });
  await later.state.ready();
  later.failing.add(path);
  later.write(path, text);
  await later.settle();
  assert.deepEqual(later.state.unread(), [path]);
  later.failing.delete(path);
  await later.settle(1000);

  for (const h of [first, later]) {
    assert.deepEqual(h.state.unread(), []);
    samePlan(h);
  }
  assert.deepEqual(later.state.decks(), first.state.decks());
  assert.deepEqual(later.state.history(), first.state.history());
  assert.deepEqual(later.state.today(), first.state.today());
  assert.deepEqual(sources(later), sources(first));
});
