import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { encodeEntry, formatTime, logPath, mergeHistory, readHistory, replay } from '../src/core/study/index.ts';
import type { Rating } from '../src/core/study/index.ts';
import { createNodeFiles } from '../tools/node-files.ts';

function threeYears() {
  const files = new Map<string, string[]>();
  const start = Date.parse('2023-10-01T20:00:00+08:00');
  const end = Date.parse('2026-10-01T20:00:00+08:00');
  const add = (device: string, ms: number, line: string) => {
    const path = logPath(device, ms, 480);
    let lines = files.get(path);
    if (!lines) { lines = []; files.set(path, lines); }
    lines.push(line);
  };
  let day = 0;
  for (let ms = start; ms < end; ms += 86_400_000, day++) {
    for (let i = 0; i < 152; i++) {
      const at = ms + i * 15_000;
      const t = formatTime(at, 480);
      const sample = (day * 31 + i * 17) % 100;
      const r: Rating = sample < 8 ? 'miss' : sample < 18 ? 'near' : sample < 85 ? 'good' : 'easy';
      const device = (i + day) % 2 ? 'Phone-abcd' : 'PC-efgh';
      add(device, at, encodeEntry(t, { lt: 'goal' + (day * 152 + i) % 2000, r, v: '12345678' }));
      if (i === 7) add(device, at + 1, encodeEntry(formatTime(at + 1, 480), { undo: t }));
    }
    if (new Date(ms).getUTCDate() === 1) {
      for (const device of ['Phone-abcd', 'PC-efgh']) add(device, ms, encodeEntry(formatTime(ms, 480), { set: 'cap', val: 30 }));
    }
  }
  return { days: day, sources: [...files].map(([path, lines]) => ({ path, text: lines.join('\n') + '\n' })), lines: [...files.values()].reduce((sum, lines) => sum + lines.length, 0) };
}

void test('三年份：合併＋重播 500 ms 內，另量真的讀檔＋重播（無門檻）', async t => {
  // npm test 逐檔執行，避免同一套測試中的 ESLint / Git 子程序搶占計時的 CPU。
  const { sources, days, lines } = threeYears();
  assert.equal(sources.length, 72);
  assert.equal(lines, 167760);
  const start = performance.now();
  const history = mergeHistory(sources);
  const replayStart = performance.now();
  const memories = replay(history.reviews);
  const mergedMs = performance.now() - start;
  t.diagnostic(`mergeHistory + replay: ${mergedMs.toFixed(2)} ms; ${lines} lines / 72 files / ${memories.size} targets`);
  t.diagnostic(`merge: ${(replayStart - start).toFixed(2)} ms; replay: ${(performance.now() - replayStart).toFixed(2)} ms`);
  assert.equal(memories.size, 2000);
  assert.equal(history.reviews.length, days * 151);
  assert.equal(history.changes.length, 36); // 兩台裝置同時寫相同變更，去重。
  assert.deepEqual(history.problems, []);
  assert.ok(mergedMs < 500, `合併＋重播 ${mergedMs.toFixed(2)} ms，門檻 500 ms`);

  const root = await mkdtemp(join(tmpdir(), 'essence-study-perf-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(dirname(join(root, sources[0].path)), { recursive: true });
  await Promise.all(sources.map(source => writeFile(join(root, source.path), source.text)));
  const files = createNodeFiles(root);
  const readStart = performance.now();
  const loaded = await readHistory(files);
  const restored = replay(loaded.reviews);
  const readMs = performance.now() - readStart;
  t.diagnostic(`readHistory + replay (Node Files): ${readMs.toFixed(2)} ms`);
  assert.deepEqual(restored, memories);
});
