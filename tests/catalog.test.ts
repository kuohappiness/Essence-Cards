import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, paintCatalog, unitColor } from '../src/core/catalog/index.ts';
import type { CatalogDeck, UnitNode } from '../src/core/catalog/index.ts';
import { parseDeck } from '../src/core/deck/index.ts';
import type { MemoryColor } from '../src/core/study/index.ts';

// 單元索引（tasks/entry-and-catalog.md §3、§9）：卡組都是自編的。

const deck = (path: string, text: string): CatalogDeck => ({ path, deck: parseDeck(text) });
/** 屬性與目標：targets 寫 `^id` 加上每個目標底下的資料列。 */
function card(path: string, props: Record<string, string>, targets: Record<string, string[]>): CatalogDeck {
  const head = Object.entries(props).map(([key, value]) => key + ': ' + value).join('\n');
  const body = Object.entries(targets).map(([id, lines]) => '- 目標 ' + id + ' ^' + id + '\n' + [...lines, '問 :: 答'].map(line => '    - ' + line).join('\n')).join('\n');
  return deck(path, '---\n' + head + '\n---\n' + body + '\n');
}
const unit = (term: string, code: string, subject = '自然'): Record<string, string> => ({ 年級學期: term, 科目: subject, 單元: JSON.stringify(code) });
const ids = (node: UnitNode | null): string[] => (node?.targets ?? []).map(target => target.id);
const codes = (units: readonly UnitNode[]): (string | null)[] => units.map(each => each.code);

void test('多篇的單元：課本、習作同一個單元鍵只有一列，目標去重；一篇改草稿，另一篇還在，草稿的目標不算', () => {
  const book = card('Essence Cards/2-1 課本.md', unit('國二上', '2-1 水溶液'), { a: [], b: [] });
  const work = card('Essence Cards/2-1 習作.md', unit('國二上', '2-1 別的名稱'), { b: [], c: [] });
  const index = buildIndex([book, work]);
  assert.equal(index.units.length, 1);
  assert.deepEqual(ids(index.units[0]).sort(), ['a', 'b', 'c']);
  assert.equal(index.units[0].name, '2-1 別的名稱', '名稱顯示路徑第一篇的（習作 < 課本）');
  const draft = card('Essence Cards/2-1 習作.md', { ...unit('國二上', '2-1 別的名稱'), 狀態: '草稿' }, { d: [] });
  const mixed = buildIndex([book, draft]).units[0];
  assert.deepEqual(ids(mixed), ['a', 'b']);
  assert.equal(mixed.status, 'active');
  assert.deepEqual(mixed.decks.map(each => [each.name, each.status]), [['2-1 習作', 'draft'], ['2-1 課本', 'active']]);
});

void test('全部草稿、全部暫停：狀態與數字照 §3', () => {
  const draftA = card('Essence Cards/a.md', { ...unit('國二上', '2-1'), 狀態: '草稿' }, { a: [] });
  const draftB = card('Essence Cards/b.md', { ...unit('國二上', '2-1'), 狀態: '草稿' }, { b: [] });
  const paused = card('Essence Cards/c.md', { ...unit('國二上', '2-2'), 狀態: '暫停' }, { c: [] });
  const painted = paintCatalog(buildIndex([draftA, draftB, paused]), new Map(), new Set());
  const [draftRow, pausedRow] = painted.terms[0].subjects[0].units;
  assert.deepEqual([draftRow.status, draftRow.count, draftRow.decks.length], ['draft', null, 2]);
  assert.deepEqual([pausedRow.status, pausedRow.count], ['paused', 0]);
  assert.equal(pausedRow.color, 'new');
});

