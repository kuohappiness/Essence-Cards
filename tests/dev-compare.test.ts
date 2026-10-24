import test from 'node:test';
import assert from 'node:assert/strict';
import { compareAssigned, compareLists, type ListItem } from '../src/dev/compare.ts';

// 手寫的 listItems：parent 是上層項目的行；最上層是負數（實測第 0 行開始的清單是 -1）。
const item = (line: number, parent: number, id?: string, end = line): ListItem => (id ? { line, end, parent, id } : { line, end, parent });
const rules = (text: string, items: ListItem[]) => compareLists(text, items).map(m => m.rule + m.line);

const deck = '- 目標 ^abc234\n    - Q :: A\n    - 重要性：高\n    - 補充文字';
const deckItems = [item(0, -1, 'abc234'), item(1, 0), item(2, 0), item(3, 0)];

void test('對照：結構一致時沒有不一致；欄位、行內程式碼與公式裡的 :: 不算題目', () => {
  assert.deepEqual(compareLists(deck, deckItems), []);
  assert.deepEqual(rules('- 一般\n    - 備註：a == b\n    - `a::b` 與 $x==y$', [item(0, -1), item(1, 0), item(2, 0)]), []);
  // 圍欄裡的 :: 不算題目，項目自己開的圍欄也一樣（D036）。
  const fenced = '- ~~~\n  - 假題 :: A\n  ~~~\n- 目標\n  - Q :: A\n  - ~~~\n    - 假題 :: B\n    ~~~\n  - R :: C';
  assert.deepEqual(rules(fenced, [item(0, -1, undefined, 2), item(3, -1), item(4, 3), item(5, 3, undefined, 7), item(8, 3)]), []);
  assert.deepEqual(rules('前言\n\n- 一般清單\n- 第二項', [item(2, -2), item(3, -2)]), []);
});

void test('對照 (a)：目標不是最上層項目，或最上層項目有題目卻不是目標', () => {
  assert.deepEqual(rules(deck, [item(0, 7, 'abc234'), ...deckItems.slice(1)]), ['a0']);
  assert.deepEqual(rules(deck, deckItems.slice(1)), ['a0', 'd0']);
  // 文件層級縮排 4 格：解析器不當清單，這裡假設 metadataCache 當成清單。
  assert.deepEqual(rules('    - Q :: A', [item(0, -1)]), ['a0']);
  assert.deepEqual(rules('    - 目標\n        - Q :: A', [item(0, -1), item(1, 0)]), ['a0']);
  // 轉錄稿不比後半；引言框裡的項目先拿掉。
  assert.deepEqual(rules('---\n來源類型: 課本\n---\n- Q :: A', [item(3, -3)]), []);
  assert.deepEqual(rules('> - Q :: A', [item(0, -1)]), []);
});

void test('對照 (b)：題目不是清單項目，或上層不是目標', () => {
  assert.deepEqual(rules('- 目標\n    - Q :: A', [item(0, -1)]), ['b1']);
  assert.deepEqual(rules('- 目標\n    - Q :: A', [item(0, -1), item(1, -1)]), ['a1', 'b1']);
  assert.deepEqual(rules('- 目標\n  - 子\n    - Q :: A', [item(0, -1), item(1, 0), item(2, 1)]), []);
  assert.deepEqual(rules('- 目標\n    - Q :: A', [item(0, -1), item(1, 5)]), ['b1']);
});

void test('對照 (c)：目標底下像題目的項目沒有出題', () => {
  // 解析器在空行與頂格段落之後結束清單；假設 metadataCache 仍把 R 算成目標的子項目。
  const text = '- 目標\n    - Q :: A\n\n隨手一行\n\n    - R :: B';
  assert.deepEqual(compareLists(text, [item(0, -1), item(1, 0), item(5, 0)]).map(m => m.rule + m.line + m.detail), ['c5目標底下像題目的項目沒有出題']);
});

void test('對照 (d)：metadataCache 在目標那一行讀到的 ID 不同或沒有', () => {
  assert.deepEqual(rules(deck, [item(0, -1, 'zzz999'), ...deckItems.slice(1)]), ['d0']);
  assert.deepEqual(rules(deck, [item(0, -1), ...deckItems.slice(1)]), ['d0']);
});

void test('對照 (e)：補 ID 之後還有沒 ID 的一般目標；跳過的 implicit 不算', () => {
  assert.deepEqual(compareAssigned('- 目標\n    - Q :: A', [item(0, -1), item(1, 0)]).map(m => m.rule + m.line), ['e0']);
  assert.deepEqual(compareAssigned('- :: 答案', [item(0, -1)]), []);
  assert.deepEqual(compareAssigned(deck, deckItems), []);
});

void test('對照：寫錯的目標（ok 是 false）也照比，parseDeck 仍保留它的題目', () => {
  // 空題目是錯誤，這個目標不出題，但結構一樣要和 metadataCache 相同。
  assert.deepEqual(rules('- 目標 ^abc234\n  - :: A', [item(0, -1, 'abc234'), item(1, 0)]), []);
  assert.deepEqual(rules('- 目標 ^abc234\n  - :: A', [item(0, -1, 'abc234'), item(1, 5)]), ['b1']);
});
