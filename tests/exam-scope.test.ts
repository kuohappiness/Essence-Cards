import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseScope, editScope, isExamPath, newScopeText, parseExamFile, parseScope as parse, readDate, scopeDay, scopeFileName, scopePeriod, scopeWritable, unitInScope } from '../src/core/catalog/index.ts';
import type { ScopeFile } from '../src/core/catalog/index.ts';
import { newId } from '../src/core/deck/index.ts';
import { dayOf } from '../src/core/study/index.ts';
import { parse as parseYaml } from 'yaml';

// 考試範圍檔（tasks/exam-scope.md §2、syntax.md §4）：預期值都來自那份說明的表，內容都是自編的。

/** 共用範例：每個讀過的檔都會受下面往返與冪等的保護（和 tests/deck.test.ts 的 deckCases 同一種做法）。 */
const scopeCases = new Set<string>();
function parseScope(text: string): ScopeFile { scopeCases.add(text); return parse(text); }

type Read = [string, string, string] | '看不懂' | '分類';
const shown = (line: ScopeFile['lines'][number]): Read => line.kind === 'unit' ? [line.term, line.subject, line.code] : line.kind === 'category' ? '分類' : '看不懂';
const readLine = (line: string): Read[] => parseScope(line + '\n').lines.map(shown);

const LINES: [string, Read][] = [
  ['- 國二上 自然 2', ['國二上', '自然', '2']],
  ['國二上 自然 2', ['國二上', '自然', '2']],
  ['* 國二上 自然 2-1', ['國二上', '自然', '2-1']],
  ['+ 國二上 自然 2-1', ['國二上', '自然', '2-1']],
  ['1. 國二上 自然 2-1', ['國二上', '自然', '2-1']],
  ['- [ ] 國二上 自然 2-1', ['國二上', '自然', '2-1']],
  ['國二上 Social Studies L1', ['國二上', 'Social Studies', 'L1']],
  ['國二上 Social Studies Starter', ['國二上', 'Social Studies', 'Starter']],
  ['八上 Math2 L 1', ['國二上', 'Math2', 'L1']],
  ['國二 上 自然 第1章第3節', ['國二上', '自然', '1-3']],
  ['國二上學期 自然 第2章', ['國二上', '自然', '2']],
  ['國二上自然 2-1', ['國二上', '自然', '2-1']],
  ['國二上 自然 單元 2-1', ['國二上', '自然', '2-1']],
  ['國二上 自然 2-2 水溶液', ['國二上', '自然', '2-2']],
  ['國二上 自然 2-2 CO2 的性質', ['國二上', '自然', '2-2']],
  ['國二上 英文 L1 Back to School', ['國二上', '英文', 'L1']],
  ['國二上 英文 L1 Unit 2', ['國二上', '英文', 'L1']],
  ['國二上 英文 L1-2', ['國二上', '英文', 'L1-2']],
  ['國二上 英文 Starter', ['國二上', '英文', 'Starter']],
  ['國二上 自然 2-', ['國二上', '自然', '2-']],
  ['B2 自然 2-1', ['B2', '自然', '2-1']],
  ['今天 自然 2', ['今天', '自然', '2']],
  ['國二上 英文 Unit 1', ['國二上', '英文 Unit', '1']],
  ['國二上 英文 Starter 開學', ['國二上', '英文 Starter', '開學']],
  ['自然 2-1', '看不懂'],
  ['老師說第三節不考', '看不懂'],
  ['國二上 自然', '看不懂'],
  ['國二上 自然 2-1、2-2', '看不懂'],
  ['國二上 自然 2-1, 2-2', '看不懂'],
  ['國二上 自然 2-1 ～ 2-3', '看不懂'],
  ['國二上 自然 2到3', '看不懂'],
  ['國二上 英文 Unit 1～Unit 3', '看不懂'],
  ['國二上 自然 2-1 水溶液、2-2 酸鹼', '看不懂'],
  ['國二上 自然 2-1 國二下 自然 2-2', '看不懂'],
  ['國二上 自然 2-1 2-2', '看不懂'],
  ['國二上 英文 L1 L2', '看不懂'],
  ['國二上 自然 2/3', '看不懂'],
  ['分類：醫學', '分類'],
  ['- 分類:醫學', '分類'],
];

void test('一行怎麼讀：年級學期、科目、編號；讀不懂的不猜', () => {
  const wrong = LINES.flatMap(([line, expected]) => {
    const got = readLine(line);
    return JSON.stringify(got) === JSON.stringify([expected]) ? [] : [{ line, expected, got }];
  });
  assert.deepEqual(wrong, []);
});

