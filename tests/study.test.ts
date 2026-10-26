import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatTime, dayOf, dayStart, encodeEntry, parseLine, mergeHistory, replay } from '../src/core/study/index.ts';
import type { NewEntry } from '../src/core/study/index.ts';

const syntax = readFileSync(new URL('../docs/syntax.md', import.meta.url), 'utf8');
const examples = syntax.slice(syntax.indexOf('## 5.'), syntax.indexOf('## 6.')).split(/\r?\n/).filter(line => line.startsWith('{"t":'));
const rows: { t: string; entry: NewEntry; kind: string }[] = [
  { t: '2026-10-16T20:15:03.250+08:00', entry: { lt: 'k3m9x2', r: 'good', v: 'a1b2c3d4' }, kind: 'review' },
  { t: '2026-10-16T20:15:21.804+08:00', entry: { lt: 'p7q2w8', r: 'miss', v: '9f0e1d2c' }, kind: 'review' },
  { t: '2026-10-16T20:15:40.112+08:00', entry: { undo: '2026-10-16T20:15:21.804+08:00' }, kind: 'undo' },
  { t: '2026-10-16T20:15:40.530+08:00', entry: { lt: 'p7q2w8', r: 'near', v: '9f0e1d2c' }, kind: 'review' },
  { t: '2026-10-18T21:30:05.447+08:00', entry: { lt: 'h2m8qd', r: 'good', v: '5e6f7a8b', src: 'check' }, kind: 'review' },
  { t: '2026-10-20T19:00:00.120+08:00', entry: { set: 'status', deck: 'Essence Cards/國二上/自然/2-3 濃度.md', val: '啟用' }, kind: 'change' },
  { t: '2026-10-22T21:02:40.006+08:00', entry: { set: 'cap', val: 20 }, kind: 'change' },
  { t: '2026-10-21T19:02:11.020+08:00', entry: { lt: 'k3m9x2', r: 'miss', src: 'mistake' }, kind: 'review' },
];

void test('syntax §5 的八行逐欄解析，寫回和原文完全相同', () => {
  assert.equal(examples.length, 8);
  rows.forEach(({ t, entry, kind }, index) => {
    const stamp = { t, at: Date.parse(t), offset: 480 };
    const defaults = kind === 'review' ? { v: null, typed: null, src: null } : kind === 'change' ? { deck: null, lt: null } : {};
    assert.deepEqual(parseLine(examples[index]), { ...stamp, kind, ...defaults, ...entry });
    assert.equal(encodeEntry(t, entry), examples[index]);
  });
});

void test('歷史跨檔去重、依時間排序、取消只精確比對原始 t', () => {
  const t = '2026-10-31T23:59:59.000+08:00';
  const a = encodeEntry(t, { lt: 'a', r: 'miss', v: '12345678' });
  const corrected = encodeEntry('2026-11-01T00:00:02.000+08:00', { lt: 'a', r: 'good', v: '12345678' });
  const change = encodeEntry(t, { set: 'cap', val: 20 });
  const sources = [
    { path: 'z.jsonl', text: a + '\n' + corrected + '\n' + change },
    { path: 'a.jsonl', text: encodeEntry('2026-11-01T00:00:01.000+08:00', { undo: t }) + '\n' + a + '\n' + change },
    { path: 'conflict.jsonl', text: a + '\n' + corrected },
  ];
  const history = mergeHistory(sources);
  assert.deepEqual(history.reviews.map(e => [e.t, e.r]), [['2026-11-01T00:00:02.000+08:00', 'good']]);
  assert.deepEqual(history.changes, [parseLine(change)]);
  assert.deepEqual(history.problems, []);
  assert.deepEqual(mergeHistory([...sources].reverse()), history);
});

