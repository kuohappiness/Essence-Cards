import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseDeck } from '../src/core/deck/index.ts';
import { encodeEntry, formatTime, logPath, mergeHistory, nextCard, planToday, progress, readHistory, replay } from '../src/core/study/index.ts';
import type { DeckEntry, Rating, TodayInput } from '../src/core/study/index.ts';
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

/** threeYears 的 2000 個學習目標，分成四科、20 篇卡組。 */
export function threeYearDecks(): DeckEntry[] {
  return Array.from({ length: 20 }, (_, d) => ({
    path: '卡組 ' + String(d).padStart(2, '0') + '.md',
    deck: parseDeck('---\n科目: ' + ['自然', '英文', '數學', '社會'][d % 4] + '\n---\n'
      + Array.from({ length: 100 }, (_, i) => '- 能說明 goal' + String(d * 100 + i) + ' ^goal' + String(d * 100 + i) + '\n    - 題目 :: 答案\n').join('')),
  }));
}

const median = (times: number[]): number => [...times].sort((a, b) => a - b)[times.length >> 1];

/** W4 今天的佇列：planToday 5 次、作答後 nextCard＋progress 21 次，各取中位數。 */
function benchToday(sources: { path: string; text: string }[]): boolean {
  const history = mergeHistory(sources);
  const input: TodayInput = { decks: threeYearDecks(), history, settings: { capMinutes: 30, retention: 0.8, filter: [] }, exam: null,
    now: Date.parse('2026-10-02T19:00:00.000+08:00'), offset: 480 };
  const plans: number[] = [];
  let today = planToday(input);
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    today = planToday(input);
    plans.push(performance.now() - start);
  }
  const answer = mergeHistory([{ path: 'answer.jsonl', text: encodeEntry('2026-10-02T19:00:00.000+08:00', { lt: today.share[0].lt, r: 'miss', v: '12345678' }) }]).reviews;
  const answered = { ...input, history: { ...history, reviews: [...history.reviews, ...answer] }, now: Date.parse('2026-10-02T19:00:10.000+08:00') };
  const steps: number[] = [];
  for (let run = 0; run < 21; run++) {
    const start = performance.now();
    nextCard(today, answered, { subject: today.share[0].subject });
    progress(today, answered);
    steps.push(performance.now() - start);
  }
  console.log('planToday median: ' + median(plans).toFixed(2) + ' ms (budget 300 ms)');
  console.log('nextCard + progress median: ' + median(steps).toFixed(2) + ' ms (budget 20 ms)');
  return median(plans) <= 300 && median(steps) <= 20;
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
  console.log('mergeHistory + replay median: ' + median(times).toFixed(2) + ' ms (budget 500 ms)');
  const today = benchToday(sources);

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
  if (median(times) > 500 || !today) process.exitCode = 1;
}

if (import.meta.main) await benchStudy();