const wide = (text: string): string => text.replace(/[0-9A-Za-z.,\-]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
const NOISE: Record<string, (line: string) => string> = {
  全形字: wide,
  連續空白: t => t.replace(/ /g, '  '),
  全形空白: t => t.replace(/ /g, '　'),
  Tab: t => t.replace(/ /g, '\t'),
  短破折號: t => t.replace(/(?<=\d)-(?=\d)/g, '–'),
  開頭空白: t => '  ' + t,
  結尾空白: t => t + '  ',
  最後的逗號: t => t + ',',
  最後的全形逗號: t => t + '，',
  最後的句號: t => t + '。',
  零寬字元: t => t + String.fromCharCode(0x200b),
};

void test('一行怎麼讀的性質：打字雜訊不影響意思', () => {
  for (const [line, expected] of LINES) for (const [name, change] of Object.entries(NOISE)) {
    const got = readLine(change(line));
    // 只有編號的大小寫與全形比鍵，這裡 expected 是半形的原字，所以比字面。
    assert.deepEqual(got, [expected], `${name}：${JSON.stringify(change(line))}`);
  }
});

void test('屬性區以外逐行當純文字讀：標題、空行不算；圍欄、註解裡的行一樣算', () => {
  const text = '---\n識別碼: x7f3k2\n---\n\n# 這次的範圍\n## 自然\n```\n- 國二上 自然 2\n```\n<!-- 國二上 自然 3 -->\n> 國二上 自然 4\n#沒有空白的不是標題\n---\n';
  assert.deepEqual(parseScope(text).lines.map(line => [line.line, shown(line)]), [
    [6, '看不懂'], [7, ['國二上', '自然', '2']], [8, '看不懂'],
    [9, ['<!--', '國二上 自然', '3']], [10, ['>', '國二上 自然', '4']], [11, '看不懂'], [12, '看不懂'],
  ]);
  assert.deepEqual(parseScope('﻿- 國二上 自然 2').lines.map(shown), [['國二上', '自然', '2']], '檔頭的 BOM 不是字');
  assert.deepEqual(parseScope('﻿---\n識別碼: abc\n---\n- 國二上 自然 2').id, 'abc');
});

void test('每一行留著原字與行號，CRLF 也一樣', () => {
  const lines = parseScope('---\r\n識別碼: x\r\n---\r\n- 國二上 自然 2-2 水溶液\r\n老師說第三節不考\r\n').lines;
  assert.deepEqual(lines.map(line => [line.line, line.raw]), [[3, '- 國二上 自然 2-2 水溶液'], [4, '老師說第三節不考']]);
});

// ── 比對 ──

const unit = (term: string, subject: string, code: string) => ({ term, subject, code });

void test('比對：同一學期同一科，編號相同或在它底下；後面每一段都不能是空的', () => {
  const inScope = (line: string, code: string, term = '國二上', subject = '自然'): boolean => unitInScope(parseScope(line + '\n'), unit(term, subject, code));
  const table: [string, string[], string[]][] = [
    ['國二上 自然 2', ['2', '2-1', '2-1-3'], ['20-1', '1-2', '2-', '2--1']],
    ['國二上 自然 2-1', ['2-1', '2-1-3'], ['2-2', '2-10', '2']],
    ['國二上 自然 L1', ['L1', 'L1-2', 'L1-2-3', 'l1', 'Ｌ１'], ['L10', 'L2', 'L01']],
    ['國二上 自然 Starter', ['Starter', 'Starter-2'], ['Starter2']],
    ['國二上 自然 2-', ['2-'], ['2', '2-1']],
    ['國二上 自然 第2章', ['2', '2-1'], ['20']],
  ];
  for (const [line, yes, no] of table) {
    for (const code of yes) assert.equal(inScope(line, code), true, `${line} 包含 ${code}`);
    for (const code of no) assert.equal(inScope(line, code), false, `${line} 不包含 ${code}`);
  }
  assert.equal(inScope('國二上 自然 2', '2-1', '國二下'), false, '別的學期');
  assert.equal(inScope('國二上 自然 2', '2-1', '八上'), true, '學期比鍵');
  assert.equal(inScope('國二上 自然 2', '2-1', '國二上', '數學'), false, '別的科目');
  assert.equal(inScope('國二上 Social  Studies L1', 'L1', '國二上', 'social studies'), true, '科目不分大小寫與多的空白');
  assert.equal(inScope('Ｂ２ 自然 2', '2-1', 'B2'), true, '認不得的學期也去雜訊比');
  assert.equal(inScope('B2 自然 2', '2-1', 'Ｂ２'), true);
  assert.equal(inScope('今天 自然 2', '2-1'), false, '認不得的學期不等於已知的學期');
});

void test('比對：看不懂與分類的行不算', () => {
  assert.equal(unitInScope(parseScope('國二上 自然 2-1、2-2\n分類：醫學\n'), unit('國二上', '自然', '2-1')), false);
});

// ── 日期 ──

void test('日期：常見寫法都認得，存成標準格式；不存在的、缺年份、民國年不猜', () => {
  const ok: [unknown, string][] = [
    ['2026-10-28', '2026-10-28'], ['2026/10/28', '2026-10-28'], ['2026.10.28', '2026-10-28'], ['20261028', '2026-10-28'], [20261028, '2026-10-28'],
    ['2026-1-5', '2026-01-05'], ['２０２６－１０－２８', '2026-10-28'], ['２０２６／１０／２８', '2026-10-28'], [' 2026-10-28 ', '2026-10-28'],
    ['2028-02-29', '2028-02-29'], ['2000-02-29', '2000-02-29'],
  ];
  const why = (value: unknown): string => { const read = readDate(value); return read.kind === 'bad' ? read.why : read.kind; };
  for (const [value, date] of ok) assert.deepEqual(readDate(value), { kind: 'ok', date }, JSON.stringify(value));
  for (const value of ['2026-13-01', '2026-02-30', '2026-02-29', '1900-02-29', '20260230', 20260230]) assert.equal(why(value), 'nonexistent', JSON.stringify(value));
  for (const value of ['10/28', '115/10/28', '明天', '2026-10', '2026-10/28', true, 2.5, 202610, [], {}, new Date(0)]) assert.equal(why(value), 'format', JSON.stringify(value));
  for (const value of [undefined, null, '', '   ']) assert.deepEqual(readDate(value), { kind: 'none' }, JSON.stringify(value));
});

const scope = (head: string, body = '- 國二上 自然 2\n'): ScopeFile => parseScope(`---\n${head}\n---\n${body}`);
const period = (head: string): unknown => {
  const found = scopePeriod(scope(head));
  return found.kind === 'ok' ? [found.start, found.end] : found.kind;
};

void test('考試期間（§2-2 的表）：屬性的 YAML 型別都認得', () => {
  assert.equal(period('識別碼: x'), 'none');
  assert.equal(period('考試開始:\n考試結束:'), 'none', '空著算沒寫');
  assert.deepEqual(period('考試開始: 2026-10-28'), ['2026-10-28', '2026-10-28']);
  assert.deepEqual(period('考試開始: 20261028'), ['2026-10-28', '2026-10-28'], 'YAML 讀成數字');
  assert.deepEqual(period('考試開始: "20261028"'), ['2026-10-28', '2026-10-28'], '引號裡是字串');
  assert.deepEqual(period('考試開始: 2026/10/28\n考試結束: 2026.10.29'), ['2026-10-28', '2026-10-29']);
  assert.deepEqual(period('考試開始: 2026-10-28\n考試結束: 2026-10-28'), ['2026-10-28', '2026-10-28'], '同一天可以');
  assert.deepEqual(period('考試結束: 2026-10-29'), ['2026-10-29', '2026-10-29']);
  for (const head of ['考試開始: 2026-10-29\n考試結束: 2026-10-28', '考試開始: 10/28', '考試開始: 2026-10-28\n考試結束: 2026-13-01', '考試結束: 115/10/28', '考試開始: true', '考試開始: !!timestamp 2026-10-28']) {
    assert.equal(period(head), 'bad', head);
  }
});

void test('提前結束：有這一行就算結束，值空著或看不懂也算；期間留著', () => {
  assert.equal(scope('考試開始: 2026-10-28').ended, false);
  for (const value of ['2026-11-04', '', '亂寫']) {
    const file = scope('考試開始: 2026-10-28\n考試結束: 2026-10-29\n提前結束: ' + value);
    assert.equal(file.ended, true, value);
    assert.deepEqual(scopePeriod(file).kind, 'ok');
  }
});

void test('屬性區壞了：日期算有問題，不會因為壞了就復活；有結束的 --- 時底下照讀', () => {
  const broken: [string, number, boolean][] = [
    ['---\n考試開始: [\n---\n- 國二上 自然 2\n', 1, false],
    ['---\n考試開始: 2026-10-28\n考試開始: 2026-10-29\n---\n- 國二上 自然 2\n', 1, false],
    ['---\n- 清單\n---\n- 國二上 自然 2\n', 1, false],
    ['---\n考試開始: [\n提前結束: 2026-11-04\n---\n- 國二上 自然 2\n', 1, true],
    ['---\n考試開始: 2026-10-28\n- 國二上 自然 2\n', 0, false],
    ['---\n提前結束: 2026-11-04\n- 國二上 自然 2\n', 0, true],
    ['---\n考試開始: *missing\n---\n- 國二上 自然 2\n', 1, false],
    ['---\n考試開始: &a [*a]\n---\n- 國二上 自然 2\n', 1, false],
    ['---\n其他: &a [*a]\n---\n- 國二上 自然 2\n', 1, false],
  ];
  for (const [text, lines, ended] of broken) {
    const file = parseScope(text);
    assert.equal(file.broken, true, text);
    assert.equal(scopePeriod(file).kind, 'bad', text);
    assert.equal(file.lines.filter(line => line.kind === 'unit').length, lines, text);
    assert.equal(file.ended, ended, text);
  }
  const plain = parseScope('- 國二上 自然 2\n');
  assert.equal(plain.broken, false, '沒有屬性區不算壞');
  assert.equal(scopePeriod(plain).kind, 'none');
  assert.equal(parseScope('---\n---\n- 國二上 自然 2\n').broken, false, '空的屬性區不算壞');
});

void test('範圍檔的新識別碼第一個字是字母：抽到的、撞到往下找的都是；卡組的 ID 不變', () => {
  assert.equal(newId(() => 0.75, new Set(), { letterFirst: true }), 'u22222');
  assert.equal(newId(() => 0.9999, new Set(['z99999']), { letterFirst: true }), 'aaaaaa', '撞到往下找，不會變成數字開頭');
  assert.equal(newId(() => 0.75, new Set()), '222222', '卡組的 ID 照舊');
  assert.equal(newId(() => 0.9999, new Set(['999999'])), 'aaaaaa');
  // 為什麼第一個字是字母就夠：這些看起來像數字或關鍵字的，YAML 都讀成字串。
  for (const id of ['e23456', 'nan234', 'inf234', 'true23', 'false2', 'null23', 'yes234', 'no2345', 'x23456']) {
    assert.equal((parseYaml(`識別碼: ${id}`) as Record<string, unknown>)['識別碼'], id, id);
  }
});

void test('識別碼照寫的字讀：YAML 當成數字的寫法不會變成別的；壞屬性區和正常的讀法相同', () => {
  const both = (written: string, id: string | null): void => {
    assert.equal(parseScope(`---\n識別碼: ${written}\n---\n`).id, id, written);
    assert.equal(parseScope(`---\n識別碼: ${written}\n其他: [\n---\n`).id, id, '壞屬性區：' + written);
    assert.equal(parseScope(`---\n識別碼: ${written}\n`).id, id, '沒有結束的 ---：' + written);
  };
  for (const id of ['2e2345', '3e8', '012345', '0x12ab', '0o1234', '1.50', '123456', '+12345', 'aaaaaa']) both(id, id);
  both('"school #1"', 'school #1');
  both("'a''b'", "a'b");
  both('"a\\"b"', 'a"b');
  both('"2e2345"', '2e2345');
  both('plain # 註解', 'plain');
  both('a#b', 'a#b');
  both('" 前後有空白 "', '前後有空白');
  both('', null);
  both('""', null);
  both('true', null);
  assert.equal(parseScope('---\n別名: &id 2e2345\n識別碼: *id\n---\n').id, '2e2345', '別名指到的也照原字');
  assert.equal(parseScope('---\n{識別碼: 2e2345, 考試開始: 2026-10-28}\n---\n').id, '2e2345');
  assert.equal(parseScope('---\n識別碼: [\n提前結束: 2026-10-20\n---\n').id, null, '這一行本身就壞了：算認不出來');

  const copy = { path: 'B.md', file: parseScope('---\n識別碼: "school #1"\n---\n- 國二上 自然 2\n') };
  const ended = parseScope('---\n識別碼: "school #1"\n提前結束: 2026-10-20\n其他: [\n---\n');
  assert.equal(chooseScope([{ path: 'A.md', file: ended }, copy], scopeDay('2026-10-25')).chosen, null, '正常的副本和壞掉的那份是同一次考試');
  assert.notEqual(parseScope('---\n識別碼: 2e2345\n---\n').id, parseScope('---\n識別碼: 3e4567\n---\n').id, '不同的字不會變成同一次考試');

  const written = editScope('---\n識別碼: 2e2345\n---\n- 國二上 自然 2\n', { start: '2026-10-28' }, []);
  assert.deepEqual(written, { kind: 'ok', text: '---\n識別碼: 2e2345\n考試開始: 2026-10-28\n---\n- 國二上 自然 2\n' }, '屬性讀回來還是同一個');
  const filled = editScope('---\n考試開始: 2026-10-28\n---\n- 國二上 自然 2\n', { end: '2026-10-29', id: '2e2345' }, []);
  assert.equal(filled.kind === 'ok' ? parseScope(filled.text).id : null, '2e2345', '補上的識別碼像數字也寫得進去');
});

void test('壞屬性區裡完整的識別碼行和正常讀法相同：鍵有引號也認得，舊副本不會復活（R18）', () => {
  for (const [line, id] of [['"識別碼": "school #1"', 'school #1'], ["'識別碼': abc234", 'abc234'], ['"識別碼" : 2e2345', '2e2345'], ['"\\u8B58\\u5225\\u78BC": abc234', 'abc234']]) {
    assert.equal(parseScope(`---\n${line}\n---\n`).id, id, '正常：' + line);
    assert.equal(parseScope(`---\n${line}\n其他: [\n---\n`).id, id, '壞屬性區：' + line);
    assert.equal(parseScope(`---\n其他: [\n${line}\n---\n`).id, id, '壞的在前面：' + line);
    assert.equal(parseScope(`---\n${line}\n`).id, id, '沒有結束的 ---：' + line);
  }
  for (const line of ['其他: "識別碼: abc234"', '# 識別碼: abc234', '其他: 識別碼', '識別碼', '識別碼: [abc234']) {
    assert.equal(parseScope(`---\n${line}\n其他二: [\n---\n`).id, null, '不是識別碼：' + line);
  }
  const copy = { path: 'B.md', file: parseScope('---\n"識別碼": "school #1"\n---\n- 國二上 自然 2\n') };
  const ended = { path: 'A.md', file: parseScope('---\n"識別碼": "school #1"\n提前結束: 2026-10-20\n其他: [\n---\n- 國二上 自然 2\n') };
  assert.equal(chooseScope([ended, copy], scopeDay('2026-10-25')).chosen, null);
  // 定下來的邊界：別名要看另一行，壞屬性區不跟（任務說明 §2-3），算認不出來。
  assert.equal(parseScope('---\n錨點: &x 1e3\n識別碼: *x\n其他: [\n---\n').id, null);
});

void test('壞屬性區只看最外層的行：多行的值與巢狀的鍵不是這份檔的識別碼，和正常讀法相同（R22）', () => {
  // 第三個是最外層的縮排：整份一起縮排也是合法的 YAML。
  const cases: [string, string | null, string][] = [
    ['備註: |\n  {"識別碼": "bbbbbb"}\n識別碼: aaaaaa', 'aaaaaa', ''],
    ['備註: |\n  識別碼: bbbbbb\n識別碼: aaaaaa', 'aaaaaa', ''],
    ['備註: |-\n  "識別碼": bbbbbb\n識別碼: aaaaaa', 'aaaaaa', ''],
    ['備註: >\n  識別碼: bbbbbb\n\n  識別碼: cccccc\n識別碼: aaaaaa', 'aaaaaa', ''],
    ['外層:\n  識別碼: bbbbbb\n識別碼: aaaaaa', 'aaaaaa', ''],
    ['備註: |\n  識別碼: bbbbbb', null, ''],
    ['外層:\n  識別碼: bbbbbb', null, ''],
    ['備註: "第一行\n  識別碼: bbbbbb\n  第三行"\n識別碼: aaaaaa', 'aaaaaa', ''],
    ['外層: {\n  識別碼: bbbbbb\n  }\n識別碼: aaaaaa', 'aaaaaa', ''],
    ['外層:\n  內層: |\n    識別碼: bbbbbb\n  識別碼: cccccc\n識別碼: aaaaaa', 'aaaaaa', ''],
    ['外層:\n- 識別碼: bbbbbb\n識別碼: aaaaaa', 'aaaaaa', ''],
    ['# 註解\n  識別碼: aaaaaa\n  備註: |\n    識別碼: bbbbbb', 'aaaaaa', '  '],
    ['  備註: |\n    識別碼: bbbbbb\n  識別碼: aaaaaa', 'aaaaaa', '  '],
    ['  外層:\n    識別碼: bbbbbb', null, '  '],
  ];
  for (const [head, id, indent] of cases) {
    assert.equal(parseScope(`---\n${head}\n---\n`).id, id, '正常：' + head);
    assert.equal(parseScope(`---\n${head}\n${indent}其他: [\n---\n`).id, id, '壞屬性區：' + head);
    assert.equal(parseScope(`---\n${head}\n${indent}其他: [\n`).id, id, '沒有結束的 ---：' + head);
  }
  // 多打的空白不是多行的值：這一行前面沒有開多行值的行，照認。
  assert.equal(parseScope('---\n其他: 1\n  識別碼: aaaaaa\n其他二: [\n---\n').id, 'aaaaaa');
  // 結束的 A 的備註裡寫著 B 的識別碼：B 是另一次考試，不跟著結束。
  const ended = { path: 'A.md', file: parseScope('---\n備註: |\n  {"識別碼": "bbbbbb"}\n識別碼: aaaaaa\n提前結束: 2026-10-20\n其他: [\n---\n- 國二上 自然 2\n') };
  const other = { path: 'B.md', file: parseScope('---\n識別碼: bbbbbb\n---\n- 國二上 自然 2\n') };
  assert.equal(chooseScope([ended, other], scopeDay('2026-10-25')).chosen?.path, 'B.md');
});

void test('屬性區壞了還認得識別碼：舊副本不會復活；認不出來的只有它自己結束，寫不出是哪一次考試', () => {
  const copy = { path: 'B.md', file: parseScope('---\n識別碼: aaaaaa\n---\n- 國二上 自然 2\n') };
  const chosen = (text: string): string | null => chooseScope([{ path: 'A.md', file: parseScope(text) }, copy], scopeDay('2026-10-25')).chosen?.path ?? null;
  for (const text of [
    '---\n識別碼: aaaaaa\n提前結束: 2026-10-20\n其他: [\n---\n- 國二上 自然 2\n',
    '---\n識別碼: "aaaaaa" # 手寫的\n提前結束: 2026-10-20\n其他: [\n---\n',
    "---\n  識別碼: 'aaaaaa'\n提前結束: 2026-10-20\n提前結束: 2026-10-21\n---\n",
    '---\n識別碼: aaaaaa\n提前結束: 2026-10-20\n',
  ]) {
    assert.equal(parseScope(text).id, 'aaaaaa', text);
    assert.equal(chosen(text), null, text);
  }
  assert.equal(chosen('---\n提前結束: 2026-10-20\n其他: [\n---\n'), 'B.md', '連識別碼都沒有：不知道是哪一次考試，不併');
  assert.equal(chosen('---\n識別碼: # 手寫的\n提前結束: 2026-10-20\n其他: [\n---\n'), 'B.md', '空著的識別碼算沒有');
});

void test('識別碼：字串或數字都留著，空白算沒有；不檢查字母表', () => {
  assert.equal(scope('識別碼: x7f3k2').id, 'x7f3k2');
  assert.equal(scope('識別碼: 123456').id, '123456');
  assert.equal(scope('識別碼: 手寫的').id, '手寫的');
  for (const head of ['識別碼:', '識別碼: ""', '考試開始: 2026-10-28']) assert.equal(scope(head).id, null, head);
});

void test('日編號和 dayOf 同一種算法：清晨 4 點換日', () => {
  const at = (text: string): number => dayOf(Date.parse(text), 480);
  assert.equal(scopeDay('2026-10-28'), at('2026-10-28T04:00:00+08:00'));
  assert.equal(scopeDay('2026-10-28'), at('2026-10-29T03:59:00+08:00'));
  assert.equal(scopeDay('2026-10-29'), at('2026-10-29T04:00:00+08:00'));
});

void test('範圍檔的路徑：考試範圍資料夾裡的 md，子資料夾也算', () => {
  assert.equal(isExamPath('Essence Cards/考試範圍/2026-10-28 國二上.md'), true);
  assert.equal(isExamPath('Essence Cards/考試範圍/舊的/2026-10-28 國二上.md'), true);
  assert.equal(isExamPath('Essence Cards/考試範圍/附件.png'), false);
  assert.equal(isExamPath('Essence Cards/自然/2-1.md'), false);
});

void test('範圍檔的路徑：考試範圍/小考/ 留給小考（D-189），只排除直接底下叫「小考」的那一層', () => {
  for (const path of ['a.md', '2026/a.md', '小考備份/a.md', '舊的/小考/a.md', '小考.md']) assert.equal(isExamPath('Essence Cards/考試範圍/' + path), true, path);
  for (const path of ['小考/a.md', '小考/2026/b.md']) assert.equal(isExamPath('Essence Cards/考試範圍/' + path), false, path);
});

// ── 選哪一份（§2-3、Codex F4）──

const entry = (path: string, head: string, body = '- 國二上 自然 2\n') => ({ path, file: parseScope(`---\n${head}\n---\n${body}`) });
const TODAY = scopeDay('2026-10-20');
function chosen(entries: ReturnType<typeof entry>[], day = TODAY): string | null {
  const first = chooseScope(entries, day);
  const second = chooseScope([...entries].reverse(), day);
  assert.equal(second.chosen?.path, first.chosen?.path, '和輸入順序無關');
  return first.chosen?.path ?? null;
}

void test('選定：有效期間的開始日早的先，只寫結束日的用結束日；沒有期間與日期有問題的排後面；平手比路徑', () => {
  assert.equal(chosen([]), null);
  assert.equal(chosen([entry('b', '考試開始: 2026-10-28'), entry('a', '考試開始: 2026-10-29')]), 'b');
  assert.equal(chosen([entry('a', '考試開始: 2026-10-28'), entry('b', '考試結束: 2026-10-25')]), 'b', '只寫結束日');
  assert.equal(chosen([entry('a', '識別碼: x'), entry('b', '考試開始: 2026-10-28')]), 'b', '沒有期間排後面');
  assert.equal(chosen([entry('a', '考試開始: 10/28'), entry('b', '考試開始: 2026-10-28')]), 'b', '日期有問題排後面');
  assert.equal(chosen([entry('b', '考試開始: 10/28'), entry('a', '識別碼: x')]), 'a', '兩種之間比路徑');
  assert.equal(chosen([entry('a', '識別碼: x'), entry('b', '考試開始: 10/28')]), 'a');
  assert.equal(chosen([entry('B', '考試開始: 2026-10-28'), entry('a', '考試開始: 2026-10-28')]), 'B', '路徑是字串比較，不看語系');
});

void test('生效：開始日還沒到也算；結束日當天還算，隔天不算；日期未定與日期有問題不會自動失效', () => {
  const exam = [entry('a', '考試開始: 2026-10-28\n考試結束: 2026-10-29')];
  assert.equal(chosen(exam, scopeDay('2026-10-01')), 'a');
  assert.equal(chosen(exam, scopeDay('2026-10-29')), 'a');
  assert.equal(chosen(exam, scopeDay('2026-10-30')), null);
  assert.equal(chosen([entry('a', '識別碼: x')], scopeDay('2030-01-01')), 'a');
  assert.equal(chosen([entry('a', '考試開始: 10/28')], scopeDay('2030-01-01')), 'a');
  assert.equal(chosen([entry('a', '考試開始: 2026-10-20')], scopeDay('2026-10-21')), null, '只寫開始就是一天');
});

void test('提前結束：同一個識別碼任一份結束，整組都結束，舊副本不會復活；別的識別碼接手', () => {
  const ended = entry('a', '識別碼: x\n考試開始: 2026-10-28\n提前結束: 2026-10-20');
  const copy = entry('b', '識別碼: x\n考試開始: 2026-10-28');
  assert.equal(chosen([ended, copy]), null);
  assert.equal(chosen([ended, copy, entry('c', '識別碼: y\n考試開始: 2026-11-28')]), 'c');
  assert.equal(chosen([entry('a', '提前結束: 2026-10-20'), entry('b', '考試開始: 2026-10-28')]), 'b', '沒有識別碼的各算一次考試，不併');
  assert.equal(chosen([entry('a', '識別碼: x\n提前結束: 亂寫'), entry('b', '識別碼: x')]), null, '值看不懂也算結束');
  const broken = { path: 'a', file: parseScope('---\n識別碼: x\n提前結束: [\n---\n- 國二上 自然 2\n') };
  assert.equal(chooseScope([broken], TODAY).chosen, null, '屬性區壞了但字裡有提前結束');
});

void test('候選：只有看不懂、只有分類或空的檔，不會蓋過真的範圍；只有它時回傳它，但不能用', () => {
  const real = entry('z', '考試開始: 2026-12-01');
  for (const body of ['老師說第三節不考\n', '分類：醫學\n', '', '# 只有標題\n']) {
    const empty = entry('a', '考試開始: 2026-10-28', body);
    assert.equal(chosen([empty, real]), 'z', body);
    assert.deepEqual(chooseScope([empty], TODAY).usable, false, body);
    assert.equal(chooseScope([empty], TODAY).chosen?.path, 'a', body);
  }
  assert.equal(chooseScope([real], TODAY).usable, true);
  assert.equal(chooseScope([entry('a', '識別碼: x', '- 今天 自然 2\n')], TODAY).usable, true, '對不到卡組的也算讀得懂');
});

void test('其他也生效的：同一次考試的副本與別的考試都列，結束的不列', () => {
  const list = [entry('a', '識別碼: x\n考試開始: 2026-10-28'), entry('b', '識別碼: x\n考試開始: 2026-10-28'), entry('c', '考試開始: 2026-11-01'), entry('d', '提前結束: 2026-10-20'), entry('e', '識別碼: y', '老師說\n')];
  assert.deepEqual(chooseScope(list, TODAY).others, ['b', 'c']);
});

// ── 寫回（§2-4、Codex F5）──

const units = (...codes: string[]): { term: string; subject: string; code: string }[] => codes.map(code => unit('國二上', '自然', code));
function edit(text: string, change: Parameters<typeof editScope>[1], known: readonly { term: string; subject: string; code: string }[] = []): string {
  scopeCases.add(text);
  const done = editScope(text, change, known);
  assert.equal(done.kind, 'ok', text);
  return done.kind === 'ok' ? done.text : '';
}

const FILE = `---
識別碼: x7f3k2
考試開始: 2026-10-28
---
# 範圍
- 國二上 自然 2-1
- 國二上 自然 2-2 水溶液
- 國二上 自然 第2章第2節
- 國二上 自然 2-9 老師手寫
分類：醫學
老師說第三節不考
- 國二下 自然 2-2
- 國二上 英文 L1
`;
const CHAPTER = `---
識別碼: x7f3k2
---
- 國二上 自然 2
- 國二上 自然 ２
- 國二上 自然 2-9 老師手寫
分類：醫學
老師說第三節不考
- 國二上 英文 L1
`;
const BOOK = units('2', '2-1', '2-1-3', '2-2', '2-3', '3-1');

void test('勾與取消：只動那幾行，其他字一字不動', () => {
  assert.equal(edit(FILE, { remove: units('2-2') }), FILE.replace('- 國二上 自然 2-2 水溶液\n- 國二上 自然 第2章第2節\n', ''), '別名與重複的行一起');
  assert.equal(edit(FILE, { remove: units('2-9') }), FILE.replace('- 國二上 自然 2-9 老師手寫\n', ''));
  assert.equal(edit(FILE, { add: units('2-3') }), FILE.replace('- 國二上 自然 2-9 老師手寫\n', '- 國二上 自然 2-9 老師手寫\n- 國二上 自然 2-3\n'), '同一學期同一科最後一行後面');
  assert.equal(edit(FILE, { add: [unit('國一上', '自然', '1-1')] }), FILE.replace('- 國二下 自然 2-2\n', '- 國二下 自然 2-2\n- 國一上 自然 1-1\n'), '這個學期沒有行：同一科最後一行後面');
  assert.equal(edit(FILE, { add: [unit('國二上', '英文', 'L2')] }), FILE.replace('- 國二上 英文 L1\n', '- 國二上 英文 L1\n- 國二上 英文 L2\n'));
  assert.equal(edit(FILE, { add: [unit('國二上', '數學', '1')] }), FILE + '- 國二上 數學 1\n', '這一科沒有行就加在最後');
  assert.equal(edit(FILE, { add: units('2-1') }), FILE, '已經有了');
  assert.equal(edit(CHAPTER, { add: units('2-1') }), CHAPTER, '已經被整章包含');
  assert.equal(edit(FILE, { remove: units('7-7') }), FILE, '沒有這一行');
});

void test('勾「2 全部」：被包含的行換成一行 2，放在第一個被換掉的位置；別的學期、看不懂的、分類留著', () => {
  assert.equal(edit(FILE, { add: units('2') }), `---
識別碼: x7f3k2
考試開始: 2026-10-28
---
# 範圍
- 國二上 自然 2
分類：醫學
老師說第三節不考
- 國二下 自然 2-2
- 國二上 英文 L1
`);
});

void test('整章裡取消一個：2 換成目前有卡組的其他單元，只留最上層；明寫的行留著', () => {
  assert.equal(edit(CHAPTER, { remove: units('2-2') }, BOOK), `---
識別碼: x7f3k2
---
- 國二上 自然 2-1
- 國二上 自然 2-3
- 國二上 自然 2-9 老師手寫
分類：醫學
老師說第三節不考
- 國二上 英文 L1
`, '兩行都是 2（別名），只展開一次；2 自己的卡組不算了；2-1-3 由 2-1 包含');
  assert.equal(edit(CHAPTER, { remove: units('2-1-3') }, BOOK), `---
識別碼: x7f3k2
---
- 國二上 自然 2-2
- 國二上 自然 2-3
- 國二上 自然 2-9 老師手寫
分類：醫學
老師說第三節不考
- 國二上 英文 L1
`, '取消的單元有上一層：2-1 包含它，也不算了');
  assert.equal(edit(CHAPTER, { remove: units('2-9') }, BOOK), `---
識別碼: x7f3k2
---
- 國二上 自然 2-1
- 國二上 自然 2-2
- 國二上 自然 2-3
分類：醫學
老師說第三節不考
- 國二上 英文 L1
`, '明寫的行本身被取消');
  const after = parseScope(edit(CHAPTER, { remove: units('2-2') }, BOOK));
  assert.equal(unitInScope(after, unit('國二上', '自然', '2-2')), false);
  assert.equal(unitInScope(after, unit('國二上', '自然', '2-1-3')), true);
  assert.equal(unitInScope(after, unit('國二上', '自然', '2-4')), false, '之後才建立的不再自動算進去');
  assert.equal(unitInScope(after, unit('國二上', '自然', '2')), false, '這個格式寫不出只考它自己');
  assert.equal(unitInScope(after, unit('國二上', '自然', '2-9')), true);
});

void test('整章裡取消一個：寫不回去的單元存了會掉出範圍，不寫、指出是哪個；一起取消或只取消它都照常', () => {
  const chapter = '---\n識別碼: x\n---\n- 國二上 自然 2\n';
  const odd = unit('國二上', '自然', '2-9,3');
  const book = [...units('2-1'), odd, ...units('2-10')];
  assert.equal(scopeWritable(odd), false, '直接勾就擋掉的那一種');
  assert.equal(unitInScope(parseScope(chapter), odd), true, '整章本來包含它');
  assert.deepEqual(editScope(chapter, { remove: units('2-1') }, book), { kind: 'blocked', reason: 'special', lost: ['2-9,3'] });
  assert.equal(edit(chapter, { remove: [...units('2-1'), odd] }, book), '---\n識別碼: x\n---\n- 國二上 自然 2-10\n');
  assert.equal(edit(chapter, { remove: [odd] }, book), '---\n識別碼: x\n---\n- 國二上 自然 2-1\n- 國二上 自然 2-10\n');
  assert.equal(edit(chapter, { add: units('3') }, book), chapter + '- 國二上 自然 3\n', '沒有取消就不用展開');
});

void test('整章裡取消一個的性質：取消前後，只有取消的與包含它的不在範圍，其他都還在', () => {
  const chapter = '---\n識別碼: x\n---\n- 國二上 自然 2\n';
  const book = units('2', '2-1', '2-1-3', '2-1-4', '2-2', '2-10');
  const answers: Record<string, string[]> = {
    '2-1-3': ['2-1-4', '2-2', '2-10'],
    '2-1': ['2-2', '2-10'],
    '2-2': ['2-1', '2-1-3', '2-1-4', '2-10'],
    '2-10': ['2-1', '2-1-3', '2-1-4', '2-2'],
  };
  for (const [removed, kept] of Object.entries(answers)) {
    const file = parseScope(edit(chapter, { remove: units(removed) }, book));
    assert.deepEqual(book.filter(each => unitInScope(file, each)).map(each => each.code), kept, removed);
  }
});

void test('取消整章與底下的：一起刪', () => {
  assert.equal(edit(FILE, { remove: units('2') }, BOOK), FILE.replace('- 國二上 自然 2-1\n- 國二上 自然 2-2 水溶液\n- 國二上 自然 第2章第2節\n- 國二上 自然 2-9 老師手寫\n', ''));
});

void test('先取消再新勾：同一次按確定', () => {
  assert.equal(edit('---\n識別碼: x\n---\n- 國二上 自然 2-1\n', { remove: units('2-1'), add: units('2-2') }), '---\n識別碼: x\n---\n- 國二上 自然 2-2\n');
});

void test('日期：畫面改了的寫新值，沒改的標準化，看不懂的留原字，清空就刪；註解與別的屬性不動', () => {
  const file = '---\n# 手寫的註解\n識別碼: x\n考試開始: 20261028 # 第一天\n老師: 王\n考試結束: 2026/10/29\n---\n- 國二上 自然 2\n';
  assert.equal(edit(file, {}), '---\n# 手寫的註解\n識別碼: x\n考試開始: 2026-10-28 # 第一天\n老師: 王\n考試結束: 2026-10-29\n---\n- 國二上 自然 2\n');
  assert.equal(edit(file, { start: '2026-10-20' }), '---\n# 手寫的註解\n識別碼: x\n考試開始: 2026-10-20 # 第一天\n老師: 王\n考試結束: 2026-10-29\n---\n- 國二上 自然 2\n');
  assert.equal(edit(file, { end: null }), '---\n# 手寫的註解\n識別碼: x\n考試開始: 2026-10-28 # 第一天\n老師: 王\n---\n- 國二上 自然 2\n');
  assert.equal(edit('---\n考試開始: 10/28\n---\n', {}), '---\n考試開始: 10/28\n---\n', '看不懂的留原字');
  assert.equal(edit('---\n考試開始: 2026.10.28\n---\n', {}), '---\n考試開始: 2026-10-28\n---\n', '值沒變、只是寫法不同也寫成標準');
  assert.equal(edit('---\n考試開始: "2026-10-28"\n---\n', {}), '---\n考試開始: "2026-10-28"\n---\n', '引號留著：裡面已經是標準寫法就不動');
  const quoted = "---\n考試開始: '20261028' # 留著\n考試結束: \"2026/10/29\"\n---\n";
  assert.equal(edit(quoted, {}), "---\n考試開始: '2026-10-28' # 留著\n考試結束: \"2026-10-29\"\n---\n", '標準化只換引號裡面的字');
  assert.equal(edit(quoted, { start: '2026-10-20', end: '2026-10-21' }), "---\n考試開始: '2026-10-20' # 留著\n考試結束: \"2026-10-21\"\n---\n", '畫面改的值也是');
  assert.equal(edit("---\n識別碼: ''\n---\n", { id: 'abc123' }), "---\n識別碼: 'abc123'\n---\n");
  assert.equal(edit('---\n考試開始:\n---\n', { start: '2026-10-28' }), '---\n考試開始: 2026-10-28\n---\n', '空著的值');
  assert.equal(edit('---\n考試結束: 2026-10-29\n---\n', { start: '2026-10-28' }), '---\n考試開始: 2026-10-28\n考試結束: 2026-10-29\n---\n', '開始寫在結束前面');
  assert.equal(edit('---\n識別碼: x\n---\n', { end: '2026-10-29' }), '---\n識別碼: x\n考試結束: 2026-10-29\n---\n');
  assert.equal(edit('---\n考試結束: 2026-10-29\n---\n', { end: null }), '---\n---\n', '唯一的屬性也能刪');
  assert.equal(edit('---\n考試開始: [2026, 10]\n---\n', { start: '2026-10-28' }), '---\n考試開始: 2026-10-28\n---\n', '清單是看不懂的日期，畫面改了就換掉整個值');
  assert.equal(edit('---\n考試開始: [2026, 10]\n---\n', {}), '---\n考試開始: [2026, 10]\n---\n');
});

void test('識別碼：第一次寫入補在屬性區最前面，已經有就不動；沒有屬性區就建一個', () => {
  assert.equal(edit('---\n考試開始: 2026-10-28\n---\n- 國二上 自然 2\n', { id: 'abc123' }), '---\n識別碼: abc123\n考試開始: 2026-10-28\n---\n- 國二上 自然 2\n');
  assert.equal(edit('---\n識別碼: x\n---\n', { id: 'abc123' }), '---\n識別碼: x\n---\n');
  assert.equal(edit('---\n識別碼:\n---\n', { id: 'abc123' }), '---\n識別碼: abc123\n---\n', '空著的值');
  assert.equal(edit('- 國二上 自然 2\n', { id: 'abc123' }), '---\n識別碼: abc123\n---\n- 國二上 自然 2\n');
  assert.equal(edit('﻿- 國二上 自然 2\n', { id: 'abc123', start: '2026-10-28' }), '﻿---\n識別碼: abc123\n考試開始: 2026-10-28\n---\n- 國二上 自然 2\n', 'BOM 留在最前面');
  assert.equal(edit('- 國二上 自然 2\n', {}), '- 國二上 自然 2\n', '沒有要補的就不建');
});

void test('提前結束：多一行，開始與結束日不動', () => {
  assert.equal(edit('---\n識別碼: x\n考試開始: 2026-10-28\n考試結束: 2026-10-29\n---\n- 國二上 自然 2\n', { ended: '2026-10-24' }), '---\n識別碼: x\n考試開始: 2026-10-28\n考試結束: 2026-10-29\n提前結束: 2026-10-24\n---\n- 國二上 自然 2\n');
});

void test('提前結束：手寫的日期連寫法都不動，引號也是；還沒有識別碼的照樣補', () => {
  assert.equal(edit('---\n識別碼: x\n考試開始: 20261028\n考試結束: 2026/10/29\n---\n- 國二上 自然 2\n', { ended: '2026-10-24' }), '---\n識別碼: x\n考試開始: 20261028\n考試結束: 2026/10/29\n提前結束: 2026-10-24\n---\n- 國二上 自然 2\n');
  assert.equal(edit("---\n識別碼: x\n考試開始: '20261028' # 留著\n---\n", { ended: '2026-10-24' }), "---\n識別碼: x\n考試開始: '20261028' # 留著\n提前結束: 2026-10-24\n---\n");
  assert.equal(edit('---\n考試開始: 10/28\n---\n', { ended: '2026-10-24', id: 'abc123' }), '---\n識別碼: abc123\n考試開始: 10/28\n提前結束: 2026-10-24\n---\n');
});

void test('換行照檔案原本的：CRLF、結尾沒換行都留著', () => {
  const crlf = '---\r\n識別碼: x\r\n考試開始: 20261028\r\n---\r\n- 國二上 自然 2-1\r\n- 國二上 英文 L1\r\n';
  assert.equal(edit(crlf, { add: units('2-2') }), '---\r\n識別碼: x\r\n考試開始: 2026-10-28\r\n---\r\n- 國二上 自然 2-1\r\n- 國二上 自然 2-2\r\n- 國二上 英文 L1\r\n');
  assert.equal(edit('---\n識別碼: x\n---\n- 國二上 自然 2-1', { add: units('2-2') }), '---\n識別碼: x\n---\n- 國二上 自然 2-1\n- 國二上 自然 2-2');
  assert.equal(edit('---\n識別碼: x\n---\n- 國二上 自然 2-1', { add: [unit('國二上', '數學', '1')] }), '---\n識別碼: x\n---\n- 國二上 自然 2-1\n- 國二上 數學 1');
  assert.equal(edit('---\n識別碼: x\n---', { add: units('2-2') }), '---\n識別碼: x\n---\n- 國二上 自然 2-2', '屬性區後面沒有字');
  assert.equal(edit('---\n識別碼: x\n---\n- 國二上 自然 2-1\n\n\n', { add: [unit('國二上', '數學', '1')] }), '---\n識別碼: x\n---\n- 國二上 自然 2-1\n- 國二上 數學 1\n\n\n', '加在最後一行有字的後面');
});

void test('不寫：檔不見或清空、已經結束、屬性區壞了', () => {
  const blocked = (text: string): string => { const done = editScope(text, { add: units('2') }, []); return done.kind === 'blocked' ? done.reason : 'ok'; };
  assert.equal(blocked(''), 'changed');
  assert.equal(blocked('---\n識別碼: x\n提前結束: 2026-10-20\n---\n'), 'changed');
  assert.equal(blocked('---\n考試開始: [\n---\n'), 'broken');
  assert.equal(blocked('---\n考試開始: 2026-10-28\n'), 'broken');
  assert.deepEqual(editScope('---\n{考試開始: 2026-10-28}\n---\n', { id: 'abc123' }, []), { kind: 'blocked', reason: 'broken' }, '一行的寫法加不了新的一行：不寫，不是寫壞');
});

void test('新檔的內容與檔名', () => {
  assert.equal(newScopeText({ id: 'x7f3k2', start: '2026-10-28', end: '2026-10-29', add: [unit('國二上', '自然', '2'), unit('國二上', '英文', 'L1')] }), '---\n識別碼: x7f3k2\n考試開始: 2026-10-28\n考試結束: 2026-10-29\n---\n- 國二上 自然 2\n- 國二上 英文 L1\n');
  assert.equal(newScopeText({ id: 'x7f3k2', add: [unit('國二上', '自然', '2')] }), '---\n識別碼: x7f3k2\n---\n- 國二上 自然 2\n');
  assert.equal(scopeFileName('2026-10-28', [unit('國一下', '自然', '1'), unit('國二上', '自然', '2'), unit('B2', '自然', '3')]), '2026-10-28 國二上', '最新的認得的學期');
  assert.equal(scopeFileName(null, [unit('國二上', '自然', '2')]), '日期未定 國二上');
  assert.equal(scopeFileName('2026-10-28', [unit('B2', '自然', '2')]), '2026-10-28', '不認得的學期不放進檔名');
  assert.equal(scopeFileName(null, [unit('B2', '自然', '2')]), '日期未定');
});

void test('寫得回去的單元才能勾：讀回來要是同一個', () => {
  for (const each of [unit('國二上', '自然', '2'), unit('八上', 'Social Studies', 'L1-2'), unit('國二上', '英文', 'Starter'), unit('B2', '自然', '2-'), unit('國二上', 'Math2', 'L1')]) assert.equal(scopeWritable(each), true, JSON.stringify(each));
  for (const each of [unit('B 2', '自然', '2'), unit('國二上', '社會 2 班', 'L1'), unit('國二上', '自然', '2,3'), unit('國二上', '自然', '水溶液 2')]) assert.equal(scopeWritable(each), false, JSON.stringify(each));
});

// ── 共用範例：登錄過的每個檔（要放在最後）──

void test('日期套到最新的內容上變成開始晚於結束：不寫；家長原本的值，畫面沒改就留著', () => {
  const latest = '---\n識別碼: x\n考試開始: 2026-10-21\n考試結束: 2026-10-25\n---\n- 國二上 自然 2\n';
  const dates = { kind: 'blocked', reason: 'dates' };
  assert.deepEqual(editScope(latest, { start: '2026-10-27' }, []), dates, '畫面把開始改成 10/27，別台把結束改成 10/25');
  assert.deepEqual(editScope(latest, { end: '2026-10-20' }, []), dates);
  assert.deepEqual(editScope(latest, { start: '2026-10-27', add: units('3') }, []), dates, '一起勾的也不寫');
  assert.equal(edit(latest, { start: '2026-10-25' }), latest.replace('10-21', '10-25'), '同一天可以');
  assert.equal(edit(latest, { start: '2026-10-27', end: '2026-10-28' }), latest.replace('10-21', '10-27').replace('10-25', '10-28'), '兩邊都改的是對的');
  assert.equal(edit(latest, { start: null }), latest.replace('考試開始: 2026-10-21\n', ''));
  const inverted = '---\n識別碼: x\n考試開始: 2026-10-30\n考試結束: 2026-10-25\n---\n- 國二上 自然 2\n';
  assert.equal(edit(inverted, { add: units('3') }), inverted + '- 國二上 自然 3\n', '畫面沒改日期：原本的留著，日期有問題照舊寫出來');
  assert.deepEqual(editScope(inverted, { start: '2026-10-29' }, []), dates, '畫面改了還是不對');
  assert.equal(edit(inverted, { start: '2026-10-20' }), inverted.replace('10-30', '10-20'), '改對了就寫');
  const other = '---\n考試開始: 2026-10-21\n考試結束: 10/25\n---\n';
  assert.equal(edit(other, { start: '2026-10-27' }), other.replace('10-21', '10-27'), '另一邊看不懂：留原字，不算這次造成的');
});

void test('換行混在一起：沒改到的行連換行都不動，改到的用它原本的換行', () => {
  const mixed = '---\r\n識別碼: aaaaaa\n# 註解\n考試開始: 2026-10-28\n其他: 1\n---\n- 國二上 自然 2\n';
  assert.equal(edit(mixed, { start: '2026-10-29' }), mixed.replace('10-28', '10-29'), '第一行 CRLF、其他 LF');
  assert.equal(edit(mixed, { start: null }), mixed.replace('考試開始: 2026-10-28\n', ''), '刪一行');
  const inside = '---\r\n識別碼: aaaaaa\r\n考試開始: 2026-10-28\n其他: 1\r\n---\r\n- 國二上 自然 2\r\n';
  assert.equal(edit(inside, { start: '2026-10-29' }), inside.replace('10-28', '10-29'), 'CRLF 裡夾一行 LF，改的就是那一行');
  assert.equal(edit(inside, { end: '2026-10-30' }), inside.replace('考試開始: 2026-10-28\n其他: 1\r\n', '考試開始: 2026-10-28\n其他: 1\r\n考試結束: 2026-10-30\r\n'), '多的一行用檔案的換行');
  const noStart = '---\r\n識別碼: aaaaaa\n考試結束: 2026-10-30\n---\n';
  assert.equal(edit(noStart, { start: '2026-10-29' }), noStart.replace('考試結束', '考試開始: 2026-10-29\r\n考試結束'), '插在中間的新行也用檔案的換行');
  const both = '---\n識別碼: aaaaaa\n考試開始: 2026-10-22\n考試結束: 2026-10-28\r\n其他: 1\n---\n';
  assert.equal(edit(both, { start: '2026-10-23', end: '2026-10-29' }), both.replace('10-22', '10-23').replace('10-28', '10-29'), '連續兩行都改（R20）');
  const lone = '---\r識別碼: aaaaaa\r考試開始: 2026-10-22\r---\r- 國二上 自然 2\r';
  assert.equal(edit(lone, { start: '2026-10-23' }), lone.replace('10-22', '10-23'), '單獨的 CR');
  const block = '---\n識別碼: aaaaaa\n考試開始: |-\n  2026-10-22\n\n其他: 1\n---\n';
  assert.equal(edit(block, { start: null }), '---\n識別碼: aaaaaa\n\n其他: 1\n---\n', '刪多行的值：後面的空行留著（R20）');
  assert.equal(edit(block, { start: '2026-10-23' }), '---\n識別碼: aaaaaa\n考試開始: 2026-10-23\n\n其他: 1\n---\n', '改多行的值：後面的空行留著');
  const same = '---\r\n# 同一句\n# 同一句\r\n考試開始: 2026-10-28\n---\n';
  assert.equal(edit(same, { start: '2026-10-29' }), same.replace('10-28', '10-29'), '一樣的兩行各留各的');
});

void test('屬性區不是一行一個屬性：只有要改的變了才寫，帶走別的屬性就不寫', () => {
  const blocked = { kind: 'blocked', reason: 'broken' };
  const line = '---\n{識別碼: aaaaaa, 考試開始: 2026-10-28, 其他: 保留}\n---\n- 國二上 自然 2\n';
  assert.deepEqual(editScope(line, { start: null }, []), blocked, '同一行的識別碼與別的屬性不能跟著刪');
  assert.deepEqual(editScope(line, { end: '2026-10-29' }, []), blocked, '加不了新的一行');
  assert.deepEqual(editScope(line, { ended: '2026-10-20' }, []), blocked);
  assert.equal(edit(line, { start: '2026-11-01' }), '---\n{識別碼: aaaaaa, 考試開始: 2026-11-01, 其他: 保留}\n---\n- 國二上 自然 2\n', '只換值的改得了');
  assert.equal(edit(line, { add: units('3') }), line + '- 國二上 自然 3\n', '屬性區沒有要改的：範圍行照寫');
  const scalar = '---\n識別碼: aaaaaa\n考試開始: |\n  2026-10-28\n其他: 保留\n---\n- 國二上 自然 2\n';
  assert.equal(edit(scalar, { start: null }), '---\n識別碼: aaaaaa\n其他: 保留\n---\n- 國二上 自然 2\n', '多行的值：下一行不會跟著刪');
  assert.equal(edit(scalar, { start: '2026-11-01' }), '---\n識別碼: aaaaaa\n考試開始: 2026-11-01\n其他: 保留\n---\n- 國二上 自然 2\n', '多行的值換成一行');
  const lines = '---\n{識別碼: aaaaaa,\n 考試開始: 2026-10-28,\n 其他: 保留}\n---\n';
  assert.equal(edit(lines, { start: null }), '---\n{識別碼: aaaaaa,\n 其他: 保留}\n---\n', '分行的對照表刪一行還是對的');
  assert.deepEqual(editScope('---\n{識別碼: aaaaaa,\n 考試開始: 2026-10-28}\n---\n', { start: null }, []), blocked, '刪一行就壞的不寫');
  const comment = '---\n識別碼: aaaaaa # 不要改\n考試開始: 2026-10-28 # 第一天\n巢狀: {考試開始: 2026-10-30}\n其他: [1, 2]\n---\n';
  assert.equal(edit(comment, { start: null }), '---\n識別碼: aaaaaa # 不要改\n巢狀: {考試開始: 2026-10-30}\n其他: [1, 2]\n---\n', '只刪頂層的那一行，別的都留著');
});

void test('往返與冪等：沒有要改的再按一次不變，只動屬性區，範圍照舊', () => {
  assert.ok(scopeCases.size > 40, '範例要真的登錄進來');
  for (const text of scopeCases) {
    const plain = editScope(text, {}, []);
    if (plain.kind === 'ok') {
      assert.deepEqual(parseScope(plain.text).lines.map(line => line.raw), parseScope(text).lines.map(line => line.raw), '沒有要改的只碰日期的寫法：' + JSON.stringify(text));
      assert.deepEqual(parseScope(plain.text).lines.map(shown), parseScope(text).lines.map(shown));
      assert.equal(parseScope(plain.text).id, parseScope(text).id, '沒有要改的不補識別碼');
      assert.deepEqual(editScope(plain.text, {}, []), plain);
    }
    const once = editScope(text, { id: 'abc123' }, []);
    if (once.kind !== 'ok') continue;
    const twice = editScope(once.text, {}, []);
    assert.deepEqual(twice, { kind: 'ok', text: once.text }, '第二次完全不變：' + JSON.stringify(text));
    const before = parseScope(text), after = parseScope(once.text);
    assert.deepEqual(after.lines.map(line => line.raw), before.lines.map(line => line.raw), '範圍行一字不動：' + JSON.stringify(text));
    assert.deepEqual(after.lines.map(shown), before.lines.map(shown));
    assert.equal(after.id, before.id ?? 'abc123');
    assert.equal(after.ended, before.ended);
    assert.deepEqual(scopePeriod(after), scopePeriod(before), '期間不變：' + JSON.stringify(text));
  }
});

// ── 搬出 小考/ 的小考檔（D-189 第 5 點、tasks/quiz-practice.md §1）──

void test('段考讀的內容：屬性區有頂層 小考日期 就略過，值合法、空的、寫錯都一樣；鍵在別的地方不算', () => {
  const quiz = (date: string): string => `---\n識別碼: q4m8t2\n小考日期:${date}\n---\n- 國二上 英文 L3\n`;
  for (const text of [quiz(' 2026-11-05'), quiz(''), quiz(' 明天'), quiz(' 2026-13-01'), quiz(' ~'), '---\n"小考日期": 2026-11-05\n---\n- 國二上 英文 L3\n', quiz(' 2026-11-05').replaceAll('\n', '\r\n'), '\uFEFF' + quiz(' 2026-11-05')]) {
    assert.equal(parseExamFile(text), null, JSON.stringify(text));
  }
  const exam = (text: string): void => {
    const file = parseExamFile(text);
    assert.ok(file, JSON.stringify(text));
    assert.deepEqual(file, parseScope(text), '不是小考檔就和原本讀的一樣');
  };
  exam('---\n識別碼: x7f3k2\n考試開始: 2026-10-28\n---\n- 國二上 自然 2\n');
  exam('- 國二上 自然 2\n');
  exam('---\n說明:\n  小考日期: 2026-11-05\n---\n- 國二上 自然 2\n');
  exam('---\n考試開始: 2026-10-28\n---\n小考日期: 2026-11-05\n- 國二上 自然 2\n');
  exam('');
});

void test('段考讀的內容：屬性區壞到讀不出鍵，照段考的處理（日期有問題），不猜成小考檔', () => {
  for (const text of ['---\n小考日期: [\n---\n- 國二上 英文 L3\n', '---\n小考日期: 2026-11-05\n- 國二上 英文 L3\n', '---\n小考日期：2026-11-05\n---\n- 國二上 英文 L3\n']) {
    const file = parseExamFile(text);
    assert.ok(file, text);
    assert.equal(scopePeriod(file).kind, 'bad', text);
  }
});