void test('時間格式完全由 offset 決定，清晨四點換日，跨月、年與負 offset 可逆', () => {
  const ms = Date.parse('2026-10-31T18:00:03.007Z');
  assert.equal(formatTime(ms, 480), '2026-11-01T02:00:03.007+08:00');
  assert.equal(formatTime(ms, -300), '2026-10-31T13:00:03.007-05:00');
  assert.equal(formatTime(ms, 345), '2026-10-31T23:45:03.007+05:45');
  assert.equal(formatTime(ms, 0), '2026-10-31T18:00:03.007+00:00');
  for (const [before, after, offset] of [
    ['2026-11-01T03:59:59.999+08:00', '2026-11-01T04:00:00.000+08:00', 480],
    ['2027-01-01T03:59:59.999-05:00', '2027-01-01T04:00:00.000-05:00', -300],
    ['1969-12-31T03:59:59.999Z', '1969-12-31T04:00:00.000Z', 0],
  ] as const) {
    const day = dayOf(Date.parse(after), offset);
    assert.equal(dayOf(Date.parse(before), offset), day - 1);
    assert.equal(dayStart(day, offset), Date.parse(after));
    assert.equal(dayOf(dayStart(day, offset), offset), day);
  }
});

void test('parseLine 接受 Z、1～3 位小數與未知欄位，拒絕無時區、不存在的日期及缺欄位', () => {
  for (const t of ['2024-02-29T03:02:01Z', '2026-10-16T20:00:00.1-05:00', '2026-10-16T20:00:00.12+05:45', '0000-01-01T00:00:00.123+00:00']) {
    const result = parseLine(JSON.stringify({ t, lt: 'a', r: 'good', v: '12345678', future: 'right' }));
    assert.ok(result?.kind === 'review', t);
    assert.equal(result.at, Date.parse(t));
    assert.equal(result.offset, t.endsWith('-05:00') ? -300 : t.endsWith('+05:45') ? 345 : 0);
    assert.equal('future' in result, false);
  }
  for (const t of ['2026-10-16T20:00:00', '2026-10-16 20:00:00Z', '2026-02-29T20:00:00Z', '2026-04-31T20:00:00Z', '2026-13-01T20:00:00Z', '2026-10-00T20:00:00Z', '2026-10-16T24:00:00Z', '2026-10-16T20:60:00Z', '2026-10-16T20:00:60Z', '2026-10-16T20:00:00.1234Z', '2026-10-16T20:00:00+24:00', '2026-10-16T20:00:00+08:60']) {
    assert.equal(parseLine(JSON.stringify({ t, lt: 'a', r: 'good', v: '12345678' })), null, t);
  }
  for (const line of ['', ' ', '[]', 'null', '42', '{', '{"t":"2026-10-16T20:00:00Z"}', '{"t":"2026-10-16T20:00:00Z","lt":"a","r":"wrong","v":"x"}', '{"t":"2026-10-16T20:00:00Z","lt":"a","r":"good"}']) assert.equal(parseLine(line), null, line);
});

void test('取消優先於變更；未知來源與設定保留原值，變更不進 reviews', () => {
  const t = '2026-10-16T20:00:00Z';
  assert.deepEqual(parseLine(JSON.stringify({ t, undo: 'original', set: 'cap', val: 10, lt: 'a', r: 'good' })), { kind: 'undo', t, at: Date.parse(t), offset: 0, undo: 'original' });
  const unknown = parseLine(JSON.stringify({ t, lt: 'a', r: 'easy', v: 'x', src: 'future', extra: 1 }));
  assert.ok(unknown?.kind === 'review');
  assert.equal(unknown.src, 'future');
  const changes = [
    { set: 'retention', val: .9 }, { set: 'semester', val: '國二上' }, { set: 'filter', val: ['攝影', '重要性：低'] },
    { set: 'status', lt: 'a', val: '暫停' }, { set: 'future', val: { nested: [1, null, false] } },
  ];
  const history = mergeHistory([{ path: 'a', text: changes.map(e => JSON.stringify({ t, ...e })).join('\n') }]);
  assert.equal(history.reviews.length, 0);
  assert.deepEqual(history.changes.map(e => [e.set, e.val]), changes.map(e => [e.set, e.val]));
  assert.equal(encodeEntry(t, { set: 'status', lt: 'a', val: '暫停' }), '{"t":"2026-10-16T20:00:00Z","set":"status","lt":"a","val":"暫停"}');
  assert.deepEqual(history.problems, []);
});

