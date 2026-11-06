import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { markup, type Mark } from '../src/obsidian/markup.ts';

// tasks/edit-markup.md §1、§6-1 的標示：用 Obsidian 內建的同一版 CodeMirror（@codemirror/state）跑，位置寫死。
// 細線的位置、顏色與 tooltip 在 Windows 版 Obsidian 對照（§6-3）。

function editor(doc: string, deck = true) {
  const m = markup({ isDeck: () => deck });
  let state = EditorState.create({ doc, extensions: [m.extension] });
  return {
    get marks() { return m.marks(state); },
    get state() { return state; },
    dispatch(spec: TransactionSpec) { state = state.update(spec).state; },
    refresh() { state = state.update({ effects: m.refresh }).state; },
  };
}
/** 第 line 行（從 1 算）第 column 欄（從 0 算）在文件裡的位置。 */
const pos = (state: EditorState, line: number, column = 0): number => state.doc.line(line).from + column;
const kinds = (marks: Mark[], kind: Mark['kind']): Mark[] => marks.filter(mark => mark.kind === kind);

// syntax.md §2-2 的自然例子。
const NATURAL = `---
年級學期: 國二上
科目: 自然
單元: 2-2 水溶液
材料:
  - "[[國二上自然 2-2 水溶液]]"
狀態: 啟用
---

## 1 溶液

- 能說出溶質與溶劑的意思 ^k3m9x2
    - 出處：p.43｜類型：定義｜錯題補強：[[國二上自然 第一次段考]]
    - 糖水裡，哪一個是溶質？哪一個是溶劑？ :: 糖是**溶質**，水是**溶劑**
    - 碘酒裡的溶劑是什麼？ :: **酒精**
- 能說明溶液的質量組成 ^h2m8qd
    - 出處：p.43｜類型：因果｜重要性：高｜錯題補強：[[國二上自然 第一次段考]]
    - 溶液的質量怎麼算？ :: **溶質**的質量加上**溶劑**的質量
    - 糖加太多、杯底有沉澱時，溶液的質量怎麼算？ :: **只算已溶解的溶質**加上**溶劑**

## 2 擴散現象

- 能用粒子運動說明擴散現象 ^p7q2w8
    - 出處：p.44、圖 2-14｜類型：因果｜重要性：高
    - 黑糖放進水裡，不攪拌也會慢慢變甜，為什麼？ :: 粒子**不停運動**，糖從**濃度高**的地方散到**濃度低**的地方
        - ![[國二上自然 2-2 圖2-14.png]]
- 能說出影響溶解快慢的因素 ^w4s8nd
    - 出處：p.45｜類型：因果
    - 水溫越==高==、顆粒越==小==、有==攪拌==，糖溶解得越快
- 老師說這一段只要看懂，不用背
- 能說明溶液靜置後不會分層 ^r5t9vb
    - 出處：國二上 2-2 p.43｜類型：因果｜錯題補強：[[國二上自然 第一次段考]]
    - 糖水放一整天，杯底會出現糖嗎？為什麼？ :: **不會**；溶解的糖粒子和水**均勻混合**，不會自己沉下去
`;
/** 目標那幾行（不含「老師說」那一行一般筆記）。 */
const TARGET_LINES = [12, 16, 23, 27, 31];
/** 每個 `::` 的 [行, 欄]；填空題沒有。 */
const SEPARATORS = [[14, 25], [15, 17], [18, 16], [19, 28], [25, 28], [33, 26]];

void test('§1-1 自然的例子：目標那幾行有細線，每個 :: 變淡紫，沒有問題', () => {
  const e = editor(NATURAL);
  assert.deepEqual(kinds(e.marks, 'target').map(mark => mark.from), TARGET_LINES.map(line => pos(e.state, line)));
  const separators = kinds(e.marks, 'separator');
  assert.deepEqual(separators.map(mark => [mark.from, mark.to]), SEPARATORS.map(([line, column]) => [pos(e.state, line, column), pos(e.state, line, column + 2)]));
  for (const mark of separators) assert.equal(e.state.sliceDoc(mark.from, mark.to), '::');
  assert.deepEqual(e.marks.filter(mark => mark.kind === 'error' || mark.kind === 'hint'), []);
});

