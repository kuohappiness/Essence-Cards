import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { isDeckPath, parseDeck, readDecks } from '../src/core/deck/index.ts';
import { dayOf, encodeEntry, nextCard, planToday, progress, readHistory } from '../src/core/study/index.ts';
import type { Next, NewEntry } from '../src/core/study/index.ts';
import type { Files } from '../src/core/files.ts';
import { createState } from '../src/state/index.ts';
import type { LoadTimings, State, StateOptions } from '../src/state/index.ts';
import { createNodeFiles } from '../tools/node-files.ts';

// W5 說明 §7：+08:00、now 由測試控制、delay 很小；只透過公開介面測。
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

interface Harness {
  root: string;
  files: Files;
  state: State;
  reads: string[];
  /** onChange 被呼叫的次數。 */
  changed: () => number;
  clock: { now: number; offset: number };
  write: (path: string, text: string) => Promise<void>;
  /** 放進來的路徑 read 會失敗（模擬 iCloud 還沒同步好之類的暫時錯誤）。 */
  failing: Set<string>;
  /** onError 收到的 [錯誤, 來源]。 */
  errors: [unknown, string][];
}
async function setup(t: TestContext, options: Partial<StateOptions> & { vault?: Record<string, string>; now?: () => number } = {}, start = at('2026-10-24T19:00:00.000+08:00')): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'essence-state-'));
  const write = async (path: string, text: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, 'utf8');
  };
  for (const [path, text] of Object.entries(options.vault ?? baseVault)) await write(path, text);
  const node = createNodeFiles(root);
  const reads: string[] = [];
  const failing = new Set<string>();
  const files: Files = { ...node, read: path => {
    reads.push(path);
    return failing.has(path) ? Promise.reject(Error('讀不到：' + path)) : node.read(path);
  } };
  const clock = { now: start, offset: 480 };
  const errors: [unknown, string][] = [];
  const state = createState({ device: 'PC-test', delay: 50, fillIds: false, now: () => clock.now, offset: () => clock.offset,
    onError: (error, source) => { errors.push([error, source]); }, ...options, files });
  let changes = 0;
  state.onChange(() => { changes++; });
  t.after(async () => { await state.close(); await rm(root, { recursive: true, force: true }); });
  return { root, files, state, reads, changed: () => changes, clock, write, failing, errors };
}
async function until(condition: () => boolean, message: string, timeout = 5000): Promise<void> {
  const end = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > end) assert.fail('等不到：' + message);
    await wait(20);
  }
}
/** 等通知與 delay 都過去：用來確認「沒有發生」。 */
const settle = () => wait(400);
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
  const { state, root, reads, changed, clock } = await setup(t, { vault: { [NATURAL]: naturalText } });
  await state.ready();
  reads.length = 0;
  const v = state.decks()[0].deck.targets[0].prompts[0].fingerprint;
  assert.equal(cardOf(state.next({ subject: '自然' })), 'a');
  const entry: NewEntry = { lt: 'a', r: 'good', v };
  const t1 = state.answer(entry);
  assert.equal(t1, '2026-10-24T19:00:00.000+08:00');
  await state.flush();
  const lines = (await readFile(join(root, PC), 'utf8')).trimEnd().split('\n');
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
  assert.match(await readFile(join(root, PC), 'utf8'), new RegExp(t2.replaceAll('.', '\\.').replaceAll('+', '\\+')));
  assert.equal((await readFile(join(root, 'Essence Cards/紀錄/2026-11 PC-test.jsonl'), 'utf8')), encodeEntry(t3, { lt: 'b', r: 'good', v }) + '\n');
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
  const { state, root, reads, changed } = await setup(t, { delay: 200 });
  await state.ready();
  reads.length = 0;
  const line = review('2026-10-23T19:00:00.000+08:00', 'a', 'easy');
  await appendFile(join(root, PHONE), line + '\n');
  await until(() => changed() === 1, '別台裝置的一行');
  assert.equal(state.history().reviews.some(entry => entry.lt === 'a' && entry.r === 'easy'), true);
  assert.deepEqual(state.today(), planToday(state.input()));
  await settle();
  assert.deepEqual(reads, [PHONE]);
  assert.equal(changed(), 1);

  reads.length = 0;
  // 每 100 ms 一次、全部超過 delay（200 ms）：每次通知都重新計時，最後才讀一次。
  for (let i = 0; i < 5; i++) {
    await appendFile(join(root, PHONE), review(`2026-10-23T20:00:0${String(i)}.000+08:00`, 'b') + '\n');
    await wait(100);
  }
  await until(() => changed() === 2, '追加五次');
  await settle();
  assert.deepEqual(reads, [PHONE]);
  assert.equal(changed(), 2);
  const count = state.history().reviews.length;
  assert.equal(count, 3 + 1 + 5);

  // 自己檔的衝突副本：會讀，但作答不重複。
  reads.length = 0;
  await writeFile(join(root, 'Essence Cards/紀錄/2026-10 PC-test 2.jsonl'), await readFile(join(root, PC), 'utf8'));
  await until(() => reads.includes('Essence Cards/紀錄/2026-10 PC-test 2.jsonl'), '衝突副本');
  await settle();
  assert.equal(state.history().reviews.length, count);

  // 通知了但內容沒變。
  const before = changed();
  reads.length = 0;
  await writeFile(join(root, PHONE), await readFile(join(root, PHONE), 'utf8'));
  await until(() => reads.includes(PHONE), '內容沒變的通知');
  await settle();
  assert.equal(changed(), before);

  await rm(join(root, PHONE));
  await until(() => changed() === before + 1, '刪掉別台裝置的紀錄');
  await settle();
  assert.equal(changed(), before + 1);
  assert.deepEqual(state.history().reviews.map(entry => entry.lt), ['b']);
});

