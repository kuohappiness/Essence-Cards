import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AdapterResult, Conflict, DeckSnap, Snapshot, TodaySnap } from './snapshot.ts';

/**
 * 發布前比較的轉接器（任務說明 1-3）：在一個版本的 worktree 裡，用那個版本自己的 `src/state` 讀凍結的備份，輸出 snapshot.ts 的比較資料。
 * 每個版本在自己的 Node 程序裡跑：
 *
 *   node tools/compare/adapter.ts <那個版本的 repo> <輸入 JSON> <輸出 JSON>
 *
 * 讀取閘門、今天的份與到期都照那一版的 state，不在這裡另寫一份規則：讀得懂哪些「需要版本」與 need 看那一版 manifest 的版號，
 * 重複 ID 的判斷（D-157）是那一版有才有，沒有就是 null，不要求舊版跑新版的規則。
 * 接不上（函式不存在、型別不同、丟錯）、版號不是正式版號（讀取能力不明）就輸出 `ok: false`，比較的一方寫「無法比較」，不能當成零差異。
 *
 * state 載入時會想寫版本行（讀取能力和版本行都綁在 build，src/state/index.ts）。這裡的 Files 拒絕所有寫入，什麼都寫不出去，
 * 也不假裝寫成；看到版本行以外的寫入，就是這一版載入時不只讀，當成無法比較。紀錄照順序寫，第一行被拒絕之後排在後面的不會送到這裡，
 * 所以看得到的是排在最前面的那一行與 modify，不保證抓到版本行之後才排的。
 */

/** 輸入：備份的時間與時區當「現在」，`Essence Cards/` 底下的文字檔。 */
export interface AdapterInput { now: number; offset: number; files: Record<string, string> }

type Fn = (...args: unknown[]) => unknown;
function need(module: unknown, name: string): Fn {
  const value = (module as Record<string, unknown>)[name];
  if (typeof value !== 'function') throw Error('這個版本沒有 ' + name);
  return value as Fn;
}

// 被比較的版本回傳的值，拿來判斷、算數或走訪之前先查型別，不能靠真假值往下算：Promise 永遠是真的，`!` 之後停掉的目標就成了新卡；
// NaN 寫進 JSON 變成 null，看起來也像新卡（Codex L2 F1）；字串也能展開、走訪，空字串就成了空清單，接不上的版本可能報成零差異（Codex 再審 F2）。
// 用 `.map` 的清單不用另外查：字串、Promise、Set 都沒有 `.map`，會丟錯。卡組的欄位不用查：一邊改了名，比的時候就是差異。
const wrongType = (name: string): Error => Error(`這個版本的 ${name} 型別不同`);
function yesNo(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw wrongType(name);
  return value;
}
function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw wrongType(name);
  return value;
}
function array<T>(value: unknown, name: string): T[] {
  if (!Array.isArray(value)) throw wrongType(name);
  return value as T[];
}
function strings(value: unknown, name: string): string[] {
  const list = array<unknown>(value, name);
  if (list.some(each => typeof each !== 'string')) throw wrongType(name);
  return list as string[];
}
function map<V>(value: unknown, name: string): Map<string, V> {
  if (!(value instanceof Map)) throw wrongType(name);
  return value as Map<string, V>;
}

/** 凍結的輸入：監看不做事（內容不會變），寫入一律拒絕並記下來。 */
function frozen(texts: Record<string, string>) {
  const paths = Object.keys(texts).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const refused: string[] = [];
  const refusal = Error('比較只能讀，不能寫');
  const refuse = (what: string): Promise<never> => {
    refused.push(what);
    return Promise.reject(refusal);
  };
  return {
    refused,
    refusal,
    files: {
      list: (folder: string): Promise<string[]> => Promise.resolve(paths.filter(path => path.startsWith(folder + '/'))),
      read: (path: string): Promise<string | null> => Promise.resolve(Object.hasOwn(texts, path) ? texts[path] : null),
      modify: (path: string) => refuse('改 ' + path),
      append: (_path: string, line: string) => refuse(line),
      watch: () => () => {},
    },
  };
}
const isVersionLine = (line: string): boolean => {
  try { return (JSON.parse(line) as { set?: unknown }).set === 'app'; } catch { return false; }
};

interface TargetLike { id: string | null; name: string; line: number; ok: boolean; prompts: { fingerprint: string }[];
  fields: { importance: string; paused: boolean }; direction: string | null }
interface DeckLike { props: { status: string; isTranscript: boolean; term: string | null; subject: string | null; unit: { code: string; name: string } | null; categories: string[] };
  targets: TargetLike[]; problems: { line: number; level: string; code: string }[] }
interface ItemLike { lt: string; deck: string; lane: string }
interface SlotLike { retention: number; target: { direction: string | null } }
interface TodayLike { share: ItemLike[]; more: ItemLike[]; slots: Map<string, SlotLike> }
interface StateLike {
  ready(): Promise<unknown>;
  close(): Promise<void>;
  unread(): readonly string[];
  decks(): readonly { path: string; deck: DeckLike }[];
  history(): { reviews: unknown[] };
  blocked(): { decks: readonly string[]; targets: readonly string[]; all: boolean };
  canAnswer(lt: string): boolean;
  input(): { settings: { retention: number } };
  today(): TodayLike;
  /** D-157 之後才有。 */
  conflicts?(): readonly Conflict[];
}
const STATE_METHODS = ['ready', 'close', 'unread', 'decks', 'history', 'blocked', 'canAnswer', 'input', 'today'];

