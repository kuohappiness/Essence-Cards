import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldFixes, fixField, fixQuestion, parseDeck } from '../src/core/deck/index.ts';
import { COLON_CASES, NOT_COLONS, NOT_RENAMED, RENAME_CASES } from './helpers/field-fix-cases.ts';
import { HEAD } from './helpers/source-edit-cases.ts';

// §1-4 出處的欄位名稱寫錯、半形冒號：問一句就改（tasks/edit-markup.md §1-4、§4-4、§6-1〈§1-4〉）。預期值寫死。

const VERSION = '0.3.0';
const apply = (text: string, changes: readonly { from: number; to: number; insert: string }[]): string =>
  [...changes].sort((a, b) => b.from - a.from).reduce((out, { from, to, insert }) => out.slice(0, from) + insert + out.slice(to), text);
const renames = (text: string) => fieldFixes(text).filter(fix => fix.kind === 'rename');
const colons = (text: string) => fieldFixes(text).filter(fix => fix.kind === 'colon');

for (const each of RENAME_CASES) {
  void test('§4-4 欄位名稱寫錯：' + each.name, () => {
    const found = renames(each.text);
    assert.deepEqual(found.map(fix => fix.line), [each.line], '標在那一項');
    const result = fixField({ text: each.text, fix: { kind: 'rename', line: each.line }, version: VERSION });
    if (typeof each.want === 'string') {
      assert.ok(result.ok, '改不了：' + (result.ok ? '' : result.reason + ' ' + String(result.failure)));
      assert.equal(result.text, each.want);
      assert.equal(apply(each.text, result.changes), each.want, '改動套回去不是那份全文');
      assert.equal(result.changes.length, 1, '一個範圍的改動');
      assert.deepEqual(renames(result.text), [], '改完標示消失');
      assert.deepEqual(fixField({ text: result.text, fix: { kind: 'rename', line: each.line }, version: VERSION }).ok, false, '第二次不改');
    } else {
      assert.equal(result.ok, false);
      if (!result.ok) { assert.equal(result.reason, each.want.reason); assert.equal(result.failure, null); }
    }
  });
}

for (const each of NOT_RENAMED) {
  void test('§1-4 不標：' + each.name, () => {
    assert.deepEqual(renames(each.text), []);
  });
}

void test('§1-4 欄位名稱寫錯的底線是那一項第一行的內容、說明與問句', () => {
  const text = HEAD + '- 目標 ^abc123\n    - Q :: A\n    - 來源：p.45\n';
  const [fix] = renames(text);
  assert.deepEqual(fix.spans, [{ line: 7, from: 6, to: 13 }]);
  assert.equal(fix.tip, '這一行看起來是出處，點一下改成正確的寫法。');
  assert.equal(fixQuestion(fix, 0), '改成「出處：p.45」？');
  const long = '出處：' + 'p.45、'.repeat(8) + 'p.46';
  assert.equal(fixQuestion({ ...fix, replacement: long }, 0), '改成「' + long.slice(0, 40) + '…」？', '最長 40 個字');
});

void test('§1-4 題目底下的 來源：p.45 改完，那一題的 extras 少這一項、出處多這一項', () => {
  const each = RENAME_CASES.find(one => one.name.startsWith('題目底下'))!;
  const before = parseDeck(each.text).targets[0], after = parseDeck(each.want as string).targets[0];
  assert.deepEqual(before.prompts[0].extras, ['來源：p.45']);
  assert.deepEqual(after.prompts[0].extras, []);
  assert.deepEqual(after.fields.sources, ['p.45']);
});

