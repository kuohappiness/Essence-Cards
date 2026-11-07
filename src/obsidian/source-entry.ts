import type { EditorView } from '@codemirror/view';
import { guessSource } from '../core/catalog/index.ts';
import type { CatalogUnit } from '../core/catalog/index.ts';
import { NEEDS_NEWER, canEditSource, editSource, fieldFixes, fixField, fixQuestion, parseDeck } from '../core/deck/index.ts';
import type { FieldFix, SourceEditAction } from '../core/deck/index.ts';
import type { State } from '../state/index.ts';
import { closeSourceForm, openAskPanel, openSourceForm } from './source-form.ts';
import type { UnreadableSource } from '../ui/sources.ts';

// 填出處的入口（tasks/edit-markup.md §2）：圖示與命令「填出處」打開空白的表單，用來加一項；
// 點看不懂的出處、游標在看不懂的出處上用命令，打開那一段的表單（§1-3 的一段）。套用寫回筆記（§4-3）：一個交易，Ctrl+Z 一次復原。

/** 寫回需要的：這台讀得懂的版號（需要新版的不寫）、核對不成立時記進錯誤紀錄（where: "edit"）。 */
export interface SourceEntry {
  state: State | null;
  version: string | null;
  fail: (error: Error) => void;
}

/** 同一科目錄裡的單元，照目錄的順序（「其他單元…」的選單）。目錄的名稱是「編號 名稱」，這裡拆開。 */
function catalogUnits(state: State | null, subject: string | null): CatalogUnit[] {
  if (!state || subject === null) return [];
  return state.catalog().terms.flatMap(term => term.subjects.filter(each => each.subject === subject).flatMap(each => each.units.flatMap(unit => {
    if (unit.code === null) return [];
    const name = unit.name.startsWith(unit.code) ? unit.name.slice(unit.code.length).trim() : unit.name;
    return [{ term: term.term, code: unit.code, name }];
  })));
}

/** 在 pos 底下打開空白的表單：加一段到 target 那個目標（從 0 算的行）。 */
export function openBlankSourceForm(view: EditorView, pos: number, target: number, entry: SourceEntry): void {
  open(view, pos, target, entry, null);
}
/** 在看不懂的那一段（從 pos 開始）底下打開它的表單，先填好猜的內容（§4-1）；套用時換掉那一段與接在後面的位置。 */
export function openUnreadableSourceForm(view: EditorView, pos: number, entry: SourceEntry, hit: UnreadableSource): void {
  open(view, pos, hit.line, entry, hit);
}

/**
 * 點了 §1-4 的標示（pos 是那一處的開頭）：問一句，按「修改」寫回（§4-4）。標示是停止打字 250 ms 後算的，用現在的全文重新判斷那一行；
 * 這篇需要新版時只寫原因、沒有「修改」。核對不成立記進錯誤紀錄。
 */
export function openFieldFix(view: EditorView, pos: number, entry: SourceEntry, kind: FieldFix['kind']): void {
  const opened = view.state.doc, text = opened.toString();
  const line = opened.lineAt(pos).number - 1;
  const fixes = fieldFixes(text);
  const fix = fixes.find(each => each.kind === kind && (kind === 'colon' || each.line === line));
  const result = fixField({ text, fix: kind === 'colon' ? { kind } : { kind, line }, version: entry.version });
  if (!result.ok && result.failure !== null) entry.fail(Error(result.failure));
  const newer = !result.ok && result.reason === NEEDS_NEWER;
  const at = view.coordsAtPos(pos) ?? view.contentDOM.getBoundingClientRect();
  openAskPanel({
    rect: { left: at.left, top: at.top, bottom: at.bottom },
    question: fix && !newer ? fixQuestion(fix, fixes.filter(each => each.kind === 'colon').length) : null,
    blocked: result.ok ? null : result.reason,
    apply: () => {
      if (!result.ok || view.state.doc !== opened) { closeSourceForm(); return; }
      view.dispatch({ changes: result.changes, userEvent: 'input.essence-source', scrollIntoView: true });
      closeSourceForm();
    },
  });
}

function open(view: EditorView, pos: number, target: number, entry: SourceEntry, hit: UnreadableSource | null): void {
  const opened = view.state.doc;
  const text = opened.toString();
  const deck = parseDeck(text, { layout: true });
  // 標示是停止打字 250 ms 之後算的：這之間改過字，點到的那一段可能已經不是第幾段，不寫（換錯段的話核對擋不到）。
  const part = hit ? deck.layout.get(target)?.parts[hit.part] : undefined;
  const sources = deck.targets.find(each => each.line === target)?.fields.sources ?? [];
  const stale = hit !== null && (!part || part.from === null || part.to === null || sources[part.entry]?.slice(part.from, part.to) !== hit.text);
  const own = { term: deck.props.term, subject: deck.props.subject, unit: deck.props.unit };
  const units = catalogUnits(entry.state, deck.props.subject);
  const at = view.coordsAtPos(pos) ?? view.contentDOM.getBoundingClientRect();
  const action = (written: string, mine: boolean): SourceEditAction => hit ? { kind: 'replace', part: hit.part, text: written, own: mine } : { kind: 'add', text: written, own: mine };
  // 核對不成立（不是預期的不寫）每次打開表單只記一次：表單每打一個字就核對一次。
  let logged = false;
  const edit = (written: string, mine: boolean) => {
    const result = editSource({ text, target, action: action(written, mine), version: entry.version });
    if (!result.ok && result.failure !== null && !logged) { logged = true; entry.fail(Error(result.failure)); }
    return result;
  };
  openSourceForm({
    rect: { left: at.left, top: at.top, bottom: at.bottom },
    original: hit?.whole ?? null,
    form: guessSource(hit?.item ?? null, own, units, hit?.follows, hit?.scope),
    own,
    units,
    blocked: stale ? '筆記剛改過，請再點一次' : canEditSource(text, target, hit?.part ?? null, entry.version),
    check: (written, mine) => {
      if (!written) return { reason: null, written };
      const result = edit(written, mine);
      return result.ok ? { reason: null, written: result.written } : { reason: result.reason, written };
    },
    apply: (written, mine) => {
      // 表單打開之後筆記改過就不寫（改到筆記時表單本來就會關掉，§2 第 1 點）。
      if (view.state.doc !== opened) { closeSourceForm(); return; }
      const result = edit(written, mine);
      if (!result.ok) return;
      view.dispatch({ changes: result.changes, userEvent: 'input.essence-source', scrollIntoView: true });
      closeSourceForm();
    },
  });
}
