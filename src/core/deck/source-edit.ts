import { canRead } from '../version/index.ts';
import { expandTabs, linesOf, listTree } from './markdown.ts';
import type { Item, Line } from './markdown.ts';
import { parseDeck, readProperties } from './parse.ts';
import { readSourceParts, sourceLinks } from './sources.ts';
import type { SourceItem, SourceOwner, SourcePart } from './sources.ts';
import type { Deck, SourceFieldLayout, Span, Target, TargetLayout } from './types.ts';

// 出處的寫回（tasks/edit-markup.md §4-3）：家長在小表單按「套用」才寫，寫的是 syntax §2-5 本來就有的寫法（D-164 第 6 點）。
// 編輯的單位是讀的時候切出的原文段（§3-3 的 SourcePart），不是按鈕。只有兩種動作：換掉一段（連同接在後面、同一個單元的位置）、加一段。
// 寫之前把改動套到全文、重新讀，除了這一段，意思都要和原本一樣（第 6 點）；不一樣就不寫。

/**
 * 換掉第 part 段（layout.parts 的位置），或加一段。text 是表單會寫成的字（§4-2）；own：表單選的是「這一篇」。
 * 寫進的位置跟著別的單元時，這一篇的字前面加 `本單元`（syntax §2-5），由這裡決定。
 */
export type SourceEditAction =
  | { kind: 'replace'; part: number; text: string; own: boolean }
  | { kind: 'add'; text: string; own: boolean };
export interface SourceEditInput {
  /** 筆記全文。 */
  text: string;
  /** 目標那一行（從 0 算）。 */
  target: number;
  action: SourceEditAction;
  /** 這台讀得懂的正式版號（`releaseOf(BUILD)`）：這篇「需要新版」時不寫。 */
  version: string | null;
}
/** 要改的範圍，全文的位置；一個交易送出。 */
export interface TextChange { from: number; to: number; insert: string }
/**
 * 寫得回去：改完的全文、改動、實際寫進的那一段（加了 `本單元` 時和表單的字不同）。
 * 寫不回去：表單上的一句原因；failure 是寫進錯誤紀錄的固定代碼（核對不成立才有，預期的不寫是 null）。
 */
export type SourceEditResult =
  | { ok: true; text: string; changes: TextChange[]; written: string }
  | { ok: false; reason: string; failure: string | null };
/** 核對的計畫：這個目標沒動到的段（改之前的位置，照順序）、新的段排在它們之間的第幾個、寫進的字。 */
export interface SourceEditPlan { target: number; untouched: readonly number[]; at: number; written: string }

const REASON = {
  two: '這個目標寫了兩處「出處」，先合併成一處',
  split: '這一項分在兩行，請直接改字',
  newer: '這篇需要新版的外掛才能改',
  failed: '寫不回去，請直接改字',
} as const;
const changed = (raw: string): string => `改完之後，後面的「${raw}」會跟著改，請直接改字`;

type LaidOut = Deck & { layout: Map<number, TargetLayout> };
const ownerOf = (deck: Deck): SourceOwner => ({ term: deck.props.term, subject: deck.props.subject, unit: deck.props.unit });

/** 換掉第 index 段時一起換的段：它和接在它後面、follows 是 place 的那一串（同一個單元的位置）。 */
function chainOf(parts: readonly SourcePart[], index: number): number[] {
  const chain = [index];
  for (let at = index + 1; at < parts.length && parts[at].follows === 'place'; at++) chain.push(at);
  return chain;
}
/** 一段在檔案的位置；那一項或那一段切不出原文是 null。 */
function spanOf(layout: TargetLayout, part: SourcePart): Span | null {
  const entry = layout.entries[part.entry];
  return entry && part.from !== null && part.to !== null ? { line: entry.line, from: entry.from + part.from, to: entry.from + part.to } : null;
}

