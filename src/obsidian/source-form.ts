import { applyBlock, countedUnit, placeValid, sourceText } from '../core/catalog/index.ts';
import type { CatalogUnit, PlaceKind, SourceForm, UnitChoice } from '../core/catalog/index.ts';
import type { SourceOwner } from '../core/deck/index.ts';

// 填出處的小表單（tasks/edit-markup.md §2、§4）：浮在那段文字或圖示的下方，下面放不下就往上開。
// 先填好的內容與會寫成的字是 core/catalog 的純函式；這裡只畫畫面、收輸入。套用寫回筆記是 §4-3（還沒做）。

export interface FormOptions {
  /** 表單貼著的位置（螢幕座標）：那段字或圖示的上緣與下緣。 */
  rect: { left: number; top: number; bottom: number };
  /** 原文；空白的表單是 null。 */
  original: string | null;
  form: SourceForm;
  own: SourceOwner & { unit: { code: string; name: string } | null };
  /** 同一科目錄裡的單元（其他單元…的選單）。 */
  units: readonly CatalogUnit[];
  /** 寫進去的位置前面那幾項（讀回核對用）。 */
  preceding?: readonly string[];
  /** 按了套用：會寫成的字。 */
  apply: (text: string) => void;
  /** 表單關掉了（取消、Esc、點外面、改到筆記）。 */
  closed?: () => void;
}
export interface FormHandle { close: () => void; element: HTMLElement }

const KINDS: PlaceKind[] = ['頁', '圖', '表', '例題', '筆記連結'];
const label = (unit: UnitChoice | CatalogUnit): string => `${unit.term} ${unit.code}`;

/** 打開表單；同時只有一個（再打開會先關掉前一個）。 */
let current: FormHandle | null = null;
export function closeSourceForm(): void { current?.close(); }

