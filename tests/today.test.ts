import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/core/deck/index.ts';
import { checkTyped, encodeEntry, mergeHistory, nextCard, planToday, progress } from '../src/core/study/index.ts';
import type { Card, DeckEntry, ExamScope, History, Next, Rating, Today, TodayInput } from '../src/core/study/index.ts';
import type { Prompt } from '../src/core/deck/index.ts';
import { threeYearDecks, threeYears } from '../tools/bench-study.ts';

// 除了特別寫的：+08:00、retention 0.8、每日 30 分鐘、沒有濾網、沒有考試範圍。
const A = '2026-10-16T20:15:03.250+08:00';
const at = (date: string, time = '19:00:00.000') => '2026-' + date + 'T' + time + '+08:00';
const local = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 23) + '+08:00';

function deckEntry(path: string, props: Record<string, string>, targets: string[]): DeckEntry {
  const head = Object.keys(props).length ? '---\n' + Object.entries(props).map(([key, value]) => key + ': ' + value).join('\n') + '\n---\n' : '';
  return { path, deck: parseDeck(head + targets.join('\n') + '\n') };
}
function goal(id: string, fields: string[] = [], prompts = ['題目 ' + id + ' :: 答案 ' + id]): string {
  return ['- 能說明 ' + id + ' ^' + id, ...fields.map(field => '    - ' + field), ...prompts.map(prompt => '    - ' + prompt)].join('\n');
}

type Row = string | [t: string, lt: string, r: Rating, v?: string];
function log(...rows: Row[]): History {
  const lines = rows.map(row => typeof row === 'string' ? row : encodeEntry(row[0], { lt: row[1], r: row[2], v: row[3] ?? '12345678' }));
  return mergeHistory([{ path: 'Essence Cards/紀錄/2026-10 Phone-test.jsonl', text: lines.join('\n') }]);
}
const mistake = (t: string, lt: string) => encodeEntry(t, { lt, r: 'miss', src: 'mistake' });

interface Options { exam?: ExamScope | null; cap?: number; retention?: number; filter?: string[] }
function input(decks: DeckEntry[], history: History, now: string, options: Options = {}): TodayInput {
  return { decks, history, settings: { capMinutes: options.cap ?? 30, retention: options.retention ?? 0.8, filter: options.filter ?? [] },
    exam: options.exam ?? null, now: Date.parse(now), offset: 480 };
}
const scope = (ids: string[], hasPeriod: boolean): ExamScope => ({ contains: (_entry, target) => target.id !== null && ids.includes(target.id), hasPeriod });
const ids = (items: { lt: string }[]) => items.map(item => item.lt);
const lanes = (today: Today) => today.share.map(item => [item.lt, item.lane]);
function card(next: Next): Card {
  assert.equal(next.kind, 'card');
  if (next.kind !== 'card') throw Error();
  return next.card;
}

// T1：a＝情境 A、b＝情境 B、c＝前一天 miss、d＝新卡、e＝情境 A 加重要性高。
const NATURAL = '國二上/自然/2-2 水溶液.md';
const natural = deckEntry(NATURAL, { 科目: '自然' }, [goal('a'), goal('b'), goal('c'), goal('d'), goal('e', ['重要性：高'])]);
const t1Rows: Row[] = [[A, 'a', 'good'], [A, 'b', 'easy'], [at('10-23', '21:00:00.000'), 'c', 'miss'], [A, 'e', 'good']];

void test('T1 分道與順序：考試範圍與考前提高保持率', () => {
  const plan = (exam: ExamScope | null) => planToday(input([natural], log(...t1Rows), at('10-24'), { exam }));
  assert.deepEqual(lanes(plan(null)), [['c', 'relearn'], ['e', 'due'], ['a', 'due'], ['d', 'new']]);
  assert.deepEqual(lanes(plan(scope(['d'], false))), [['c', 'relearn'], ['d', 'exam-new'], ['e', 'due'], ['a', 'due']]);
  assert.deepEqual(lanes(plan(scope(['b'], true))), [['c', 'relearn'], ['b', 'exam-due'], ['e', 'due'], ['a', 'due'], ['d', 'new']]);
  assert.deepEqual(lanes(plan(scope(['b'], false))), [['c', 'relearn'], ['e', 'due'], ['a', 'due'], ['d', 'new']]);
  assert.deepEqual(plan(null).more, []);

  const only = deckEntry(NATURAL, { 科目: '自然' }, [goal('a')]);
  const onlyA = (date: string, options: Options) => planToday(input([only], log([A, 'a', 'good']), at(date), options));
  assert.deepEqual(lanes(onlyA('10-18', { retention: 0.9 })), [['a', 'due']]);
  assert.deepEqual(lanes(onlyA('10-17', { retention: 0.9 })), []);
  assert.deepEqual(lanes(onlyA('10-17', { exam: scope(['a'], true) })), []);
  assert.deepEqual(lanes(onlyA('10-18', { exam: scope(['a'], true) })), [['a', 'exam-due']]);
  assert.deepEqual(lanes(onlyA('10-17', { exam: scope(['a'], true), retention: 0.95 })), [['a', 'exam-due']]);
  assert.deepEqual(ids(onlyA('10-17', { retention: 0.9 }).more), []);
});