void test('合併兩台裝置交錯排序，同時照路徑再照行號；相同 t 不同內容保留', () => {
  const same = '2026-10-16T20:00:00+08:00';
  const line = (lt: string, t = same) => JSON.stringify({ t, lt, r: 'good', v: 'x' });
  const history = mergeHistory([
    { path: 'z', text: line('z') + '\n' + line('early', '2026-10-16T19:00:00+08:00') },
    { path: 'a', text: line('a1') + '\n' + line('a2', '2026-10-16T12:00:00Z') + '\n' + line('a3') },
  ]);
  assert.deepEqual(history.reviews.map(e => e.lt), ['early', 'a1', 'a2', 'a3', 'z']);
});

void test('空白 CRLF 與 BOM 不算問題，壞行尾端救回，只在 JSON.parse 失敗時救', () => {
  const good = examples[0];
  const raw = '\uFEFF \r\n\r\n壞掉的行\r\n{"t":"中斷' + good + '\r\n' + good + '\r\n' + JSON.stringify({ nested: JSON.parse(good) as unknown }) + '\r\n';
  const history = mergeHistory([{ path: 'broken', text: raw }]);
  assert.deepEqual(history.reviews, [parseLine(good)]);
  assert.deepEqual(history.problems.map(e => [e.path, e.line]), [['broken', 2], ['broken', 3], ['broken', 5]]);
  assert.match(history.problems[1].message, /救回/);
});

