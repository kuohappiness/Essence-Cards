import type { Files } from '../core/files.ts';
import { SNAPSHOT_FOLDER, snapshotKey, snapshotPath, snapshotSuffix, snapshotText, snapshotValid } from '../core/catalog/index.ts';
import type { SnapshotDeck } from '../core/catalog/index.ts';
import { parseTime } from '../core/study/index.ts';
import { completeText, IncompleteRead } from './reads.ts';

/** 這一刻該留下的切面（tasks/record-gaps.md §2）；不該寫是 null。day 放進來，跨過清晨 4 點就算不同。 */
export interface SnapshotPlan {
  day: number;
  exam: string | null;
  scope: string;
  start: string;
  end: string;
  units: string[];
  decks: SnapshotDeck[];
}

interface SnapshotOptions {
  files: Files;
  device: string;
  closed: () => boolean;
  /** 同步算出現在該寫哪一份，條件都在這裡（範圍可用、日期、卡組與範圍檔都讀到、至少一篇）。 */
  plan: () => SnapshotPlan | null;
  /** 等已知的待讀讀完；false 是這次不寫。 */
  settle: () => Promise<boolean>;
  /** 範圍檔的待讀都讀完之後呼叫 decide，兩者在同一個同步區段（folder-files 的 drain）。 */
  drain: <T>(decide: (known: boolean) => T | Promise<T>) => Promise<T>;
  /** 卡組或範圍檔還有沒有在讀的。 */
  waiting: () => boolean;
  stamp: () => string;
  /** 一次列檔、讀檔或寫檔最多等多久（毫秒）：iCloud 的佔位檔可能讓它一直不回來。 */
  stuckAfter: number;
  onError: (error: unknown) => void;
}

/** 最後一個能拒絕建檔的地方發現情況變了：這次不建，重新查（L2 的 R2）。 */
class Stale extends Error {}
/** 等到上限還沒回來：底層可能還在做，檔案在不在都不能當成「被拒絕」（L2 的 R10）。 */
class Stuck extends Error {}

/**
 * 考試切面的查核與寫入（§2）：每次排今天的份之後、讀不到的補齊之後呼叫 check。一次只跑一輪，跑的時候又有觸發就再查一次；
 * 這份已經有效的記住不再查；寫失敗的這一天不再試。不影響作答，排程與複習畫面都不讀這個資料夾。
 */
export function createSnapshots(options: SnapshotOptions) {
  const { files } = options;
  const done = new Set<string>();
  const failed = new Map<string, number>();
  /** 底層的寫入還沒結束的（逾時只結束等待）：這時再查會把寫到一半的檔當成無效，另寫一份序號（L2 的 R11）。 */
  const writing = new Set<string>();
  /** 這次觸發裡已經因為「列檔之後才出現」重新查過的路徑：列檔一直列不到它時，不空轉；下一次觸發重新算（L2 的 R10）。 */
  const late = new Set<string>();
  function recheck(path: string): void {
    if (late.has(path)) return;
    late.add(path);
    again = true;
  }
  let running = false, again = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  /** 等到上限就放棄這一步（底層取消不了）：一份卡住的檔不能擋住之後的查核與別場考試（L2 的 R5）。 */
  function limited<T>(work: Promise<T>): Promise<T> {
    let id: ReturnType<typeof setTimeout> | undefined;
    const stuck = new Promise<never>((_, reject) => {
      id = setTimeout(() => { reject(new Stuck(`考試切面的檔案操作等了 ${String(options.stuckAfter)} ms 沒有回來（逾時）`)); }, options.stuckAfter);
      timers.add(id);
    });
    return Promise.race([work, stuck]).finally(() => {
      if (id === undefined) return;
      clearTimeout(id);
      timers.delete(id);
    });
  }

  async function once(): Promise<void> {
    const first = options.plan();
    if (!first) return;
    const key = snapshotKey(first.exam, first.scope), id = first.start + ' ' + key;
    if (done.has(id) || failed.get(id) === first.day || writing.has(id)) return;
    if (!await options.settle()) return;
    const mine: { suffix: number; path: string }[] = [];
    for (const path of await limited(files.list(SNAPSHOT_FOLDER))) {
      const suffix = snapshotSuffix(path, first.start, key, options.device);
      if (suffix !== null) mine.push({ suffix, path });
    }
    // 這台的檔讀不到：這次不寫，下次再查。
    for (const { path } of mine) {
      const text = completeText(path, await limited(files.read(path)));
      if (text !== null && snapshotValid(text, key, first.start, t => parseTime(t) !== null)) { done.add(id); return; }
    }
    const taken = new Set(mine.map(each => each.suffix));
    let suffix = 1;
    while (taken.has(suffix)) suffix++;
    const path = snapshotPath(first.start, key, options.device, suffix);
    const stale = (): boolean => options.closed() || options.waiting() || JSON.stringify(options.plan()) !== JSON.stringify(first);
    await options.drain(async known => {
      // 等待與列檔的時候選定的範圍、日期或卡組變了：這次不寫；變動的那一批會再查。
      if (!known || stale()) return;
      const content = snapshotText({ t: options.stamp(), exam: first.exam, scope: first.scope, start: first.start, end: first.end, units: first.units, decks: first.decks.length }, first.decks);
      let gaveUp = false, occupied = false;
      try {
        const work = files.modify(path, (text, exists) => {
          occupied = exists;
          if (exists) return text;
          // modify 開始到回呼之間可能讓出執行（排隊、等搬回、建上層資料夾）：丟錯才不會建出空檔。
          if (gaveUp || stale()) throw new Stale();
          return content;
        });
        writing.add(id);
        const finished = (): void => { writing.delete(id); };
        void work.then(finished, finished);
        await limited(work);
        // 列檔之後才出現的（L2 的 R6）：不知道有不有效，重新列一次，有效的算完成、無效的另寫序號、讀不到的下次再查。
        if (!occupied) done.add(id);
        else recheck(path);
      } catch (error) {
        // 內容相同的讀取不會觸發下一次查核，所以自己再查一次；要等的都在 settle 與 drain 裡，不會空轉。
        if (error instanceof Stale) { again = true; return; }
        if (error instanceof IncompleteRead) return;
        gaveUp = true;
        // 讀舊內容就被拒絕，modify 走不到回呼：檔案在的話和「列檔之後才出現」同一種情況，不是寫失敗（L2 的 R10）。
        if (!(error instanceof Stuck) && await limited(files.list(SNAPSHOT_FOLDER)).then(paths => paths.includes(path), () => false)) { recheck(path); return; }
        failed.set(id, first.day);
        if (!options.closed()) options.onError(error);
      }
    });
  }

  async function loop(): Promise<void> {
    do {
      again = false;
      // 列檔、讀檔失敗（iCloud 佔位檔、沒有權限）下次再查。
      await once().catch(() => {});
    } while (again && !options.closed());
    running = false;
  }

  return {
    check(): void {
      if (options.closed()) return;
      late.clear();
      if (running) { again = true; return; }
      running = true;
      void loop();
    },
    /** 關閉：不等卡住的檔，等待的計時也不留著。 */
    stop(): void {
      for (const id of timers) clearTimeout(id);
      timers.clear();
    },
  };
}