void test('T2 同樣重要時 recall 低的先，重要性高的優先', () => {
  const plan = (b: string[]) => planToday(input([deckEntry(NATURAL, {}, [goal('a'), goal('b', b)])], log([A, 'a', 'good'], [A, 'b', 'easy']), at('11-14')));
  assert.deepEqual(lanes(plan([])), [['a', 'due'], ['b', 'due']]);
  assert.deepEqual(lanes(plan(['重要性：高'])), [['b', 'due'], ['a', 'due']]);
});

void test('T3 時間上限：照行號累加，第一個放不下的和後面的全部進 more', () => {
  // ID 的字串順序和行號相反，確認新卡照筆記順序。
  const names = Array.from({ length: 25 }, (_, i) => 'n' + String(99 - i));
  const deck = deckEntry(NATURAL, { 科目: '自然' }, names.map(name => goal(name)));
  const five = planToday(input([deck], log(), at('10-24'), { cap: 5 }));
  assert.deepEqual(ids(five.share), names.slice(0, 20));
  assert.deepEqual(ids(five.more), names.slice(20));
  assert.deepEqual([...new Set([...five.share, ...five.more].map(item => item.seconds + item.lane))], ['15new']);
  const thirty = planToday(input([deck], log(), at('10-24'), { cap: 30 }));
  assert.deepEqual(ids(thirty.share), names);
  assert.deepEqual(thirty.more, []);
  // 秒數不同時也不跳過去找小的：自然 20 秒（暫停的 n0 留下的紀錄），英文 15 秒。
  const mixed = [
    deckEntry('自然.md', { 科目: '自然' }, [goal('n0', ['狀態：暫停']), goal('n1'), goal('n2'), goal('n3')]),
    deckEntry('英文.md', { 科目: '英文' }, [goal('w1')]),
  ];
  const twenty: Row[] = Array.from({ length: 31 }, (_, i) => [local(Date.parse(at('10-20', '20:00:00.000')) + i * 20_000), 'n0', 'good']);
  const cut = planToday(input(mixed, log(...twenty), at('10-24'), { cap: 55 / 60 }));
  assert.deepEqual([ids(cut.share), ids(cut.more)], [['n1', 'n2'], ['n3', 'w1']]);
  assert.deepEqual([...cut.share, ...cut.more].map(item => item.seconds), [20, 20, 20, 15]);
});

void test('T4 每張卡的秒數：這一科最近 30 天的間隔中位數', () => {
  const decks = [
    deckEntry('自然.md', { 科目: '自然' }, [goal('n1'), goal('n2')]),
    deckEntry('英文.md', { 科目: '英文' }, [goal('w1'), goal('w2')]),
  ];
  const chain = (date: string, gaps: number[], lt: (i: number) => string = () => 'n1') => {
    let ms = Date.parse(at(date, '20:00:00.000'));
    const rows: Row[] = [[at(date, '20:00:00.000'), lt(0), 'good']];
    gaps.forEach((gap, i) => { ms += gap * 1000; rows.push([local(ms), lt(i + 1), 'good']); });
    return rows;
  };
  const seconds = (rows: Row[]) => {
    const today = planToday(input(decks, log(...rows), at('10-24')));
    const items = [...today.share, ...today.more];
    return Object.fromEntries(['n2', 'w2'].map(lt => [lt, items.find(item => item.lt === lt)?.seconds]));
  };
  const tens = Array<number>(39).fill(10);
  assert.deepEqual(seconds(chain('10-20', tens)), { n2: 10, w2: 15 });
  assert.deepEqual(seconds(chain('10-20', [...tens.slice(0, 19), 300, ...tens.slice(19)])), { n2: 10, w2: 15 });
  assert.deepEqual(seconds(chain('10-20', tens.slice(0, 29))), { n2: 15, w2: 15 });
  assert.deepEqual(seconds(chain('09-20', tens)), { n2: 15, w2: 15 });
  // 偶數個取中間兩個的平均再四捨五入；間隔算在後面那一筆的科目；找不到的目標、錯題補強不算。
  assert.deepEqual(seconds(chain('10-20', [...Array<number>(15).fill(10), ...Array<number>(15).fill(12)])), { n2: 11, w2: 15 });
  assert.deepEqual(seconds(chain('10-20', Array.from({ length: 60 }, (_, i) => i % 2 ? 8 : 6), i => i % 2 ? 'w1' : 'n1')), { n2: 8, w2: 6 });
  assert.deepEqual(seconds(chain('10-20', Array<number>(61).fill(10), i => i % 2 ? 'gone' : 'n1')), { n2: 10, w2: 15 });
  const withMistakes = chain('10-20', tens).map((row, i) => i % 2 && typeof row !== 'string' ? mistake(row[0], 'n1') : row);
  assert.deepEqual(seconds([...withMistakes, ...chain('10-21', Array<number>(10).fill(10))]), { n2: 15, w2: 15 });
  assert.deepEqual(seconds([...withMistakes, ...chain('10-21', Array<number>(11).fill(10))]), { n2: 20, w2: 15 });
  // 中位數不到 0.5 秒時最少算 1 秒，時間上限才不會失效。
  assert.deepEqual(seconds(chain('10-20', Array<number>(30).fill(0.25))), { n2: 1, w2: 15 });
});

