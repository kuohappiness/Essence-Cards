import { StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Extension, Range, Text, Transaction } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { fieldFixes, parseDeck } from '../core/deck/index.ts';
import type { Deck, FieldFix, Problem, Span, TargetLayout } from '../core/deck/index.ts';

// 編輯畫面標示卡組結構（D-047、D-089 第 10、11 條，tasks/edit-markup.md §1）：學習目標那一行左邊一條細線、題目的 `::` 變淡紫、
// 問題畫波浪線（紅色這題不會出、橘色照常出）。只在電腦版的編輯器、只在卡組筆記；判斷全部來自 parseDeck，不另寫一份規則。
// 這個檔不 import obsidian，在 Node 用 @codemirror/state 直接測；Obsidian 的接線在 main.ts。

/**
 * 一個標示：target 是那一行（from 是行首、to 等於 from）；separator 是題目的 `::`；error、hint 是問題的波浪線，tip 是滑過的說明；
 * source 是看不懂的出處（§1-3），點了打開表單；fix 是出處的欄位名稱寫錯或資料欄位的半形冒號（§1-4），點了問一句。
 */
export interface Mark { kind: 'target' | 'separator' | 'error' | 'hint' | 'source' | 'fix'; from: number; to: number; tip?: string }
/** 看不懂的出處的一段（§1-3）：line 是目標那一行；at 是那一段在檔案的位置，切不出原文時是 null（畫那一欄出處的第一行）。 */
export interface SourceHit { line: number; at: Span | null; tip: string }
type LaidOut = Deck & { layout: Map<number, TargetLayout> };

const MARKER = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]*/;
const TRAILING_ID = /[ \t]+\^[A-Za-z0-9-]+[ \t]*$/;
/** 不標的問題：ID 不在行尾（存檔時自動移回，家長不用做事）；屬性區的問題（targetLine 是 null）標不上，存檔按鈕已經提示（§1-1）。 */
const skipped = (problem: Problem): boolean => problem.code === 'misplaced-id' || problem.targetLine === null;

/** 題目那一行的 `::`：要和 parseDeck 讀到的題目一致（開頭到它去掉空白就是題目），寫在接續行的不標。 */
function separatorAt(body: string, question: string): number {
  for (let at = body.indexOf('::'); at >= 0; at = body.indexOf('::', at + 1)) if (body.slice(0, at).trim() === question) return at;
  return -1;
}

