import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EditorSelection, EditorState, Text } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { parseDeck } from '../src/core/deck/index.ts';
import { idLock, scanTokens } from '../src/obsidian/lock.ts';

// W5 §8-6、§8-7 I7 的 Node 部分：用 Obsidian 內建的同一版 CodeMirror（@codemirror/state）跑交易，比對操作後的文字。
// 真正的鍵盤、中文輸入法、Live Preview／Source mode 在 Windows 版 Obsidian 用開發命令 lock 驗。

function editor(doc: string, deck = true) {
  const removed: string[] = [], restored: string[] = [];
  const lock = idLock({ isDeck: () => deck, onRemoved: (_state, ids) => { removed.push(...ids); }, onRestored: (_state, ids) => { restored.push(...ids); } });
  // Obsidian 允許多個游標。
  let state = EditorState.create({ doc, extensions: [lock.extension, EditorState.allowMultipleSelections.of(true)] });
  return {
    removed, restored,
    get text() { return state.doc.toString(); },
    get head() { return state.selection.main.head; },
    get tokens() { return lock.tokens(state); },
    get state() { return state; },
    select(anchor: number, head = anchor) { state = state.update({ selection: EditorSelection.single(anchor, head), userEvent: 'select' }).state; },
    /** 取代目前的選取（打字、貼上、拖放的落點）。 */
    input(text: string, userEvent = 'input.type') { state = state.update({ ...state.replaceSelection(text), userEvent }).state; },
    dispatch(spec: TransactionSpec) { state = state.update(spec).state; },
  };
}
const A = '- 能說明擴散 ^k3m9x2', B = '- 能說明溶解 ^p7q2w8';
const doc = A + '\n    - Q1 :: A1\n' + B + '\n    - Q2 :: A2\n';
const nameEnd = A.indexOf(' ^'), lineEnd = A.length;
const bLine = doc.indexOf(B);

void test('I7 游標停在 ID 後面（End、點行尾）時移到名稱最後', () => {
  const e = editor(doc);
  e.select(lineEnd);
  assert.equal(e.head, nameEnd);
  e.select(2, lineEnd);
  assert.deepEqual([e.state.selection.main.anchor, e.state.selection.main.head], [2, lineEnd]);
});

void test('I7 名稱後面打字、中文組字、貼上：字放在 ID 前面', () => {
  for (const event of ['input.type', 'input.type.compose', 'input.paste']) {
    const e = editor(doc);
    e.select(lineEnd);
    e.input('的現象', event);
    assert.equal(e.text, doc.replace(A, '- 能說明擴散的現象 ^k3m9x2'), event);
    assert.equal(e.head, nameEnd + 3, event);
  }
});

void test('I7 字進到 ID 後面或裡面（拖放的落點、其他輸入方式）也移到 ID 前面', () => {
  for (const [at, event] of [[lineEnd, 'input.drop'], [lineEnd - 3, 'input.type'], [nameEnd + 1, 'input.type']] as const) {
    const e = editor(doc);
    e.dispatch({ changes: { from: at, insert: 'xyz' }, userEvent: event });
    assert.equal(e.text, doc.replace(A, '- 能說明擴散xyz ^k3m9x2'), at + ' ' + event);
  }
});

void test('I7 貼上帶 ID 的文字到名稱裡：貼上的 ID 拿掉，原本的 ID 留在行尾', () => {
  const e = editor(doc);
  e.select(nameEnd);
  e.input('（另一個 ^zzzzz9）', 'input.paste');
  assert.equal(e.text, doc.replace(A, '- 能說明擴散（另一個）^k3m9x2'.replace('）^', '） ^').replace('另一個）', '另一個）')));
  const f = editor(doc);
  f.dispatch({ changes: { from: lineEnd, insert: ' 尾巴 ^zzzzz9' }, userEvent: 'input.paste' });
  assert.equal(f.text, doc.replace(A, '- 能說明擴散 尾巴 ^k3m9x2'));
  assert.deepEqual(scanTokens(f.state.doc).map(t => t.id), ['k3m9x2', 'p7q2w8']);
});

