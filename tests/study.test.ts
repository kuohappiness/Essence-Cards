import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatTime, dayOf, dayStart, encodeEntry, parseLine, mergeHistory } from '../src/core/study/index.ts';
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
    const defaults = kind === 'review' ? { v: null, src: null } : kind === 'change' ? { deck: null, lt: null } : {};
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
    const result = parseLine(JSON.stringify({ t, lt: 'a', r: 'good', v: '12345678', typed: 'right' }));
    assert.ok(result?.kind === 'review', t);
    assert.equal(result.at, Date.parse(t));
    assert.equal(result.offset, t.endsWith('-05:00') ? -300 : t.endsWith('+05:45') ? 345 : 0);
    assert.equal('typed' in result, false);
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