// S9（state-load §4，技術債 A1）：配新 ID 要避開的 lt 由紀錄模組算，state 不再自己解析原始紀錄。
void test('seen：每一行出現過的 lt（作答、變更、被取消的）；壞掉的行救回的尾段與寬鬆找到的也算；照字串排序、不重複', () => {
  const review = (t: string, lt: string) => encodeEntry(t, { lt, r: 'good', v: '12345678' });
  const lines = [
    review('2026-10-24T10:00:00.000+08:00', 'k3m9x2'),
    review('2026-10-24T10:01:00.000+08:00', 'p7q2w8'),
    encodeEntry('2026-10-24T10:02:00.000+08:00', { undo: '2026-10-24T10:01:00.000+08:00' }),
    encodeEntry('2026-10-24T10:03:00.000+08:00', { set: 'status', lt: 'h2m8qd', val: '暫停' }),
    encodeEntry('2026-10-24T10:04:00.000+08:00', { set: 'status', deck: 'Essence Cards/x.md', val: '暫停' }),
    // 合法 JSON、跳脫的鍵名（Codex 審查第二部分的 F3）。
    '{"t":"2026-10-24T12:00:00+08:00","\\u006ct":"esc001","r":"good","v":"12345678"}',
    // 寫入中斷、救回的尾段用跳脫的鍵名（Codex 再審的 R1）。
    '{"t":"2026-10-24T11:00:00+08:00","r":"go{"t":"2026-10-24T12:00:01+08:00","\\u006ct":"tail01","r":"good","v":"12345678"}',
    // 寫入中斷、前半段也有 lt。
    '{"t":"2026-10-24T11:00:00+08:00","lt":"head01","r":"go' + review('2026-10-24T12:00:02.000+08:00', 'tail02'),
    '{"lt": "loose1", 壞掉',
    '{"lt":"x\\u0031y", 壞掉',
    '{"lt":"bad001","r":"good"}',
  ];
  const history = mergeHistory([
    { path: 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl', text: lines.join('\n') + '\n' },
    { path: 'Essence Cards/紀錄/2026-10 PC-2c9e.jsonl', text: review('2026-10-24T10:00:00.000+08:00', 'k3m9x2') + '\n' + review('2026-10-25T10:00:00.000+08:00', 'k3m9x2') },
  ]);
  assert.deepEqual(history.seen, ['bad001', 'esc001', 'h2m8qd', 'head01', 'k3m9x2', 'loose1', 'p7q2w8', 'tail01', 'tail02', 'x1y']);
  assert.deepEqual(history.reviews.map(entry => entry.lt), ['k3m9x2', 'esc001', 'tail01', 'tail02', 'k3m9x2']);
  assert.deepEqual(mergeHistory([]).seen, []);
});

void test('取消找不到對象不算錯，不能取消變更或取消；同一 t 的所有作答都失效', () => {
  const t = '2026-10-16T20:00:00+08:00';
  const equivalent = '2026-10-16T12:00:00Z';
  const undoTime = '2026-10-16T20:01:00+08:00';
  const text = [
    { t: undoTime, undo: t }, { t: undoTime, undo: t }, { t: equivalent, lt: 'same-instant', r: 'good', v: 'x' },
    { t, lt: 'a', r: 'good', v: 'x' }, { t, lt: 'b', r: 'easy', v: 'x' }, { t, set: 'cap', val: 10 },
    { t: '2026-11-01T20:00:00Z', undo: undoTime }, { t: '2026-11-01T20:01:00Z', undo: 'missing' },
  ].map(e => JSON.stringify(e)).join('\n');
  const history = mergeHistory([{ path: 'a', text }]);
  assert.deepEqual(history.reviews.map(e => e.lt), ['same-instant']);
  assert.equal(history.changes.length, 1);
  assert.deepEqual(history.problems, []);
});

void test('去重比較解析後欄位，未知欄位忽略，設定物件鍵的次序不影響相等', () => {
  const t = '2026-10-16T20:00:00Z';
  const history = mergeHistory([{ path: 'a', text: [
    { t, lt: 'a', r: 'good', v: 'x' }, { r: 'good', lt: 'a', t, v: 'x', future: 1 },
    { t, lt: 'a', r: 'good', v: 'different' },
    { t, lt: 'a', r: 'good', v: 'different', extra: true },
    { t, set: 'future', val: { a: 1, b: [2, 3] } }, { t, set: 'future', val: { b: [2, 3], a: 1 } },
    { t, set: 'future', val: { b: [3, 2], a: 1 } },
  ].map(e => JSON.stringify(e)).join('\n') }]);
  assert.equal(history.reviews.length, 2);
  assert.equal(history.changes.length, 2);
});

void test('來源重複使用同一路徑時，同一時間仍依原行號排列', () => {
  const t = '2026-10-16T20:00:00Z';
  const line = (lt: string) => JSON.stringify({ t, lt, r: 'good', v: 'x' });
  const history = mergeHistory([{ path: 'same', text: line('a') + '\n' + line('c') }, { path: 'same', text: line('b') }]);
  assert.deepEqual(history.reviews.map(e => e.lt), ['a', 'b', 'c']);
});

void test('L2-2 同時間同路徑同行號依 trim 原文 code unit 排序，交換來源不改歷史與重播', () => {
  const t = '2026-10-16T20:00:00Z';
  const good = encodeEntry(t, { lt: 'goal', r: 'good', v: 'fp' });
  const miss = encodeEntry(t, { lt: 'goal', r: 'miss', v: 'fp' });
  const change = (val: string) => JSON.stringify({ t, set: 'future', val });
  const sources = [
    { path: 'same.jsonl', text: '  ' + miss + '\r\n' + change('a') },
    { path: 'same.jsonl', text: '\t' + good + '  \n' + change('Z') },
  ];
  const forward = mergeHistory(sources);
  const reversed = mergeHistory([...sources].reverse());
  assert.deepEqual(forward.reviews.map(entry => entry.r), ['good', 'miss']);
  assert.deepEqual(forward.changes.map(entry => entry.val), ['Z', 'a']);
  assert.deepEqual(forward, reversed);
  assert.deepEqual(replay(forward.reviews), replay(reversed.reviews));
});

void test('L2-5 status 必須剛好有一個非空字串對象，壞行跳過並記 problem', () => {
  const t = '2026-10-16T20:00:00Z';
  const invalid = [
    {}, { deck: '' }, { lt: '' }, { deck: '  ' }, { lt: 0 }, { deck: null },
    { deck: 'deck.md', lt: 'goal' }, { deck: 'deck.md', lt: null },
  ].map(target => JSON.stringify({ t, set: 'status', ...target, val: '暫停' }));
  for (const line of invalid) assert.equal(parseLine(line), null, line);
  const valid = [
    JSON.stringify({ t, set: 'status', deck: 'deck.md', val: '啟用' }),
    JSON.stringify({ t, set: 'status', lt: 'goal', val: '暫停' }),
  ];
  const history = mergeHistory([{ path: 'status.jsonl', text: [...invalid, ...valid].join('\n') }]);
  assert.deepEqual(history.changes.map(entry => [entry.deck, entry.lt]), [['deck.md', null], [null, 'goal']]);
  assert.deepEqual(history.problems.map(problem => [problem.path, problem.line]), invalid.map((_, line) => ['status.jsonl', line]));
});

void test('L2-5 其他已知變更不新增 val 型別限制，未知種類仍原樣保留', () => {
  const t = '2026-10-16T20:00:00Z';
  const rows = [{ set: 'cap', val: 'future' }, { set: 'retention', val: null }, { set: 'semester', val: 1 }, { set: 'filter', val: {} }, { set: 'future', val: { nested: [1, true] } }];
  const history = mergeHistory([{ path: 'changes.jsonl', text: rows.map(row => JSON.stringify({ t, ...row })).join('\n') }]);
  assert.deepEqual(history.changes.map(entry => [entry.set, entry.val]), rows.map(row => [row.set, row.val]));
  assert.deepEqual(history.problems, []);
});

void test('T15 typed 欄位：寫在 v 後 src 前、往返相同、認不得的保留、非字串當作沒有、只差 typed 不算重複', () => {
  const t = '2026-10-16T20:15:03.250+08:00';
  const right = encodeEntry(t, { lt: 'c9tn3e', r: 'good', v: '3c4d5e6f', typed: 'right' });
  assert.equal(right, '{"t":"2026-10-16T20:15:03.250+08:00","lt":"c9tn3e","r":"good","v":"3c4d5e6f","typed":"right"}');
  const check = encodeEntry(t, { lt: 'c9tn3e', r: 'miss', v: '3c4d5e6f', typed: 'skip', src: 'check' });
  assert.equal(check, '{"t":"2026-10-16T20:15:03.250+08:00","lt":"c9tn3e","r":"miss","v":"3c4d5e6f","typed":"skip","src":"check"}');
  for (const line of [right, check]) {
    const entry = parseLine(line);
    assert.ok(entry?.kind === 'review');
    assert.equal(entry.typed, line === right ? 'right' : 'skip');
    const { lt, r, v, typed, src } = entry;
    assert.ok(v !== null && (typed === 'right' || typed === 'skip') && (src === null || src === 'check'));
    assert.equal(encodeEntry(entry.t, { lt, r, v, typed, ...(src ? { src } : {}) }), line);
  }
  const maybe = parseLine('{"t":"2026-10-16T20:15:03.250+08:00","lt":"c9tn3e","r":"good","v":"3c4d5e6f","typed":"maybe"}');
  assert.ok(maybe?.kind === 'review');
  assert.equal(maybe.typed, 'maybe');
  const number = '{"t":"2026-10-16T20:15:03.250+08:00","lt":"c9tn3e","r":"good","v":"3c4d5e6f","typed":1}';
  const plain = '{"t":"2026-10-16T20:15:03.250+08:00","lt":"c9tn3e","r":"good","v":"3c4d5e6f"}';
  const history = mergeHistory([{ path: 'typed.jsonl', text: [number, plain, right].join('\n') }]);
  assert.deepEqual(history.problems, []);
  assert.deepEqual(history.reviews.map(entry => entry.typed), [null, 'right']);
});