/** 這一篇要畫的標示（看不懂的出處另外算），照位置排好。 */
function marksOf(doc: Text, deck: Deck): Mark[] {
  const marks: Mark[] = [];
  const line = (index: number) => index + 1 <= doc.lines ? doc.line(index + 1) : null;
  for (const target of deck.targets) {
    const head = line(target.line);
    if (head) marks.push({ kind: 'target', from: head.from, to: head.from });
    for (const prompt of target.prompts) {
      if (prompt.kind !== 'qa') continue;
      const at = line(prompt.line);
      if (!at) continue;
      const offset = MARKER.exec(at.text)?.[0].length ?? 0;
      const colon = separatorAt(at.text.slice(offset), prompt.question);
      if (colon >= 0) marks.push({ kind: 'separator', from: at.from + offset + colon, to: at.from + offset + colon + 2 });
    }
  }
  // 同一段有好幾個問題時畫一條：有 error 就是紅的，說明一行一句。
  const problems = new Map<string, Mark>();
  for (const problem of deck.problems) {
    if (skipped(problem)) continue;
    const at = line(problem.columns?.line ?? problem.line);
    if (!at) continue;
    // 有欄位的位置時只畫那一段（§1-2）；沒有時畫那一項第一行的內容，不含清單符號與行尾的 ID。
    const start = MARKER.exec(at.text)?.[0].length ?? at.text.length - at.text.trimStart().length;
    const trail = TRAILING_ID.exec(at.text);
    const from = at.from + (problem.columns?.from ?? start);
    const to = at.from + (problem.columns?.to ?? (trail ? trail.index : at.text.trimEnd().length));
    if (from >= to) continue;
    const key = from + ':' + to;
    const found = problems.get(key);
    if (!found) problems.set(key, { kind: problem.level, from, to, tip: problem.message });
    else {
      if (problem.level === 'error') found.kind = 'error';
      if (!found.tip?.split('\n').includes(problem.message)) found.tip += '\n' + problem.message;
    }
  }
  marks.push(...problems.values());
  return marks.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** 看不懂的出處的標示（§1-3）：有位置畫那一段；沒有時畫那一欄出處第一行的內容（不含清單符號與行尾的 ID）。 */
function sourceMarks<H extends SourceHit>(doc: Text, deck: LaidOut, hits: readonly H[]): (Mark & { hit: H })[] {
  return hits.flatMap(hit => {
    const span = hit.at ?? fieldLine(doc, deck.layout.get(hit.line)?.fields[0]?.line);
    if (!span || span.line + 1 > doc.lines) return [];
    const at = doc.line(span.line + 1);
    if (span.to > at.length || span.from >= span.to) return [];
    return [{ kind: 'source' as const, from: at.from + span.from, to: at.from + span.to, tip: hit.tip, hit }];
  });
}
/** §1-4 的標示：欄位名稱寫錯畫那一項第一行的內容，半形冒號畫名稱加冒號（跨行時各畫一段）。 */
function fixMarks(doc: Text, fixes: readonly FieldFix[]): (Mark & { fix: FieldFix })[] {
  return fixes.flatMap(fix => fix.spans.flatMap(span => {
    if (span.line + 1 > doc.lines) return [];
    const at = doc.line(span.line + 1);
    return span.to <= at.length && span.from < span.to ? [{ kind: 'fix' as const, from: at.from + span.from, to: at.from + span.to, tip: fix.tip, fix }] : [];
  }));
}
function fieldLine(doc: Text, index: number | undefined): Span | null {
  if (index === undefined || index + 1 > doc.lines) return null;
  const text = doc.line(index + 1).text, trail = TRAILING_ID.exec(text);
  return { line: index, from: MARKER.exec(text)?.[0].length ?? 0, to: trail ? trail.index : text.trimEnd().length };
}

const CLASSES: Record<Mark['kind'], string> = {
  target: 'essence-cards-target', separator: 'essence-cards-separator', error: 'essence-cards-error', hint: 'essence-cards-hint', source: 'essence-cards-source',
  fix: 'essence-cards-fix',
};
const KINDS = new Map(Object.entries(CLASSES).map(([kind, name]) => [name, kind as Mark['kind']]));
const targetLine = Decoration.line({ class: CLASSES.target });
const separator = Decoration.mark({ class: CLASSES.separator });

function decorate(marks: readonly (Mark & { hit?: SourceHit; fix?: FieldFix })[]): DecorationSet {
  const ranges: Range<Decoration>[] = marks.map(mark => {
    if (mark.kind === 'target') return targetLine.range(mark.from);
    if (mark.kind === 'separator') return separator.range(mark.from, mark.to);
    // aria-label：Obsidian 滑過時顯示的說明（§1-1）。看不懂的出處、§1-4 的寫法把那一段帶在 spec 裡，點了用它開表單或面板。
    return Decoration.mark({ class: CLASSES[mark.kind], attributes: { 'aria-label': mark.tip ?? '' }, ...(mark.hit ? { hit: mark.hit } : {}), ...(mark.fix ? { fix: mark.fix } : {}) }).range(mark.from, mark.to);
  });
  return Decoration.set(ranges, true);
}

/** 停止打字多久之後重新解析（§1-5）。 */
const REPARSE_DELAY = 250;
/** 使用者自己的編輯（含 Undo／Redo）：標示先跟著平移，停下來才重新解析；其他交易（打開別的檔、外部改檔後重新載入）馬上重算。 */
const isEdit = (tr: Transaction): boolean => ['input', 'delete', 'move', 'undo', 'redo'].some(event => tr.isUserEvent(event));

export interface MarkupOptions<H extends SourceHit = SourceHit> {
  /** 這個編輯器開的是不是卡組筆記（和 ID 鎖定同一個判斷，main.ts 的 lockable）。 */
  isDeck: (state: EditorState) => boolean;
  /** 點了「填出處」的圖示（§2 第 2 點）：出處欄位那一行（從 1 算）。沒給就不畫圖示。 */
  onAdd?: (view: EditorView, line: number) => void;
  /** 使用者改到筆記：開著的表單要關掉（§2 第 1 點）。 */
  onEdit?: () => void;
  /** 看不懂的出處（§1-3）：要看材料與目錄，由 main.ts 給。沒給就不標。 */
  unreadable?: (state: EditorState, deck: LaidOut) => readonly H[];
  /** 點了看不懂的出處：那一段與它在文件裡的開頭（§2 第 1 點）。 */
  onSource?: (view: EditorView, hit: H, from: number) => void;
  /** 點了 §1-4 的標示：那一處與它在文件裡的開頭（問一句的面板）。沒給就不標。 */
  onFix?: (view: EditorView, fix: FieldFix, from: number) => void;
  /** 欄位名稱寫錯的那一項，後面的字要看目錄與材料才知道讀不讀得懂（§1-4：每一段都沒有 §1-3 的問題）；由 main.ts 給，沒給當作讀得懂。 */
  readable?: (state: EditorState, deck: LaidOut, sources: readonly string[]) => boolean;
}

// ── 「填出處」的圖示（§2 第 2 點）──
// 哪一行是出處欄位：用解析記下的出處欄位（§3 的 layout.fields），欄位那一行、名稱、冒號、值所在的行與分行的子項目都算。
// 每次移動游標都要判斷，不重新解析：記下那幾行的行首，改字時跟著平移，停下來重新解析時重算。

/** 一個出處欄位：anchor 是欄位那一行的行首，lines 是算在這個欄位裡的每一行的行首。 */
interface FieldLines { anchor: number; lines: number[] }
function fieldLinesOf(doc: Text, deck: LaidOut): FieldLines[] {
  const start = (index: number): number | null => index + 1 <= doc.lines ? doc.line(index + 1).from : null;
  return [...deck.layout.values()].flatMap(layout => layout.fields.flatMap(field => {
    const anchor = start(field.line);
    if (anchor === null) return [];
    const indexes = [field.line, field.name.line, field.colon.line, ...(field.value ? [field.value.line] : []), ...field.children];
    return [{ anchor, lines: [...new Set(indexes)].flatMap(index => start(index) ?? []) }];
  }));
}

class AddWidget extends WidgetType {
  readonly line: number;
  readonly onAdd: (view: EditorView, line: number) => void;
  constructor(line: number, onAdd: (view: EditorView, line: number) => void) { super(); this.line = line; this.onAdd = onAdd; }
  eq(other: AddWidget): boolean { return other.line === this.line; }
  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button');
    button.className = 'essence-cards-add';
    button.type = 'button';
    button.setAttribute('aria-label', '填出處');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.innerHTML = '<rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.5"/><path d="M8 5.25v5.5M5.25 8h5.5"/>';
    button.append(svg);
    // 按下去不移動游標（§2 第 2 點）。
    button.addEventListener('mousedown', event => { event.preventDefault(); });
    button.addEventListener('click', event => { event.preventDefault(); this.onAdd(view, this.line); });
    return button;
  }
  ignoreEvent(): boolean { return true; }
}