const ENGLISH = '國二上/英文/L1 Back to School.md';
const english = (e: string[] = [], withE = true) => deckEntry(ENGLISH, { 科目: '英文' }, [
  ...withE ? ['- borrow 英翻中 ^E', ...e.map(field => '    - ' + field), '    - borrow :: v. 借入'] : [],
  '- borrow 中翻英 ^Z', '    - Can I ＿＿ your pen?（借） :: borrow',
]);

void test('T5 英文的兩個方向：記得之後才出中翻英，同一天只出一個', () => {
  const plan = (rows: Row[], date: string, deck = english()) => {
    const today = planToday(input([deck], log(...rows), at(date)));
    return { share: ids(today.share), more: ids(today.more) };
  };
  assert.deepEqual(plan([], '10-16'), { share: ['E'], more: [] });
  assert.deepEqual(plan([[A, 'E', 'good']], '10-16'), { share: ['E'], more: [] });
  assert.deepEqual(plan([[A, 'E', 'good']], '10-17'), { share: ['Z'], more: [] });
  assert.deepEqual(planToday(input([english()], log([A, 'E', 'good']), at('10-17'))).share[0].lane, 'new');
  assert.deepEqual(plan([[A, 'E', 'good'], [A, 'Z', 'easy']], '11-14'), { share: ['E'], more: [] });
  // 英翻中到期、還不是「記得」：中翻英即使是新卡（recall 當作 0）也還不出。
  assert.deepEqual(plan([[A, 'E', 'good']], '10-24'), { share: ['E'], more: [] });
  // 兩個方向 recall 相同時留英翻中。
  assert.deepEqual(plan([[A, 'E', 'good'], [A, 'Z', 'good']], '10-24'), { share: ['E'], more: [] });
  assert.deepEqual(plan([[A, 'E', 'easy'], [A, 'Z', 'good']], '11-14'), { share: ['Z'], more: [] });
  assert.deepEqual(plan([[A, 'E', 'good'], [A, 'Z', 'easy'], [at('11-14'), 'E', 'good']], '11-15'), { share: ['Z'], more: [] });
  assert.deepEqual(plan([], '10-16', english(['狀態：暫停'])), { share: ['Z'], more: [] });
  assert.deepEqual(plan([], '10-16', english([], false)), { share: ['Z'], more: [] });
  // 時間上限切掉時，被比下去的方向也不進 more。
  const cut = planToday(input([english()], log([A, 'E', 'good'], [A, 'Z', 'easy']), at('11-14'), { cap: 0 }));
  assert.deepEqual([ids(cut.share), ids(cut.more)], [[], ['E']]);
});

void test('T6 下一張：再出時間、還沒碰過、提早出、取消與換日', () => {
  const plan = planToday(input([natural], log(...t1Rows), at('10-24')));
  assert.deepEqual(ids(plan.share), ['c', 'e', 'a', 'd']);
  const answers: Row[] = [];
  const step = (now: string, extra: Row[] = []) => {
    const state = input([natural], log(...t1Rows, ...answers, ...extra), now);
    const before = structuredClone({ plan, history: state.history });
    const next = nextCard(plan, state, { subject: '自然' });
    const row = progress(plan, state);
    assert.deepEqual({ plan, history: state.history }, before);
    return { next, row: [row.done, row.total, row.subjects[0].remainingSeconds] };
  };
  const expect = (now: string, lt: string, early: boolean, row: number[]) => {
    const result = step(now);
    const got = card(result.next);
    assert.deepEqual([got.lt, got.early, result.row], [lt, early, row], now);
    return got;
  };
  const first = expect(at('10-24', '19:00:00.000'), 'c', false, [0, 4, 60]);
  assert.deepEqual(step(at('10-24', '19:00:00.000')).next, { kind: 'card', card: first });
  assert.deepEqual([first.isNew, first.typed, first.deck], [false, false, NATURAL]);
  answers.push([at('10-24', '19:00:00.000'), 'c', 'miss']);
  expect(at('10-24', '19:00:10.000'), 'e', false, [0, 4, 60]);
  answers.push([at('10-24', '19:00:10.000'), 'e', 'good']);
  // 取消 e 之後，e 回到還沒碰過。
  const undone = step(at('10-24', '19:00:30.000'), [encodeEntry(at('10-24', '19:00:20.000'), { undo: at('10-24', '19:00:10.000') })]);
  assert.deepEqual([card(undone.next).lt, undone.row], ['e', [0, 4, 60]]);
  expect(at('10-24', '19:01:05.000'), 'c', false, [1, 4, 45]);
  answers.push([at('10-24', '19:01:05.000'), 'c', 'good']);
  expect(at('10-24', '19:01:10.000'), 'a', false, [2, 4, 30]);
  answers.push([at('10-24', '19:01:10.000'), 'a', 'near']);
  const d = expect(at('10-24', '19:01:20.000'), 'd', false, [2, 4, 30]);
  assert.equal(d.isNew, true);
  answers.push([at('10-24', '19:01:20.000'), 'd', 'good']);
  expect(at('10-24', '19:01:30.000'), 'a', true, [3, 4, 15]);
  answers.push([at('10-24', '19:01:30.000'), 'a', 'good']);
  const done = step(at('10-24', '19:01:40.000'));
  assert.deepEqual([done.next, done.row], [{ kind: 'done' }, [4, 4, 0]]);
  assert.deepEqual(step('2026-10-25T03:59:59.999+08:00').next, { kind: 'done' });
  assert.deepEqual(step('2026-10-25T04:00:00.000+08:00').next, { kind: 'stale' });
  answers.length = 0;
  assert.equal(card(step('2026-10-25T03:59:59.000+08:00').next).lt, 'c');
  assert.deepEqual(step('2026-10-25T04:00:00.000+08:00').next, { kind: 'stale' });
});

