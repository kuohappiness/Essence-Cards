import test from 'node:test';
import assert from 'node:assert/strict';
import { spelling, lockAxis, gesture, frameStats, uniqueClock, reviewLine, undoLine } from '../src/logic.ts';
import { generate } from '../tools/gen-records.mjs';
test('拼字：大小寫、前後空白、插入／缺漏／錯字', () => {
  assert.equal(spelling('  BoRRow ', 'borrow').ok, true);
  const missing = spelling('borow', 'borrow');
  assert.equal(missing.ok, false);
  assert.equal(missing.expected.filter(c => c.bad).length, 1);
  assert.equal(missing.expected.map(c => c.char).join(''), 'borrow');
  assert.equal(spelling('borroww', 'borrow').typed.filter(c => c.bad).length, 1);
  assert.equal(spelling('', 'measure').expected.filter(c => c.bad).length, 7);
  assert.equal(spelling('barrOw', 'borrow').typed.filter(c => c.bad).length, 1);
});
test('手勢先鎖方向，垂直捲動後不能改判水平', () => {
  assert.equal(lockAxis('pending', 9, 2), 'pending');
  assert.equal(lockAxis('pending', 11, 3), 'horizontal');
  assert.equal(lockAxis('pending', 11, 8), 'vertical');
  assert.equal(lockAxis('vertical', 100, 20), 'vertical');
  assert.equal(gesture('horizontal', 70, 4, 500, true, false), '上一張');
  assert.equal(gesture('horizontal', -70, 4, 500, true, true), '回到目前');
  assert.equal(gesture('horizontal', -70, 4, 500, true, false), '彈回');
  assert.equal(gesture('horizontal', 70, 4, 500, false, false), '彈回');
  assert.equal(gesture('horizontal', 30, 2, 40, true, false), '上一張');
  assert.equal(gesture('horizontal', 30, 2, 500, true, false), '彈回');
  assert.equal(gesture('vertical', 80, 200, 500, true, true), '捲動');
  assert.equal(gesture('pending', 2, 3, 500, true, true), '點擊');
});
test('動畫統計：中位數與 1.5 倍掉格邊界', () => {
  assert.deepEqual(frameStats([]), { frames: 0, median: 0, max: 0, dropped: 0, intervals: [] });
  const x = frameStats([16, 16, 16, 24, 40]);
  assert.equal(x.median, 16); assert.equal(x.dropped, 1); assert.equal(x.max, 40);
  assert.equal(frameStats([10, 20]).median, 15);
});
test('紀錄格式：時區到毫秒、同毫秒唯一、undo 指回舊評分', () => {
  const clock = uniqueClock(() => 1792400000000), t = clock();
  const row = reviewLine(t, 'k3m9x2', 'good', 'a1b2c3d4');
  const undo = undoLine(clock(), row.t), updated = reviewLine(clock(), 'k3m9x2', 'near', 'a1b2c3d4');
  assert.match(t, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/);
  assert.deepEqual(Object.keys(row), ['t', 'lt', 'r', 'v']);
  assert.equal(undo.undo, row.t);
  assert.ok(Date.parse(updated.t) > Date.parse(undo.t));
  assert.equal(new Set([row.t, undo.t, updated.t]).size, 3);
});
test('小參數假紀錄：可重現、兩台裝置、行數與變更／取消格式', () => {
  const files = generate({ months: 2, daily: 5, seed: 42 });
  assert.deepEqual(files, generate({ months: 2, daily: 5, seed: 42 }));
  assert.equal(files.size, 4);
  let reviews = 0, undos = 0, changes = 0, lines = 0;
  for (const [file, content] of files) {
    assert.match(file, /^2024-0[12] (iPhone|Windows)-[0-9a-f]{4}\.jsonl$/);
    assert.ok(content.endsWith('\n'));
    const seen = new Map();
    for (const line of content.trim().split('\n')) {
      const r = JSON.parse(line); lines++;
      assert.match(r.t, /^2024-0[12]-\d\dT\d\d:\d\d:\d\d\.\d{3}\+08:00$/);
      assert.ok(!seen.has(r.t));
      if ('undo' in r) { undos++; assert.ok(seen.has(r.undo)); assert.deepEqual(Object.keys(r), ['t', 'undo']); }
      else if ('set' in r) { changes++; assert.ok(['cap', 'status', 'filter'].includes(r.set)); if (r.set === 'status') assert.ok(r.deck); }
      else { reviews++; assert.match(r.lt, /^[a-z0-9]{6}$/); assert.match(r.v, /^[a-f0-9]{8}$/); assert.ok(['miss', 'near', 'good', 'easy'].includes(r.r)); }
      seen.set(r.t, r);
    }
  }
  assert.equal(changes, 12); assert.ok(undos > 0);
  assert.equal(reviews - undos, 60 * 5);
  assert.equal(lines, 300 + undos * 2 + 12);
});
test('三年假紀錄：72 檔、約 16 萬行、約八成 iPhone', () => {
  const files = generate(); assert.equal(files.size, 72);
  let lines = 0, phone = 0;
  for (const [name, content] of files) { const n = content.trim().split('\n').length; lines += n; if (name.includes('iPhone')) phone += n; }
  assert.ok(lines > 164000 && lines < 172000); assert.ok(phone / lines > .78 && phone / lines < .82);
});
