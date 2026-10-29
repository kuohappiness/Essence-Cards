import { assignIds, blockIds, parseDeck, setTargetId } from '../core/deck/index.ts';
import type { Deck, Target } from '../core/deck/index.ts';

export type IdIssueKind = 'lost' | 'changed' | 'ambiguous';
/**
 * 待處理的問題。state 用物件身分認出是哪一個問題（技術債 A12）：畫面不能複製這個物件，要把拿到的同一個物件交回 resolve。
 * 內容沒變的重讀原地更新行號、保留同一個物件；內容改過就換一個新物件，舊的不能再寫回（D-134）。
 */
export interface IdIssue {
  path: string;
  /** 那個目標現在的行號。 */
  line: number;
  /** 目標名稱，給家長看。 */
  name: string;
  /** lost：原本的 ID 不見了；changed：換成一個沒見過的 ID；ambiguous：那一行有兩個 ID。 */
  kind: IdIssueKind;
  /** 能確定的原本 ID；null 時只能當成新的。 */
  restore: string | null;
}

/** 待處理的問題；issue 是交給畫面的同一個物件，重讀時更新它的行號與名稱，resolve 靠它認出是哪一個。 */
interface Pending {
  issue: IdIssue;
  /** 在改動之間認出同一個目標用（W5 §8-5）：changed 的 ID、ambiguous 的候選、名稱與題目指紋。 */
  id: string | null;
  candidates: string[];
  fingerprints: string[];
  /** 有卡組或紀錄讀不到時找到的：占用資訊不完整，等都讀到了再由 confirm() 核對（state-load §3-2）。 */
  provisional: boolean;
}

/** 寫入的預期變更（tasks/state-writes.md §4 第 2 點）：這個 ID 在名稱是 name 的目標的行尾。 */
export interface Expected { id: string; name: string }
/**
 * 一份寫入的準備：要寫回的文字、預期的變更、這次新配的 ID 數，以及延後到採用時才做的記錄（還原、當成新的）。
 * 準備只預留 ID（配出的立刻記進 seen）：不採用輸出、不解除待處理、不記 removed（§4 第 1 點）。
 */
export interface Prepared { text: string; expect: Expected[]; added: number; record: (() => void) | null }

/** 預期的變更都在這份文字裡：每個 ID 都在某個目標的行尾，而且那個目標的名稱和預期相同（§4 第 3 點）。 */
export function confirms(text: string, expect: readonly Expected[]): boolean {
  const targets = parseDeck(text).targets;
  return expect.every(({ id, name }) => targets.some(t => t.id === id && t.name === name));
}

export interface IdTrackerOptions {
  random?: () => number;
  /** 原始紀錄每一行出現過的 lt（包括被取消的作答）。 */
  logIds: () => ReadonlySet<string>;
  /** 有卡組或紀錄讀不到（占用資訊不完整）：這時找到的問題是暫定的。 */
  partial: () => boolean;
}

/**
 * 學習目標 ID 的保護（W5 §8-5、D-134）：記住這次載入裡每篇卡組的上一版，重讀時找出弄丟或改掉的 ID，
 * 讓那些目標待處理（不出題、不補、不移動），直到家長選了、那個目標被刪掉，或這次載入結束；有東西讀不到時找到的
 * changed，讀到之後換成的 ID 出現在紀錄裡就撤銷（confirm）。不依內容猜身分：
 * 只有「這一版和上一版的 ID」當證據；名稱與指紋只用來在改動之間認出同一個待處理的目標，或判斷沒有 ID 的目標是不是上一版就在。
 */