void test('T6 範圍：當日卡只出那篇卡組，再複習一些跳過另一個方向今天作答過的，今天的錯題補強不算碰過', () => {
  const other = deckEntry('國二上/自然/2-3 濃度.md', { 科目: '自然' }, [goal('f')]);
  const decks = [natural, other];
  const plan = planToday(input(decks, log(...t1Rows), at('10-24')));
  assert.deepEqual(ids(plan.share), ['c', 'e', 'a', 'd', 'f']);
  const pick = (deck: string, rows: Row[] = []) => nextCard(plan, input(decks, log(...t1Rows, ...rows), at('10-24', '19:05:00.000')), { deck });
  assert.equal(card(pick(other.path)).lt, 'f');
  assert.equal(card(pick(NATURAL)).lt, 'c');
  assert.deepEqual(pick(other.path, [[at('10-24'), 'f', 'good']]), { kind: 'done' });
  assert.equal(card(pick(NATURAL, [[at('10-24'), 'f', 'good']])).lt, 'c');
  assert.equal(card(pick(other.path, [mistake(at('10-24'), 'f')])).lt, 'f');
  assert.deepEqual(nextCard(plan, input(decks, log(...t1Rows), at('10-24')), { subject: '英文' }), { kind: 'done' });

  const rows: Row[] = [[A, 'E', 'good'], [A, 'Z', 'easy']];
  const more = planToday(input([english()], log(...rows), at('11-14'), { cap: 0 }));
  const next = (extra: Row[]) => nextCard(more, input([english()], log(...rows, ...extra), at('11-14', '19:05:00.000')), { more: true });
  const e = card(next([]));
  assert.deepEqual([e.lt, e.typed, e.isNew, e.prompt.kind === 'qa' && e.prompt.question], ['E', false, false, 'borrow']);
  assert.deepEqual(next([[at('11-14'), 'Z', 'good']]), { kind: 'done' });
  assert.equal(card(next([mistake(at('11-14'), 'Z')])).lt, 'E');
  assert.deepEqual(nextCard(more, input([english()], log(...rows), at('11-14')), { subject: '英文' }), { kind: 'done' });
});

void test('T7 出哪一題：基本題、答錯再出同一題、進階題輪流、改字當作沒出過', () => {
  const prompts = ['問題零 :: 答案零', '問題一 :: 答案一', '問題二 :: 答案二'];
  const deck = (list = prompts) => deckEntry(NATURAL, { 科目: '自然' }, [goal('p', [], list)]);
  const [p0, p1, p2] = deck().deck.targets[0].prompts.map(prompt => prompt.fingerprint);
  const changed = deck([prompts[0], prompts[1], '問題二（改） :: 答案二']);
  const choose = (rows: Row[], entry = deck()) => {
    const state = input([entry], log(...rows), at('10-24'));
    const got = card(nextCard(planToday(state), state, { subject: '自然' }));
    const prompt = got.prompt;
    assert.ok(prompt.kind === 'qa');
    return prompt.question;
  };
  const day = (date: string): string => '2025-' + date + 'T20:00:00.000+08:00';
  const goods: Row[] = [[day('01-10'), 'p', 'good', p0], [day('02-10'), 'p', 'good', p1], [day('03-10'), 'p', 'good', p2]];
  assert.equal(choose([]), '問題零');
  assert.equal(choose([[at('10-23', '20:00:00.000'), 'p', 'miss', p0]]), '問題零');
  assert.equal(choose(goods.slice(0, 1)), '問題一');
  assert.equal(choose(goods.slice(0, 2)), '問題二');
  assert.equal(choose(goods), '問題一');
  const missToday: Row[] = [...goods, [at('10-24', '18:00:00.000'), 'p', 'miss', p2]];
  assert.equal(choose(missToday), '問題二');
  assert.equal(choose(missToday, changed), '問題二（改）');
  assert.equal(choose([[day('01-10'), 'p', 'good', p0]], deckEntry(NATURAL, { 科目: '自然' }, [goal('p', [], prompts.slice(0, 1))])), '問題零');
  assert.equal(choose([[day('01-10'), 'p', 'good', 'deadbeef']]), '問題一');
  // 今天答對過也算答對過；今天最後一筆答錯但題目已經改字，照進階題的規則選。
  assert.equal(choose([[at('10-24', '18:00:00.000'), 'p', 'good', p0], [at('10-24', '18:00:10.000'), 'p', 'miss', 'deadbeef']]), '問題一');
});

