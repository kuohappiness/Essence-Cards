import { StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Extension, Range, Text, Transaction } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
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
    const at = line(problem.line);
    if (!at) continue;
    // 那一行的內容：不含清單符號與行尾的 ID。
    const start = MARKER.exec(at.text)?.[0].length ?? at.text.length - at.text.trimStart().length;
    const trail = TRAILING_ID.exec(at.text);
    const from = at.from + start;
    const to = at.from + (trail ? trail.index : at.text.trimEnd().length);
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
}

/** 編輯器的標示：extension 用 registerEditorExtension 裝上（只在電腦）；marks 是目前畫的標示，refresh 是馬上重新解析的 effect（測試與開發命令用）。 */
export function markup(options: MarkupOptions): { extension: Extension; marks: (state: EditorState) => Mark[]; refresh: StateEffect<null> } {
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
  const delay = ViewPlugin.fromClass(class {
    private timer = 0;
    private readonly view: EditorView;
    constructor(view: EditorView) { this.view = view; }
    update(update: ViewUpdate): void {
      if (!update.docChanged || !update.transactions.some(isEdit) || !options.isDeck(update.state)) return;
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
  return { extension: [field, delay], marks, refresh: reparse.of(null) };
}
