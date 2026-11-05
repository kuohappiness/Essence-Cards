import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/core/deck/index.ts';
import { encodeEntry, mergeHistory, nextCard, planToday, progress, scopeCount } from '../src/core/study/index.ts';
import type { Card, DeckEntry, Next, Pick, Today, TodayInput } from '../src/core/study/index.ts';

// 比較卡的佇列（tasks/question-type-seam.md §5、§11）：例子用規畫與示意頁的字。預期值手算，不用同樣的算法再算一次。
const P = 'Essence Cards/國語/相似字.md';
const ALL = ['han000', 'sai000', 'yyy000', 'zhai00'];
const BRACKET = '（寨、塞、寒、賽） 相似字';
const CHARS = `---
科目: 國語
---
- 寨${BRACKET} ^zhai00
    - 記憶錨點：**山**寨：山寨、營寨
    - 盜匪躲在山＿＿裡。 :: 寨
    - 這座古老的＿＿子建在山頂上。 :: 寨
- 塞${BRACKET} ^sai000
    - 下班時間大＿＿車。 :: 塞
    - 水管＿＿住了。 :: 塞
- 寒${BRACKET} ^han000
    - 冬天很＿＿冷。 :: 寒
    - ＿＿假快到了。 :: 寒
- 賽${BRACKET} ^yyy000
    - 明天有籃球比＿＿。 :: 賽
    - 運動會＿＿跑。 :: 賽
`;
const entry = (text: string, path = P): DeckEntry => ({ path, deck: parseDeck(text) });
const chars = entry(CHARS);
const at = (date: string, time = '19:00:00.000'): string => `2026-${date}T${time}+08:00`;
function v(deck: DeckEntry, lt: string, index: number): string {
  const target = deck.deck.targets.find(each => each.id === lt);
  assert.ok(target, lt);
  return target.prompts[index].fingerprint;
}

interface Options { cap?: number }
function input(decks: DeckEntry[], lines: readonly string[], now: string, options: Options = {}): TodayInput {
  return { decks, history: mergeHistory([{ path: 'Essence Cards/紀錄/2026-10 Phone-test.jsonl', text: lines.join('\n') }]), settings: { capMinutes: options.cap ?? 30, retention: 0.8, filter: [] }, exam: null, now: Date.parse(now), offset: 480 };
}
const good = (t: string, lt: string, print: string): string => encodeEntry(t, { lt, r: 'good', v: print, pick: '字' });
function card(next: Next): Card {
  assert.equal(next.kind, 'card');
  if (next.kind !== 'card') throw Error();
  return next.card;
}
const SUBJECT: Pick = { subject: '國語' };
const next = (today: Today, data: TodayInput, pick: Pick = SUBJECT): Card => card(nextCard(today, data, pick));
const plan = (decks: DeckEntry[], lines: readonly string[], now: string, options?: Options): { today: Today; data: TodayInput } => {
  const data = input(decks, lines, now, options);
  return { today: planToday(data), data };
};
/** 這張卡每個目標的格數，照目標 ID 排。 */
const cells = (c: Card): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const blank of [...c.blanks].sort((a, b) => a.lt < b.lt ? -1 : 1)) counts[blank.lt] = (counts[blank.lt] ?? 0) + 1;
  return counts;
};
const prints = (c: Card, lt: string): string[] => c.blanks.filter(blank => blank.lt === lt).map(blank => blank.prompt.fingerprint).sort();

void test('全新：一張卡，5 格、4 個字鍵、對照 4 行，四個目標都進今天的份', () => {
  const { today, data } = plan([chars], [], at('10-24'));
  assert.deepEqual(today.share.map(item => item.lt).sort(), ALL);
  const c = next(today, data);
  assert.equal(c.blanks.length, 5);
  assert.deepEqual(Object.keys(cells(c)), ALL);
  assert.ok(ALL.every(lt => (cells(c)[lt] ?? 0) >= 1));
  assert.deepEqual(c.group?.members, ['寨', '塞', '寒', '賽']);
  assert.deepEqual([...c.group?.keys ?? []].sort(), ['塞', '寒', '寨', '賽']);
  assert.equal(c.group?.title, '相似字');
  assert.deepEqual(c.group?.rows.map(row => [row.member, row.lt, row.anchor]), [['寨', 'zhai00', '**山**寨：山寨、營寨'], ['塞', 'sai000', null], ['寒', 'han000', null], ['賽', 'yyy000', null]]);
  for (const blank of c.blanks) assert.equal(blank.prompt.kind === 'qa' && blank.prompt.answer, blank.answer);
  assert.equal(c.isNew, true);
  assert.equal(c.early, false);
  assert.ok(c.blanks.some(blank => blank.lt === c.lt && blank.prompt === c.prompt));
});