void test('T8 候選：草稿、暫停、轉錄稿、暫停的目標、寫錯、沒有 ID 不出；重複 ID 照路徑第一篇', () => {
  const decks = [
    deckEntry('5 複製.md', { 科目: '自然' }, [goal('g5'), goal('g4')]),
    deckEntry('1 草稿.md', { 狀態: '草稿' }, [goal('d1')]),
    deckEntry('2 暫停.md', { 狀態: '暫停' }, [goal('d2')]),
    deckEntry('3 轉錄.md', { 來源類型: '課本' }, [goal('d3')]),
    deckEntry('4 啟用.md', { 科目: '自然' }, [goal('g1'), goal('g2', ['狀態：暫停']), '- x 中翻英 ^g3', '    - 借入 :: 中文', '- 沒有 ID :: 答案', goal('g4')]),
  ];
  assert.equal(decks[4].deck.targets.find(target => target.id === 'g3')?.ok, false);
  const plan = planToday(input(decks, log(), at('10-24')));
  assert.deepEqual(ids(plan.share), ['g1', 'g4', 'g5']);
  assert.deepEqual(plan.share.map(item => item.deck), ['4 啟用.md', '4 啟用.md', '5 複製.md']);
  assert.deepEqual(plan.problems.map(problem => [problem.deck, problem.line]), [['5 複製.md', 5]]);
  assert.match(plan.problems[0].message, /g4.*4 啟用\.md/);
  // 紀錄裡有、卡組裡沒有的目標不影響結果。
  const ghost = planToday(input(decks, log([A, 'gone', 'good'], [at('10-23'), 'gone', 'miss']), at('10-24')));
  assert.deepEqual([ghost.share, ghost.more], [plan.share, plan.more]);
});

void test('T9 濾網：分類完全相同、重要性冒號全形半形都認；濾掉期間的作答照算', () => {
  const decks = [
    deckEntry('自然.md', { 科目: '自然' }, [goal('h', ['重要性：高']), goal('m'), goal('l', ['重要性：低'])]),
    deckEntry('攝影.md', { 分類: '[攝影, 生活]' }, [goal('f')]),
  ];
  const share = (filter: string[]) => ids(planToday(input(decks, log(), at('10-24'), { filter })).share);
  assert.deepEqual(share([]), ['f', 'h', 'm', 'l']);
  assert.deepEqual(share(['攝影']), ['h', 'm', 'l']);
  assert.deepEqual(share(['攝']), ['f', 'h', 'm', 'l']);
  assert.deepEqual(share(['重要性：低']), ['f', 'h', 'm']);
  assert.deepEqual(share(['重要性:低']), ['f', 'h', 'm']);
  assert.deepEqual(share(['重要性：高', '生活']), ['m', 'l']);
  const photo = (rows: Row[], filter: string[]) => lanes(planToday(input(decks.slice(1), log(...rows), at('10-24'), { filter })));
  assert.deepEqual(photo([[A, 'f', 'good']], ['攝影']), []);
  assert.deepEqual(photo([[A, 'f', 'good']], []), [['f', 'due']]);
  assert.deepEqual(photo([[A, 'f', 'good'], [at('10-23', '21:00:00.000'), 'f', 'miss']], []), [['f', 'relearn']]);
});

void test('T10 錯題補強：照一般到期排，不進 relearn；今天的錯題補強不算碰過', () => {
  const only = [deckEntry(NATURAL, { 科目: '自然' }, [goal('a')])];
  const rows: Row[] = [[A, 'a', 'good'], mistake('2026-10-21T19:02:11.020+08:00', 'a')];
  assert.deepEqual(lanes(planToday(input(only, log(...rows), at('10-22')))), [['a', 'due']]);
  assert.deepEqual(lanes(planToday(input(only, log(...rows), at('10-22'), { exam: scope(['a'], false) }))), [['a', 'exam-due']]);
  const plan = planToday(input(only, log([A, 'a', 'good']), at('10-24')));
  assert.deepEqual(lanes(plan), [['a', 'due']]);
  const state = input(only, log([A, 'a', 'good'], mistake(at('10-24', '18:00:00.000'), 'a')), at('10-24'));
  const got = card(nextCard(plan, state, { subject: '自然' }));
  assert.deepEqual([got.lt, got.early, got.isNew], ['a', false, false]);
  const row = progress(plan, state);
  assert.deepEqual([row.done, row.total], [0, 1]);
  // 只有錯題補強紀錄的目標不是新卡。
  const fresh = planToday(input(only, log(), at('10-24')));
  assert.equal(card(nextCard(fresh, input(only, log(mistake(at('10-24', '18:00:00.000'), 'a')), at('10-24')), { subject: '自然' })).isNew, false);
  assert.equal(card(nextCard(fresh, input(only, log(), at('10-24')), { subject: '自然' })).isNew, true);
});

