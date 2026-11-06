import { StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Extension, Range, Text, Transaction } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { parseDeck } from '../core/deck/index.ts';
import type { Deck, Problem } from '../core/deck/index.ts';

// 編輯畫面標示卡組結構（D-047、D-089 第 10、11 條，tasks/edit-markup.md §1）：學習目標那一行左邊一條細線、題目的 `::` 變淡紫、
// 問題畫波浪線（紅色這題不會出、橘色照常出）。只在電腦版的編輯器、只在卡組筆記；判斷全部來自 parseDeck，不另寫一份規則。
// 這個檔不 import obsidian，在 Node 用 @codemirror/state 直接測；Obsidian 的接線在 main.ts。

/** 一個標示：target 是那一行（from 是行首、to 等於 from）；separator 是題目的 `::`；error、hint 是問題的波浪線，tip 是滑過的說明。 */
export interface Mark { kind: 'target' | 'separator' | 'error' | 'hint'; from: number; to: number; tip?: string }

const MARKER = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]*/;
const TRAILING_ID = /[ \t]+\^[A-Za-z0-9-]+[ \t]*$/;
/** 不標的問題：ID 不在行尾（存檔時自動移回，家長不用做事）；屬性區的問題（targetLine 是 null）標不上，存檔按鈕已經提示（§1-1）。 */
const skipped = (problem: Problem): boolean => problem.code === 'misplaced-id' || problem.targetLine === null;

/** 題目那一行的 `::`：要和 parseDeck 讀到的題目一致（開頭到它去掉空白就是題目），寫在接續行的不標。 */
function separatorAt(body: string, question: string): number {
  for (let at = body.indexOf('::'); at >= 0; at = body.indexOf('::', at + 1)) if (body.slice(0, at).trim() === question) return at;
  return -1;
}

/** 這一篇要畫的標示，照位置排好。deck 沒給時自己解析。 */
function marksOf(doc: Text, deck: Deck = parseDeck(doc.toString())): Mark[] {
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

const CLASSES: Record<Mark['kind'], string> = {
  target: 'essence-cards-target', separator: 'essence-cards-separator', error: 'essence-cards-error', hint: 'essence-cards-hint',
};
const KINDS = new Map(Object.entries(CLASSES).map(([kind, name]) => [name, kind as Mark['kind']]));
const targetLine = Decoration.line({ class: CLASSES.target });
const separator = Decoration.mark({ class: CLASSES.separator });

function decorate(marks: readonly Mark[]): DecorationSet {
  const ranges: Range<Decoration>[] = marks.map(mark => {
    if (mark.kind === 'target') return targetLine.range(mark.from);
    if (mark.kind === 'separator') return separator.range(mark.from, mark.to);
    // aria-label：Obsidian 滑過時顯示的說明（§1-1）。
    return Decoration.mark({ class: CLASSES[mark.kind], attributes: { 'aria-label': mark.tip ?? '' } }).range(mark.from, mark.to);
  });
  return Decoration.set(ranges, true);
}

/** 停止打字多久之後重新解析（§1-5）。 */
const REPARSE_DELAY = 250;
/** 使用者自己的編輯（含 Undo／Redo）：標示先跟著平移，停下來才重新解析；其他交易（打開別的檔、外部改檔後重新載入）馬上重算。 */
const isEdit = (tr: Transaction): boolean => ['input', 'delete', 'move', 'undo', 'redo'].some(event => tr.isUserEvent(event));

export interface MarkupOptions {
  /** 這個編輯器開的是不是卡組筆記（和 ID 鎖定同一個判斷，main.ts 的 lockable）。 */
  isDeck: (state: EditorState) => boolean;
  /** 點了「填出處」的圖示（§2 第 2 點）：出處欄位那一行（從 1 算）。沒給就不畫圖示。 */
  onAdd?: (view: EditorView, line: number) => void;
  /** 使用者改到筆記：開著的表單要關掉（§2 第 1 點）。 */
  onEdit?: () => void;
}

// ── 「填出處」的圖示（§2 第 2 點）──
// 哪一行是出處欄位：游標所在的那幾行簡單地看（每次移動游標都要判斷，不重新解析整篇）。
// 解析多記出處欄位的位置之後（§3 的 sourceFields）改用那一份，這裡的判斷就拿掉。

const LIST_ITEM = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const FIELD_START = /^(?:出處|類型|重要性|狀態|備註|錯題補強)\s*[：:]/;
/** 這一段資料有 `出處` 欄位：開頭就是，或用 `｜`（半形的 `|` 也算，D-170 第 12 點）接在別的欄位後面。 */
const HAS_SOURCE = /(?:^|[｜|])\s*出處\s*[：:]/;
const indentOf = (text: string): number => { let width = 0; for (const ch of text) width += ch === '\t' ? 4 - width % 4 : 1; return width; };
const isSourceField = (body: string): boolean => FIELD_START.test(body) && HAS_SOURCE.test(body);

/** 第 line 行（從 1 算）是出處欄位那一行，或它分行的子項目時，回傳欄位那一行；不是回傳 null。欄位要在目標底下（有縮排）。 */
function sourceFieldAt(doc: Text, line: number): number | null {
  const item = LIST_ITEM.exec(doc.line(line).text);
  if (!item) return null;
  const indent = indentOf(item[1]);
  if (isSourceField(item[2])) return indent > 0 ? line : null;
  for (let at = line - 1; at >= 1; at--) {
    const text = doc.line(at).text;
    if (!text.trim()) return null;
    const parent = LIST_ITEM.exec(text);
    if (!parent) continue;
    const width = indentOf(parent[1]);
    if (width < indent) return width > 0 && isSourceField(parent[2]) ? at : null;
  }
  return null;
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
 * icon 是「填出處」圖示所在的那一行（從 1 算，沒有是 null）：測試與開發命令用。
 */
export interface Markup { extension: Extension; marks: (state: EditorState) => Mark[]; refresh: StateEffect<null>; icon: (state: EditorState) => number | null }
export function markup(options: MarkupOptions): Markup {
  const reparse = StateEffect.define<null>();
  const build = (state: EditorState): DecorationSet => options.isDeck(state) ? decorate(marksOf(state.doc)) : Decoration.none;
  const field = StateField.define<DecorationSet>({
    create: build,
    update(value, tr) {
      if (!options.isDeck(tr.state)) return Decoration.none;
      if (!options.isDeck(tr.startState) || tr.effects.some(effect => effect.is(reparse))) return build(tr.state);
      if (!tr.docChanged) return value;
      return isEdit(tr) ? value.map(tr.changes) : build(tr.state);
    },
    provide: f => EditorView.decorations.from(f),
  });
  // 圖示：主要的選取是空的、在出處欄位那一行或它的子項目上時，那一欄第一行的行尾；一篇只有一個。
  const iconLine = (state: EditorState): number | null => {
    if (!options.onAdd || !options.isDeck(state) || !state.selection.main.empty) return null;
    return sourceFieldAt(state.doc, state.doc.lineAt(state.selection.main.head).number);
  };
  const icon = StateField.define<{ line: number | null; set: DecorationSet }>({
    create: state => drawIcon(state, iconLine(state)),
    update(value, tr) {
      if (!tr.docChanged && !tr.selection) return value;
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
  const marks = (state: EditorState): Mark[] => {
    const set = state.field(field, false);
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
  return { extension: [field, icon, delay], marks, refresh: reparse.of(null), icon: state => state.field(icon, false)?.line ?? null };
}
