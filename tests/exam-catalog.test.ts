import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, lastEnded, paintCatalog, parseScope, scopeAfter, scopeCheck, scopeCountdown, scopeDates, scopeDay, scopeHasSubject, scopeLabels, scopeNotes, scopePeriod, scopeRows, scopeStartDate, targetsInScope } from '../src/core/catalog/index.ts';
import type { CatalogDeck } from '../src/core/catalog/index.ts';
import { parseDeck } from '../src/core/deck/index.ts';

// 範圍和卡組對起來（tasks/exam-scope.md §3、§7、§8）：卡組都是自編的。

const deck = (path: string, text: string): CatalogDeck => ({ path, deck: parseDeck(text) });
/** 屬性與目標：targets 寫 `^id` 加上每個目標底下的資料列。 */
function card(path: string, props: Record<string, string>, targets: Record<string, string[]>): CatalogDeck {
  const head = Object.entries(props).map(([key, value]) => key + ': ' + value).join('\n');
  const body = Object.entries(targets).map(([id, lines]) => '- 目標 ' + id + ' ^' + id + '\n' + [...lines, '問 :: 答'].map(line => '    - ' + line).join('\n')).join('\n');
  return deck(path, '---\n' + head + '\n---\n' + body + '\n');
}
const unit = (term: string, code: string, subject = '自然'): Record<string, string> => ({ 年級學期: term, 科目: subject, 單元: JSON.stringify(code) });
const scope = (...lines: string[]): ReturnType<typeof parseScope> => parseScope(lines.map(line => '- ' + line).join('\n') + '\n');
const inScope = (decks: readonly CatalogDeck[], ...lines: string[]): string[] => [...targetsInScope(scope(...lines), buildIndex(decks))].sort();

void test('目標屬於哪些單元：自己的單元、出處的單元（對得到與對不到卡組的都算），帶依據', () => {
  const index = buildIndex([
    card('Essence Cards/a.md', unit('國二上', '2-1'), { a: ['出處：小五上 3-1 p.15、國二上 2-9 p.3'], b: ['出處：國二上 1-3, 10-15 p.44'], c: ['出處：小五上 p.15'] }),
    card('Essence Cards/b.md', unit('小五上', '3-1'), { d: [] }),
  ]);
  const of = (id: string) => index.members.find(member => member.id === id);
  assert.deepEqual(of('a')?.units, [
    { term: '國二上', subject: '自然', code: '2-1', basis: 'own' },
    { term: '小五上', subject: '自然', code: '3-1', basis: 'written' },
    { term: '國二上', subject: '自然', code: '2-9', basis: 'written' },
  ]);
  assert.deepEqual(of('a')?.sources, ['小五上 3-1 p.15', '國二上 2-9 p.3']);
  assert.deepEqual(of('b')?.units.map(each => [each.code, each.basis]), [['2-1', 'own'], ['1-3', 'written'], ['10-15', 'carried']]);
  assert.equal(of('a')?.missed, false);
  assert.equal(of('c')?.missed, true, '字面上有單元的線索、沒有算進歸屬');
  assert.equal(of('d')?.line, 5);
  assert.equal(of('d')?.path, 'Essence Cards/b.md');
  assert.equal(of('d')?.own, '小五上 3-1');
});

void test('同一個單元有明寫就算明寫；寫到自己的單元還是自己的', () => {
  const index = buildIndex([card('Essence Cards/a.md', unit('國二上', '2-1'), { a: ['出處：國二上 1-3, 10-15 p.44、國二上 10-15 p.45'], b: ['出處：國二上 2-1 p.3'] })]);
  assert.deepEqual(index.members[0].units.map(each => [each.code, each.basis]), [['2-1', 'own'], ['1-3', 'written'], ['10-15', 'written']]);
  assert.deepEqual(index.members[1].units.map(each => [each.code, each.basis]), [['2-1', 'own']]);
});