/** 打開表單時就知道的不寫原因（§4-3 第 4 點）；part 是要換掉的段，加一段是 null。可以寫是 null。 */
export function canEditSource(text: string, target: number, part: number | null, version: string | null): string | null {
  return blocked(parseDeck(text, { layout: true }), target, part, version);
}
function blocked(deck: LaidOut, target: number, part: number | null, version: string | null): string | null {
  if (deck.props.need !== null && !canRead(deck.props.need, version)) return REASON.newer;
  const layout = deck.layout.get(target);
  if (!layout) return REASON.failed;
  if (layout.fields.length >= 2) return REASON.two;
  if (layout.fields[0]?.continued) return REASON.split;
  if (part !== null) {
    if (!layout.parts[part]) return REASON.failed;
    if (chainOf(layout.parts, part).some(index => !spanOf(layout, layout.parts[index]))) return REASON.split;
  }
  return null;
}

// ── 全文與行 ──

interface Doc { text: string; lines: Line[]; starts: number[]; eol: string; tab: boolean; tree: Item[] }
function docOf(text: string): Doc {
  const lines = linesOf(text);
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) { starts.push(at); at += line.raw.length + line.eol.length; }
  // 有使用 Tab 縮排的清單或接續行時，這篇沿用 Tab（和補 ID 的改縮排相同）。
  return { text, lines, starts, eol: lines.find(line => line.eol)?.eol ?? '\n', tab: lines.some(line => /^[ \t]*\t/.test(line.raw)), tree: listTree(lines, readProperties(lines).start) };
}
const offset = (doc: Doc, line: number, column: number): number => doc.starts[line] + column;
const lineEnd = (doc: Doc, line: number): number => doc.starts[line] + doc.lines[line].raw.length;
function findItem(items: readonly Item[], line: number): Item | null {
  for (const item of items) {
    if (item.line === line) return item;
    const found = item.line < line && line < item.end ? findItem(item.children, line) : null;
    if (found) return found;
  }
  return null;
}
const MARKER = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]*)/;
/** 那一行的縮排、清單符號與後面的空白（新的一行照抄，和它同一層）。 */
const markerOf = (raw: string): string => MARKER.exec(raw)?.[0] ?? '- ';
/**
 * 那一行底下子項目的開頭（§4-3 第 3 點）：`-` 是那一項的縮排再加 4 欄，`*`、`+` 與數字清單照它自己的內容位置；換回這篇的縮排字元。
 * 子項目的清單符號和它相同，數字清單用 `-`。
 */
function childPrefix(doc: Doc, raw: string): string {
  const found = MARKER.exec(raw);
  const indent = expandTabs(found?.[1] ?? '').length, marker = found?.[2] ?? '-';
  const gap = expandTabs((found?.[1] ?? '') + marker + (found?.[3] ?? '')).length - indent - marker.length;
  const column = marker === '-' ? indent + 4 : indent + marker.length + (gap > 4 ? 1 : Math.max(1, gap));
  const space = doc.tab ? '\t'.repeat(Math.floor(column / 4)) + ' '.repeat(column % 4) : ' '.repeat(column);
  return space + (/^\d/.test(marker) ? '-' : marker) + ' ';
}
/** 在第 line 行前面加一行（line 等於行數時加在檔尾，檔尾有沒有換行照舊）。 */
function insertLine(doc: Doc, line: number, content: string): TextChange {
  if (line < doc.lines.length) return { from: doc.starts[line], to: doc.starts[line], insert: content + doc.eol };
  const last = doc.lines.at(-1);
  return { from: doc.text.length, to: doc.text.length, insert: last && !last.eol ? doc.eol + content : content + doc.eol };
}
function applyChanges(text: string, changes: readonly TextChange[]): string {
  return [...changes].sort((a, b) => b.from - a.from || b.to - a.to).reduce((out, { from, to, insert }) => out.slice(0, from) + insert + out.slice(to), text);
}
/** 前後一樣的字不算：一個範圍的改動（游標與標示跟著平移）。 */
function diff(before: string, after: string): TextChange[] {
  if (before === after) return [];
  let head = 0, tail = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return [{ from: head, to: before.length - tail, insert: after.slice(head, after.length - tail) }];
}