void test('跨單元的目標：兩個單元都列它、都算一個，別的單元標「來自」；寫到自己只算一次；共用真正擁有者的狀態', () => {
  const low = card('Essence Cards/low.md', unit('小四上', '2-1'), { a: ['出處：小五上 2-1 p.15、小四上 2-1 p.3、p.4'] });
  const high = card('Essence Cards/high.md', unit('小五上', '2-1'), { b: [] });
  const index = buildIndex([low, high]);
  assert.deepEqual(ids(index.find('小四上', '自然', '2-1')), ['a']);
  assert.deepEqual(ids(index.find('小五上', '自然', '2-1')), ['b', 'a']);
  assert.equal(index.find('小五上', '自然', '2-1')?.targets[1].from, '小四上 2-1');
  assert.equal(index.find('小四上', '自然', '2-1')?.targets[0].from, null);
  // 擁有者暫停或改草稿：哪一個單元都不算。
  for (const status of ['暫停', '草稿']) {
    const stopped = buildIndex([card('Essence Cards/low.md', { ...unit('小四上', '2-1'), 狀態: status }, { a: ['出處：小五上 2-1'] }), high]);
    assert.deepEqual(ids(stopped.find('小五上', '自然', '2-1')), ['b'], status);
  }
  const pausedTarget = buildIndex([card('Essence Cards/low.md', unit('小四上', '2-1'), { a: ['出處：小五上 2-1', '狀態：暫停'] }), high]);
  assert.deepEqual(ids(pausedTarget.find('小五上', '自然', '2-1')), ['b']);
  assert.deepEqual(ids(pausedTarget.find('小四上', '自然', '2-1')), []);
});

void test('出處寫到 A、B：兩個單元各列一次；同一科', () => {
  const owner = card('Essence Cards/o.md', unit('國二上', '1-1'), { a: ['出處：國二上 2-1 p.3、國二上 2-2、國二上 L1'] });
  const others = ['2-1', '2-2', 'L1'].map(code => card('Essence Cards/' + code + '.md', unit('國二上', code), {}));
  const otherSubject = card('Essence Cards/x.md', unit('國二上', '2-1', '數學'), {});
  const index = buildIndex([owner, ...others, otherSubject]);
  for (const code of ['2-1', '2-2', 'L1']) assert.deepEqual(ids(index.find('國二上', '自然', code)), ['a'], code);
  assert.deepEqual(ids(index.find('國二上', '數學', '2-1')), [], '不跨科目');
});

void test('D-166 沒寫年級學期、編號帶逗號的都不算參照：單元有卡組也不歸過去，也不留在對不到的清單', () => {
  const owner = card('Essence Cards/o.md', unit('國二上', '1-1'), { a: ['出處：2-1 p.3、L1、2-2、國二上 L1, L2、國二上 2-2/ p.3'] });
  const others = ['2-1', '2-2', 'L1', 'L2'].map(code => card('Essence Cards/' + code + '.md', unit('國二上', code), {}));
  const index = buildIndex([owner, ...others]);
  for (const code of ['2-1', '2-2', 'L1', 'L2']) assert.deepEqual(ids(index.find('國二上', '自然', code)), [], code);
  assert.deepEqual(index.unresolved, []);
  assert.deepEqual(ids(index.find('國二上', '自然', '1-1')), ['a'], '自己的單元照算');
});

void test('對不到的參照留在索引，目錄沒有節點；段落標題不算參照，新增同名單元的卡組前後都不變', () => {
  const owner = card('Essence Cards/o.md', unit('國二上', '1-1'), { a: ['出處：國二上 1-9 p.3、2 擴散現象、A1 p.20'] });
  const index = buildIndex([owner]);
  assert.deepEqual(index.unresolved, [{ id: 'a', path: 'Essence Cards/o.md', term: '國二上', subject: '自然', code: '1-9' }]);
  assert.equal(index.find('國二上', '自然', '1-9'), null);
  // 新增單元 2、A1 的卡組：目標歸屬不變。
  const more = buildIndex([owner, card('Essence Cards/2.md', unit('國二上', '2'), {}), card('Essence Cards/a1.md', unit('國二上', 'A1'), {})]);
  assert.deepEqual(ids(more.find('國二上', '自然', '2')), []);
  assert.deepEqual(ids(more.find('國二上', '自然', 'A1')), []);
  // 補上單元 1-9 的卡組：參照對到了。
  const filled = buildIndex([owner, card('Essence Cards/9.md', unit('國二上', '1-9'), {})]);
  assert.deepEqual(filled.unresolved, []);
  assert.deepEqual(ids(filled.find('國二上', '自然', '1-9')), ['a']);
});