void test('T11 入口排序：考試範圍的先、剩比較多的先、學業以外的（null）在沒做完的最後、做完的到最下面', () => {
  const decks = [
    deckEntry('英文.md', { 科目: '英文' }, [goal('e1'), goal('e2'), goal('e3')]),
    deckEntry('自然.md', { 科目: '自然' }, [goal('n1'), goal('n2')]),
    deckEntry('數學.md', { 科目: '數學' }, [goal('m1')]),
    deckEntry('其他.md', {}, [goal('o1'), goal('o2')]),
    deckEntry('社會.md', { 科目: '社會' }, [goal('s1', ['狀態：暫停'])]),
  ];
  const exam = scope(['m1'], false);
  const plan = planToday(input(decks, log(), at('10-24'), { exam }));
  const rows = (answers: Row[]) => {
    const result = progress(plan, input(decks, log(...answers), at('10-24', '20:00:00.000'), { exam }));
    return { done: result.done, total: result.total, subjects: result.subjects.map(row => [row.subject, row.done, row.total, row.remainingSeconds, row.inExam]) };
  };
  assert.deepEqual(rows([]), { done: 0, total: 8, subjects: [
    ['數學', 0, 1, 15, true], ['英文', 0, 3, 45, false], ['自然', 0, 2, 30, false], [null, 0, 2, 30, false]] });
  const english: Row[] = ['e1', 'e2', 'e3'].map((lt, i) => [at('10-24', '19:00:0' + String(i) + '.000'), lt, 'good']);
  assert.deepEqual(rows(english), { done: 3, total: 8, subjects: [
    ['數學', 0, 1, 15, true], ['自然', 0, 2, 30, false], [null, 0, 2, 30, false], ['英文', 3, 3, 0, false]] });
  assert.deepEqual(rows([...english, [at('10-24'), 'n1', 'near']]).subjects.slice(1, 3), [['自然', 0, 2, 30, false], [null, 0, 2, 30, false]]);
  // 學業以外的那一列剩得比較多，仍排在學業科目後面。
  assert.deepEqual(rows([...english, [at('10-24'), 'n1', 'good']]).subjects.slice(1, 3), [['自然', 1, 2, 15, false], [null, 0, 2, 30, false]]);
  assert.deepEqual(rows([...english, [at('10-24'), 'o1', 'good'], [at('10-24', '19:00:10.000'), 'o2', 'good']]).subjects.map(row => row[0]), ['數學', '自然', '英文', null]);
  // 範圍內的目標只在 more 裡也算這一科在範圍裡；沒有範圍時都是 false。
  const relearn = log([at('10-23'), 'n1', 'miss']);
  const cut = planToday(input(decks, relearn, at('10-24'), { exam: scope(['n2'], false), cap: 0.25 }));
  assert.deepEqual([ids(cut.share), cut.more[0].lt], [['n1'], 'n2']);
  assert.deepEqual(progress(cut, input(decks, relearn, at('10-24'), { exam: scope(['n2'], false) })).subjects.map(row => [row.subject, row.inExam]), [['自然', true]]);
  const none = progress(planToday(input(decks, log(), at('10-24'))), input(decks, log(), at('10-24')));
  assert.deepEqual(none.subjects.map(row => row.inExam), [false, false, false, false]);
});

void test('T12 打字卡：去掉頭尾空白、不分大小寫、連續的空白當成一個（D-158），其餘完全相同', () => {
  const deck = deckEntry(ENGLISH, { 科目: '英文' }, [
    '- borrow 中翻英 ^z1', '    - 借入 :: borrow', '- look after 中翻英 ^z2', '    - 照顧 :: look after',
    '- borrow 英翻中 ^e1', '    - borrow :: 借入', '- after 中翻英 ^z3', '    - ==after== 之後',
    "- make up one's mind 中翻英 ^z4", '    - 他已經下定決心。He has already ＿＿. :: made up his mind | made his mind up',
  ]);
  const prompt = (id: string): Prompt => {
    const found = deck.deck.targets.find(target => target.id === id);
    assert.ok(found);
    return found.prompts[0];
  };
  assert.equal(checkTyped(prompt('z1'), ' Borrow '), true);
  assert.equal(checkTyped(prompt('z1'), 'borow'), false);
  assert.equal(checkTyped(prompt('z1'), 'borrow.'), false);
  assert.equal(checkTyped(prompt('z2'), 'Look After'), true);
  assert.equal(checkTyped(prompt('z2'), 'look  after'), true);
  assert.throws(() => checkTyped(prompt('e1'), 'borrow'), TypeError);
  assert.throws(() => checkTyped(prompt('z3'), 'after'), TypeError);
  // R3（D-122）：對中任何一個答案就算對；比對規則每一個都相同。
  assert.equal(checkTyped(prompt('z4'), 'made up his mind'), true);
  assert.equal(checkTyped(prompt('z4'), ' Made His Mind Up '), true);
  assert.equal(checkTyped(prompt('z4'), 'made his mind  up'), true);
  assert.equal(checkTyped(prompt('z4'), 'decided'), false);
  const state = input([deck], log(), at('10-24'));
  const typed = card(nextCard(planToday(state), state, { subject: '英文' }));
  assert.deepEqual([typed.lt, typed.typed, typed.isNew], ['z2', true, true]);
});

