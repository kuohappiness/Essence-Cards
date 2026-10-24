import { assignIds, blockIds, parseDeck, setTargetId } from '../core/deck/index.ts';
import type { Deck, Target } from '../core/deck/index.ts';

export type IdIssueKind = 'lost' | 'changed' | 'ambiguous';
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
}

export interface IdTrackerOptions {
  random?: () => number;
  /** 原始紀錄每一行出現過的 lt（包括被取消的作答）。 */
  logIds: () => ReadonlySet<string>;
}

/**
 * 學習目標 ID 的保護（W5 §8-5、D-134）：記住這次載入裡每篇卡組的上一版，重讀時找出弄丟或改掉的 ID，
 * 讓那些目標待處理（不出題、不補、不移動），直到家長選了、那個目標被刪掉，或這次載入結束。不依內容猜身分：
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
  /** 這次載入自己配出的 ID：還沒有紀錄時被拿掉（例如補完按 Undo）不算弄丟。 */
  const issued = new Set<string>();
  /** 刻意拿掉的：removedInEditor 報的，以及自己寫回時拿掉的。 */
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
      id: target.id, candidates: target.idCandidates ?? [], fingerprints: target.prompts.map(p => p.fingerprint) };
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
   * 這一篇的新版本（讀到的、或自己要寫回的）。detect 是 false 時（第一次讀、自己寫回）只延續待處理的問題，
   * 不找新的弄丟；ambiguous-id 不論如何都待處理。
   */
  function observe(path: string, text: string, deck: Deck, detect: boolean): void {
    const prev = versions.get(path);
    const prevPresent = present.get(path) ?? new Set<string>();
    const now = presentOf(text, deck);
    const old = pending.get(path) ?? [];
    const oldLines = new Set(old.map(item => item.issue.line));
    const used = new Set<Target>();
    const kept: Pending[] = [], unmatched: Pending[] = [];
    for (const item of old) {
      const target = match(item, deck.targets, used);
      if (!target) { unmatched.push(item); continue; }
      used.add(target);
      Object.assign(item.issue, { line: target.line, name: target.name });
      Object.assign(item, { id: target.id, candidates: target.idCandidates ?? [], fingerprints: target.prompts.map(p => p.fingerprint) });
      kept.push(item);
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
      // 不見的 ID：上一版的目標有、這一版整篇都沒有、別篇也沒有，也不是刻意拿掉的或自己剛配出還沒有紀錄的。
      const missing = [...new Set(targetIds(prev))].filter(id => !now.has(id) && !others.has(id) && !removed.has(id) && !(issued.has(id) && !logs.has(id)));
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
    present.set(path, now);
    for (const id of now) seen.add(id);
  }

  function lines(path: string): Set<number> {
    return new Set((pending.get(path) ?? []).map(item => item.issue.line));
  }
  function taken(): Set<string> {
    const ids = new Set([...seen, ...options.logIds(), ...removed]);
    for (const items of pending.values()) for (const item of items) if (item.issue.restore) ids.add(item.issue.restore);
    return ids;
  }
  /** 照一般規則補這一篇（待處理的跳過），記下配出的 ID。 */
  function fill(path: string, text: string): string {
    const result = assignIds(text, { taken: taken(), skip: lines(path), random: options.random });
    for (const { id } of result.assigned) { seen.add(id); issued.add(id); }
    return result.text;
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
    removed(ids: readonly string[]): void { for (const id of ids) removed.add(id); },
    /** 存檔：先把這份文字當成新版本比對（可能比讀到的新），再補。回傳要寫回的文字。 */
    fill(path: string, text: string): string {
      if (texts.get(path) !== text) observe(path, text, parseDeck(text), true);
      const next = fill(path, text);
      if (next !== text) observe(path, next, parseDeck(next), false);
      return next;
    },
    /** 家長選了：回傳寫回後的文字；問題已不在、目標不在、或還原的 ID 已經在別處時回傳 null，問題保留。 */
    resolve(issue: IdIssue, choice: 'restore' | 'new', text: string): string | null {
      const path = issue.path;
      if (texts.get(path) !== text) observe(path, text, parseDeck(text), true);
      const items = pending.get(path) ?? [];
      const item = items.find(each => each.issue === issue);
      if (!item) return null;
      const target = versions.get(path)?.targets.find(t => t.line === issue.line);
      if (!target) return null;
      const own = [...(target.id ? [target.id] : []), ...(target.idCandidates ?? [])];
      let next: string | null;
      if (choice === 'restore') {
        const restore = item.issue.restore;
        if (!restore || target.implicit) return null;
        // 寫回前重新確認：原本的 ID 現在不在任何卡組（這個目標自己那一行的候選不算）。
        const bare = setTargetId(text, target.line, null);
        if (bare === null || elsewhere(path).has(restore) || presentOf(bare, parseDeck(bare)).has(restore)) return null;
        next = setTargetId(text, target.line, restore);
        if (next === null) return null;
        pending.set(path, items.filter(each => each !== item));
      } else {
        const bare = target.implicit ? text : setTargetId(text, target.line, null);
        if (bare === null) return null;
        pending.set(path, items.filter(each => each !== item));
        next = fill(path, bare);
      }
      revision++;
      // 自己寫回時拿掉的 ID（被換掉的、當成新的拿掉的候選）不算弄丟。
      for (const id of own) if (id !== item.issue.restore || choice !== 'restore') removed.add(id);
      if (item.issue.restore && choice === 'restore') seen.add(item.issue.restore);
      if (!pending.get(path)?.length) pending.delete(path);
      observe(path, next, parseDeck(next), false);
      return next;
    },
  };
}