void test('全形編號對不到 2-1，退回文字；單元屬性的全形空白和別篇的出處是同一個單元', () => {
  const owner = card('Essence Cards/o.md', unit('國二上', '1-1'), { a: ['出處：國二上 ２-１'], b: ['出處：國二上 2-1 p.20'] });
  const target = deck('Essence Cards/t.md', '---\n年級學期: 國二上\n科目: 自然\n單元: 2-1　水溶液\n---\n');
  const index = buildIndex([owner, target]);
  assert.deepEqual(ids(index.find('國二上', '自然', '2-1')), ['b']);
  assert.deepEqual(index.unresolved.map(ref => ref.code), ['２-１']);
});

void test('排序：自然排序、平手比原字串；順序打亂、反向輸入結果相同；未知學期排在後面', () => {
  const codesIn = ['L10', 'L2', 'L01', 'L1', '2-10', '2-2', '2-01', '2-1', '10', '2', 'Starter', 'L1-2', '2-', '1-2-3'];
  const decks = codesIn.map(code => card('Essence Cards/' + code + '.md', unit('國二上', code), {}));
  const expected = ['1-2-3', '2', '2-01', '2-1', '2-2', '2-10', '10', 'L01', 'L1', 'L2', 'L10', '2-', 'L1-2', 'Starter'];
  assert.deepEqual(codes(buildIndex(decks).units), expected);
  assert.deepEqual(codes(buildIndex([...decks].reverse()).units), expected);
  const terms = ['暑假', '小五上', '高一下', '國一下', '國一上', '自學', '小五下'];
  const termDecks = terms.map(term => card('Essence Cards/' + term + '.md', unit(term, '1'), {}));
  const painted = paintCatalog(buildIndex(termDecks), new Map(), new Set());
  assert.deepEqual(painted.terms.map(each => each.term), ['小五上', '小五下', '國一上', '國一下', '高一下', '暑假', '自學']);
  assert.equal(painted.latest, '高一下', '預設展開最新的學期');
  assert.equal(paintCatalog(buildIndex([card('Essence Cards/x.md', unit('暑假', '1'), {})]), new Map(), new Set()).latest, '暑假');
  assert.equal(paintCatalog(buildIndex([]), new Map(), new Set()).latest, null);
});

void test('其他組：學業以外、有年級學期與科目但沒單元的都不消失；一般筆記不列；轉錄稿不算', () => {
  const photo = deck('Essence Cards/攝影.md', '- 構圖 ^a\n    - 問 :: 答\n');
  const noUnit = deck('Essence Cards/零散.md', '---\n年級學期: 國二上\n科目: 自然\n---\n- 目標 ^b\n    - 問 :: 答\n');
  const plain = deck('Essence Cards/說明.md', '隨手寫的筆記\n');
  const transcript = deck('Essence Cards/轉錄.md', '---\n來源類型: 課本\n---\n- 問 :: 答\n');
  const index = buildIndex([plain, photo, noUnit, transcript]);
  assert.deepEqual(index.units, []);
  assert.deepEqual(index.others.map(each => [each.name, ids(each)]), [['攝影', ['a']], ['零散', ['b']]]);
  assert.deepEqual(index.unit('Essence Cards/攝影.md')?.name, '攝影');
});

