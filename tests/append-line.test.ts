import test from 'node:test';
import assert from 'node:assert/strict';
import { appendLine, encodeEntry, formatTime, isLogPath, mergeHistory } from '../src/core/study/index.ts';
import type { History, NewEntry, Rating } from '../src/core/study/index.ts';

// syntax.md §5 的例子。
const IPHONE = 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl';
const WINDOWS = 'Essence Cards/紀錄/2026-10 Windows-2c9e.jsonl';
const iphoneLines = [
  '{"t":"2026-10-16T20:15:03.250+08:00","lt":"k3m9x2","r":"good","v":"a1b2c3d4"}',
  '{"t":"2026-10-16T20:15:21.804+08:00","lt":"p7q2w8","r":"miss","v":"9f0e1d2c"}',
  '{"t":"2026-10-16T20:15:40.112+08:00","undo":"2026-10-16T20:15:21.804+08:00"}',
  '{"t":"2026-10-16T20:15:40.530+08:00","lt":"p7q2w8","r":"near","v":"9f0e1d2c"}',
  '{"t":"2026-10-18T21:30:05.447+08:00","lt":"h2m8qd","r":"good","v":"5e6f7a8b","src":"check"}',
  '{"t":"2026-10-20T19:00:00.120+08:00","set":"status","deck":"Essence Cards/國二上/自然/2-3 濃度.md","val":"啟用"}',
  '{"t":"2026-10-22T21:02:40.006+08:00","set":"cap","val":20}',
];
const windowsText = '{"t":"2026-10-21T19:02:11.020+08:00","lt":"k3m9x2","r":"miss","src":"mistake"}\n';
const comparable = (history: History) => ({ reviews: history.reviews, changes: history.changes });

void test('isLogPath：紀錄資料夾正下方的 .jsonl，子資料夾與其他副檔名不算', () => {
  assert.equal(isLogPath(IPHONE), true);
  assert.equal(isLogPath('Essence Cards/紀錄/2026-10 iPhone-7f3a 2.jsonl'), true);
  for (const path of ['Essence Cards/紀錄/舊/x.jsonl', 'Essence Cards/紀錄/x.json', 'Essence Cards/紀錄2/x.jsonl', 'Essence Cards/x.jsonl', '紀錄/x.jsonl', 'Essence Cards/紀錄/'])
    assert.equal(isLogPath(path), false, path);
});

void test('T5 appendLine：syntax.md §5 的 iPhone 七行依序併進 Windows 的檔，和兩個檔一起 merge 相同', () => {
  let history = mergeHistory([{ path: WINDOWS, text: windowsText }]);
  const steps: History[] = [];
  for (const line of iphoneLines) { history = appendLine(history, line); steps.push(history); }
  const both = mergeHistory([{ path: WINDOWS, text: windowsText }, { path: IPHONE, text: iphoneLines.join('\n') + '\n' }]);
  assert.deepEqual(comparable(history), comparable(both));
  assert.deepEqual(history.reviews.map(entry => [entry.lt, entry.r]), [['k3m9x2', 'good'], ['p7q2w8', 'near'], ['h2m8qd', 'good'], ['k3m9x2', 'miss']]);
  assert.deepEqual(history.changes.map(entry => entry.set), ['status', 'cap']);
  // 第 3 行（取消）之後：被取消的那筆不在；第 4 行的 near 在。
  assert.equal(steps[2].reviews.some(entry => entry.t === '2026-10-16T20:15:21.804+08:00'), false);
  assert.equal(steps[3].reviews.some(entry => entry.lt === 'p7q2w8' && entry.r === 'near'), true);
});