void test('不同篇同樣的括號不是同一組', () => {
  const other = entry(CHARS, 'Essence Cards/國語/另一篇.md');
  const twin = entry(CHARS.replaceAll('^zhai00', '^zhai01').replaceAll('^sai000', '^sai001').replaceAll('^han000', '^han001').replaceAll('^yyy000', '^yyy001'), other.path);
  const { today, data } = plan([chars, twin], [], at('10-24'));
  const c = next(today, data, { deck: P });
  assert.deepEqual(Object.keys(cells(c)), ALL);
  assert.equal(today.share.reduce((sum, item) => sum + item.seconds, 0), 30);
});

const allGood = (except: readonly string[], when: string): string[] => ALL.filter(lt => !except.includes(lt)).map(lt => good(when, lt, v(chars, lt, 0)));

void test('全部 good 後過幾天只有塞到期：1 格、4 個字鍵、對照 4 行，換一句', () => {
  const lines = [good(at('10-01'), 'sai000', v(chars, 'sai000', 0)), ...allGood(['sai000'], at('10-23'))];
  const { today, data } = plan([chars], lines, at('10-24'));
  assert.deepEqual(today.share.map(item => item.lt), ['sai000']);
  const c = next(today, data);
  assert.deepEqual(cells(c), { sai000: 1 });
  assert.deepEqual(prints(c, 'sai000'), [v(chars, 'sai000', 1)]);
  assert.equal(c.group?.keys.length, 4);
  assert.equal(c.group?.rows.length, 4);
  assert.equal(c.isNew, false);
});

void test('塞、賽到期：併成一張 2 格，不多放；全部到期：多放一句', () => {
  const two = plan([chars], [...['sai000', 'yyy000'].map(lt => good(at('10-01'), lt, v(chars, lt, 0))), ...allGood(['sai000', 'yyy000'], at('10-23'))], at('10-24'));
  assert.deepEqual(cells(next(two.today, two.data)), { sai000: 1, yyy000: 1 });
  const full = plan([chars], allGood([], at('10-01')), at('10-24'));
  const c = next(full.today, full.data);
  assert.equal(c.blanks.length, 5);
  assert.deepEqual(Object.keys(cells(c)), ALL);
});

void test('寨 near、塞 miss：1 分鐘後只出塞，10 分鐘後寨，各換一句；沒別張時提早出，兩個併成一張', () => {
  const t0 = Date.parse(at('10-24'));
  const lines = [encodeEntry(at('10-24'), { lt: 'zhai00', r: 'near', v: v(chars, 'zhai00', 0), pick: '塞', retry: 'right' }), encodeEntry(at('10-24', '19:00:00.001'), { lt: 'sai000', r: 'miss', v: v(chars, 'sai000', 0), pick: null, with: at('10-24') }),
    good(at('10-24', '19:00:00.002'), 'han000', v(chars, 'han000', 0)), good(at('10-24', '19:00:00.003'), 'yyy000', v(chars, 'yyy000', 0))];
  const when = (seconds: number): string => new Date(t0 + seconds * 1000 + 8 * 3600_000).toISOString().slice(0, 23) + '+08:00';
  const today = planToday(input([chars], [], at('10-24', '18:00:00.000')));
  const early = next(today, input([chars], lines, when(10)));
  assert.equal(early.early, true);
  assert.deepEqual(cells(early), { sai000: 1, zhai00: 1 });
  assert.deepEqual(prints(early, 'sai000'), [v(chars, 'sai000', 1)]);
  assert.deepEqual(prints(early, 'zhai00'), [v(chars, 'zhai00', 1)]);
  const sai = next(today, input([chars], lines, when(120)));
  assert.equal(sai.early, false);
  assert.deepEqual(cells(sai), { sai000: 1 });
  assert.deepEqual(prints(sai, 'sai000'), [v(chars, 'sai000', 1)]);
  const after = [...lines, good(when(121), 'sai000', v(chars, 'sai000', 1))];
  const zhai = next(today, input([chars], after, when(130)));
  assert.equal(zhai.early, true);
  assert.deepEqual(cells(zhai), { zhai00: 1 });
  const late = next(today, input([chars], after, when(1200)));
  assert.equal(late.early, false);
  assert.deepEqual(cells(late), { zhai00: 1 });
  assert.deepEqual(prints(late, 'zhai00'), [v(chars, 'zhai00', 1)]);
  assert.equal(nextCard(today, input([chars], [...after, good(when(1201), 'zhai00', v(chars, 'zhai00', 1))], when(1300)), SUBJECT).kind, 'done');
});