void test('寫錯的提示：跳過寫錯的目標、數出幾個與第一個的位置；屬性問題同一種寫法', () => {
  const bad = deck('Essence Cards/a.md', '---\n年級學期: 國二上\n科目: 自然\n單元: 2-1\n材料: [[教材]]\n---\n- 好 ^a\n    - 問 :: 答\n- 壞一 ^b\n    - 問 ::\n- 壞二\n    - :: 答\n');
  const node = buildIndex([bad]).units[0];
  assert.deepEqual(ids(node), ['a']);
  assert.deepEqual(node.problems, [{ kind: 'target', count: 2, path: 'Essence Cards/a.md', line: 8 }, { kind: 'property', count: 1, path: 'Essence Cards/a.md', line: 4 }]);
  // `單元: 3`：沒有單元，進「其他」組，提示跟著。
  const numeric = buildIndex([deck('Essence Cards/n.md', '---\n年級學期: 國二上\n科目: 自然\n單元: 3\n---\n')]);
  assert.deepEqual(numeric.others[0].problems, [{ kind: 'property', count: 1, path: 'Essence Cards/n.md', line: 3 }]);
});

void test('被停掉的目標（讀不懂的紀錄行）不算；沒有 ID 的不算；這一篇的目標集合只有啟用的卡組', () => {
  const entry = card('Essence Cards/a.md', unit('國二上', '2-1'), { a: [], b: [] });
  const noId = deck('Essence Cards/b.md', '---\n年級學期: 國二上\n科目: 自然\n單元: 2-1\n---\n- 還沒補 ID\n    - 問 :: 答\n');
  const index = buildIndex([entry, noId], id => id === 'b');
  assert.deepEqual(ids(index.units[0]), ['a']);
  assert.deepEqual(index.deckTargets('Essence Cards/a.md'), ['a']);
  assert.deepEqual(index.deckTargets('Essence Cards/b.md'), []);
  assert.deepEqual(buildIndex([card('Essence Cards/a.md', { ...unit('國二上', '2-1'), 狀態: '草稿' }, { a: [] })]).deckTargets('Essence Cards/a.md'), []);
});

void test('單元的顏色：邊界各一例', () => {
  const colors = (counts: Partial<Record<MemoryColor, number>>): MemoryColor[] => (Object.entries(counts) as [MemoryColor, number][]).flatMap(([color, n]) => Array<MemoryColor>(n).fill(color));
  assert.equal(unitColor(colors({ new: 5, good: 5 })), 'near', '剛好一半不是灰');
  assert.equal(unitColor(colors({ new: 6, good: 4 })), 'new');
  assert.equal(unitColor(colors({ easy: 10 })), 'easy');
  assert.equal(unitColor(colors({ good: 6, easy: 4 })), 'easy');
  assert.equal(unitColor(colors({ good: 4, easy: 4, near: 2 })), 'good');
  assert.equal(unitColor(colors({ good: 7, near: 3 })), 'near');
  assert.equal(unitColor([]), 'new');
});

void test('畫面的資料：數字是目標數、當日卡的 N 是目標集合與今天還沒完成的交集、兩個單元共用同一個目標的顏色', () => {
  const low = card('Essence Cards/low.md', unit('小四上', '2-1'), { a: ['出處：小五上 2-1'], b: [] });
  const high = card('Essence Cards/high.md', unit('小五上', '2-1'), { c: [] });
  const painted = paintCatalog(buildIndex([low, high]), new Map<string, MemoryColor>([['a', 'easy'], ['b', 'easy'], ['c', 'near']]), new Set(['a', 'c']));
  const [lowRow] = painted.terms[0].subjects[0].units, [highRow] = painted.terms[1].subjects[0].units;
  assert.deepEqual([lowRow.count, lowRow.today, lowRow.color], [2, 1, 'easy']);
  assert.deepEqual([highRow.count, highRow.today, highRow.color], [2, 2, 'near']);
  assert.deepEqual(highRow.targets.map(target => [target.id, target.color, target.from]), [['c', 'near', null], ['a', 'easy', '小四上 2-1']]);
});