void test('§1-1 第二個目標按一次 Tab：那一行沒有細線，它底下的 :: 也沒有', () => {
  // Obsidian 在清單項目按 Tab，連同底下的子項目一起縮一層。
  const lines = NATURAL.split('\n');
  for (let i = 15; i <= 18; i++) lines[i] = '\t' + lines[i];
  const e = editor(lines.join('\n'));
  assert.deepEqual(kinds(e.marks, 'target').map(mark => mark.from), [12, 23, 27, 31].map(line => pos(e.state, line)));
  assert.deepEqual(kinds(e.marks, 'separator').map(mark => e.state.doc.lineAt(mark.from).number), [14, 15, 25, 33]);
});

void test('§1-1 沒有答案的題目畫紅色波浪線，範圍是那一行的內容；直接寫成題目的目標也有細線', () => {
  const doc = '- 能說出溶劑 ^k3m9x2\n    - 碘酒裡的溶劑是什麼？ ::\n- 鹽水的溶劑 :: 水\n';
  const e = editor(doc);
  assert.deepEqual(kinds(e.marks, 'target').map(mark => mark.from), [0, pos(e.state, 3)]);
  const errors = kinds(e.marks, 'error');
  assert.deepEqual(errors.map(mark => [mark.from, mark.to, mark.tip]), [[pos(e.state, 2, 6), pos(e.state, 2, 19), '這一題 :: 的底下沒有答案']]);
  // 直接寫成題目的目標：那一行的 :: 也標。
  assert.deepEqual(kinds(e.marks, 'separator').map(mark => [mark.from, mark.to]), [[pos(e.state, 2, 17), pos(e.state, 2, 19)], [pos(e.state, 3, 8), pos(e.state, 3, 10)]]);
});

void test('§1-1 hint 畫橘色、範圍不含清單符號與行尾的 ID；misplaced-id 不標', () => {
  // 兩個 ID 是 error（ambiguous-id）；行中一個 ID 是 misplaced-id，不標。
  const doc = '- 能說 ^k3m9x2 明 ^h2m8qd\n    - Q :: A\n- 能說 ^p7q2w8 出\n    - Q2 :: A2\n- 水 中翻英\n    - 水是 ==water==\n';
  const e = editor(doc);
  const problems = e.marks.filter(mark => mark.kind === 'error' || mark.kind === 'hint');
  assert.deepEqual(problems.map(mark => [mark.kind, e.state.sliceDoc(mark.from, mark.to), mark.tip]), [
    ['error', '能說 ^k3m9x2 明', '學習目標那一行有兩個以上的 ID，先不出題，等家長選要用哪一個'],
    ['hint', '水是 ==water==', '中翻英的填空題照一般翻面，不要求打字'],
  ]);
});

void test('§1-2 重要性：很高 只標「很高」', () => {
  const doc = '- 目標 ^k3m9x2\n    - 出處：p.43｜重要性：很高\n    - Q :: A\n';
  const e = editor(doc);
  assert.deepEqual(kinds(e.marks, 'hint').map(mark => [mark.from, mark.to, e.state.sliceDoc(mark.from, mark.to), mark.tip]), [[pos(e.state, 2, 18), pos(e.state, 2, 20), '很高', '重要性的值認不得，先當作中']]);
});

void test('§1-5 改字之後標示跟著平移；重新解析之後和打開時一樣', () => {
  const e = editor(NATURAL);
  const before = e.marks;
  const at = pos(e.state, 10);
  e.dispatch({ changes: { from: at, insert: '\n' }, userEvent: 'input.type' });
  assert.deepEqual(e.marks, before.map(mark => ({ ...mark, from: mark.from + 1, to: mark.to + 1 })));
  // 打字打到一半（還沒重新解析）：把第一個目標按 Tab，標示照舊平移，停下來才更新。
  const first = pos(e.state, 13);
  e.dispatch({ changes: { from: first, insert: '\t' }, userEvent: 'input.type' });
  assert.equal(kinds(e.marks, 'target').length, 5);
  e.refresh();
  assert.deepEqual(kinds(e.marks, 'target').map(mark => e.state.doc.lineAt(mark.from).number), [17, 24, 28, 32]);
  assert.deepEqual(editor(e.state.doc.toString()).marks, e.marks);
});

void test('§1-5 不是使用者的編輯（打開別的檔、外部改檔後重新載入）馬上重算', () => {
  const e = editor(NATURAL);
  e.dispatch({ changes: { from: 0, to: e.state.doc.length, insert: '- A\n    - Q :: A\n' } });
  assert.deepEqual(e.marks.map(mark => [mark.kind, mark.from]), [['target', 0], ['separator', 12]]);
});

void test('§1 不是卡組筆記不標', () => {
  assert.deepEqual(editor(NATURAL, false).marks, []);
});