void test('今天已經答對的不併；完成照目標算，還剩的一次少好幾個', () => {
  const lines = allGood(['yyy000'], at('10-24'));
  const today = planToday(input([chars], [], at('10-24', '18:00:00.000')));
  const data = input([chars], lines, at('10-24', '19:30:00.000'));
  assert.deepEqual(cells(next(today, data)), { yyy000: 1 });
  assert.deepEqual(scopeCount(today, data, SUBJECT), { done: 3, total: 4 });
  assert.equal(progress(today, data).subjects[0].remainingSeconds, 3.75);
});

void test('暫停的、ID 重複的、被停掉的字：不出句子，字鍵與對照還在', () => {
  const text = CHARS.replace('^zhai00\n', '^zhai00\n    - 狀態：暫停\n').replace('- 塞（寨、塞、寒、賽） 相似字 ^sai000', '- 其他 ^sai000\n    - Q :: A\n- 塞（寨、塞、寒、賽） 相似字 ^sai000');
  const deck = entry(text);
  const held = JSON.stringify({ t: at('10-01'), need: '9.0.0', lt: 'han000', r: 'good', v: '12345678' });
  const { today, data } = plan([deck], [held], at('10-24'));
  assert.deepEqual(today.share.map(item => item.lt), ['yyy000']);
  const c = next(today, data);
  assert.deepEqual(cells(c), { yyy000: 1 });
  assert.equal(c.group?.keys.length, 4);
  assert.deepEqual(c.group?.rows.map(row => row.member), ['寨', '塞', '寒', '賽']);
});

void test('組裡的字沒有自己的目標：字鍵照樣有，對照那一行只有字', () => {
  const deck = entry('---\n科目: 國語\n---\n- 寨（寨、塞） 相似字 ^zhai00\n    - 山＿＿ :: 寨\n');
  const { today, data } = plan([deck], [], at('10-24'));
  const c = next(today, data);
  assert.deepEqual(cells(c), { zhai00: 1 });
  assert.deepEqual(c.group?.rows, [{ member: '寨', lt: 'zhai00', anchor: null }, { member: '塞', lt: null, anchor: null }]);
});

// 兩個選項的組（borrow、lend，每個字三句）：§5-2 的表。
const TWO = `---\n科目: 英文\n---\n- borrow（borrow、lend） 比較 ^borrow\n    - Can I ＿＿ your pen? :: borrow\n    - I ＿＿ books from the library. :: borrow\n    - May I ＿＿ this? :: borrow\n- lend（borrow、lend） 比較 ^lendxx\n    - Can you ＿＿ me a pen? :: lend\n    - Banks ＿＿ money. :: lend\n    - Please ＿＿ me that. :: lend\n`;
const two = entry(TWO);
const ENGLISH: Pick = { subject: '英文' };
const twoGood = (t: string, lt: string): string => good(t, lt, v(two, lt, 0));

void test('兩個選項：全新 3 格、只有一個到期 2 格、兩個都到期 4 格、一新一到期 3 格', () => {
  const fresh = plan([two], [], at('10-24'));
  const first = next(fresh.today, fresh.data, ENGLISH);
  assert.equal(first.blanks.length, 3);
  assert.deepEqual(Object.keys(cells(first)), ['borrow', 'lendxx']);
  const one = plan([two], [twoGood(at('10-01'), 'borrow'), twoGood(at('10-23'), 'lendxx')], at('10-24'));
  assert.deepEqual(cells(next(one.today, one.data, ENGLISH)), { borrow: 2 });
  const both = plan([two], [twoGood(at('10-01'), 'borrow'), twoGood(at('10-01'), 'lendxx')], at('10-24'));
  assert.deepEqual(cells(next(both.today, both.data, ENGLISH)), { borrow: 2, lendxx: 2 });
  const mixed = plan([two], [twoGood(at('10-01'), 'borrow')], at('10-24'));
  assert.deepEqual(cells(next(mixed.today, mixed.data, ENGLISH)), { borrow: 2, lendxx: 1 });
});