/** 讀完的 state 換成比較資料。到期照整份紀錄算（下次到期），但照那一版的 state 停掉的目標不算。 */
function read(state: StateLike, study: unknown, input: AdapterInput): Snapshot {
  const [nextCard, replay, dueAt, dayOf] = ['nextCard', 'replay', 'dueAt', 'dayOf'].map(name => need(study, name));
  const dayNumber = (at: number): number => finite(dayOf(at, input.offset), 'dayOf()');
  const blocked = state.blocked();
  const deckSnaps: DeckSnap[] = state.decks().map(({ path, deck: { props, targets, problems } }) => ({
    path,
    props: { status: props.status, isTranscript: props.isTranscript, term: props.term, subject: props.subject,
      unit: props.unit ? (props.unit.code + ' ' + props.unit.name).trim() : null, categories: props.categories },
    targets: targets.map(target => ({ key: target.id ?? `@${target.line}:${target.name}`, id: target.id, name: target.name, line: target.line, ok: target.ok,
      fingerprints: target.prompts.map(prompt => prompt.fingerprint), importance: target.fields.importance, paused: target.fields.paused, direction: target.direction })),
    problems: problems.map(problem => `${problem.line} ${problem.level} ${problem.code}`),
  }));

  const todayInput = state.input();
  const retention = finite(todayInput.settings.retention, 'input().settings.retention');
  const memories = map(replay(array(state.history().reviews, 'history().reviews')), 'replay()');
  const due: Snapshot['due'] = {};
  for (const entry of deckSnaps) for (const target of entry.targets) {
    if (target.id === null || Object.hasOwn(due, target.id)) continue;
    const memory = memories.get(target.id);
    due[target.id] = !yesNo(state.canAnswer(target.id), 'canAnswer()') ? 'stopped'
      : memory === undefined ? null : finite(dueAt(memory, retention), 'dueAt()');
  }
  const todayDay = dayNumber(input.now);
  const days = Array.from({ length: 30 }, () => 0);
  for (const at of Object.values(due)) {
    if (typeof at !== 'number') continue;
    const day = Math.max(0, dayNumber(at) - todayDay);
    if (day < 30) days[day]++;
  }

  const today = state.today();
  const slots = map<SlotLike>(today.slots, 'today().slots');
  const items: TodaySnap[] = [];
  for (const list of ['share', 'more'] as const) {
    for (const item of array<ItemLike>(today[list], 'today().' + list)) {
      const slot = slots.get(item.lt);
      if (!slot) throw wrongType('today().slots');
      // 只放這一張進今天的份，nextCard 就出它，拿到還沒作答時會出的那一題。今天已經答對就是 done；時間是固定的，不會是 stale。
      const next = nextCard({ ...today, share: [item], more: [] }, todayInput, { deck: item.deck }) as { kind: string; card?: { prompt: { fingerprint: string } } };
      if (next.kind !== 'card' && next.kind !== 'done') throw wrongType('nextCard()');
      items.push({ list, lt: item.lt, deck: item.deck, lane: item.lane, retention: finite(slot.retention, 'today().slots 的 retention'),
        prompt: next.kind === 'card' ? next.card!.prompt.fingerprint : null, direction: slot.target.direction ?? null });
    }
  }
  return {
    gates: { decks: strings(blocked.decks, 'blocked().decks'), held: strings(blocked.targets, 'blocked().targets'), incomplete: yesNo(blocked.all, 'blocked().all'),
      conflicts: state.conflicts ? state.conflicts().map(each => ({ id: each.id, targets: each.targets.map(({ path, line, name }) => ({ path, line, name })) })) : null },
    decks: deckSnaps, due, today: items, days,
  };
}

export async function snapshot(root: string, input: AdapterInput): Promise<Snapshot> {
  const { version } = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as { version: unknown };
  // 載入要比較的那個版本的程式：路徑由命令列給，只能是計算出來的（這個檔不進外掛，D-148 的邊界檢查管的是 src/）。
  // eslint-disable-next-line essence/module-boundaries
  const release = await import(pathToFileURL(join(root, 'src/core/version/index.ts')).href) as unknown;
  if (typeof version !== 'string' || typeof need(release, 'releaseOf')(version) !== 'string') throw Error('這個版本的版號不是正式版號，讀取能力不明：' + String(version));
  // eslint-disable-next-line essence/module-boundaries
  const study = await import(pathToFileURL(join(root, 'src/core/study/index.ts')).href) as unknown;
  // eslint-disable-next-line essence/module-boundaries
  const stateModule = await import(pathToFileURL(join(root, 'src/state/index.ts')).href) as unknown;
  const { files, refused, refusal } = frozen(input.files);
  const failures: unknown[] = [];
  // 預期的錯只有這裡的 Files 拒絕寫入（寫了什麼下面查）；其他的都是這一版讀或收尾時出錯，不能當成沒事（Codex 第三次審查 F4）。
  const failed = (error: unknown): void => { if (error !== refusal) failures.push(error); };
  const state = need(stateModule, 'createState')({
    files, device: 'compare', build: version, fillIds: false, now: () => input.now, offset: () => input.offset,
    onError: failed,
  }) as StateLike;
  let result: Snapshot;
  try {
    for (const name of STATE_METHODS) need(state, name);
    await state.ready();
    const unread = strings(state.unread(), 'unread()');
    if (unread.length) throw Error('讀不到：' + unread.join('、'));
    result = read(state, study, input);
  } finally {
    // 版本行被拒絕之後，close 重試時也會拒絕，拒絕的是同一個物件。
    await state.close().catch(failed);
  }
  if (failures.length) throw Error('這個版本讀的時候出錯：' + String(failures[0]));
  const write = refused.find(line => !isVersionLine(line));
  if (write !== undefined) throw Error('這個版本比較的時候想寫入：' + write);
  return result;
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