// ── 一欄出處的改動 ──

/** 一欄出處與它在檔案裡的樣子：field 是 null 時目標還沒有出處欄位。 */
interface Field { doc: Doc; deck: LaidOut; target: Target; layout: TargetLayout; field: SourceFieldLayout | null; node: Item | null }
function fieldOf(doc: Doc, deck: LaidOut, target: number): Field | null {
  const found = deck.targets.find(each => each.line === target), layout = deck.layout.get(target);
  if (!found || !layout) return null;
  const field = layout.fields[0] ?? null;
  return { doc, deck, target: found, layout, field, node: field ? findItem(doc.tree, field.line) : null };
}
const spanAt = (f: Field, index: number): Span | null => spanOf(f.layout, f.layout.parts[index]);
/** 當成出處值的子項目（分行的出處）。 */
const childItems = (f: Field): Item[] => f.node?.children.filter(child => f.field?.children.includes(child.line)) ?? [];
/** 那一行上有位置的段，照位置排。 */
function partsOnLine(f: Field, line: number): { index: number; span: Span }[] {
  return f.layout.parts.flatMap((_, index) => { const span = spanAt(f, index); return span?.line === line ? [{ index, span }] : []; }).sort((a, b) => a.span.from - b.span.from);
}

/** 拿掉同一行上連在一起的幾段，連同一個分隔符號；那一行只有它們、是分行的子項目時整行拿掉。 */
function removeGroup(f: Field, group: readonly number[]): TextChange[] {
  const spans = group.map(index => spanAt(f, index) as Span);
  const line = spans[0].line, onLine = partsOnLine(f, line);
  const first = Math.min(...spans.map(span => span.from)), last = Math.max(...spans.map(span => span.to));
  const next = onLine.find(each => !group.includes(each.index) && each.span.from >= last);
  const prev = [...onLine].reverse().find(each => !group.includes(each.index) && each.span.to <= first);
  if (next) return [{ from: offset(f.doc, line, first), to: offset(f.doc, line, next.span.from), insert: '' }];
  if (prev) return [{ from: offset(f.doc, line, prev.span.to), to: offset(f.doc, line, last), insert: '' }];
  const child = childItems(f).find(each => each.line === line);
  if (child) return [{ from: f.doc.starts[child.line], to: child.end < f.doc.lines.length ? f.doc.starts[child.end] : f.doc.text.length, insert: '' }];
  return [{ from: offset(f.doc, line, first), to: offset(f.doc, line, last), insert: '' }];
}
/** 幾段照所在的行分組（同一行的連在一起）。 */
function byLine(f: Field, indexes: readonly number[]): number[][] {
  const groups: number[][] = [];
  for (const index of indexes) {
    const line = (spanAt(f, index) as Span).line, group = groups.at(-1);
    if (group && (spanAt(f, group[0]) as Span).line === line) group.push(index); else groups.push([index]);
  }
  return groups;
}
/** 換掉那一串：第一行的那幾段換成新的字，其他行的拿掉。 */
function replaceChain(f: Field, chain: readonly number[], written: string): TextChange[] {
  const [head, ...rest] = byLine(f, chain);
  const spans = head.map(index => spanAt(f, index) as Span);
  const line = spans[0].line;
  return [
    { from: offset(f.doc, line, Math.min(...spans.map(span => span.from))), to: offset(f.doc, line, Math.max(...spans.map(span => span.to))), insert: written },
    ...rest.flatMap(group => removeGroup(f, group)),
  ];
}
/** 加在第 index 段前面：它是分行的子項目的第一段時多一個子項目，否則寫在同一行（頓號隔開）。 */
function insertBefore(f: Field, index: number, written: string): TextChange[] | null {
  const span = spanAt(f, index);
  if (!span) return null;
  const child = childItems(f).find(each => each.line === span.line);
  if (child && partsOnLine(f, span.line)[0]?.index === index) return [insertLine(f.doc, child.line, markerOf(f.doc.lines[child.line].raw) + written)];
  const at = offset(f.doc, span.line, span.from);
  return [{ from: at, to: at, insert: written + '、' }];
}
/** 加在最後：分行的多一個子項目；同一行的接在值後面；空的寫在冒號後面；沒有出處欄位時加一行。 */
function append(f: Field, written: string): TextChange[] {
  const { doc, field } = f;
  if (!field) return addField(f, written);
  const children = childItems(f);
  if (children.length) {
    const last = children[children.length - 1];
    return [insertLine(doc, last.end, markerOf(doc.lines[last.line].raw) + written)];
  }
  if (!field.value) { const at = offset(doc, field.colon.line, field.colon.to); return [{ from: at, to: at, insert: written }]; }
  const at = offset(doc, field.value.line, field.value.to);
  return [{ from: at, to: at, insert: (doc.text[at - 1] === '、' ? '' : '、') + written }];
}
/** 目標沒有出處欄位（§4-3 第 2 點）：在第一個子項目前面加一行，和它同一層；沒有子項目時加在目標底下。 */
function addField(f: Field, written: string): TextChange[] {
  const root = findItem(f.doc.tree, f.target.line);
  if (!root) return [];
  const first = root.children[0];
  if (first) return [insertLine(f.doc, first.line, markerOf(f.doc.lines[first.line].raw) + '出處：' + written)];
  return [insertLine(f.doc, root.end, childPrefix(f.doc, f.doc.lines[root.line].raw) + '出處：' + written)];
}