export function createIdTracker(options: IdTrackerOptions) {
  const texts = new Map<string, string>();
  const versions = new Map<string, Deck>();
  /** 這一版還留在筆記裡的 ID：每一行行尾的區塊 ID，加上目標行中被認得的與 ambiguous 的候選。 */
  const present = new Map<string, Set<string>>();
  const pending = new Map<string, Pending[]>();
  /** 這次載入在任何卡組看過的 ID，以及自己配出的：不再配出，重新出現也不算沒見過。 */
  const seen = new Set<string>();
  /** 刻意拿掉的：removedInEditor 報的（restoredInEditor 報回來時取消），以及自己寫回時拿掉的。 */
  const removed = new Set<string>();
  /** pending 改變時加一，state 用來決定要不要重排。 */
  let revision = 0;

  const targetIds = (deck: Deck): string[] => deck.targets.flatMap(t => [...(t.id ? [t.id] : []), ...(t.idCandidates ?? [])]);
  function presentOf(text: string, deck: Deck): Set<string> {
    const ids = blockIds(text);
    for (const id of targetIds(deck)) ids.add(id);
    return ids;
  }
  function elsewhere(path: string): Set<string> {
    const ids = new Set<string>();
    for (const [other, set] of present) if (other !== path) for (const id of set) ids.add(id);
    return ids;
  }
  const idless = (t: Target): boolean => t.id === null && !t.idCandidates;
  const sharesPrompt = (t: Target, fingerprints: readonly string[]): boolean => t.prompts.some(p => fingerprints.includes(p.fingerprint));
  const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every(id => b.includes(id));
  function make(path: string, target: Target, kind: IdIssueKind, restore: string | null): Pending {
    return { issue: { path, line: target.line, name: target.name, kind, restore: target.implicit ? null : restore },
      id: target.id, candidates: target.idCandidates ?? [], fingerprints: target.prompts.map(p => p.fingerprint), provisional: options.partial() };
  }
  /** 這一版裡哪個目標是同一個待處理的目標：同樣的未知 ID、同樣的候選、同樣的名稱，或至少一題相同；平手取行號最近的。 */
  function match(item: Pending, targets: readonly Target[], used: ReadonlySet<Target>): Target | null {
    let best: Target | null = null, bestScore = 0;
    for (const target of targets) {
      if (used.has(target)) continue;
      if (target.id !== null && !(item.issue.kind === 'changed' && target.id === item.id)) continue;
      const score = item.issue.kind === 'changed' && target.id === item.id ? 4
        : target.idCandidates && item.candidates.length && sameSet(target.idCandidates, item.candidates) ? 3
        : target.name === item.issue.name ? 2
        : sharesPrompt(target, item.fingerprints) ? 1 : 0;
      const closer = best && Math.abs(target.line - item.issue.line) < Math.abs(best.line - item.issue.line);
      if (score > bestScore || (score === bestScore && score > 0 && closer)) { best = target; bestScore = score; }
    }
    return best;
  }

  /**
   * 這幾篇的新版本（同一批讀到的、或自己要寫回的）。detect 是 false 時（第一次讀、自己寫回）只延續待處理的問題，
   * 不找新的弄丟；ambiguous-id 不論如何都待處理。同一批先把每一篇最新的占用放上，再各自和上一版比：
   * 跨檔搬移不因通知的先後被當成弄丟（Codex 審查第二部分的 F5）。
   */
  function observe(entries: readonly { path: string; text: string; deck: Deck }[], detect: boolean): void {
    const batch = entries.map(entry => ({ ...entry, prev: versions.get(entry.path), prevPresent: present.get(entry.path) ?? new Set<string>(), now: presentOf(entry.text, entry.deck) }));
    for (const entry of batch) present.set(entry.path, entry.now);
    for (const entry of batch) observeOne(entry, detect);
  }
  function observeOne({ path, text, deck, prev, prevPresent, now }: { path: string; text: string; deck: Deck; prev: Deck | undefined; prevPresent: Set<string>; now: Set<string> }, detect: boolean): void {
    const old = pending.get(path) ?? [];
    const oldLines = new Set(old.map(item => item.issue.line));
    const used = new Set<Target>();
    const kept: Pending[] = [], unmatched: Pending[] = [];
    for (const item of old) {
      const target = match(item, deck.targets, used);
      if (!target) { unmatched.push(item); continue; }
      used.add(target);
      const fingerprints = target.prompts.map(p => p.fingerprint);
      const candidates = target.idCandidates ?? [];
      // 名稱、題目或候選改了：換一個新的問題物件，舊的（小視窗拿到的）就不能再用來寫回（D-134：寫回前重新確認內容沒變）。
      const same = target.name === item.issue.name && target.id === item.id && sameSet(candidates, item.candidates)
        && fingerprints.length === item.fingerprints.length && [...fingerprints].sort().join() === [...item.fingerprints].sort().join();
      const issue = same ? Object.assign(item.issue, { line: target.line }) : { ...item.issue, line: target.line, name: target.name };
      if (!same) revision++;
      kept.push({ issue, id: target.id, candidates, fingerprints, provisional: item.provisional });
    }
    const fresh: Pending[] = [];
    for (const target of deck.targets) {
      if (used.has(target) || !target.idCandidates) continue;
      used.add(target);
      const back = prev ? target.idCandidates.filter(id => prevPresent.has(id)) : [];
      fresh.push(make(path, target, 'ambiguous', back.length === 1 ? back[0] : null));
    }
    if (detect && prev) {
      const others = elsewhere(path);
      const logs = options.logIds();
      // 不見的 ID：上一版的目標有、這一版整篇都沒有、別篇也沒有，也不是刻意拿掉的。
      const missing = [...new Set(targetIds(prev))].filter(id => !now.has(id) && !others.has(id) && !removed.has(id));
      // 上一版就在、同樣沒有 ID 的目標不算新出現（同名或至少一題相同，一對一）。
      const pool = prev.targets.filter(t => idless(t) && !oldLines.has(t.line));
      const appeared: [Target, IdIssueKind][] = [];
      for (const target of deck.targets) {
        if (used.has(target)) continue;
        if (target.id === null) {
          const same = pool.findIndex(t => t.name === target.name) >= 0 ? pool.findIndex(t => t.name === target.name) : pool.findIndex(t => sharesPrompt(target, t.prompts.map(p => p.fingerprint)));
          if (same >= 0) pool.splice(same, 1);
          else appeared.push([target, 'lost']);
        } else if (!seen.has(target.id) && !others.has(target.id) && !logs.has(target.id)) appeared.push([target, 'changed']);
      }
      // 兩者都有才是問題；證據也包括這次認不出來的待處理問題（那個目標可能被改得認不出來）。
      const evidence = missing.length + unmatched.length;
      if (evidence && appeared.length) {
        const single = evidence === 1 && appeared.length === 1 ? missing[0] ?? unmatched[0].issue.restore : null;
        for (const [target, kind] of appeared) fresh.push(make(path, target, kind, single));
      }
    }
    const next = [...kept, ...fresh].sort((a, b) => a.issue.line - b.issue.line);
    if (next.length !== old.length || unmatched.length || fresh.length) revision++;
    if (next.length) pending.set(path, next); else pending.delete(path);
    versions.set(path, deck);
    texts.set(path, text);
    for (const id of now) seen.add(id);
  }
  const observeText = (path: string, text: string, detect: boolean): void => { observe([{ path, text, deck: parseDeck(text) }], detect); };

  function lines(path: string): Set<number> {
    return new Set((pending.get(path) ?? []).map(item => item.issue.line));
  }
  function taken(): Set<string> {
    const ids = new Set([...seen, ...options.logIds(), ...removed]);
    for (const items of pending.values()) for (const item of items) if (item.issue.restore) ids.add(item.issue.restore);
    return ids;
  }
  /** 照一般規則補這一篇（skip 的行跳過），配出的 ID 立刻記進 seen（預留）。回傳寫回的文字與新配的 ID。 */
  function reserve(text: string, skip: ReadonlySet<number>): { text: string; ids: string[] } {
    const result = assignIds(text, { taken: taken(), skip, random: options.random });
    for (const { id } of result.assigned) seen.add(id);
    return { text: result.text, ids: result.assigned.map(({ id }) => id) };
  }
  /** 這些 ID 在寫回的文字裡所在目標的名稱。 */
  function expected(text: string, ids: readonly string[]): Expected[] {
    const targets = parseDeck(text).targets;
    return ids.flatMap(id => targets.filter(t => t.id === id).map(t => ({ id, name: t.name })));
  }

  return {
    revision: () => revision,
    text: (path: string) => texts.get(path),
    observe,
    /** 卡組刪掉了：它的待處理問題跟著消失（那個目標被刪掉）。 */
    forget(path: string): void {
      if (pending.delete(path)) revision++;
      texts.delete(path); versions.delete(path); present.delete(path);
    },
    /** 改名：上一版與待處理的問題搬到新路徑，再照一般的重讀比對。 */
    move(from: string, to: string): void {
      for (const map of [texts, versions, present, pending] as Map<string, unknown>[]) {
        if (map.has(from)) { map.set(to, map.get(from)); map.delete(from); }
      }
      for (const item of pending.get(to) ?? []) item.issue.path = to;
    },
    issues: (path: string): IdIssue[] => (pending.get(path) ?? []).map(item => item.issue),
    lines,
    status(path: string): { missing: number; issues: IdIssue[] } {
      const text = texts.get(path);
      const missing = text === undefined ? 0 : assignIds(text, { taken: new Set(), skip: lines(path) }).assigned.length;
      return { missing, issues: (pending.get(path) ?? []).map(item => item.issue) };
    },
    /**
     * 讀不到的卡組與紀錄都讀到了（state-load §3-2）：暫定的 changed 換成的 ID 現在出現在紀錄裡（那份紀錄讀不到時才被當成
     * 沒見過），撤銷那個問題；其他的（lost、ambiguous、ID 仍沒見過的 changed）確定下來。不自動配回。
     */
    confirm(): void {
      const logs = options.logIds();
      for (const [path, items] of pending) {
        const kept = items.filter(item => !(item.provisional && item.issue.kind === 'changed' && item.id !== null && logs.has(item.id)));
        for (const item of kept) item.provisional = false;
        if (kept.length === items.length) continue;
        revision++;
        if (kept.length) pending.set(path, kept); else pending.delete(path);
      }
    },
    removed(ids: readonly string[]): void { for (const id of ids) removed.add(id); },
    restored(ids: readonly string[]): void { for (const id of ids) removed.delete(id); },
    /**
     * 存檔的準備：先把這份文字當成新版本比對（可能比讀到的新；先觀察原文再配號），再照一般規則補。只預留 ID，
     * 寫成並由核對讀取確認之後，state 才呼叫 wrote 把寫回的文字當成這一篇現在的內容（寫不進去時不呼叫，就不會以為 ID 已經在檔案裡）。
     */
    fill(path: string, text: string): Prepared {
      if (texts.get(path) !== text) observeText(path, text, true);
      const next = reserve(text, lines(path));
      return { text: next.text, expect: expected(next.text, next.ids), added: next.ids.length, record: null };
    },
    /**
     * 家長選了之後的準備：問題已不在、內容改過（問題物件已換新）、目標不在、或還原的 ID 已經在別處時回傳 null，問題保留。
     * 「拿掉這個問題、被換掉的 ID 記成刻意拿掉、還原的 ID 記成見過」放在 record，採用時才做；在那之前問題還在，
     * 還原的 ID 照舊經由問題的 restore 留在 taken() 裡。
     */
    resolve(issue: IdIssue, choice: 'restore' | 'new', text: string): Prepared | null {
      const path = issue.path;
      if (texts.get(path) !== text) observeText(path, text, true);
      const item = (pending.get(path) ?? []).find(each => each.issue === issue);
      if (!item) return null;
      const target = versions.get(path)?.targets.find(t => t.line === issue.line);
      if (!target) return null;
      const own = [...(target.id ? [target.id] : []), ...(target.idCandidates ?? [])];
      const restore = choice === 'restore' ? item.issue.restore : null;
      let next: string | null, id: string | undefined;
      if (choice === 'restore') {
        if (!restore || target.implicit) return null;
        // 寫回前重新確認：原本的 ID 現在不在任何卡組（這個目標自己那一行的候選不算）。
        const bare = setTargetId(text, target.line, null);
        if (bare === null || elsewhere(path).has(restore) || presentOf(bare, parseDeck(bare)).has(restore)) return null;
        next = setTargetId(text, target.line, restore);
        id = restore;
      } else {
        const bare = target.implicit ? text : setTargetId(text, target.line, null);
        if (bare === null) return null;
        // 這個目標還在待處理（採用時才拿掉），補的時候不跳過它；其他待處理的照常跳過。
        const skip = lines(path);
        skip.delete(target.line);
        const filled = reserve(bare, skip);
        next = filled.text;
        // 這個目標配到的那一個：同名、行號最近的新 ID（隱含目標補上 ID 時會多一行）。
        const mine = expected(next, filled.ids).filter(e => e.name === target.name);
        const lineOf = (each: Expected) => parseDeck(next as string).targets.find(t => t.id === each.id)?.line ?? Infinity;
        id = mine.sort((a, b) => Math.abs(lineOf(a) - target.line) - Math.abs(lineOf(b) - target.line))[0]?.id;
      }
      if (next === null || id === undefined) return null;
      return { text: next, expect: [{ id, name: target.name }], added: 0, record() {
        const items = pending.get(path) ?? [];
        const rest = items.filter(each => each !== item);
        if (rest.length !== items.length) {
          revision++;
          if (rest.length) pending.set(path, rest); else pending.delete(path);
        }
        // 自己寫回時拿掉的 ID（被換掉的、當成新的拿掉的候選）不算弄丟。
        for (const each of own) if (each !== restore) removed.add(each);
        if (restore) seen.add(restore);
      } };
    },
    /** 自己寫回的文字（核對讀取確認寫成了）：當成這一篇現在的內容，延續待處理的問題，不找新的弄丟。 */
    wrote(path: string, text: string): void {
      if (texts.get(path) !== text) observeText(path, text, false);
    },
  };
}
