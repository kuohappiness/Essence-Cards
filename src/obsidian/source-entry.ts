import { Notice } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { guessSource } from '../core/catalog/index.ts';
import type { CatalogUnit } from '../core/catalog/index.ts';
import { parseDeck } from '../core/deck/index.ts';
import type { State } from '../state/index.ts';
import { openSourceForm } from './source-form.ts';

// 填出處的入口（tasks/edit-markup.md §2）：圖示與命令「填出處」打開空白的表單，用來加一項。
// 點看不懂的出處、游標在看不懂的出處上用命令打開那一項，要等解析多記出處的原文位置（§3）。

/** 同一科目錄裡的單元，照目錄的順序（「其他單元…」的選單）。目錄的名稱是「編號 名稱」，這裡拆開。 */
function catalogUnits(state: State | null, subject: string | null): CatalogUnit[] {
  if (!state || subject === null) return [];
  return state.catalog().terms.flatMap(term => term.subjects.filter(each => each.subject === subject).flatMap(each => each.units.flatMap(unit => {
    if (unit.code === null) return [];
    const name = unit.name.startsWith(unit.code) ? unit.name.slice(unit.code.length).trim() : unit.name;
    return [{ term: term.term, code: unit.code, name }];
  })));
}

/** 在 pos 底下打開空白的表單。 */
export function openBlankSourceForm(view: EditorView, pos: number, state: State | null): void {
  const deck = parseDeck(view.state.doc.toString());
  const own = { term: deck.props.term, subject: deck.props.subject, unit: deck.props.unit };
  const units = catalogUnits(state, deck.props.subject);
  const at = view.coordsAtPos(pos) ?? view.contentDOM.getBoundingClientRect();
  openSourceForm({
    rect: { left: at.left, top: at.top, bottom: at.bottom },
    original: null,
    form: guessSource(null, own, units),
    own,
    units,
    // 寫回筆記是 §4-3，要等格式查核；這一步只看得到會寫成的字。
    apply: () => { new Notice('Essence Cards：寫回筆記還沒做好'); },
  });
}