for (const each of COLON_CASES) {
  void test('§4-4 半形冒號：' + each.name, () => {
    const found = colons(each.text);
    assert.deepEqual(found.map(fix => fix.spans), each.spans);
    for (const fix of found) assert.equal(fix.tip, '冒號改成全形，和其他欄位一致。點一下就改。');
    const result = fixField({ text: each.text, fix: { kind: 'colon' }, version: VERSION });
    assert.ok(result.ok, '改不了：' + (result.ok ? '' : result.reason + ' ' + String(result.failure)));
    assert.equal(result.text, each.want);
    assert.equal(apply(each.text, result.changes), each.want);
    assert.equal(result.text.length, each.text.length, '只有那幾個字不同');
    assert.deepEqual(parseDeck(result.text), parseDeck(each.text), '讀法完全一樣');
    assert.deepEqual(colons(result.text), [], '改完第二次一字不改');
    assert.equal(fixField({ text: result.text, fix: { kind: 'colon' }, version: VERSION }).ok, false);
  });
}

for (const each of NOT_COLONS) {
  void test('§1-4 半形冒號不標：' + each.name, () => {
    assert.deepEqual(colons(each.text), []);
    assert.equal(fixField({ text: each.text, fix: { kind: 'colon' }, version: VERSION }).ok, false, '不改');
  });
}

void test('§1-4 半形冒號的問句：這篇有好幾處時一起改', () => {
  const [one] = colons(COLON_CASES[1].text);
  assert.equal(fixQuestion(one, 1), '冒號改成全形？');
  assert.equal(fixQuestion(one, 5), '冒號改成全形？這篇共 5 處，一起改');
});

void test('§4-4 需要新版：半形冒號也不改', () => {
  const text = HEAD.replace('---\n年', '---\n需要版本: "99.0.0"\n年') + '- 目標\n    - Q :: A\n    - 類型:定義\n';
  const result = fixField({ text, fix: { kind: 'colon' }, version: VERSION });
  assert.deepEqual(result, { ok: false, reason: '這篇需要新版的外掛才能改', failure: null });
});

void test('§4-4 標示之後筆記改過：那一行已經不是寫錯的欄位就不改', () => {
  const result = fixField({ text: HEAD + '- 目標\n    - Q :: A\n    - 出處：p.45\n', fix: { kind: 'rename', line: 7 }, version: VERSION });
  assert.deepEqual(result, { ok: false, reason: '筆記剛改過，請再點一次', failure: null });
});

void test('§4-4 併進去：這一篇的位置加在別的單元前面，讀起來和單獨讀這一項一樣', () => {
  // 加在最後會被讀成 1-3 的 p.45；加在第一個別的單元前面（這一篇的先寫）才一樣。變成三個按鈕所以分行。
  const text = HEAD + '- 目標\n    - Q :: A\n    - 出處：國二上 1-3 p.20、21\n    - 來源 p.45\n';
  const result = fixField({ text, fix: { kind: 'rename', line: 8 }, version: VERSION });
  assert.ok(result.ok);
  assert.equal(result.text, HEAD + '- 目標\n    - Q :: A\n    - 出處：\n        - p.45\n        - 國二上 1-3 p.20\n        - 21\n');
  // 這一項自己有別的單元、開頭是這一篇的：整串加在別的單元前面。
  const mixed = fixField({ text: HEAD + '- 目標\n    - Q :: A\n    - 出處：國二上 1-3 p.20\n    - 來源 p.45、國二上 1-8 p.30\n', fix: { kind: 'rename', line: 8 }, version: VERSION });
  assert.ok(mixed.ok);
  assert.equal(mixed.text, HEAD + '- 目標\n    - Q :: A\n    - 出處：\n        - p.45\n        - 國二上 1-8 p.30\n        - 國二上 1-3 p.20\n');
});

void test('§4-4 核對不成立：就地改名之後讀法會變就不寫，記錯誤紀錄', () => {
  // 已有的出處有接續行，只能就地改名；它最後跟著 1-3，接在後面的 p.45 會被讀成 1-3 的。
  const text = HEAD + '- 目標\n    - Q :: A\n    - 出處：國二上 1-3 p.20\n      p.21\n    - 來源 p.45\n';
  assert.deepEqual(renames(text).map(fix => fix.line), [9]);
  const result = fixField({ text, fix: { kind: 'rename', line: 9 }, version: VERSION });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, '寫不回去，請直接改字');
    assert.equal(result.failure, 'verify:rename action:改名 line:9');
  }
});
