import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseDeck } from '../src/core/deck/index.ts';
import { encodeEntry, formatTime, logPath, mergeHistory, nextCard, planToday, progress, readHistory, replay } from '../src/core/study/index.ts';
import type { Card, DeckEntry, Pick, Rating, TodayInput } from '../src/core/study/index.ts';
import { createState, type LoadTimings } from '../src/state/index.ts';
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

/** threeYears 的 2000 個學習目標，分成四科、20 篇卡組的文字；量測寫進 vault 時放在 `Essence Cards/` 底下。 */
function threeYearDeckTexts(): { path: string; text: string }[] {
  return Array.from({ length: 20 }, (_, d) => ({
    path: '卡組 ' + String(d).padStart(2, '0') + '.md',
    text: '---\n科目: ' + ['自然', '英文', '數學', '社會'][d % 4] + '\n---\n'
      + Array.from({ length: 100 }, (_, i) => '- 能說明 goal' + String(d * 100 + i) + ' ^goal' + String(d * 100 + i) + '\n    - 題目 :: 答案\n').join(''),
  }));
}

/** threeYearDeckTexts 解析好的卡組。 */
export function threeYearDecks(): DeckEntry[] {
  return threeYearDeckTexts().map(({ path, text }) => ({ path, deck: parseDeck(text) }));
}

/** 把三年份的紀錄與 20 篇卡組寫進 root（root 底下就是 `Essence Cards/`）。 */
async function writeThreeYears(root: string, sources: { path: string; text: string }[]): Promise<void> {
  const all = [...sources, ...threeYearDeckTexts().map(({ path, text }) => ({ path: 'Essence Cards/' + path, text }))];
  for (const folder of new Set(all.map(({ path }) => dirname(join(root, path))))) await mkdir(folder, { recursive: true });
  await Promise.all(all.map(({ path, text }) => writeFile(join(root, path), text)));
}

const rounded = (t: LoadTimings) => `decks ${t.decks.toFixed(1)}, history ${t.history.toFixed(1)}, plan ${t.plan.toFixed(1)}, total ${t.total.toFixed(1)}`;

/** W5 §5-1：對寫好的資料夾建 state、跑一次 ready()，印出 LoadTimings。 */
async function benchOpen(root: string, label: string): Promise<void> {
  const state = createState({ files: createNodeFiles(root), device: 'Bench-0000', fillIds: false });
  try {
    const timings = await state.ready();
    const targets = state.decks().reduce((n, d) => n + d.deck.targets.length, 0);
    console.log(label + ' ready(): ' + rounded(timings) + ' ms; history + plan ' + (timings.history + timings.plan).toFixed(1)
      + ' ms (I1 budget 1000 ms on iPhone); ' + state.history().reviews.length + ' reviews, ' + state.decks().length + ' decks, ' + targets + ' targets, share ' + state.today().share.length);
  } finally { await state.close(); }
}

/** W5 §5-1：state 的 answer＋next＋progress 一次，21 次取中位數（寫檔在背景，不計時）。 */
async function benchAnswer(root: string): Promise<boolean> {
  const state = createState({ files: createNodeFiles(root), device: 'Bench-0000', fillIds: false });
  const steps: number[] = [];
  try {
    await state.ready();
    // 畫面的用法：在還有卡的那一科取下一張；今天的份做完就取「再複習一些」。
    const upcoming = (): { pick: Pick; card: Card } => {
      const picks: Pick[] = [...state.progress().subjects.map(row => ({ subject: row.subject })), { more: true }];
      for (const pick of picks) {
        const next = state.next(pick);
        if (next.kind === 'card') return { pick, card: next.card };
      }
      throw Error('三年份資料沒有可以作答的卡');
    };
    for (let run = 0; run < 21; run++) {
      const { pick, card } = upcoming();
      const start = performance.now();
      state.answer({ lt: card.lt, r: 'good', v: card.prompt.fingerprint });
      state.next(pick);
      state.progress();
      steps.push(performance.now() - start);
    }
  } finally { await state.close(); }
  console.log('state answer + next + progress median: ' + median(steps).toFixed(2) + ' ms (budget 20 ms)');
  return median(steps) <= 20;
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

async function benchStudy(vault: string | undefined): Promise<void> {
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
  let answer: boolean;
  try {
    await writeThreeYears(root, sources);
    const files = createNodeFiles(root);
    const start = performance.now();
    replay((await readHistory(files)).reviews);
    console.log('readHistory + replay (Node Files): ' + (performance.now() - start).toFixed(2) + ' ms');
    answer = await benchAnswer(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  if (vault) {
    // 開發命令 open 讀的資料夾（W5 說明 §4-4）；只有 bench 寫這裡，先清掉上一次的。
    const target = join(vault, 'Essence W5', '量測');
    await rm(target, { recursive: true, force: true });
    await writeThreeYears(target, sources);
    console.log('wrote ' + lines + ' log lines and 20 decks to <vault>/Essence W5/量測/');
    await benchOpen(target, 'vault (Node Files)');
  }
  if (median(times) > 500 || !today || !answer) process.exitCode = 1;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { vault: { type: 'string' } } });
  if (values.vault !== undefined && !(await stat(values.vault)).isDirectory()) throw Error('--vault 必須是已存在的資料夾');
  await benchStudy(values.vault);
}
