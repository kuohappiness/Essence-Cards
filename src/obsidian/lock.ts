import { EditorSelection, EditorState, StateField } from '@codemirror/state';
import type { ChangeSpec, Extension, Text, Transaction } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';

// 鎖住學習目標的 ID（W5 §8-6、D-134）：電腦版編輯器裡，目標那一行行尾的 ` ^id` 顯示成一個小而淡的標記，
// 一般編輯碰不到它。這個檔不 import obsidian，在 Node 用 @codemirror/state 直接測；Obsidian 的接線在 main.ts。
// 核心的解析不能從這裡 import（D-110 的邊界），所以判斷用簡化的規則：最上層的清單項目、行尾的區塊 ID，
// 屬性區與圍欄裡的不算。和 parseDeck 的對照在 tests/lock.test.ts。

const TRAILING = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;
const ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DIVIDER = /^ {0,3}(?:`{3,}|~{3,}|---)/m;
// 貼進名稱中間的程式格式 ID（D-134 的行中候選）：不能讓一行有兩個 ID。
const MIDDLE = /[ \t]+\^[abcdefghjkmnpqrstuvwxyz23456789]{6}(?![A-Za-z0-9-])/g;

/** 一個被鎖住的 ID：[from, to) 是 ID 連同前面的空白到行尾；contentFrom 是名稱的開頭（清單符號之後）。 */
export interface IdToken { id: string; from: number; to: number; lineFrom: number; contentFrom: number }
interface Scan { tokens: IdToken[]; /** 屬性區與最上層圍欄：裡面的行不鎖。 */ blocked: { from: number; to: number }[] }
/** 不是卡組筆記：不鎖。 */
const OFF: Scan = { tokens: [], blocked: [] };

/** 最上層的清單項目、名稱之後有行尾的區塊 ID 時，回傳它相對行首的位置。 */
function tokenOf(text: string): { id: string; start: number; content: number } | null {
  const item = ITEM.exec(text);
  const trail = item && TRAILING.exec(text);
  // ID 前面的空白要在名稱之後：`- ^abc` 沒有名稱，parseDeck 不當成 ID。
  if (!item || !trail || trail.index < item[0].length) return null;
  return { id: trail[1], start: trail.index, content: item[0].length };
}
function token(line: { from: number; to: number; text: string }): IdToken | null {
  const found = tokenOf(line.text);
  return found && { id: found.id, from: line.from + found.start, to: line.to, lineFrom: line.from, contentFrom: line.from + found.content };
}

/** 整篇掃一次（只在打開、或改到圍欄與屬性區的分隔行時）；一般的輸入只重掃改到的行（rescan）。 */
function scan(doc: Text): Scan {
  const tokens: IdToken[] = [], blocked: Scan['blocked'] = [];
  let first = 1;
  if (doc.lines > 1 && /^﻿?---\s*$/.test(doc.line(1).text)) {
    // 屬性區要有結束的 ---；沒有結束時 Obsidian 當成一般文字（D-135）。
    for (let i = 2; i <= doc.lines; i++) if (/^---\s*$/.test(doc.line(i).text)) { blocked.push({ from: 0, to: doc.line(i).to }); first = i + 1; break; }
  }
  let fence: { char: string; count: number; from: number } | null = null;
  for (let i = first; i <= doc.lines; i++) {
    const line = doc.line(i);
    const open = FENCE.exec(line.text);
    if (fence) {
      if (open && open[1][0] === fence.char && open[1].length >= fence.count && !line.text.slice(open[0].length).trim()) {
        blocked.push({ from: fence.from, to: line.to });
        fence = null;
      }
      continue;
    }
    if (open) { fence = { char: open[1][0], count: open[1].length, from: line.from }; continue; }
    const found = token(line);
    if (found) tokens.push(found);
  }
  if (fence) blocked.push({ from: fence.from, to: doc.length });
  return { tokens, blocked };
}
/** 測試用：文件裡被鎖住的 ID。 */
export function scanTokens(doc: Text): IdToken[] { return scan(doc).tokens; }

/** 改到的行重掃，其他的照位置平移；改到圍欄或屬性區的分隔行、或改到屬性區裡面時整篇重掃。 */
function rescan(value: Scan, tr: Transaction): Scan {
  const before = tr.startState.doc, after = tr.newDoc;
  const ranges: { fromA: number; toA: number; fromB: number; toB: number }[] = [];
  let full = false;
  tr.changes.iterChanges((fromA, toA, fromB, toB) => {
    const a = { from: before.lineAt(fromA).from, to: before.lineAt(toA).to };
    const b = { from: after.lineAt(fromB).from, to: after.lineAt(toB).to };
    if (DIVIDER.test(before.sliceString(a.from, a.to)) || DIVIDER.test(after.sliceString(b.from, b.to))) full = true;
    if (value.blocked.some(range => range.from === 0 && a.from <= range.to)) full = true;
    ranges.push({ fromA: a.from, toA: a.to, fromB: b.from, toB: b.to });
  });
  if (full) return scan(after);
  const map = (pos: number, assoc = -1): number => tr.changes.mapPos(pos, assoc);
  const blocked = value.blocked.map(range => ({ from: map(range.from, 1), to: map(range.to) }));
  const tokens = value.tokens.filter(t => !ranges.some(r => t.lineFrom <= r.toA && t.to >= r.fromA))
    .map(t => ({ id: t.id, from: map(t.from), to: map(t.to), lineFrom: map(t.lineFrom), contentFrom: map(t.contentFrom) }));
  for (const r of ranges) {
    for (let pos = r.fromB; pos <= r.toB;) {
      const line = after.lineAt(pos);
      const found = blocked.some(range => line.from >= range.from && line.from <= range.to) ? null : token(line);
      if (found && !tokens.some(t => t.lineFrom === line.from)) tokens.push(found);
      pos = line.to + 1;
    }
  }
  tokens.sort((a, b) => a.from - b.from);
  return { tokens, blocked };
}

class IdWidget extends WidgetType {
  readonly id: string;
  constructor(id: string) { super(); this.id = id; }
  eq(other: IdWidget): boolean { return other.id === this.id; }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'essence-cards-id';
    span.textContent = 'ID';
    span.title = '學習目標的編號，由程式自動管理';
    span.setAttribute('aria-label', span.title);
    return span;
  }
}
const decorationCache = new WeakMap<Scan, DecorationSet>();
function decorations(value: Scan): DecorationSet {
  let set = decorationCache.get(value);
  if (!set) {
    set = Decoration.set(value.tokens.map(t => Decoration.replace({ widget: new IdWidget(t.id) }).range(t.from, t.to)));
    decorationCache.set(value, set);
  }
  return set;
}

/** 交易碰到這個 ID 那一行（含行首與行尾的換行）。 */
const touches = (tr: Transaction, t: IdToken): boolean => tr.changes.touchesRange(t.lineFrom, t.to) !== false;

/**
 * 使用者的編輯之後，每一個被碰到的 ID 該在哪裡（W5 §8-6）。回傳要接在原交易之後的修改（新文件的位置）。
 * - 整個刪掉就讓它走：跨行的刪除整段蓋過它（刪掉或剪下整個目標、跨兩個目標刪掉一段、全選取代）、
 *   同一行被換成另一個帶 ID 的目標行、連同清單符號整行清空。
 * - 其他情況 ID 留在原本那個目標名稱所在那一行的最後：打進 ID 裡或後面的字移到 ID 前面、Enter 之後 ID 留在原本那一行、
 *   刪到 ID 或它前面空白的字不刪。
 * - 同一行剩兩個 ID 時，留下行尾那個（它的目標還有內容），另一個讓它走；貼進名稱中間或行尾的別的 ID 拿掉。
 * 不事後補回已經整個刪掉的目標。
 */
function repair(tr: Transaction, touched: readonly IdToken[]): ChangeSpec[] {
  const doc = tr.newDoc, old = tr.startState.doc;
  const changes: { fromA: number; toA: number; fromB: number; toB: number; text: string }[] = [];
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => { changes.push({ fromA, toA, fromB, toB, text: inserted.toString() }); });
  const deleted = (pos: number): boolean => changes.some(c => c.fromA <= pos && pos < c.toA);
  interface Kept { token: IdToken; line: number; runs: [number, number][] }
  const kept: Kept[] = [];
  for (const token of touched) {
    const alive: number[] = [];
    for (let pos = token.from; pos < token.to; pos++) if (!deleted(pos)) alive.push(tr.changes.mapPos(pos, 1));
    if (!alive.length) {
      const cover = changes.find(c => c.fromA <= token.from && token.to <= c.toA);
      const gone = cover && (old.sliceString(cover.fromA, cover.toA).includes('\n')
        || cover.text.split(/\r?\n/).some(line => tokenOf(line))
        || (!cover.text && cover.fromA < token.contentFrom));
      if (gone) continue;
    }
    const runs: [number, number][] = [];
    for (const pos of alive) {
      const last = runs.at(-1);
      if (last && last[1] === pos) last[1] = pos + 1; else runs.push([pos, pos + 1]);
    }
    // ID 原樣還在某個有名稱的目標行最後（例如名稱中間按 Enter、貼回剪下的一段），就留在那裡；
    // 否則回到原本名稱所在的那一行（名稱最後按 Enter 時，新的一行沒有名稱）。
    let line = doc.lineAt(tr.changes.mapPos(token.contentFrom, -1)).number;
    if (runs.length === 1 && runs[0][1] - runs[0][0] === token.to - token.from) {
      const at = doc.lineAt(runs[0][0]);
      const found = tokenOf(at.text);
      if (found?.id === token.id && at.from + found.start === runs[0][0]) line = at.number;
    }
    kept.push({ token, line, runs });
  }
  const out: { from: number; to: number; insert: string }[] = [];
  const add = (from: number, to: number, insert = ''): void => { out.push({ from, to, insert }); };
  /** 這個 ID 一個字都沒少、在那一行的最後。 */
  const atEnd = (k: Kept): boolean => {
    const line = doc.line(k.line);
    const trail = TRAILING.exec(line.text);
    return k.runs.length === 1 && !!trail && trail[1] === k.token.id && line.from + trail.index === k.runs[0][0]
      && k.runs[0][1] - k.runs[0][0] === k.token.to - k.token.from;
  };
  const groups = new Map<number, Kept[]>();
  for (const k of kept) groups.set(k.line, [...groups.get(k.line) ?? [], k]);
  for (const [number, group] of groups) {
    const winner = group.find(atEnd) ?? group[0];
    for (const k of group) if (k !== winner) for (const [from, to] of k.runs) add(from, to);
    if (atEnd(winner)) continue;
    const line = doc.line(number);
    const trail = TRAILING.exec(line.text);
    const trailFrom = trail ? line.from + trail.index : -1;
    // 行尾是別的 ID（貼上的）時一起換掉。
    const foreign = trail && !winner.runs.some(([from, to]) => from < line.to && to > trailFrom);
    const tail = winner.runs.find(([, to]) => to === line.to);
    for (const run of winner.runs) if (run !== tail) add(run[0], run[1]);
    const insert = ' ^' + winner.token.id;
    if (tail) add(foreign ? Math.min(trailFrom, tail[0]) : tail[0], line.to, insert);
    else if (foreign) add(trailFrom, line.to, insert);
    else add(line.to, line.to, insert);
  }
  // 貼進目標名稱中間的程式格式 ID 拿掉（原本的那個還在別處）。
  for (const c of changes) {
    if (!c.text) continue;
    for (let pos = c.fromB; pos <= c.toB;) {
      const line = doc.lineAt(pos);
      if (ITEM.test(line.text)) {
        const trail = TRAILING.exec(line.text);
        const limit = trail ? trail.index : line.text.length;
        for (const match of line.text.matchAll(MIDDLE)) {
          const from = line.from + match.index, to = from + match[0].length;
          if (match.index < limit && from < c.toB && to > c.fromB) add(from, to);
        }
      }
      pos = line.to + 1;
    }
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** 停在某個 ID 後面（行尾）的游標，移到那個 ID 前面（名稱最後）。 */
function park(selection: EditorSelection, tokens: readonly IdToken[]): EditorSelection | null {
  let changed = false;
  const ranges = selection.ranges.map(range => {
    const token = range.empty ? tokens.find(t => t.to === range.head) : undefined;
    if (!token) return range;
    changed = true;
    return EditorSelection.cursor(token.from, -1);
  });
  return changed ? EditorSelection.create(ranges, selection.mainIndex) : null;
}

export interface LockOptions {
  /** 這個編輯器開的是不是卡組筆記（Obsidian 用 editorInfoField 的 file 判斷）。 */
  isDeck: (state: EditorState) => boolean;
  /** 使用者的編輯讓這些 ID 從筆記裡消失了（刪掉或剪下整個目標、Undo 掉補上的 ID、全選取代）。 */
  onRemoved: (state: EditorState, ids: string[]) => void;
  /** 使用者的編輯讓這些 ID 回到筆記裡（Redo、貼回剪下的目標）：之後再弄丟就照常算。 */
  onRestored?: (state: EditorState, ids: string[]) => void;
}
const present = (text: string, id: string): boolean => new RegExp('(?:^|[ \\t])\\^' + id + '(?![A-Za-z0-9-])', 'm').test(text);

/** 使用者自己的編輯；Undo／Redo 照常，不調整；沒有標記的交易（外部改檔後重新載入、其他外掛）不碰。 */
const isEdit = (tr: Transaction): boolean => tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('move');
const isHistory = (tr: Transaction): boolean => tr.isUserEvent('undo') || tr.isUserEvent('redo');

/** 編輯器的鎖定：extension 用 registerEditorExtension 裝上（只在電腦）；tokens 是目前被鎖住的 ID（測試與開發命令用）。 */
export function idLock(options: LockOptions): { extension: Extension; tokens: (state: EditorState) => IdToken[] } {
  const field = StateField.define<Scan>({
    create: state => options.isDeck(state) ? scan(state.doc) : OFF,
    update(value, tr) {
      if (!options.isDeck(tr.state)) return OFF;
      if (value === OFF) return scan(tr.state.doc);
      return tr.docChanged ? rescan(value, tr) : value;
    },
    provide: f => [
      EditorView.decorations.from(f, decorations),
      // 游標左右移動時跳過整個標記。
      EditorView.atomicRanges.of(view => decorations(view.state.field(f))),
    ],
  });
  const filter = EditorState.transactionFilter.of(tr => {
    if (!options.isDeck(tr.startState)) return tr;
    const before = tr.startState.field(field).tokens;
    if (!tr.docChanged) {
      // 游標不停在 ID 後面：打字、中文組字、Backspace 都發生在 ID 前面。
      const moved = tr.selection && before.length ? park(tr.selection, before) : null;
      return moved ? [tr, { selection: moved, sequential: true }] : tr;
    }
    if (!isEdit(tr)) return tr;
    const fix = repair(tr, before.filter(t => touches(tr, t)));
    return fix.length ? [tr, { changes: fix, sequential: true }] : tr;
  });
  // 回報拿掉與補回的 ID：Undo／Redo 的交易關掉了 transactionFilter（CodeMirror 的 history 用 filter: false），
  // transactionExtender 仍然會跑，而且看到的是調整之後的整筆交易。
  // filter 改過的交易，CodeMirror 會對同一筆交易套兩次 extender：記住報過的。
  const reported = new WeakSet<Transaction>();
  const report = EditorState.transactionExtender.of(tr => {
    if (reported.has(tr)) return null;
    reported.add(tr);
    if (!tr.docChanged || !(isEdit(tr) || isHistory(tr)) || !options.isDeck(tr.startState)) return null;
    const touched = tr.startState.field(field).tokens.filter(t => touches(tr, t));
    const inserted: string[] = [];
    tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, text) => { if (text.length) inserted.push(text.toString()); });
    const back = [...new Set(inserted.flatMap(text => [...text.matchAll(/[ \t]\^([A-Za-z0-9-]+)[ \t]*(?=\r?\n|$)/gm)].map(m => m[1])))];
    if (!touched.length && !back.length) return null;
    const text = tr.newDoc.toString();
    const removed = [...new Set(touched.map(t => t.id))].filter(id => !present(text, id));
    if (removed.length) options.onRemoved(tr.startState, removed);
    const startText = back.length ? tr.startState.doc.toString() : '';
    const restored = back.filter(id => present(text, id) && !present(startText, id));
    if (restored.length) options.onRestored?.(tr.startState, restored);
    return null;
  });
  return { extension: [field, filter, report], tokens: state => state.field(field, false)?.tokens ?? [] };
}