void test('T5 appendLine：重複的一行只加一次、t 相同內容不同兩筆都留、取消不存在的不變、不改輸入', () => {
  const base = mergeHistory([{ path: WINDOWS, text: '{"t":"2026-10-16T20:15:03.250+08:00","lt":"k3m9x2","r":"miss","v":"a1b2c3d4"}\n' }]);
  const before = structuredClone(base);
  const once = appendLine(base, iphoneLines[0]);
  const twice = appendLine(once, iphoneLines[0]);
  assert.deepEqual(base, before);
  assert.equal(once.reviews.length, 2);
  assert.deepEqual(twice.reviews.map(entry => entry.r), ['miss', 'good']);
  const undoMissing = appendLine(twice, '{"t":"2026-10-17T08:00:00.000+08:00","undo":"2026-10-01T00:00:00.000+08:00"}');
  assert.deepEqual(undoMissing.reviews, twice.reviews);
  // 取消一個 t，所有檔案裡那個 t 的作答都拿掉，和 mergeHistory 一樣。
  assert.deepEqual(appendLine(twice, '{"t":"2026-10-17T08:00:00.000+08:00","undo":"2026-10-16T20:15:03.250+08:00"}').reviews, []);
  // 同一個變更（val 的欄位順序不同）只加一次。
  const set1 = appendLine(base, '{"t":"2026-10-17T08:00:00.000+08:00","set":"x","val":{"a":1,"b":2}}');
  assert.equal(appendLine(set1, '{"t":"2026-10-17T08:00:00.000+08:00","set":"x","val":{"b":2,"a":1}}').changes.length, 1);
  assert.throws(() => appendLine(base, '{"t":"壞掉"}'));
  assert.throws(() => appendLine(base, ''));
});

// Codex 審查 W5 的 F2：取消之後才加進來的同一筆作答，仍然是取消的（mergeHistory 對所有來源的取消都有效）。
void test('T5 appendLine：取消之後才加進來的同一筆作答仍然取消', () => {
  const answer = encodeEntry('2026-10-24T19:00:00.000+08:00', { lt: 'a', r: 'good', v: '12345678' });
  const undo = encodeEntry('2026-10-24T19:00:01.000+08:00', { undo: '2026-10-24T19:00:00.000+08:00' });
  const empty = mergeHistory([]);
  const stepwise = [answer, undo, answer].reduce(appendLine, empty);
  const merged = mergeHistory([{ path: 'x.jsonl', text: [answer, undo, answer].join('\n') }]);
  assert.deepEqual([stepwise.reviews, stepwise.cancelled], [[], ['2026-10-24T19:00:00.000+08:00']]);
  assert.deepEqual(stepwise, merged);
  // 別台裝置的取消先到，這台的時鐘剛好寫出同一個 t。
  const cancelledFirst = appendLine(mergeHistory([{ path: 'other.jsonl', text: undo }]), answer);
  assert.deepEqual(cancelledFirst.reviews, []);
  assert.deepEqual(cancelledFirst, mergeHistory([{ path: 'other.jsonl', text: undo }, { path: 'own.jsonl', text: answer }]));
  // 已經取消過、也沒有那一筆時，同一行取消不改任何東西。
  assert.equal(appendLine(stepwise, undo), stepwise);
});

