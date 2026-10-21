import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { encodeEntry, formatTime, logPath, mergeHistory, readHistory, replay } from '../src/core/study/index.ts';
import type { Rating } from '../src/core/study/index.ts';
import { createNodeFiles } from './node-files.ts';

export function threeYears() {
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

async function benchStudy(): Promise<void> {
  const { sources, lines } = threeYears();
  console.log(lines + ' lines / ' + sources.length + ' files / 2000 targets');
  const times: number[] = [];
  for (let run = 1; run <= 5; run++) {
    const start = performance.now();
    replay(mergeHistory(sources).reviews);
    const ms = performance.now() - start;
    times.push(ms);
    console.log('mergeHistory + replay #' + run + ': ' + ms.toFixed(2) + ' ms');
  }
  const median = [...times].sort((a, b) => a - b)[2];
  console.log('mergeHistory + replay median: ' + median.toFixed(2) + ' ms (budget 500 ms)');

  const root = await mkdtemp(join(tmpdir(), 'essence-study-bench-'));
  try {
    await mkdir(dirname(join(root, sources[0].path)), { recursive: true });
    await Promise.all(sources.map(source => writeFile(join(root, source.path), source.text)));
    const files = createNodeFiles(root);
    const start = performance.now();
    replay((await readHistory(files)).reviews);
    console.log('readHistory + replay (Node Files): ' + (performance.now() - start).toFixed(2) + ' ms');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  if (median > 500) process.exitCode = 1;
}

if (import.meta.main) await benchStudy();