// D-158：從網頁或 PDF 複製的答案常帶彎引號與不換行空白；只換列出的字元，其他照舊算錯。
void test('T12 D-158 打字卡：彎的單引號當成 \'，空白字元與 Tab 當成空白；ʼ、＇、雙引號、零寬字元、全形字母、撇號與空白的有無照舊算錯', () => {
  const deck = deckEntry(ENGLISH, { 科目: '英文' }, [
    '- o’clock 中翻英 ^q1', '    - 現在七點。It is seven ＿＿. :: o’clock',
    "- o'clock 中翻英 ^q2", "    - 現在七點。It is seven ＿＿. :: o'clock",
    '- look after 中翻英 ^q3', '    - 照顧 :: look after',
    "- make up one's mind 中翻英 ^q4", '    - 下定決心 :: made up his mind | made his mind up',
    "- don't 中翻英 ^q5", "    - 不要 :: don't",
    '- a part 中翻英 ^q6', '    - 一部分 :: a part',
    '- apart 中翻英 ^q7', '    - 分開 :: apart',
  ]);
  const prompt = (id: string): Prompt => {
    const found = deck.deck.targets.find(target => target.id === id);
    assert.ok(found);
    return found.prompts[0];
  };
  assert.equal(checkTyped(prompt('q1'), "o'clock"), true, '答案是 ’，打 \'');
  assert.equal(checkTyped(prompt('q1'), 'o’clock'), true);
  assert.equal(checkTyped(prompt('q2'), 'o’clock'), true, '答案是 \'，打 ’');
  assert.equal(checkTyped(prompt('q2'), 'o‘clock'), true, '‘ 也當成 \'');
  assert.equal(checkTyped(prompt('q3'), 'look after'), true, '答案中間是不換行空白');
  assert.equal(checkTyped(prompt('q3'), 'Look　After'), true, '全形空白');
  assert.equal(checkTyped(prompt('q3'), 'look\tafter'), true, 'Tab');
  assert.equal(checkTyped(prompt('q3'), 'look   after'), true, '混在一起的空白也當成一個');
  assert.equal(checkTyped(prompt('q4'), 'made his mind up'), true, '第二個答案也適用');
  for (const [id, text] of [
    ['q2', 'oʼclock'], ['q2', 'o＇clock'], ['q2', 'o"clock'], ['q2', 'o“clock'], ['q2', "o'​clock"], ['q2', "ｏ'clock"],
    ['q5', 'dont'], ['q6', 'apart'], ['q7', 'a part'], ['q3', 'lookafter'],
  ] as const) assert.equal(checkTyped(prompt(id), text), false, `${id} 打 ${text}`);
});

void test('T13 固定性：卡組與紀錄來源的順序不影響結果，planToday 不改輸入', () => {
  const extra = deckEntry('國二上/自然/2-1 物質.md', { 科目: '自然' }, [goal('x1'), goal('x2', ['重要性：低']), goal('x3')]);
  const decks = [natural, english(), extra];
  const rows = [...t1Rows, [A, 'E', 'good'], [A, 'x2', 'good'], [A, 'x3', 'good']] as Row[];
  const lines = rows.map(row => typeof row === 'string' ? row : encodeEntry(row[0], { lt: row[1], r: row[2], v: '12345678' }));
  const sources = [
    { path: 'Essence Cards/紀錄/2026-10 Phone-a.jsonl', text: lines.filter((_, i) => i % 2).join('\n') },
    { path: 'Essence Cards/紀錄/2026-10 PC-b.jsonl', text: lines.filter((_, i) => !(i % 2)).join('\n') },
  ];
  const state = { ...input(decks, mergeHistory(sources), at('10-24'), { cap: 1 }) };
  const before = structuredClone(state);
  const plan = planToday(state);
  assert.deepEqual(state, before);
  assert.deepEqual([ids(plan.share), ids(plan.more)], [['c', 'e', 'E', 'a'], ['x3', 'x2', 'x1', 'd']]);
  for (const order of [[2, 0, 1], [1, 2, 0], [2, 1, 0]]) {
    const shuffled = planToday(input(order.map(i => decks[i]), mergeHistory([...sources].reverse()), at('10-24'), { cap: 1 }));
    assert.deepEqual([shuffled.share, shuffled.more], [plan.share, plan.more]);
  }
});

// 300 ms／20 ms 的量測在 npm run bench；這裡只抓演算法變慢好幾倍的錯（W3 L2-6）。
void test('T14 三年份防退化：planToday 1000 ms、作答後 nextCard＋progress 100 ms 內', t => {
  const history = mergeHistory(threeYears().sources);
  const state = input(threeYearDecks(), history, '2026-10-02T19:00:00.000+08:00');
  const median = (times: number[]) => [...times].sort((a, b) => a - b)[times.length >> 1];
  const plans: number[] = [];
  let plan = planToday(state);
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    plan = planToday(state);
    plans.push(performance.now() - start);
  }
  assert.ok(plan.share.length > 0 && plan.more.length > 0);
  // 作答後：外掛把新的一筆加到 reviews 最後再呼叫。
  const answered = { ...state, history: { ...history, reviews: [...history.reviews, ...log(['2026-10-02T19:00:00.000+08:00', plan.share[0].lt, 'miss']).reviews] }, now: Date.parse('2026-10-02T19:00:10.000+08:00') };
  const steps: number[] = [];
  for (let run = 0; run < 21; run++) {
    const start = performance.now();
    const next = nextCard(plan, answered, { subject: plan.share[0].subject });
    progress(plan, answered);
    steps.push(performance.now() - start);
    assert.equal(next.kind, 'card');
  }
  t.diagnostic('planToday median ' + median(plans).toFixed(2) + ' ms; nextCard + progress median ' + median(steps).toFixed(2) + ' ms');
  assert.ok(median(plans) < 1000, 'planToday ' + median(plans).toFixed(2) + ' ms，防退化門檻 1000 ms');
  assert.ok(median(steps) < 100, 'nextCard + progress ' + median(steps).toFixed(2) + ' ms，防退化門檻 100 ms');
});