void test('I7 名稱最後按 Enter：ID 留在原本的目標那一行，新的一行照常', () => {
  const e = editor(doc);
  e.select(lineEnd);
  e.dispatch({ changes: { from: nameEnd, insert: '\n- ' }, selection: { anchor: nameEnd + 3 }, userEvent: 'input' });
  assert.equal(e.text, A + '\n- \n    - Q1 :: A1\n' + B + '\n    - Q2 :: A2\n');
  assert.equal(e.head, lineEnd + 3);
  // 名稱中間按 Enter：後半段連同 ID 到下一行，題目仍在它底下（ID 跟著有題目的那個目標，原文不動）。
  const f = editor(doc);
  f.dispatch({ changes: { from: 4, insert: '\n- ' }, selection: { anchor: 7 }, userEvent: 'input' });
  assert.equal(f.text, '- 能說\n- 明擴散 ^k3m9x2\n    - Q1 :: A1\n' + B + '\n    - Q2 :: A2\n');
  assert.deepEqual(f.removed, []);
});

void test('I7 Backspace／Delete 碰到 ID 或它前面的空白：ID 與空白不動', () => {
  for (const [from, to, event] of [[nameEnd, lineEnd, 'delete.backward'], [lineEnd - 1, lineEnd, 'delete.backward'], [nameEnd, nameEnd + 1, 'delete.forward'], [nameEnd + 1, nameEnd + 2, 'delete.backward']] as const) {
    const e = editor(doc);
    e.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: event });
    assert.equal(e.text, doc, `${from}-${to} ${event}`);
    assert.deepEqual(e.removed, []);
  }
  // 名稱最後一個字照常刪。
  const e = editor(doc);
  e.dispatch({ changes: { from: nameEnd - 1, to: nameEnd }, userEvent: 'delete.backward' });
  assert.equal(e.text, doc.replace(A, '- 能說明擴 ^k3m9x2'));
});

void test('I7 選一段跨到 ID 再打字或貼上：ID 留在那個目標的行尾', () => {
  for (const event of ['input.type', 'input.paste']) {
    const e = editor(doc);
    e.select(4, lineEnd);
    e.input('新的名稱', event);
    assert.equal(e.text, doc.replace(A, '- 能說新的名稱 ^k3m9x2'), event);
    assert.deepEqual(e.removed, []);
  }
});

void test('I7 只選目標那一行（含清單符號）刪掉：整行清空，ID 跟著走並回報，不留下孤立的 ID', () => {
  for (const [from, to] of [[0, lineEnd], [0, lineEnd + 1]]) {
    const e = editor(doc);
    e.select(from, to);
    e.dispatch({ ...e.state.replaceSelection(''), userEvent: 'delete.selection' });
    assert.equal(e.text, doc.slice(0, from) + doc.slice(to));
    assert.deepEqual(e.removed, ['k3m9x2']);
    assert.ok(!e.text.includes('k3m9x2'));
  }
});

void test('I7 刪掉或剪下整個目標：ID 跟著走並回報；貼到另一篇，ID 在那一篇的行尾', () => {
  const whole = doc.slice(0, bLine);
  const e = editor(doc);
  e.select(0, bLine);
  e.dispatch({ ...e.state.replaceSelection(''), userEvent: 'delete.cut' });
  assert.equal(e.text, B + '\n    - Q2 :: A2\n');
  assert.deepEqual(e.removed, ['k3m9x2']);
  const other = editor('- 別的目標 ^aaaaaa\n    - Q :: A\n');
  other.select(other.text.length);
  other.input(whole, 'input.paste');
  assert.equal(other.text, '- 別的目標 ^aaaaaa\n    - Q :: A\n' + whole);
  assert.deepEqual(other.tokens.map(t => t.id), ['aaaaaa', 'k3m9x2']);
});

void test('I7 跨兩個目標的一部分刪掉再貼上：恢復原文，沒有孤立或重複的 ID', () => {
  const e = editor(doc);
  const from = 4, to = bLine + 4;
  const cut = doc.slice(from, to);
  e.select(from, to);
  e.dispatch({ ...e.state.replaceSelection(''), userEvent: 'delete.cut' });
  assert.equal(e.text, '- 能說明溶解 ^p7q2w8\n    - Q2 :: A2\n');
  assert.deepEqual(e.removed, ['k3m9x2']);
  e.select(from);
  e.input(cut, 'input.paste');
  assert.equal(e.text, doc);
  assert.deepEqual(e.tokens.map(t => t.id), ['k3m9x2', 'p7q2w8']);
  // 從 ID 中間選到下一個目標的名稱中間再打字：那一行只剩下一個 ID。
  const f = editor(doc);
  f.select(lineEnd - 2, bLine + 4);
  f.input('x');
  assert.equal(f.text, '- 能說明擴散x明溶解 ^p7q2w8\n    - Q2 :: A2\n');
  assert.deepEqual(f.removed, ['k3m9x2']);
});

