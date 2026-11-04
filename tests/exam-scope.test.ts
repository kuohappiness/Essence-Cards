import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseScope, isExamPath, parseScope as parse, readDate, scopeDay, scopePeriod, unitInScope } from '../src/core/catalog/index.ts';
import type { ScopeFile } from '../src/core/catalog/index.ts';
import { dayOf } from '../src/core/study/index.ts';

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