// 固定種子的亂數（mulberry32）。
function seeded(seed: number): () => number {
  return () => {
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const multiset = (history: History) => history.reviews.map(entry => JSON.stringify(entry)).sort();

void test('T5 appendLine 性質：200 組隨機的自己的作答、取消、變更，和重新 mergeHistory 相同', () => {
  const ratings: Rating[] = ['easy', 'good', 'near', 'miss'];
  const start = Date.parse('2026-10-16T20:00:00+08:00');
  for (let round = 0; round < 200; round++) {
    const random = seeded(round + 1);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
    // 別台裝置的一個檔：時間故意和自己的重疊，也有和自己 at 完全相同的。
    const otherAts: number[] = [];
    const other = Array.from({ length: Math.floor(random() * 8) }, () => {
      const at = start + Math.floor(random() * 40) * 1000;
      otherAts.push(at);
      return encodeEntry(formatTime(at, 480), { lt: pick(['a', 'b', 'c']), r: pick(ratings), v: '12345678' });
    });
    // 別台裝置也有取消：取消它自己的一筆，或取消一個這台之後剛好會寫出的時間（時鐘相撞，F2）。
    for (let i = Math.floor(random() * 3); i > 0; i--) {
      const target = otherAts.length && random() < 0.5 ? pick(otherAts) : start + Math.floor(random() * 40) * 1000;
      other.push(encodeEntry(formatTime(start + 50_000 + i, 480), { undo: formatTime(target, 480) }));
      if (random() < 0.5) otherAts.push(target);
    }
    const otherSource = { path: 'Essence Cards/紀錄/2026-10 iPhone-7f3a.jsonl', text: other.join('\n') + '\n' };
    let history = mergeHistory([otherSource]);
    const own: string[] = [];
    const answered: string[] = [];
    let at = start;
    for (let step = 0; step < 12; step++) {
      // 同一行再加一次（例如重讀到自己剛寫的行）：結果不變，重新 merge 也去重。
      if (own.length && random() < 0.1) {
        const line = pick(own);
        own.push(line);
        history = appendLine(history, line);
        continue;
      }
      // 自己的 t 嚴格遞增；有時和別台裝置的某一筆同一毫秒。
      at = random() < 0.2 && otherAts.some(time => time > at) ? Math.min(...otherAts.filter(time => time > at)) : at + 1 + Math.floor(random() * 3000);
      const t = formatTime(at, 480);
      const kind = random();
      let entry: NewEntry;
      if (kind < 0.6) { entry = { lt: pick(['a', 'b', 'c']), r: pick(ratings), v: '12345678' }; answered.push(t); }
      else if (kind < 0.85) entry = { undo: answered.length && random() < 0.7 ? pick(answered) : formatTime(start - 1000 - step, 480) };
      else entry = { set: 'cap', val: pick([10, 20, 30]) };
      const line = encodeEntry(t, entry);
      own.push(line);
      history = appendLine(history, line);
    }
    const merged = mergeHistory([otherSource, { path: 'Essence Cards/紀錄/2026-10 PC-test.jsonl', text: own.join('\n') + '\n' }]);
    assert.deepEqual(history.changes, merged.changes, 'round ' + String(round));
    assert.deepEqual(history.cancelled, merged.cancelled, 'round ' + String(round));
    assert.deepEqual(multiset(history), multiset(merged), 'round ' + String(round));
    // 只有 at 完全相同、來自不同檔案的兩筆之間先後可以不同（§3-4）。
    assert.deepEqual(history.reviews.map(entry => entry.at), merged.reviews.map(entry => entry.at), 'round ' + String(round));
  }
});

// W6 §1：含 retry 的行依序 appendLine，和重新 mergeHistory 相同（retry 不影響去重與順序）。
void test('R4 appendLine：含 retry 的行依序併入，和重新 mergeHistory 相同；同一筆只差 retry 不算兩筆', () => {
  const lines = [
    '{"t":"2026-10-16T20:15:03.250+08:00","lt":"m7kp3q","r":"near","v":"3c9a01fe","typed":"wrong","retry":"wrong"}',
    '{"t":"2026-10-16T20:15:21.804+08:00","lt":"m7kp3q","r":"miss","v":"3c9a01fe","typed":"skip","retry":"skip"}',
    '{"t":"2026-10-16T20:15:40.112+08:00","undo":"2026-10-16T20:15:21.804+08:00"}',
    '{"t":"2026-10-16T20:15:40.530+08:00","lt":"m7kp3q","r":"near","v":"3c9a01fe","typed":"wrong","retry":"right"}',
  ];
  let history = mergeHistory([{ path: WINDOWS, text: windowsText }]);
  for (const line of lines) history = appendLine(history, line);
  const both = mergeHistory([{ path: WINDOWS, text: windowsText }, { path: IPHONE, text: lines.join('\n') + '\n' }]);
  assert.deepEqual(comparable(history), comparable(both));
  assert.deepEqual(history.reviews.map(entry => [entry.lt, entry.r, entry.typed]), [['m7kp3q', 'near', 'wrong'], ['m7kp3q', 'near', 'wrong'], ['k3m9x2', 'miss', null]]);
  // 衝突副本裡同一筆少了 retry：仍是同一筆。
  const copy = lines[0].replace(',"retry":"wrong"', '');
  assert.equal(appendLine(history, copy).reviews.length, history.reviews.length);
});