export function openSourceForm(options: FormOptions): FormHandle {
  current?.close();
  const doc = activeDocument;
  const state: SourceForm = { ...options.form, places: options.form.places.length ? options.form.places.map(place => ({ ...place })) : [{ kind: '頁', value: '' }], candidates: [...options.form.candidates] };
  let guessed = state.unitOrigin === 'guessed';
  let otherOpen = false;
  const box = doc.body.createDiv({ cls: 'essence-cards-source-form', attr: { role: 'dialog', 'aria-label': '填出處' } });
  const render = (): void => {
    box.empty();
    const head = box.createDiv({ cls: 'essence-cards-source-form-original' });
    if (options.original === null) head.setText('新的一項出處');
    else { head.appendText('原文：'); head.createEl('b', { text: options.original }); }

    // 單元：這一篇、候選、其他單元…
    const unitRow = row('單元');
    const chips = unitRow.createDiv({ cls: 'essence-cards-chips', attr: { role: 'radiogroup', 'aria-label': '單元' } });
    const chip = (text: string, checked: boolean, pick: () => void, extra?: string): void => {
      const button = chips.createEl('button', { cls: 'essence-cards-chip', text, attr: { type: 'button', role: 'radio', 'aria-checked': String(checked) } });
      if (checked && guessed) { button.addClass('is-guess'); button.createSpan({ cls: 'essence-cards-chip-tag', text: '猜的' }); }
      if (extra) button.createSpan({ cls: 'essence-cards-chip-tag', text: extra });
      button.onclick = () => { pick(); guessed = false; render(); };
    };
    chip('這一篇', state.unit === 'own', () => { state.unit = 'own'; });
    const picked = state.unit && state.unit !== 'own' ? state.unit : null;
    const shown = [...state.candidates];
    if (picked && !shown.some(each => label(each) === label(picked))) shown.push(picked);
    for (const each of shown) chip(label(each), picked !== null && label(picked) === label(each), () => { state.unit = each; }, each.exists ? undefined : '還沒有卡組');
    const more = chips.createEl('button', { cls: 'essence-cards-chip', text: '其他單元…', attr: { type: 'button', 'aria-expanded': String(otherOpen) } });
    more.onclick = () => { otherOpen = !otherOpen; render(); };
    if (otherOpen) otherUnits(unitRow);
    // 單元的說明只在還沒選、或還是猜的時候；其他說明（頁碼看不懂、當場教的寫法）講的是原文，一直留著。
    const note = [state.unit === null || guessed ? state.unitNote : null, state.note].filter(Boolean).join('\n');
    if (note) unitRow.createDiv({ cls: 'essence-cards-source-form-note', text: note });

    // 位置：一列一個，可以再加。
    const placeRow = row('位置');
    state.places.forEach((place, at) => {
      const line = placeRow.createDiv({ cls: 'essence-cards-place' });
      const kind = line.createEl('select', { attr: { 'aria-label': '位置的種類' } });
      for (const each of KINDS) kind.createEl('option', { text: each, value: each });
      kind.value = place.kind;
      kind.onchange = () => { state.places[at] = { ...place, kind: kind.value as PlaceKind }; update(); };
      const input = line.createEl('input', { attr: { type: 'text', 'aria-label': '位置' }, value: place.value });
      input.toggleClass('is-invalid', !placeValid(place));
      input.oninput = () => { state.places[at] = { kind: state.places[at].kind, value: input.value }; input.toggleClass('is-invalid', !placeValid(state.places[at])); update(); };
    });
    const add = placeRow.createEl('button', { cls: 'essence-cards-more', text: '＋ 再加一個位置', attr: { type: 'button' } });
    add.onclick = () => { state.places.push({ kind: '頁', value: '' }); render(); };

    const remarkRow = row('說明');
    const remark = remarkRow.createEl('input', { cls: 'essence-cards-wide', attr: { type: 'text', 'aria-label': '說明（選填）', placeholder: '選填' }, value: state.remark });
    remark.oninput = () => { state.remark = remark.value; update(); };

    const out = box.createDiv({ cls: 'essence-cards-source-form-out' });
    const text = out.createDiv();
    text.createSpan({ cls: 'essence-cards-source-form-key', text: '會寫成' });
    const textValue = text.createEl('code');
    const unit = out.createDiv();
    unit.createSpan({ cls: 'essence-cards-source-form-key', text: '會算進' });
    const unitValue = unit.createSpan();
    const reason = box.createDiv({ cls: 'essence-cards-source-form-reason' });
    const buttons = box.createDiv({ cls: 'essence-cards-source-form-buttons' });
    const cancel = buttons.createEl('button', { text: '取消', attr: { type: 'button' } });
    cancel.onclick = () => { handle.close(); };
    const applyButton = buttons.createEl('button', { cls: 'mod-cta', text: '套用', attr: { type: 'button' } });
    applyButton.onclick = () => { const written = sourceText(state); if (!applyBlock(state, options.own, options.preceding)) options.apply(written); };
    function update(): void {
      const written = sourceText(state);
      textValue.setText(written || '—');
      unitValue.setText(countedUnit(state, options.own) || '—（請先選單元）');
      const blocked = applyBlock(state, options.own, options.preceding);
      applyButton.disabled = blocked !== null;
      // 還沒選單元、還沒寫字時按鈕本來就不能按，不另外說。
      reason.setText(blocked && state.unit !== null && written ? blocked : '');
    }
    update();
    place();
  };
  function row(name: string): HTMLElement {
    const line = box.createDiv({ cls: 'essence-cards-source-form-row' });
    line.createSpan({ cls: 'essence-cards-source-form-label', text: name });
    return line.createDiv();
  }
  /** 其他單元：年級學期與那一學期的單元，只列目錄裡有的（D-169 第 5 點）。 */
  function otherUnits(parent: HTMLElement): void {
    const line = parent.createDiv({ cls: 'essence-cards-place' });
    // 目錄已經照學期排好。
    const terms = [...new Set(options.units.map(unit => unit.term))];
    const termSelect = line.createEl('select', { attr: { 'aria-label': '年級學期' } });
    termSelect.createEl('option', { text: '年級學期', value: '' });
    for (const term of terms) termSelect.createEl('option', { text: term, value: term });
    const unitSelect = line.createEl('select', { attr: { 'aria-label': '單元' } });
    const picked = state.unit && state.unit !== 'own' ? state.unit : null;
    termSelect.value = picked && terms.includes(picked.term) ? picked.term : '';
    const fill = (): void => {
      unitSelect.empty();
      unitSelect.createEl('option', { text: '單元', value: '' });
      options.units.filter(unit => unit.term === termSelect.value).forEach((unit, at) => { unitSelect.createEl('option', { text: `${unit.code} ${unit.name}`.trim(), value: String(at) }); });
    };
    fill();
    termSelect.onchange = fill;
    unitSelect.onchange = () => {
      const unit = options.units.filter(each => each.term === termSelect.value)[Number(unitSelect.value)];
      if (!unit) return;
      state.unit = { ...unit, exists: true };
      guessed = false;
      otherOpen = false;
      render();
    };
  }
  /** 下面放不下就往上開。 */
  function place(): void {
    const width = box.offsetWidth, height = box.offsetHeight;
    const view = doc.documentElement;
    const left = Math.max(8, Math.min(options.rect.left, view.clientWidth - width - 8));
    const below = options.rect.bottom + 6, above = options.rect.top - height - 6;
    box.style.left = left + 'px';
    box.style.top = (below + height > view.clientHeight && above > 0 ? above : below) + 'px';
  }
  const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); handle.close(); } };
  const onDown = (event: MouseEvent): void => { if (!box.contains(event.target as Node)) handle.close(); };
  const handle: FormHandle = {
    element: box,
    close() {
      if (current !== handle) return;
      current = null;
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('mousedown', onDown, true);
      box.remove();
      options.closed?.();
    },
  };
  current = handle;
  render();
  doc.addEventListener('keydown', onKey, true);
  // 打開表單的那一下點擊已經結束，之後點外面才關。
  doc.addEventListener('mousedown', onDown, true);
  return handle;
}