void test('I7 兩個沒有題目的目標行接成一行：留下行尾的 ID', () => {
  const e = editor('- 甲 ^aaaaaa\n- 乙 ^bbbbbb\n');
  e.dispatch({ changes: { from: 11, to: 12 }, userEvent: 'delete.backward' });
  assert.equal(e.text, '- 甲- 乙 ^bbbbbb\n');
  assert.deepEqual(e.removed, ['aaaaaa']);
});

void test('I7 全選取代：全部 ID 回報；貼回同樣的內容不回報', () => {
  const e = editor(doc);
  e.select(0, doc.length);
  e.input('新內容');
  assert.equal(e.text, '新內容');
  assert.deepEqual(e.removed.sort(), ['k3m9x2', 'p7q2w8']);
  const f = editor(doc);
  f.select(0, doc.length);
  f.input(doc, 'input.paste');
  assert.equal(f.text, doc);
  assert.deepEqual(f.removed, []);
});

void test('I7 清單縮排與上下移動整行：ID 跟著它的那一行', () => {
  const e = editor(doc);
  e.dispatch({ changes: { from: bLine, insert: '    ' }, userEvent: 'input.indent' });
  assert.equal(e.text, doc.replace(B, '    ' + B));
  assert.deepEqual(e.removed, []);
  // 上下移動整行：兩個目標交換位置（一個 change 換掉整段）。
  const f = editor(doc);
  const first = doc.slice(0, bLine), second = doc.slice(bLine);
  f.dispatch({ changes: { from: 0, to: doc.length, insert: second + first }, userEvent: 'move.line' });
  assert.equal(f.text, second + first);
  assert.deepEqual(f.removed, []);
  assert.deepEqual(f.tokens.map(t => t.id), ['p7q2w8', 'k3m9x2']);
});

void test('I7 Undo／Redo 照常（不調整）：拿掉的 ID 回報，回來的 ID 也回報；沒有標記的交易（外部改檔後重新載入）不碰也不回報', () => {
  const e = editor(doc);
  // CodeMirror 的 history 交易帶 filter: false（Obsidian 的 Undo／Redo 就是這樣），transactionFilter 不會跑。
  e.dispatch({ changes: { from: nameEnd, to: lineEnd }, userEvent: 'undo', filter: false });
  assert.equal(e.text, doc.replace(' ^k3m9x2', ''));
  assert.deepEqual(e.removed, ['k3m9x2']);
  e.dispatch({ changes: { from: nameEnd, insert: ' ^k3m9x2' }, userEvent: 'redo', filter: false });
  assert.equal(e.text, doc);
  assert.deepEqual(e.restored, ['k3m9x2']);
  // 貼回剪下的整個目標也算回來。
  const g = editor(doc);
  g.select(0, bLine);
  g.dispatch({ ...g.state.replaceSelection(''), userEvent: 'delete.cut' });
  g.select(0);
  g.input(doc.slice(0, bLine), 'input.paste');
  assert.deepEqual([g.removed, g.restored], [['k3m9x2'], ['k3m9x2']]);
  const f = editor(doc);
  f.dispatch({ changes: { from: nameEnd, to: lineEnd } });
  f.dispatch({ changes: { from: nameEnd, insert: ' ^k3m9x2' } });
  assert.equal(f.text, doc);
  assert.deepEqual([f.removed, f.restored], [[], []]);
});

void test('I7 不是卡組筆記：不鎖', () => {
  const e = editor(doc, false);
  e.select(lineEnd);
  assert.equal(e.head, lineEnd);
  e.input('abc');
  assert.equal(e.text, doc.replace(A, A + 'abc'));
  assert.deepEqual(e.tokens, []);
});

