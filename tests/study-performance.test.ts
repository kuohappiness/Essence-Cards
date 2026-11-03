import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, paintCatalog } from '../src/core/catalog/index.ts';
import { parseDeck } from '../src/core/deck/index.ts';
import { memoryColors, mergeHistory, replay } from '../src/core/study/index.ts';
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

void test('目標數幾百個時，建索引加顏色的時間防退化（任務說明 §9-6）：三年份紀錄、800 個目標，300 ms 內', t => {
  const { sources } = threeYears();
  const history = mergeHistory(sources);
  const ids = [...new Set(history.reviews.map(entry => entry.lt))].slice(0, 800);
  // 一個單元 40 個目標，跨單元的出處每 10 個一個。
  const decks = Array.from({ length: 20 }, (_, unit) => ({
    path: 'Essence Cards/單元 ' + String(unit) + '.md',
    deck: parseDeck('---\n年級學期: 國二上\n科目: 自然\n單元: "1-' + String(unit) + '"\n---\n' + ids.slice(unit * 40, unit * 40 + 40).map((id, i) => '- 目標 ^' + id + '\n    - ' + (i % 10 ? '出處：p.1' : '出處：1-0 p.2') + '\n    - 問 :: 答\n').join('')),
  }));
  const input = { decks, history, settings: { capMinutes: 30, retention: 0.8, filter: [] }, exam: null, now: Date.parse('2026-10-24T19:00:00.000+08:00'), offset: 480 };
  const start = performance.now();
  const catalog = paintCatalog(buildIndex(decks), memoryColors(input), new Set());
  const elapsed = performance.now() - start;
  t.diagnostic('buildIndex + memoryColors + paintCatalog: ' + elapsed.toFixed(2) + ' ms');
  assert.equal(catalog.terms[0].subjects[0].units.length, 20);
  assert.ok(elapsed < 300, '建索引加顏色 ' + elapsed.toFixed(2) + ' ms，防退化門檻 300 ms');
});