/** 游標所在的目標（§2 第 3 點）：目標那一行到它的最後一個子項目（下一個頂格的非空白行之前）；line 從 1 算。 */
export function targetAt(doc: Text, deck: Deck, line: number): Deck['targets'][number] | null {
  const target = [...deck.targets].reverse().find(each => each.line + 1 <= line);
  if (!target) return null;
  for (let at = target.line + 2; at <= line; at++) {
    const text = doc.line(at).text;
    if (text.trim() && !/^[ \t]/.test(text)) return null;
  }
  return target;
}

/**
 * 編輯器的標示：extension 用 registerEditorExtension 裝上（只在電腦）；marks 是目前畫的標示，refresh 是馬上重新解析的 effect，
 * icon 是「填出處」圖示所在的那一行（從 1 算，沒有是 null）：測試與開發命令用。sourceAt：pos 在看不懂的出處上時是那一段（命令「填出處」用）；
 * fixAt：pos 在 §1-4 的標示上時是那一處（測試與開發命令用）。
 */
export interface Markup<H extends SourceHit = SourceHit> {
  extension: Extension;
  marks: (state: EditorState) => Mark[];
  refresh: StateEffect<null>;
  icon: (state: EditorState) => number | null;
  sourceAt: (state: EditorState, pos: number) => { hit: H; from: number } | null;
  fixAt: (state: EditorState, pos: number) => { fix: FieldFix; from: number } | null;
}
export function markup<H extends SourceHit = SourceHit>(options: MarkupOptions<H>): Markup<H> {
  const reparse = StateEffect.define<null>();
  interface Built { set: DecorationSet; fields: FieldLines[] }
  const none: Built = { set: Decoration.none, fields: [] };
  const build = (state: EditorState): Built => {
    if (!options.isDeck(state)) return none;
    const text = state.doc.toString();
    const deck = parseDeck(text, { layout: true });
    const sources = options.unreadable ? sourceMarks(state.doc, deck, options.unreadable(state, deck)) : [];
    const fixes = options.onFix ? fixMarks(state.doc, fieldFixes(text, deck).filter(fix => fix.kind !== 'rename' || (options.readable?.(state, deck, fix.sources) ?? true))) : [];
    return { set: decorate([...marksOf(state.doc, deck), ...sources, ...fixes].sort((a, b) => a.from - b.from || a.to - b.to)), fields: fieldLinesOf(state.doc, deck) };
  };
  const field = StateField.define<Built>({
    create: build,
    update(value, tr) {
      if (!options.isDeck(tr.state)) return none;
      if (!options.isDeck(tr.startState) || tr.effects.some(effect => effect.is(reparse))) return build(tr.state);
      if (!tr.docChanged) return value;
      if (!isEdit(tr)) return build(tr.state);
      // 停下來才重新解析：標示與出處欄位的行跟著平移（行首往前靠，在行首打字還是那一行）。
      const map = (pos: number): number => tr.changes.mapPos(pos, -1);
      return { set: value.set.map(tr.changes), fields: value.fields.map(each => ({ anchor: map(each.anchor), lines: each.lines.map(map) })) };
    },
    provide: f => EditorView.decorations.from(f, value => value.set),
  });
  // 圖示：主要的選取是空的、在出處欄位那一行或它的子項目上時，那一欄第一行的行尾；一篇只有一個。
  const iconLine = (state: EditorState): number | null => {
    if (!options.onAdd || !options.isDeck(state) || !state.selection.main.empty) return null;
    const start = state.doc.lineAt(state.selection.main.head).from;
    const found = state.field(field, false)?.fields.find(each => each.lines.includes(start));
    return found ? state.doc.lineAt(found.anchor).number : null;
  };
  const icon = StateField.define<{ line: number | null; set: DecorationSet }>({
    create: state => drawIcon(state, iconLine(state)),
    update(value, tr) {
      if (!tr.docChanged && !tr.selection && !tr.effects.some(effect => effect.is(reparse))) return value;
      const line = iconLine(tr.state);
      return line === value.line && !tr.docChanged ? value : drawIcon(tr.state, line);
    },
    provide: f => EditorView.decorations.from(f, value => value.set),
  });
  function drawIcon(state: EditorState, line: number | null): { line: number | null; set: DecorationSet } {
    if (line === null || !options.onAdd) return { line, set: Decoration.none };
    return { line, set: Decoration.set([Decoration.widget({ widget: new AddWidget(line, options.onAdd), side: 1 }).range(state.doc.line(line).to)]) };
  }
  const delay = ViewPlugin.fromClass(class {
    private timer = 0;
    private readonly view: EditorView;
    constructor(view: EditorView) { this.view = view; }
    update(update: ViewUpdate): void {
      if (!update.docChanged || !update.transactions.some(isEdit) || !options.isDeck(update.state)) return;
      options.onEdit?.();
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => { this.view.dispatch({ effects: reparse.of(null) }); }, REPARSE_DELAY);
    }
    destroy(): void { window.clearTimeout(this.timer); }
  });
  /** pos 上的標示帶的那一段（hit）或那一處（fix）。 */
  function specAt<K extends 'hit' | 'fix'>(state: EditorState, pos: number, key: K): { value: { hit: H; fix: FieldFix }[K]; from: number } | null {
    let found: { value: { hit: H; fix: FieldFix }[K]; from: number } | null = null;
    state.field(field, false)?.set.between(pos, pos, (from, to, deco) => {
      const value = (deco.spec as Partial<{ hit: H; fix: FieldFix }>)[key];
      if (value && from <= pos && pos <= to) { found = { value, from }; return false; }
      return undefined;
    });
    return found;
  }
  const sourceAt = (state: EditorState, pos: number): { hit: H; from: number } | null => { const found = specAt(state, pos, 'hit'); return found && { hit: found.value, from: found.from }; };
  const fixAt = (state: EditorState, pos: number): { fix: FieldFix; from: number } | null => { const found = specAt(state, pos, 'fix'); return found && { fix: found.value, from: found.from }; };
  // 點看不懂的出處（§2 第 1 點）、§1-4 的標示：游標照常放到點的位置，同時打開那一段的表單或問一句的面板；焦點留在編輯器。
  const click = EditorView.domEventHandlers({
    click(event, view) {
      if (!(event.target instanceof Element)) return false;
      const source = options.onSource && event.target.closest('.' + CLASSES.source), fix = options.onFix && event.target.closest('.' + CLASSES.fix);
      if (!source && !fix) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const hit = source ? sourceAt(view.state, pos) : null, found = fix ? fixAt(view.state, pos) : null;
      if (hit) options.onSource?.(view, hit.hit, hit.from);
      else if (found) options.onFix?.(view, found.fix, found.from);
      return false;
    },
  });
  const marks = (state: EditorState): Mark[] => {
    const set = state.field(field, false)?.set;
    const out: Mark[] = [];
    set?.between(0, state.doc.length, (from, to, value) => {
      const spec = value.spec as { class?: string; attributes?: Record<string, string> };
      const kind = KINDS.get(spec.class ?? '');
      if (!kind) return;
      const tip = spec.attributes?.['aria-label'];
      out.push(tip === undefined ? { kind, from, to } : { kind, from, to, tip });
    });
    // RangeSet 一層一層走，不是照位置：排好再交出去。
    return out.sort((a, b) => a.from - b.from || a.to - b.to);
  };
  return { extension: [field, icon, delay, click], marks, refresh: reparse.of(null), icon: state => state.field(icon, false)?.line ?? null, sourceAt, fixAt };
}