void test('鎖定的範圍和 parseDeck 對照：每個有 ID 的明確目標都鎖住；屬性區、圍欄、題目行與縮排的項目不鎖', () => {
  const syntax = readFileSync(new URL('../docs/syntax.md', import.meta.url), 'utf8');
  const examples = [...syntax.matchAll(/```markdown\r?\n([\s\S]*?)\r?\n```/g)].map(m => m[1]);
  assert.ok(examples.length >= 3);
  const extra = [
    '---\n科目: 自然\n- 假 ^aaaaaa\n---\n- 目標 ^bbbbbb\n    - Q :: A ^cccccc\n',
    '```\n- 圍欄裡 ^aaaaaa\n    - Q :: A\n```\n- 目標 ^bbbbbb\n    - Q :: A\n',
    '- ^aaaaaa\n    - Q :: A\n- 目標 ^bbbbbb\n\t- Q :: A\n',
    '    - 文件層級縮排 ^aaaaaa\n- 一般筆記 ^dddddd\n',
  ];
  for (const text of [...examples, ...extra]) {
    const locked = new Set(scanTokens(Text.of(text.split(/\r?\n/))).map(t => t.id));
    for (const target of parseDeck(text).targets) {
      // 名稱是空的（`- ^aaaaaa`）不鎖：游標停在 ID 前面會打進清單符號裡。
      if (target.id && !target.implicit && target.name) assert.ok(locked.has(target.id), text.slice(0, 60) + '：' + target.id);
    }
  }
  assert.deepEqual(scanTokens(Text.of(extra[0].split('\n'))).map(t => t.id), ['bbbbbb']);
  assert.deepEqual(scanTokens(Text.of(extra[1].split('\n'))).map(t => t.id), ['bbbbbb']);
  assert.deepEqual(scanTokens(Text.of(extra[2].split('\n'))).map(t => t.id), ['bbbbbb']);
  // 沒有題目的一般清單也鎖（簡化規則的差異；ID 本來就不該被打字改掉）。
  assert.deepEqual(scanTokens(Text.of(extra[3].split('\n'))).map(t => t.id), ['dddddd']);
});

void test('只重掃改到的行：隨機編輯 300 次後和整篇重掃相同', () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const pieces = ['- 目標 ^aaaaaa\n', '    - Q :: A\n', '```\n', '---\n', '- 新 ^bbbbbb', '\n', 'x', ' ^cccccc', '~~~\n', '    '];
  const e = editor(doc);
  for (let i = 0; i < 300; i++) {
    const length = e.state.doc.length;
    const from = Math.floor(random() * (length + 1));
    const to = Math.min(length, from + Math.floor(random() * 6));
    e.dispatch({ changes: { from, to, insert: random() < 0.7 ? pieces[Math.floor(random() * pieces.length)] : '' } });
    assert.deepEqual(e.tokens, scanTokens(e.state.doc), '第 ' + i + ' 次');
  }
});

void test('一般輸入不整篇重掃：6,000 行的卡組打 200 個字在 1 秒內', () => {
  const big = Array.from({ length: 2000 }, (_, i) => `- 目標 ${i} ^${(i + 100000).toString(36)}\n    - Q${i} :: A${i}\n    - R${i} :: B${i}\n`).join('');
  const e = editor(big);
  const at = big.indexOf(' ^', big.length / 2);
  e.select(at);
  const start = performance.now();
  for (let i = 0; i < 200; i++) e.input('字');
  const ms = performance.now() - start;
  assert.ok(ms < 1000, ms + ' ms');
  assert.equal(e.tokens.length, 2000);
});

// Codex L2（2026-10-25）F2：貼上的文字裡，程式碼、公式、連結中像 ID 的字是正文，不能刪。
for (const pasted of [' ` ^p7q2w8`', ' [[note ^p7q2w8]]', ' $x ^p7q2w8$', ' [說明 ^p7q2w8](筆記.md)', ' ``a ^p7q2w8``']) void test('F2 貼上的程式碼、公式、連結原樣保留：' + pasted, () => {
  const e = editor(doc);
  e.select(nameEnd);
  e.input(pasted, 'input.paste');
  assert.equal(e.text, doc.replace(A, '- 能說明擴散' + pasted + ' ^k3m9x2'));
  // 沒有 ID 的目標行也一樣。
  const f = editor('- 新目標\n    - Q :: A\n');
  f.select(5);
  f.input(pasted, 'input.paste');
  assert.equal(f.text, '- 新目標' + pasted + '\n    - Q :: A\n');
});

void test('F2 多個游標同時貼上：正文不變，只拿掉名稱裡真的 ID 候選', () => {
  const e = editor(doc);
  e.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(nameEnd), EditorSelection.cursor(bLine + B.indexOf(' ^'))]), userEvent: 'select' });
  e.dispatch({ ...e.state.replaceSelection(' $y ^aaaaaa$ 與 ^zzzzz9'), userEvent: 'input.paste' });
  assert.equal(e.text, doc.replace(A, '- 能說明擴散 $y ^aaaaaa$ 與 ^k3m9x2').replace(B, '- 能說明溶解 $y ^aaaaaa$ 與 ^p7q2w8'));
});