void test('T9 卡組變動：只重讀那一篇；新增、刪除、改名、資料夾改名；系統資料夾與外面不理', async t => {
  const { state, root, reads, changed, write } = await setup(t);
  await state.ready();
  const paths = () => state.decks().map(entry => entry.path);
  reads.length = 0;
  await write(NATURAL, naturalText + goal('c'));
  await until(() => changed() === 1, '改卡組');
  await settle();
  assert.deepEqual(reads, [NATURAL]);
  assert.equal(changed(), 1);
  assert.deepEqual(ids(state.today().share), ['b', 'a', 'c', 'z1']);

  const NEW = 'Essence Cards/國二上/自然/2-3（卡片）.md';
  await write(NEW, goal('n1'));
  await until(() => paths().includes(NEW), '新增卡組');
  await rm(join(root, NEW));
  await until(() => !paths().includes(NEW), '刪掉卡組');

  const RENAMED = 'Essence Cards/國二上/自然/2-2 水溶液（卡片）.md';
  await rename(join(root, NATURAL), join(root, RENAMED));
  await until(() => paths().includes(RENAMED) && !paths().includes(NATURAL), '改名');
  assert.deepEqual(state.decks().find(entry => entry.path === RENAMED)?.deck.targets.map(target => target.id), ['a', 'b', 'c']);

  await rename(join(root, 'Essence Cards/英文'), join(root, 'Essence Cards/English'));
  await until(() => paths().includes('Essence Cards/English/L1（卡片）.md') && !paths().includes(ENGLISH), '資料夾改名');
  assert.deepEqual(paths(), ['Essence Cards/English/L1（卡片）.md', RENAMED, TRANSCRIPT]);

  await settle();
  const before = changed();
  reads.length = 0;
  await write('Essence Cards/錯題本/筆記.md', goal('zzzzz4'));
  await write('其他/外面（卡片）.md', goal('zzzzz5'));
  await settle();
  assert.deepEqual(reads, []);
  assert.equal(changed(), before);

  // 通知了但卡組內容沒變：讀了，不重排。
  await write(TRANSCRIPT, baseVault[TRANSCRIPT]);
  await until(() => reads.includes(TRANSCRIPT), '內容沒變的卡組');
  await settle();
  assert.equal(changed(), before);
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
  const root = await mkdtemp(join(tmpdir(), 'essence-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'Essence Cards/紀錄'), { recursive: true });
  await writeFile(join(root, PHONE), review('2026-10-21T19:00:00.000+08:00', 'a') + '\n');
  await writeFile(join(root, NATURAL.replace('國二上/自然/', '')), naturalText);
  const node = createNodeFiles(root);
  // 自己控制通知；第一次讀 PHONE 時，檔案在讀完之後被別台裝置追加一行。
  let notify: (path: string) => void = () => {};
  let first = true;
  const files: Files = {
    ...node,
    watch: listener => { notify = listener; return () => {}; },
    async read(path) {
      const text = await node.read(path);
      if (path === PHONE && first) {
        first = false;
        await appendFile(join(root, PHONE), review('2026-10-22T19:00:00.000+08:00', 'b') + '\n');
        notify(PHONE);
      }
      return text;
    },
  };
  const state = createState({ files, device: 'PC-test', delay: 10, fillIds: false, now: () => at('2026-10-24T19:00:00.000+08:00'), offset: () => 480 });
  t.after(() => state.close());
  let changes = 0;
  state.onChange(() => { changes++; });
  await state.ready();
  assert.deepEqual(state.history().reviews.map(entry => entry.lt), ['a']);
  await until(() => changes === 1, '讀完後處理讀的期間的通知');
  assert.deepEqual(state.history().reviews.map(entry => entry.lt), ['a', 'b']);
});

// Codex 審查 W5 的 F3：讀檔失敗後不能等「下一次通知」，也不能拖住同一批讀得到的檔。
void test('讀檔失敗：讀得到的照常處理，讀不到的自己重試；恢復後不用新的通知就更新', async t => {
  const { state, root, failing, errors, changed, write } = await setup(t);
  await state.ready();
  failing.add(PHONE);
  await appendFile(join(root, PHONE), review('2026-10-23T19:00:00.000+08:00', 'a', 'easy') + '\n');
  await write(NATURAL, naturalText + goal('c'));
  // 卡組不被讀不到的紀錄擋住。
  await until(() => changed() === 1, '讀得到的卡組先更新');
  assert.ok(state.decks()[0].deck.targets.some(target => target.id === 'c'));
  assert.ok(ids(state.today().share).includes('c'));
  assert.equal(state.history().reviews.some(entry => entry.r === 'easy'), false);
  assert.deepEqual(errors.map(([, source]) => source), ['read']);
  // 恢復之後沒有新的通知，也會在重試時讀到。
  failing.delete(PHONE);
  await until(() => changed() === 2, '重試讀到別台裝置的紀錄');
  assert.equal(state.history().reviews.some(entry => entry.lt === 'a' && entry.r === 'easy'), true);
  assert.deepEqual(state.today(), planToday(state.input()));
});

void test('讀檔失敗後 close：不再重試', async t => {
  const { state, root, failing, errors, reads } = await setup(t);
  await state.ready();
  failing.add(PHONE);
  await appendFile(join(root, PHONE), review('2026-10-23T19:00:00.000+08:00', 'a') + '\n');
  await until(() => errors.length === 1, '第一次讀失敗');
  await state.close();
  const count = reads.length;
  await wait(1500);
  assert.equal(reads.length, count);
});

void test('ready() 讀不到時自己重試，恢復後完成；重試中 close 會 reject', async t => {
  const { state, failing, errors, files } = await setup(t);
  failing.add(PC);
  const ready = state.ready();
  await until(() => errors.length === 1, '第一次讀失敗');
  assert.deepEqual(errors.map(([, source]) => source), ['read']);
  assert.throws(() => state.today());
  failing.delete(PC);
  await ready;
  assert.equal(state.ready(), ready);
  assert.deepEqual(state.history(), await readHistory(files));
  assert.deepEqual(state.decks().map(entry => entry.path), [NATURAL, TRANSCRIPT, ENGLISH]);

  const other = await setup(t);
  other.failing.add(PC);
  const pending = other.state.ready();
  await until(() => other.errors.length === 1, '第一次讀失敗');
  await other.state.close();
  await assert.rejects(pending);
});