/** 連結（筆記連結、Markdown 連結、網址）。 */
const LINK = /\[\[[^\]\n]*\]\]|\[[^\]\n]*\]\([^)\n]*\)|https?:\/\//;
/**
 * 分行（§4-3 第 3 點，D-164 第 4 點）：寫在同一行、有三個以上的按鈕或有連結時，`出處：` 單獨一行，底下每一個頓號項一行（sources 的每一項，切法和讀的時候相同）。
 * 用 `｜` 接了別的欄位時只把出處那一段搬出來，放在原本那一行前面；原本那一行與它的子項目不動。不用分行是空的。
 */
function splitField(f: Field): TextChange[] {
  const { doc, field, target } = f;
  if (!field || field.continued || childItems(f).length || !field.value) return [];
  const sources = target.fields.sources;
  if (sourceLinks(sources, ownerOf(f.deck)).length < 3 && !sources.some(source => LINK.test(source))) return [];
  // 切不出原文的項（私用區字元）照舊留在同一行。
  if (f.layout.entries.some(entry => entry === null)) return [];
  const raw = doc.lines[field.line].raw, prefix = childPrefix(doc, raw);
  const children = sources.map(source => prefix + source);
  if (!field.joined) {
    return [{ from: offset(doc, field.colon.line, field.colon.to), to: lineEnd(doc, field.line), insert: children.map(child => doc.eol + child).join('') }];
  }
  // 拿掉出處那一段與一個分隔符號：後面還有欄位時拿後面的，出處在最後時拿前面的。
  const end = field.value.to;
  const after = /^\s*[｜|]\s*/.exec(raw.slice(end));
  const before = /\s*[｜|]\s*$/.exec(raw.slice(0, field.name.from));
  const cut = after ? { from: field.name.from, to: end + after[0].length } : before ? { from: field.name.from - before[0].length, to: end } : null;
  if (!cut) return [];
  return [
    { from: offset(doc, field.line, cut.from), to: offset(doc, field.line, cut.to), insert: '' },
    insertLine(doc, field.line, [markerOf(raw) + '出處：', ...children].join(doc.eol)),
  ];
}