// 輪替：只有 borrow 一個目標，同一個字兩格（lend 只在字鍵上）。
const rotating = (sentences: string[]): DeckEntry => entry(`---\n科目: 英文\n---\n- borrow（borrow、lend） 比較 ^borrow\n${sentences.map(name => `    - ${name} ＿＿ :: borrow\n`).join('')}`);
const FOUR = rotating(['A', 'B', 'C', 'D']), THREE = rotating(['A', 'B', 'C']);
const pair = (deck: DeckEntry, t: string, first: string, second: string, r: 'good' | 'near' = 'good'): string =>
  encodeEntry(t, { lt: 'borrow', r, v: v(deck, 'borrow', 'ABCD'.indexOf(first)), pick: 'borrow', also: [{ v: v(deck, 'borrow', 'ABCD'.indexOf(second)), r: 'good', pick: 'borrow' }] });
const DAY = (n: number): string => new Date(Date.parse('2026-01-01T11:00:00.000Z') + n * 86400_000 * 3000).toISOString().slice(0, 23).replace('Z', '') + '+08:00';
// 答對三次之後要很久才到期（間隔上限一百年）：走今天的份，不靠全部卡的一輪。
const FAR = DAY(20);
/** 今天這張卡的兩句，照句子的名字。 */
function nextPair(deck: DeckEntry, lines: readonly string[], now: string): string {
  const { today, data } = plan([deck], lines, now);
  const names = next(today, data, ENGLISH).blanks.map(blank => (blank.prompt.kind === 'qa' ? blank.prompt.question : '')[0]);
  return [...names].join('');
}
const unordered = (text: string): string => [...text].sort().join('');

void test('輪替三句：連續全對照 AB、CA、BC、AB', () => {
  const lines = [pair(THREE, DAY(0), 'A', 'B')];
  assert.equal(unordered(nextPair(THREE, lines, DAY(1))), 'AC');
  lines.push(pair(THREE, DAY(1), 'C', 'A'));
  assert.equal(unordered(nextPair(THREE, lines, DAY(2))), 'BC');
  lines.push(pair(THREE, DAY(2), 'B', 'C'));
  assert.equal(unordered(nextPair(THREE, lines, FAR)), 'AB');
});

void test('輪替四句：AB、CD、AB', () => {
  const lines = [pair(FOUR, DAY(0), 'A', 'B')];
  assert.equal(unordered(nextPair(FOUR, lines, DAY(1))), 'CD');
  lines.push(pair(FOUR, DAY(1), 'C', 'D'));
  assert.equal(unordered(nextPair(FOUR, lines, DAY(2))), 'AB');
});

void test('輪替：一對一錯時也輪得開，而且那個字不算完成', () => {
  const lines = [pair(THREE, at('10-24'), 'A', 'B', 'near')];
  const today = planToday(input([THREE], [], at('10-24', '18:00:00.000')));
  const data = input([THREE], lines, at('10-24', '19:30:00.000'));
  assert.deepEqual(scopeCount(today, data, ENGLISH), { done: 0, total: 1 });
  const names = next(today, data, ENGLISH).blanks.map(blank => blank.prompt.kind === 'qa' ? blank.prompt.question[0] : '');
  assert.equal(unordered(names.join('')), 'AC');
});

void test('輪替：AB@1, CA@2, BC@3 加一句 D 下一次 DA；拿掉 B 只在 A、C 之間選', () => {
  const lines = [pair(THREE, DAY(0), 'A', 'B'), pair(THREE, DAY(1), 'C', 'A'), pair(THREE, DAY(2), 'B', 'C')];
  assert.equal(unordered(nextPair(FOUR, lines, FAR)), 'AD');
  const noB = rotating(['A', 'C']);
  assert.equal(unordered(nextPair(noB, lines, FAR)), 'AC');
});

void test('輪替：指紋相同的兩句算一句，只有一種句子時到期也只出一句；只有一句時還是那一句', () => {
  const same = rotating(['A', 'A']);
  const line = encodeEntry(DAY(0), { lt: 'borrow', r: 'good', v: v(same, 'borrow', 0), pick: 'borrow' });
  assert.equal(nextPair(same, [line], DAY(1)), 'A');
  const one = rotating(['A']);
  assert.equal(nextPair(one, [encodeEntry(DAY(0), { lt: 'borrow', r: 'good', v: v(one, 'borrow', 0), pick: 'borrow' })], DAY(1)), 'A');
});

