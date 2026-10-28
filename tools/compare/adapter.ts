import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AdapterResult, DeckSnap, Snapshot, TodaySnap } from './snapshot.ts';

/**
 * 發布前比較的轉接器（任務說明 1-3）：在一個版本的 worktree 裡，用那個版本自己的 `src/core/deck` 與 `src/core/study`
 * 讀凍結的備份，輸出 snapshot.ts 的比較資料。每個版本在自己的 Node 程序裡跑：
 *
 *   node tools/compare/adapter.ts <那個版本的 repo> <輸入 JSON> <輸出 JSON>
 *
 * 依版本選轉接器的方式是看那個版本有沒有這裡要用的函式：有就用這一個；之後介面改到接不上時，另寫一個並在這裡依版本選。
 * 接不上（函式不存在、型別不同、丟錯）就輸出 `ok: false`，比較的一方寫「無法比較」，不能當成零差異。
 * 只給唯讀的 Files，也不跑會補 ID 或寫紀錄的流程（state、補 ID 都不碰）。
 */

/** 輸入：備份的時間與時區當「現在」，`Essence Cards/` 底下的文字檔。 */
export interface AdapterInput { now: number; offset: number; files: Record<string, string> }

/** 外掛現在用的設定：設定頁還沒做，state 用預設（D-104、D-078）。考試範圍是 null（限制寫在報告開頭）。 */
const SETTINGS = { capMinutes: 30, retention: 0.8, filter: [] as string[] };

type Fn = (...args: unknown[]) => unknown;
function need(module: Record<string, unknown>, name: string): Fn {
  const value = module[name];
  if (typeof value !== 'function') throw Error('這個版本沒有 ' + name);
  return value as Fn;
}

/** 只能讀的 Files：寫入與監看都丟錯。 */
function readOnly(texts: Record<string, string>) {
  const paths = Object.keys(texts).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const refuse = (): never => { throw Error('比較只能讀，不能寫'); };
  return {
    list: (folder: string): Promise<string[]> => Promise.resolve(paths.filter(path => path.startsWith(folder + '/'))),
    read: (path: string): Promise<string | null> => Promise.resolve(Object.hasOwn(texts, path) ? texts[path] : null),
    modify: refuse, append: refuse, watch: refuse,
  };
}

interface TargetLike { id: string | null; name: string; line: number; ok: boolean; prompts: { fingerprint: string }[];
  fields: { importance: string; paused: boolean }; direction: string | null }
interface DeckLike { props: { status: string; isTranscript: boolean; term: string | null; subject: string | null; unit: { code: string; name: string } | null; categories: string[] };
  targets: TargetLike[]; problems: { line: number; level: string; code: string }[] }
interface ItemLike { lt: string; deck: string; lane: string }
interface TodayLike { share: ItemLike[]; more: ItemLike[]; slots: Map<string, { retention: number; target: { direction: string | null } }> }

export async function snapshot(root: string, input: AdapterInput): Promise<Snapshot> {
  // 載入要比較的那個版本的程式：路徑由命令列給，只能是計算出來的（這個檔不進外掛，D-148 的邊界檢查管的是 src/）。
  // eslint-disable-next-line essence/module-boundaries
  const deck = await import(pathToFileURL(join(root, 'src/core/deck/index.ts')).href) as Record<string, unknown>;
  // eslint-disable-next-line essence/module-boundaries
  const study = await import(pathToFileURL(join(root, 'src/core/study/index.ts')).href) as Record<string, unknown>;
  const [readDecks, readHistory, planToday, nextCard, replay, dueAt, dayOf] =
    [need(deck, 'readDecks'), ...['readHistory', 'planToday', 'nextCard', 'replay', 'dueAt', 'dayOf'].map(name => need(study, name))];
  const files = readOnly(input.files);
  const decks = await readDecks(files) as { path: string; deck: DeckLike }[];
  const history = await readHistory(files) as { reviews: unknown[] };
  const todayInput = { decks, history, settings: SETTINGS, exam: null, now: input.now, offset: input.offset };
  const today = planToday(todayInput) as TodayLike;

  const deckSnaps: DeckSnap[] = decks.map(({ path, deck: { props, targets, problems } }) => ({
    path,
    props: { status: props.status, isTranscript: props.isTranscript, term: props.term, subject: props.subject,
      unit: props.unit ? (props.unit.code + ' ' + props.unit.name).trim() : null, categories: props.categories },
    targets: targets.map(target => ({ key: target.id ?? `@${target.line}:${target.name}`, id: target.id, name: target.name, line: target.line, ok: target.ok,
      fingerprints: target.prompts.map(prompt => prompt.fingerprint), importance: target.fields.importance, paused: target.fields.paused, direction: target.direction })),
    problems: problems.map(problem => `${problem.line} ${problem.level} ${problem.code}`),
  }));

  const memories = replay(history.reviews) as Map<string, unknown>;
  const due: Record<string, number | null> = {};
  for (const entry of deckSnaps) for (const target of entry.targets) {
    if (target.id === null || Object.hasOwn(due, target.id)) continue;
    const memory = memories.get(target.id);
    due[target.id] = memory === undefined ? null : dueAt(memory, SETTINGS.retention) as number;
  }
  const todayDay = dayOf(input.now, input.offset) as number;
  const days = Array.from({ length: 30 }, () => 0);
  for (const at of Object.values(due)) {
    if (at === null) continue;
    const day = Math.max(0, (dayOf(at, input.offset) as number) - todayDay);
    if (day < 30) days[day]++;
  }

  const items: TodaySnap[] = [];
  for (const list of ['share', 'more'] as const) {
    for (const item of today[list]) {
      // 只放這一張進今天的份，nextCard 就出它，拿到還沒作答時會出的那一題。
      const next = nextCard({ ...today, share: [item], more: [] }, todayInput, { deck: item.deck }) as { kind: string; card?: { prompt: { fingerprint: string } } };
      const slot = today.slots.get(item.lt);
      items.push({ list, lt: item.lt, deck: item.deck, lane: item.lane, retention: slot?.retention ?? NaN,
        prompt: next.kind === 'card' ? next.card!.prompt.fingerprint : null, direction: slot?.target.direction ?? null });
    }
  }
  return { decks: deckSnaps, due, today: items, days };
}

if (import.meta.main) {
  const [root, inputPath, outputPath] = process.argv.slice(2);
  let result: AdapterResult;
  try {
    const input = JSON.parse(await readFile(inputPath, 'utf8')) as AdapterInput;
    result = { ok: true, snapshot: await snapshot(root, input) };
  } catch (error) {
    result = { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  await writeFile(outputPath, JSON.stringify(result));
}