void test('在範圍內的目標：自己的單元或出處落在範圍內；後來才建的卡組不影響', () => {
  const low = card('Essence Cards/low.md', unit('小四上', '2-1'), { a: ['出處：國二上 2-9 p.3'], b: [] });
  const high = card('Essence Cards/high.md', unit('國二上', '2-2'), { c: [] });
  assert.deepEqual(inScope([low, high], '國二上 自然 2-2'), ['c']);
  assert.deepEqual(inScope([low, high], '國二上 自然 2-9'), ['a'], '2-9 沒有卡組：目標寫到它就算');
  assert.deepEqual(inScope([low, high], '國二上 自然 2'), ['a', 'c'], '整章');
  const later = card('Essence Cards/later.md', unit('國二上', '2-9'), { d: [] });
  assert.deepEqual(inScope([low, high, later], '國二上 自然 2-9'), ['a', 'd']);
});

void test('別的科目、沒有科目、草稿、暫停的不算', () => {
  const english = card('Essence Cards/e.md', unit('國二上', 'L1', '英文'), { a: [] });
  assert.deepEqual(inScope([english], '國二上 自然 L1'), []);
  const none = deck('Essence Cards/n.md', '---\n年級學期: 國二上\n---\n- 目標 ^b\n    - 出處：國二上 2-1\n    - 問 :: 答\n');
  assert.deepEqual(inScope([none], '國二上 自然 2-1'), [], '自己沒有科目，不把 null 補成範圍裡的科目');
  const draft = card('Essence Cards/d.md', { ...unit('國二上', '2-1'), 狀態: '草稿' }, { c: [] });
  const paused = card('Essence Cards/p.md', { ...unit('國二上', '2-1'), 狀態: '暫停' }, { d: [] });
  const stopped = card('Essence Cards/s.md', unit('國二上', '2-1'), { e: ['狀態：暫停'], f: [] });
  assert.deepEqual(inScope([draft, paused, stopped], '國二上 自然 2-1'), ['f']);
});

// ── 入口與目錄那一列（§7）──

let made = 0;
const SCIENCE = (term: string, ...codes: string[]): CatalogDeck[] => codes.map(code => card(`Essence Cards/自然 ${term} ${code}.md`, unit(term, code), { ['s' + String(++made)]: [] }));
const ENGLISH = (term: string, ...codes: string[]): CatalogDeck[] => codes.map(code => card(`Essence Cards/英文 ${term} ${code}.md`, unit(term, code, '英文'), { ['e' + String(++made)]: [] }));
const painted = (decks: readonly CatalogDeck[]) => paintCatalog(buildIndex(decks), new Map(), new Set());
const labels = (decks: readonly CatalogDeck[], ...lines: string[]): [string, string][] => scopeLabels(scope(...lines), painted(decks)).map(each => [each.subject, each.label]);

void test('一科一行，同一學期最多三段列編號：相鄰才併、整章算一段', () => {
  const book = [...SCIENCE('國二上', '2-1', '2-2', '2-3', '3-1', '3-2'), ...ENGLISH('國二上', 'L1', 'L2', 'L3', 'L4')];
  assert.deepEqual(labels(book, '國二上 自然 2-1', '國二上 自然 2-2', '國二上 自然 2-3', '國二上 自然 3-1'), [['自然', '2-1～2-3、3-1']]);
  assert.deepEqual(labels(book, '國二上 自然 2', '國二上 自然 3-1'), [['自然', '2 全部、3-1']]);
  assert.deepEqual(labels(book, '國二上 英文 L1', '國二上 英文 L2', '國二上 英文 L3'), [['英文', 'L1～L3']]);
  assert.deepEqual(labels(book, '國二上 自然 2-1', '國二上 自然 2-3'), [['自然', '2-1、2-3']], '中間的 2-2 沒勾不併');
  assert.deepEqual(labels(book, '國二上 自然 2-3', '國二上 英文 L1'), [['自然', '2-3'], ['英文', 'L1']], '一科一行');
  assert.deepEqual(labels(book, '國二上 自然 9-9'), [['自然', '9-9']], '沒有卡組的行照樣列');
  assert.deepEqual(labels(book, '八上 自然 2-1'), [['自然', '2-1']], '別名是同一個學期');
});

