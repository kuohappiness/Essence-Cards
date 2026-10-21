import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeHistory, replay } from '../src/core/study/index.ts';
import { threeYears } from '../tools/bench-study.ts';

void test('三年份防退化：合併＋重播 2000 ms 內，效能另由 npm run bench 量測', t => {
  const { sources, days, lines } = threeYears();
  assert.equal(sources.length, 72);
  assert.equal(lines, 167760);
  const start = performance.now();
  const history = mergeHistory(sources);
  const memories = replay(history.reviews);
  const elapsed = performance.now() - start;
  t.diagnostic('mergeHistory + replay: ' + elapsed.toFixed(2) + ' ms');
  assert.equal(memories.size, 2000);
  assert.equal(history.reviews.length, days * 151);
  assert.equal(history.changes.length, 36);
  assert.deepEqual(history.problems, []);
  assert.ok(elapsed < 2000, '合併＋重播 ' + elapsed.toFixed(2) + ' ms，防退化門檻 2000 ms');
});