void test('L2-F1 被排除的重複 ID 不參與配對：不汙染原本的配對，也不壓掉不相干的目標', () => {
  const pair = (path: string, word: string, en: string, zh: string) => deckEntry(path, { 科目: '英文' }, [
    '- ' + word + ' 英翻中 ^' + en, '    - ' + word + ' :: 意思', '- ' + word + ' 中翻英 ^' + zh, '    - 意思 :: ' + word,
  ]);
  const next = (decks: DeckEntry[], rows: Row[]) => {
    const plan = planToday(input(decks, log(), at('10-24'), { cap: 0 }));
    assert.deepEqual(ids(plan.more), ['e', 'z2']);
    return nextCard(plan, input(decks, log(...rows), at('10-24', '19:05:00.000')), { more: true });
  };
  // b.md 的 e 是複製來的副本：a.md 的 z 作答過，a.md 的 e 照樣跳過。
  assert.equal(card(next([pair('a.md', 'borrow', 'e', 'z'), pair('b.md', 'borrow', 'e', 'z2')], [[at('10-24'), 'z', 'good']])).lt, 'z2');
  // b.md 改成別的字：它的中翻英作答過，不影響 a.md 的 borrow。
  assert.equal(card(next([pair('a.md', 'borrow', 'e', 'z'), pair('b.md', 'lend', 'e', 'z2')], [[at('10-24'), 'z2', 'good']])).lt, 'e');
});

void test('L2-F2 秒數算在有效的那篇卡組：草稿或暫停的卡組有同一個 ID 也不搶走科目', () => {
  const natural = deckEntry('b.md', { 科目: '自然' }, [goal('old'), goal('n1'), goal('n2')]);
  const rows: Row[] = Array.from({ length: 31 }, (_, i) => [local(Date.parse(at('10-20', '20:00:00.000')) + i * 10_000), 'old', 'good']);
  for (const status of ['草稿', '暫停']) {
    const copy = deckEntry('a.md', { 科目: '英文', 狀態: status }, [goal('old')]);
    for (const decks of [[natural], [copy, natural]]) {
      const plan = planToday(input(decks, log(...rows), at('10-24'), { cap: 20 / 60 }));
      assert.deepEqual([ids(plan.share), ids(plan.more), plan.share[0].seconds], [['n1', 'n2'], [], 10], status);
    }
  }
});

void test('L2-F3 換了時區就要重排：日編號相同也回 stale，進度照排的時候的時區算', () => {
  const only = [deckEntry(NATURAL, { 科目: '自然' }, [goal('x')])];
  const plan = planToday(input(only, log(), '2026-10-24T04:10:00.000+08:00'));
  assert.equal(plan.offset, 480);
  const rows: Row[] = [['2026-10-24T04:10:00.000+08:00', 'x', 'good']];
  const moved: TodayInput = { ...input(only, log(...rows), '2026-10-24T19:00:00.000-05:00'), offset: -300 };
  assert.deepEqual(nextCard(plan, moved, { subject: '自然' }), { kind: 'stale' });
  const row = progress(plan, moved);
  assert.deepEqual([row.done, row.total], [1, 1]);
  assert.deepEqual(nextCard(plan, { ...moved, offset: 480, now: Date.parse('2026-10-24T19:00:00.000+08:00') }, { subject: '自然' }), { kind: 'done' });
  // 用新的時區重排：那一筆在新的一天開始之前，算今天以前的紀錄。
  const again = planToday(moved);
  assert.deepEqual([again.offset, again.share, again.more], [-300, [], []]);
});

void test('L2-F4 做完的科目照當天一開始的順序，不因剩下的時間歸零而改照名稱排', () => {
  const decks = [deckEntry('英文.md', { 科目: '英文' }, [goal('e1'), goal('e2'), goal('e3')]), deckEntry('自然.md', { 科目: '自然' }, [goal('n1')])];
  const plan = planToday(input(decks, log(), at('10-24')));
  const order = (lts: string[]) => progress(plan, input(decks, log(...lts.map((lt, i): Row => [at('10-24', '19:00:0' + String(i) + '.000'), lt, 'good'])), at('10-24', '20:00:00.000')))
    .subjects.map(row => row.subject);
  assert.deepEqual(order([]), ['英文', '自然']);
  assert.deepEqual(order(['n1']), ['英文', '自然']);
  assert.deepEqual(order(['e1', 'e2', 'e3']), ['自然', '英文']);
  assert.deepEqual(order(['e1', 'e2', 'e3', 'n1']), ['英文', '自然']);
});