void test('輪替：undo AB@1 再寫 AB@4 後下一對是 CA，從檔案重讀結果相同', () => {
  const ab1 = pair(THREE, DAY(0), 'A', 'B');
  const lines = [ab1, encodeEntry(DAY(0).replace(':00.000', ':01.000'), { undo: DAY(0) }), pair(THREE, DAY(0).replace(':00.000', ':02.000'), 'A', 'B')];
  assert.equal(unordered(nextPair(THREE, lines, DAY(1))), 'AC');
});

void test('多放的那一句、字鍵與句子的順序：同一張卡不變，換句子就變；三個字鍵以上一定和括號不同；兩個字鍵不強制', () => {
  const { today, data } = plan([chars], [], at('10-24'));
  const a = next(today, data), b = next(today, data);
  assert.deepEqual(a.group?.keys, b.group?.keys);
  assert.deepEqual(a.blanks.map(blank => blank.prompt.fingerprint), b.blanks.map(blank => blank.prompt.fingerprint));
  const orders = new Set<string>(), twoKeys = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const deck = entry(CHARS.replace('盜匪躲在山', `第 ${String(i)} 個盜匪躲在山`));
    const card3 = plan([deck], [], at('10-24'));
    const keys = next(card3.today, card3.data).group?.keys.join('') ?? '';
    assert.notEqual(keys, '寨塞寒賽', String(i));
    orders.add(keys);
    const small = entry(TWO.replace('Can I', `Can ${String(i)} I`));
    const card2 = plan([small], [], at('10-24'));
    twoKeys.add(next(card2.today, card2.data, ENGLISH).group?.keys.join('') ?? '');
  }
  assert.ok(orders.size > 1);
  assert.deepEqual([...twoKeys].sort(), ['borrowlend', 'lendborrow']);
});

void test('各種範圍都照上面併：deck、subject、more、targets；只給一個字時就一格', () => {
  const { today, data } = plan([chars], [], at('10-24'));
  assert.equal(next(today, data, { deck: P }).blanks.length, 5);
  assert.deepEqual(cells(next(today, data, { targets: ['sai000'] })), { sai000: 1 });
  assert.deepEqual(cells(next(today, data, { targets: ['sai000', 'han000'] })), { han000: 1, sai000: 1 });
  const none = plan([chars], [], at('10-24'), { cap: 0.2 });
  assert.equal(next(none.today, none.data, { more: true }).blanks.length, 5);
});

void test('全部卡的一輪也併：新的整組一張；這一輪答對的不併；只給一個字就一格', () => {
  const since = Date.parse(at('10-24'));
  const now = at('10-24', '19:10:00.000');
  const { today, data } = plan([chars], [], now);
  const round = next(today, data, { targets: ALL, since });
  assert.equal(round.blanks.length, 5);
  assert.deepEqual(cells(next(today, data, { targets: ['sai000'], since })), { sai000: 1 });
  const answered = input([chars], [good(at('10-24', '19:05:00.000'), 'sai000', v(chars, 'sai000', 0))], now);
  const after = next(today, answered, { targets: ALL, since });
  assert.deepEqual(Object.keys(cells(after)), ['han000', 'yyy000', 'zhai00']);
  // 這一輪答錯、還沒到時間：不併，沒別張時提早出。
  const wrong = input([chars], [encodeEntry(at('10-24', '19:09:50.000'), { lt: 'sai000', r: 'near', v: v(chars, 'sai000', 0), pick: '寨', retry: 'right' })], now);
  const others = next(today, wrong, { targets: ['sai000', 'han000'], since });
  assert.deepEqual(cells(others), { han000: 1 });
  const early = next(today, wrong, { targets: ['sai000'], since });
  assert.equal(early.early, true);
  assert.deepEqual(prints(early, 'sai000'), [v(chars, 'sai000', 1)]);
});

void test('全部卡的一輪也照出題歷史換句：also 裡出過的句子也算（§5、R2-3）', () => {
  const round = (lines: readonly string[], now: string): string => {
    const { today, data } = plan([FOUR], lines, now);
    const card = next(today, data, { targets: ['borrow'], since: Date.parse(now) });
    return card.blanks.map(blank => (blank.prompt.kind === 'qa' ? blank.prompt.question : '')[0]).join('');
  };
  assert.equal(round([pair(FOUR, DAY(0), 'A', 'B')], DAY(1)), 'CD', 'B 只出現在 also，也算出過');
  assert.equal(round([pair(FOUR, DAY(0), 'A', 'B'), pair(FOUR, DAY(1), 'C', 'D')], DAY(2)), 'AB', '都出過：最久沒出的');
});
