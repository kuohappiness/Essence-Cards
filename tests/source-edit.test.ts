import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditSource, editSource, parseDeck, readSourceParts, sourceLinks, verifySourceEdit } from '../src/core/deck/index.ts';
import { EDIT_CASES, HEAD, TARGET } from './helpers/source-edit-cases.ts';

// 出處寫回（tasks/edit-markup.md §4-3、§6-1〈寫回〉）：每個例子寫死改完的全文，並確認改動套回去就是那份全文、第二次讀不出變化以外的差別。

const VERSION = '0.3.0';
const apply = (text: string, changes: readonly { from: number; to: number; insert: string }[]): string =>
  [...changes].sort((a, b) => b.from - a.from).reduce((out, { from, to, insert }) => out.slice(0, from) + insert + out.slice(to), text);

for (const each of EDIT_CASES) {
  void test('§4-3 ' + each.name, () => {
    const target = each.target ?? TARGET;
    const result = editSource({ text: each.text, target, action: each.action, version: VERSION });
    if (typeof each.want === 'string') {
      assert.ok(result.ok, '寫不回去：' + (result.ok ? '' : result.reason + ' ' + String(result.failure)));
      assert.equal(result.text, each.want);
      assert.equal(apply(each.text, result.changes), each.want, '改動套回去不是那份全文');
      // 重新讀：這一段不再看不懂（套用之後重新打開同一段，§6-1）。
      const after = parseDeck(result.text);
      const written = after.targets.find(each => each.line >= target)?.fields.sources ?? [];
      for (const item of sourceLinks(written, after.props)) assert.equal(item.problem, undefined, '改完還有看不懂的：' + item.text);
    } else {
      assert.equal(result.ok, false, '應該不寫');
      if (!result.ok) {
        assert.equal(result.reason, each.want.reason);
        assert.equal(result.failure, null, '預期的不寫不記錯誤紀錄');
      }
    }
  });
}

void test('§4-3 第 4 點：不寫的原因在打開表單時就知道（canEditSource）', () => {
  const blocked = (text: string, part: number | null, target = TARGET) => canEditSource(text, target, part, VERSION);
  const T = '- 目標\n    - Q :: A\n';
  assert.equal(blocked(HEAD + T + '    - 出處：p.44\n    - 出處：p.45\n', null), '這個目標寫了兩處「出處」，先合併成一處');
  assert.equal(blocked(HEAD + T + '    - 出處：p.44\n      p.45\n', null), '這一項分在兩行，請直接改字');
  assert.equal(blocked(HEAD.replace('---\n年', '---\n需要版本: "99.0.0"\n年') + T, null, TARGET + 1), '這篇需要新版的外掛才能改');
  assert.equal(blocked(HEAD.replace('---\n年', '---\n需要版本: "0.3.0"\n年') + T, null, TARGET + 1), null, '這一版讀得懂就能改');
  assert.equal(blocked(HEAD + T + '    - 出處：老師說過 p.44\n', 0), null);
  assert.equal(blocked(HEAD + T, null), null, '沒有出處欄位可以加');
});

void test('§4-3 寫進的字（written）：跟著別的單元的位置前面加本單元', () => {
  const result = editSource({ text: HEAD + '- 目標\n    - Q :: A\n    - 出處：國二上 1-3 p.20、老師說過 p.21\n', target: TARGET, action: { kind: 'replace', part: 1, text: 'p.21', own: true }, version: VERSION });
  assert.ok(result.ok);
  assert.equal(result.written, '本單元 p.21');
  const plain = editSource({ text: HEAD + '- 目標\n    - Q :: A\n    - 出處：老師說過 p.44\n', target: TARGET, action: { kind: 'replace', part: 0, text: 'p.44', own: true }, version: VERSION });
  assert.ok(plain.ok);
  assert.equal(plain.written, 'p.44');
});

void test('§4-3 第 6 點：改動只有一個範圍，CRLF 照舊', () => {
  const text = HEAD.replaceAll('\n', '\r\n') + '- 目標\r\n    - Q :: A\r\n    - 出處：p.44、p.45\r\n';
  const result = editSource({ text, target: TARGET, action: { kind: 'add', text: 'p.46', own: true }, version: VERSION });
  assert.ok(result.ok);
  assert.equal(result.text, HEAD.replaceAll('\n', '\r\n') + '- 目標\r\n    - Q :: A\r\n    - 出處：\r\n        - p.44\r\n        - p.45\r\n        - p.46\r\n');
  assert.equal(result.changes.length, 1);
});

// ── 核對器的反例（回報 R1、R7）：各做一個會被擋下的改法 ──

const BASE = HEAD + '- 目標\n    - Q :: A\n    - 補充說明\n    - 錯題補強：單位、換算\n    - 出處：老師說過 p.44、p.45 知識快遞\n- 目標二\n    - Q2 :: A2\n    - 出處：p.30\n';
/** 第一段換成 p.46 的正確寫法；計畫是：沒動到第 1 段，新的段在第 0 個。 */
const GOOD = BASE.replace('老師說過 p.44', 'p.46');
const plan = { target: TARGET, untouched: [1], at: 0, written: 'p.46' };

void test('§4-3 第 6 點：正確的改法通過核對', () => {
  assert.equal(verifySourceEdit(BASE, GOOD, plan), null);
});

void test('§4-3 第 6 點反例：改到背面補充、別的目標的出處、屬性、錯題補強的順序都擋下', () => {
  const blocked = (after: string, why: string) => {
    const found = verifySourceEdit(BASE, after, plan);
    assert.ok(found, why + '沒有被擋下');
    assert.equal(found.reason, '寫不回去，請直接改字', why);
    assert.match(found.failure ?? '', /^verify:/, why);
  };
  blocked(GOOD.replace('補充說明', '補充'), '背面補充');
  blocked(GOOD.replace('出處：p.30', '出處：p.31'), '別的目標的出處');
  blocked(GOOD.replace('科目: 自然', '科目: 數學'), '屬性');
  blocked(GOOD.replace('單位、換算', '換算、單位'), '錯題補強的順序');
});

void test('§4-3 第 6 點反例（R7）：別段的說明被刪（寫成 p.46、p.45）擋下', () => {
  const found = verifySourceEdit(BASE, BASE.replace('老師說過 p.44、p.45 知識快遞', 'p.46、p.45'), plan);
  assert.deepEqual(found, { reason: '改完之後，後面的「p.45 知識快遞」會跟著改，請直接改字', failure: null });
});

void test('§4-3 第 6 點：新的段在別的地方讀出問題就擋下', () => {
  // 新的段寫成會被讀成「位置前面有一句話」的字。
  const found = verifySourceEdit(BASE, BASE.replace('老師說過 p.44', '老師說 p.46'), { ...plan, written: '老師說 p.46' });
  assert.ok(found);
  assert.match(found.failure ?? '', /^verify:new/);
});

void test('§4-3 寫回之後重新讀：段的位置照原文順序', () => {
  const result = editSource({ text: HEAD + '- 目標\n    - Q :: A\n    - 出處：p.44、國二上 1-3 p.20\n', target: TARGET, action: { kind: 'add', text: 'p.50', own: true }, version: VERSION });
  assert.ok(result.ok);
  const after = parseDeck(result.text);
  assert.deepEqual(readSourceParts(after.targets[0].fields.sources, after.props).map(part => part.items.map(item => item.text)), [['p.44'], ['p.50'], ['國二上 1-3 p.20']]);
});