/** 一種寫法：要改的範圍、核對的計畫、動作的名稱（錯誤紀錄用）。 */
interface Attempt { changes: TextChange[]; plan: SourceEditPlan; label: string }
/** 寫在第 at 段的位置（at 是新的段排在沒動到的段之間的第幾個）時，前面那一段讀完跟著哪個單元。 */
function prefixed(text: string, own: boolean, parts: readonly SourcePart[], previous: number | undefined): string {
  return own && previous !== undefined && parts[previous].scope !== 'this' ? '本單元 ' + text : text;
}
function attempts(f: Field, action: SourceEditAction): Attempt[] | null {
  const parts = f.layout.parts, all = parts.map((_, index) => index), target = f.target.line;
  if (action.kind === 'replace') {
    const chain = chainOf(parts, action.part), untouched = all.filter(index => !chain.includes(index));
    const at = untouched.filter(index => index < action.part).length;
    const here = prefixed(action.text, action.own, parts, action.part > 0 ? action.part - 1 : undefined);
    const list: Attempt[] = [{ changes: replaceChain(f, chain, here), plan: { target, untouched, at, written: here }, label: '換' }];
    // 寫在原地之後，後面別的段的讀法會變（例如換成別的單元，後面還有本來跟著這一篇的位置）：搬到這一欄最後（D-164 第 5 點）。
    if (chain[chain.length - 1] < parts.length - 1) {
      const moved = prefixed(action.text, action.own, parts, untouched.at(-1));
      const removed = byLine(f, chain).flatMap(group => removeGroup(f, group));
      list.push({ changes: [...removed, ...append(f, moved)], plan: { target, untouched, at: untouched.length, written: moved }, label: '搬' });
    }
    return list;
  }
  // 加一段：這一篇的加在第一個跟著別的單元的段前面（這一篇的先寫），別的單元加在最後。
  const first = action.own ? parts.findIndex(part => part.scope !== 'this') : -1;
  const at = first < 0 ? parts.length : first;
  const written = prefixed(action.text, action.own, parts, at > 0 ? at - 1 : undefined);
  const changes = at < parts.length ? insertBefore(f, at, written) : append(f, written);
  if (!changes) return null;
  return [{ changes, plan: { target, untouched: all, at, written }, label: '加' }];
}

/** 寫回一欄出處（§4-3）：照第 4 點不寫、照第 6 點核對；成立才回傳改動。 */
export function editSource(input: SourceEditInput): SourceEditResult {
  const deck = parseDeck(input.text, { layout: true });
  const reason = blocked(deck, input.target, input.action.kind === 'replace' ? input.action.part : null, input.version);
  if (reason) return { ok: false, reason, failure: null };
  const doc = docOf(input.text);
  const f = fieldOf(doc, deck, input.target);
  const list = f && attempts(f, input.action);
  if (!f || !list) return { ok: false, reason: REASON.split, failure: null };
  let first: { reason: string; failure: string | null } | null = null;
  for (const { changes, plan, label } of list) {
    let text = applyChanges(input.text, changes), name = label;
    // 寫完之後才知道要不要分行：用改完的字重新讀那一欄。讀過的結果直接拿去核對，不再讀一次（表單每打一個字就核對）。
    let now = parseDeck(text, { layout: true });
    const again = fieldOf(docOf(text), now, input.target);
    const split = again ? splitField(again) : [];
    if (split.length) { text = applyChanges(text, split); name += '+分行'; now = parseDeck(text, { layout: true }); }
    const found = verifyParsed(deck, now, plan);
    if (!found) return { ok: true, text, changes: diff(input.text, text), written: plan.written };
    const tagged = found.failure === null ? found : { ...found, failure: `${found.failure} action:${name} line:${input.target} part:${input.action.kind === 'replace' ? input.action.part : 'new'}` };
    first ??= tagged;
    // 原地寫會改到別段時才試搬到最後；其他原因搬了也一樣。
    if (found.failure !== null) break;
  }
  return { ok: false, ...(first ?? { reason: REASON.failed, failure: 'verify:none' }) };
}