void test('同一學期超過三段：學期與單元數；沒有卡組的行也算', () => {
  const book = SCIENCE('國二上', '1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '1-7');
  assert.deepEqual(labels(book, '國二上 自然 1-1', '國二上 自然 1-3', '國二上 自然 1-5', '國二上 自然 1-7'), [['自然', '國二上，共 4 個單元']]);
  assert.deepEqual(labels(book, '國二上 自然 1-1', '國二上 自然 1-3', '國二上 自然 1-5', '國二上 自然 1-7', '國二上 自然 9-1'), [['自然', '國二上，共 5 個單元']]);
});

void test('跨學期：相連寫頭尾，有缺列出學期；整份有好幾個學期時列編號的前面加學期', () => {
  const book = [...SCIENCE('國一上', '1-1'), ...SCIENCE('國一下', '2-1', '2-2', '2-3'), ...SCIENCE('國二上', '3-1'), ...ENGLISH('國二上', 'L1')];
  assert.deepEqual(labels(book, '國一上 自然 1', '國一下 自然 2', '國二上 自然 3'), [['自然', '國一上～國二上，共 5 個單元']]);
  assert.deepEqual(labels(book, '國一上 自然 1', '國二上 自然 3'), [['自然', '國一上、國二上，共 2 個單元']]);
  assert.deepEqual(labels(book, '國一下 自然 2-1', '國一下 自然 2-2', '國一下 自然 2-3', '國二上 英文 L1'), [['自然', '國一下 2-1～2-3'], ['英文', '國二上 L1']]);
});

const after = (decks: readonly CatalogDeck[], ...lines: string[]): string | null => scopeAfter(scope(...lines), painted(decks));

void test('排在範圍後面的單元：已啟用、最新學期、排在最後一個已勾的後面；草稿、暫停、前面沒勾的、舊學期、範圍外的科目不列', () => {
  const book = SCIENCE('國二上', '1-1', '2-1', '2-2', '2-3');
  assert.equal(after(book, '國二上 自然 2-1', '國二上 自然 2-2'), '自然 2-3 不在範圍內');
  assert.equal(after(book, '國二上 自然 2-1', '國二上 自然 2-2', '國二上 自然 2-3'), null, '勾進範圍後那一行消失');
  const draft = [...SCIENCE('國二上', '2-1', '2-2'), card('Essence Cards/d.md', { ...unit('國二上', '2-3'), 狀態: '草稿' }, { d: [] }), card('Essence Cards/p.md', { ...unit('國二上', '2-4'), 狀態: '暫停' }, { p: [] })];
  assert.equal(after(draft, '國二上 自然 2-2'), null);
  const chapter = SCIENCE('國二上', '2-1', '2-4', '3-1');
  assert.equal(after(chapter, '國二上 自然 2'), '自然 3-1 不在範圍內', '整章底下的 2-4 不列');
  assert.equal(after([...SCIENCE('國一下', '5-1'), ...SCIENCE('國二上', '1-1', '1-2')], '國一下 自然 5-1', '國二上 自然 1-1'), '自然 1-2 不在範圍內', '舊學期的 5-1 之後沒有東西也不看');
  assert.equal(after([...SCIENCE('國一下', '5-1', '5-2'), ...SCIENCE('國二上', '1-1')], '國一下 自然 5-1', '國二上 自然 1-1'), null, '舊學期的不列');
  assert.equal(after([...SCIENCE('國二上', '1-1', '1-2'), ...ENGLISH('國二上', 'L1')], '國二上 自然 1-2'), null, '範圍外的科目不列');
  const many = [...SCIENCE('國二上', '1-1', '1-2', '1-3', '1-4', '1-5')];
  assert.equal(after(many, '國二上 自然 1-1'), '自然 1-2、自然 1-3、自然 1-4 不在範圍內，另有 1 個');
  assert.equal(after([...SCIENCE('國二上', '1-1', '1-2'), ...ENGLISH('國二上', 'L1', 'L2')], '國二上 自然 1-1', '國二上 英文 L1'), '自然 1-2、英文 L2 不在範圍內');
});

void test('入口的行數：一句話算看不懂，分類行不算；單元、科目、學期對不到都算對不到；整章底下有卡組就對得到', () => {
  const book = SCIENCE('國二上', '2-1');
  const notes = (...lines: string[]) => scopeNotes(parseScope(lines.join('\n') + '\n'), painted(book));
  assert.deepEqual(notes('- 國二上 自然 2-1'), { unreadable: 0, unmatched: 0 });
  assert.deepEqual(notes('- 國二上 自然 2'), { unreadable: 0, unmatched: 0 });
  assert.deepEqual(notes('老師說第三節不考', '分類：醫學'), { unreadable: 1, unmatched: 0 });
  assert.deepEqual(notes('- 國二上 自然 9-9', '- 國二上 理化 2-1', '- 國一上 自然 2-1'), { unreadable: 0, unmatched: 3 });
});

void test('倒數：開始日前是天數，考試期間內是今天；沒有有效的期間是 null', () => {
  const period = scopePeriod(parseScope('---\n考試開始: 2026-10-28\n考試結束: 2026-10-29\n---\n'));
  assert.equal(scopeCountdown(period, scopeDay('2026-10-16')), 12);
  assert.equal(scopeCountdown(period, scopeDay('2026-10-27')), 1);
  assert.equal(scopeCountdown(period, scopeDay('2026-10-28')), 'today');
  assert.equal(scopeCountdown(period, scopeDay('2026-10-29')), 'today');
  assert.equal(scopeCountdown(scopePeriod(parseScope('---\n識別碼: x\n---\n')), 0), null);
  assert.equal(scopeCountdown(scopePeriod(parseScope('---\n考試開始: 10/28\n---\n')), 0), null);
  if (period.kind !== 'ok') throw Error('period');
  assert.equal(scopeDates(period), '10/28～10/29');
  assert.equal(scopeStartDate(period), '10/28');
  const single = scopePeriod(parseScope('---\n考試開始: 2026-01-05\n---\n'));
  if (single.kind !== 'ok') throw Error('single');
  assert.equal(scopeDates(single), '1/5');
});

void test('範圍有沒有寫到這一科：全半形與別名不影響；給了學期就要是那個學期的', () => {
  const file = scope('八上 自然 2-1');
  assert.equal(scopeHasSubject(file, '自然'), true);
  assert.equal(scopeHasSubject(file, '英文'), false);
  assert.equal(scopeHasSubject(file, '自然', '國二上'), true);
  assert.equal(scopeHasSubject(file, '自然', '小五上'), false);
});

// ── 還不確定（§8）──

const check = (decks: readonly CatalogDeck[], ...lines: string[]) => scopeCheck(scope(...lines), buildIndex(decks));
const reasons = (decks: readonly CatalogDeck[], ...lines: string[]): [string, string[]][] => check(decks, ...lines).unsure.map(each => [each.id, each.reasons]);

void test('來自別的單元：屬於範圍內的單元，自己的單元不在範圍內；列名稱與自己的單元', () => {
  const low = card('Essence Cards/low.md', unit('小四上', '2-1'), { a: ['出處：國二上 1-1 p.3'], b: [] });
  const high = card('Essence Cards/high.md', unit('國二上', '1-1'), { c: [] });
  assert.deepEqual(check([low, high], '國二上 自然 1-1').fromOther.map(each => [each.id, each.name, each.own, each.line]), [['a', '目標 a', '小四上 2-1', 5]]);
  assert.deepEqual(check([low, high], '國二上 自然 1-1', '小四上 自然 2-1').fromOther, [], '自己的單元也在範圍內');
});

void test('可能多算：只靠沿用學期的參照落在範圍內；明寫的、自己的單元在範圍內不算', () => {
  const carried = card('Essence Cards/a.md', unit('國二上', '2-1'), { a: ['出處：國二上 1-3, 10-15 p.44'] });
  assert.deepEqual(reasons([carried, ...SCIENCE('國二上', '10-15', '1-3')], '國二上 自然 10-15'), [['a', ['可能多算']]]);
  assert.deepEqual(reasons([carried, ...SCIENCE('國二上', '10-15', '1-3')], '國二上 自然 1-3'), [], '明寫的不算');
  assert.deepEqual(reasons([carried, ...SCIENCE('國二上', '10-15', '1-3')], '國二上 自然 2-1'), [], '自己的單元在範圍內');
  assert.deepEqual(reasons([carried, ...SCIENCE('國二上', '10-15', '1-3')], '國二上 自然 2-1', '國二上 自然 10-15'), [], '同時有自己的單元');
  const both = card('Essence Cards/a.md', unit('國二上', '2-1'), { a: ['出處：國二上 1-3, 10-15 p.44、國二上 10-15 p.45'] });
  assert.deepEqual(reasons([both, ...SCIENCE('國二上', '10-15', '1-3')], '國二上 自然 10-15'), [], '明寫與沿用都有');
  const exact = card('Essence Cards/a.md', unit('國二上', '2-1'), { a: ['出處：國二上 1-3 p.20'] });
  assert.deepEqual(reasons([exact, ...SCIENCE('國二上', '1-3')], '國二上 自然 1-3'), [], '`國二上 1-3 p.20` 明寫的不算');
});

void test('可能打錯：這份範圍寫到的學期與科目裡，明寫但沒有卡組的單元；範圍檔的行本身對不到不算這裡', () => {
  const typo = card('Essence Cards/a.md', unit('國二上', '2-1'), { a: ['出處：國二上 1-9 p.3'] });
  assert.deepEqual(reasons([typo], '國二上 自然 2-1'), [['a', ['可能打錯']]]);
  assert.deepEqual(reasons([typo], '國一上 自然 2-1'), [], '別的學期');
  assert.deepEqual(reasons([typo], '國二上 英文 L1'), [], '別的科目');
  assert.deepEqual(reasons([typo, ...SCIENCE('國二上', '1-9')], '國二上 自然 2-1'), [], '有卡組就不算');
  assert.deepEqual(reasons(SCIENCE('國二上', '2-1'), '國二上 自然 9-9'), [], '範圍檔的行對不到是 §2-6 的行數');
});

void test('可能少算：這份範圍寫到的科目裡，疑似漏掉的出處；普通舊標題、位置、本篇明示、否定段不列', () => {
  const missed = card('Essence Cards/a.md', unit('國二上', '2-1'), { a: ['出處：小五上 p.15'], b: ['出處：1-3 p.20'], c: ['出處：溶解度的舊標題'], d: ['出處：p.46-44'], e: ['出處：本篇'], f: ['出處：不要算國二上 2-2'] });
  assert.deepEqual(reasons([missed], '國二上 自然 2-1'), [['a', ['可能少算']], ['b', ['可能少算']]]);
  assert.deepEqual(reasons([missed], '國二上 英文 L1'), [], '範圍外的科目不列');
  const line = check([card('Essence Cards/a.md', unit('國二上', '2-1'), { a: ['出處：p.44 及 1-8 p.45'] })], '國二上 自然 2-1').unsure;
  assert.match(line[0]?.source ?? '', /1-8/, '原文看得到線索');
});

void test('同一個目標寫了三種還不確定只算一次、原因都寫', () => {
  const many = card('Essence Cards/a.md', unit('國二上', '2-1'), { a: ['出處：國二上 1-3, 10-15 p.44、國二上 1-9 p.3、小五上 p.15'] });
  assert.deepEqual(reasons([many, ...SCIENCE('國二上', '10-15', '1-3')], '國二上 自然 10-15'), [['a', ['可能多算', '可能打錯', '可能少算']]]);
});

void test('勾選改變時數字跟著變', () => {
  const book = [card('Essence Cards/a.md', unit('國二上', '2-1'), { a: ['出處：國二上 1-1 p.3'] }), ...SCIENCE('國二上', '1-1')];
  assert.equal(check(book, '國二上 自然 2-1').fromOther.length, 0);
  assert.equal(check(book, '國二上 自然 1-1').fromOther.length, 1);
});

// ── 預先勾好（使用者 2026-11-04）──

void test('上一份怎麼算：提前結束那天、過了的結束日；同一個識別碼結束了，舊副本不算', () => {
  const today = scopeDay('2026-10-20');
  const entry = (path: string, head: string) => ({ path, file: parseScope(`---\n${head}\n---\n- 國二上 自然 2\n`) });
  assert.equal(lastEnded([], today), null);
  assert.equal(lastEnded([entry('a', '考試開始: 2026-09-01')], today), '2026-09-01');
  assert.equal(lastEnded([entry('a', '考試開始: 2026-12-01')], today), null, '還沒考');
  assert.equal(lastEnded([entry('a', '考試開始: 2026-12-01\n提前結束: 2026-10-10')], today), '2026-10-10');
  assert.equal(lastEnded([entry('a', '考試開始: 2026-09-01'), entry('b', '考試開始: 2026-10-01')], today), '2026-10-01', '最近的那一份');
  assert.equal(lastEnded([entry('a', '識別碼: x\n考試開始: 2026-10-01\n提前結束: 2026-09-20'), entry('b', '識別碼: x\n考試開始: 2026-10-01')], today), '2026-09-20');
});

void test('設定畫面的列：學期 → 科目 → 單元；底下有單元的多一列整章，只分第一段；L1 沒有；草稿與暫停照列；沒有卡組的行在最後', () => {
  const book = [
    ...SCIENCE('國二上', '2-1', '1-2-3', '3-1'),
    card('Essence Cards/d.md', { ...unit('國二上', '2-2'), 狀態: '草稿' }, { d1: [] }),
    card('Essence Cards/p.md', { ...unit('國二上', '4'), 狀態: '暫停' }, { p1: [] }),
    ...ENGLISH('國二上', 'L1', 'L2'),
    ...SCIENCE('小五上', '5-1'),
    deck('Essence Cards/其他.md', '- 目標 ^o1\n    - 問 :: 答\n'),
  ];
  const shape = (terms: ReturnType<typeof scopeRows>) => terms.map(term => [term.term, term.subjects.map(subject => [subject.subject, subject.rows.map(row => [row.kind, row.label, row.status])])]);
  assert.deepEqual(shape(scopeRows(null, painted(book))), [
    ['小五上', [['自然', [['chapter', '5 全部', null], ['unit', '5-1', null]]]]],
    ['國二上', [
      ['自然', [['chapter', '1 全部', null], ['unit', '1-2-3', null], ['chapter', '2 全部', null], ['unit', '2-1', null], ['unit', '2-2', 'draft'], ['chapter', '3 全部', null], ['unit', '3-1', null], ['unit', '4', 'paused']]],
      ['英文', [['unit', 'L1', null], ['unit', 'L2', null]]],
    ]],
  ], '「其他」組不列');
  const file = scope('國二上 自然 2-9', '八上 英文 L9', '國二上 理化 1-1', '國三上 地理 7');
  assert.deepEqual(shape(scopeRows(file, painted(SCIENCE('國二上', '2-1')))), [
    ['國二上', [['自然', [['chapter', '2 全部', null], ['unit', '2-1', null], ['extra', '2-9', null]]], ['英文', [['extra', 'L9', null]]], ['理化', [['extra', '1-1', null]]]]],
    ['國三上', [['地理', [['extra', '7', null]]]]],
  ]);
});

void test('設定畫面的列：同編號的單元併進整章；勾選連動的對象；現在範圍裡有沒有；寫法特殊的不能寫', () => {
  const book = [...SCIENCE('國二上', '2', '2-1'), card('Essence Cards/x.md', unit('國二上', '2-1,3'), { x1: [] })];
  const file = scope('國二上 自然 2-1');
  const [{ subjects: [{ rows }] }] = scopeRows(file, painted(book));
  assert.deepEqual(rows.map(row => [row.label, row.inScope, row.writable]), [['2 全部', false, true], ['2-1', true, true], ['2-1,3', false, false]]);
  const [chapter, one, odd] = rows;
  assert.deepEqual(chapter.under, [one.key, odd.key]);
  assert.deepEqual(one.above, [chapter.key]);
  assert.deepEqual(one.under, []);
  const whole = scopeRows(scope('國二上 自然 2'), painted(SCIENCE('國二上', '2-1')))[0].subjects[0].rows;
  assert.deepEqual(whole.map(row => row.inScope), [true, true], '整章底下的也算在範圍裡');
});

void test('目錄的單元標「考試」：單元本身在範圍裡才標；目標從別的單元算進去時它自己的單元不標', () => {
  const low = card('Essence Cards/low.md', unit('小四上', '2-1'), { a: ['出處：國二上 1-1 p.3'] });
  const high = card('Essence Cards/high.md', unit('國二上', '1-1'), { b: [] });
  const catalog = paintCatalog(buildIndex([low, high]), new Map(), new Set(), scope('國二上 自然 1'));
  assert.deepEqual(catalog.terms.flatMap(term => term.subjects.flatMap(subject => subject.units.map(each => [each.key.includes('小四上'), each.inExam]))), [[true, false], [false, true]]);
  assert.equal(paintCatalog(buildIndex([high]), new Map(), new Set()).terms[0].subjects[0].units[0].inExam, false, '沒有範圍');
});