// ── 寫之前核對（§4-3 第 6 點，回報 R1、R7）──

/** 一項的讀法：remark 可以變（同一欄有沒有讀懂別的，只影響提示）。 */
const meaning = ({ remark: _remark, ...item }: SourceItem): Omit<SourceItem, 'remark'> => item;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** 目標的意思，出處以外：行號除外，題目照完整內容比。 */
function targetMeaning({ line: _line, fields: { sources: _sources, ...fields }, prompts, ...rest }: Target): unknown {
  return { ...rest, fields, prompts: prompts.map(({ line: _at, ...prompt }) => prompt) };
}
/** 一段的原文（去掉前後空白）；切不出原文的用讀出的字。 */
const rawOf = (target: Target, part: SourcePart): string =>
  part.from !== null && part.to !== null ? target.fields.sources[part.entry].slice(part.from, part.to).trim() : part.items.map(item => item.text).join(' ');

/**
 * 核對改完的全文（§4-3 第 6 點）：屬性、每個目標（出處以外）、別的目標的出處按鈕、問題都和原本一樣；
 * 這個目標沒動到的段原文與讀法照原本的順序一字不差，新的段讀出來和單獨讀它時一樣、沒有問題、不是舊標題。成立是 null。
 */
export function verifySourceEdit(before: string, after: string, plan: SourceEditPlan): { reason: string; failure: string | null } | null {
  return verifyParsed(parseDeck(before, { layout: true }), parseDeck(after, { layout: true }), plan);
}
function verifyParsed(old: LaidOut, now: LaidOut, plan: SourceEditPlan): { reason: string; failure: string | null } | null {
  const fail = (code: string): { reason: string; failure: string } => ({ reason: REASON.failed, failure: 'verify:' + code });
  if (!same(old.props, now.props)) return fail('props');
  if (old.targets.length !== now.targets.length) return fail('targets');
  const index = old.targets.findIndex(target => target.line === plan.target);
  if (index < 0) return fail('target');
  const own = ownerOf(old);
  for (const [at, target] of old.targets.entries()) {
    const next = now.targets[at];
    if (!same(targetMeaning(target), targetMeaning(next))) return fail('target:' + at);
    if (at !== index && !same(sourceLinks(target.fields.sources, own), sourceLinks(next.fields.sources, own))) return fail('sources:' + at);
  }
  // 問題：行號會因為插行改變，照所屬的目標與內容比。
  const problems = (deck: Deck): unknown[] => deck.problems.map(({ line: _line, columns: _columns, targetLine, ...problem }) => ({ ...problem, target: deck.targets.findIndex(target => target.line === targetLine) }));
  if (!same(problems(old), problems(now))) return fail('problems');

  const target = old.targets[index], next = now.targets[index];
  const oldParts = old.layout.get(target.line)?.parts ?? [], newParts = now.layout.get(next.line)?.parts ?? [];
  const added = newParts.length - plan.untouched.length;
  if (added < 1) return fail('count');
  for (const [k, oldIndex] of plan.untouched.entries()) {
    const was = oldParts[oldIndex], is = newParts[k < plan.at ? k : k + added];
    if (rawOf(target, was) !== rawOf(next, is) || !same(was.items.map(meaning), is.items.map(meaning))) return { reason: changed(rawOf(target, was)), failure: null };
  }
  const items = newParts.slice(plan.at, plan.at + added).flatMap(part => part.items);
  if (items.some(item => item.problem || item.link.kind === 'heading' || item.link.kind === 'text')) return fail('new');
  if (!same(items.map(meaning), readSourceParts([plan.written], own).flatMap(part => part.items).map(meaning))) return fail('new-context');
  return null;
}
