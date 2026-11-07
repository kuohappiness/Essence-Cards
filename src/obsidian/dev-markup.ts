import { displayTooltip } from 'obsidian';
import type { App } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { IdsWiring } from '../main.ts';
import { keepRendering } from './dev-review.ts';
import { openTab, shooter, sleep, until, writeFile } from './dev-ids.ts';

// 開發命令 markup（tasks/edit-markup.md §6-3）：在 Windows 版 Obsidian 看編輯畫面的標示、「填出處」的圖示與表單，
// 淺色、深色各截一張，和樣式稿比；寫出畫面上量到的位置與文字，不只寫「通過」。只在開發版建置。

const TRIAL = 'Essence Cards/W5 範例/存檔測試';
// 樣式稿的內容（experiments/mockups/edit-markup.html）：正常的目標與題目、重要性寫錯、沒有答案、一般筆記、按了 Tab 的目標。
const DECK = `---
年級學期: 國二上
科目: 自然
單元: 2-2 水溶液
狀態: 啟用
---

## 1 溶液

- 能說出溶質與溶劑的意思 ^k3m9x2
    - 出處：p.43｜類型：定義
    - 糖水裡，哪一個是溶質？哪一個是溶劑？ :: 糖是**溶質**，水是**溶劑**
    - 碘酒裡的溶劑是什麼？ :: **酒精**
- 能說明溶液的質量組成 ^h2m8qd
    - 出處：p.43｜類型：因果｜重要性：很高
    - 溶液的質量怎麼算？ :: **溶質**的質量加上**溶劑**的質量
- 能用粒子運動說明擴散現象 ^p7q2w8
    - 出處：p.44、圖 2-14
    - 黑糖放進水裡，不攪拌也會慢慢變甜，為什麼？ :: 粒子**不停運動**
- 能說出影響溶解快慢的因素 ^w4s8nd
    - 出處：p.45
    - 水溫越==高==、顆粒越==小==，糖溶解得越快
- 老師說這一段只要看懂，不用背
- 能說明溶液靜置後不會分層 ^r5t9vb
    - 糖水放一整天，杯底會出現糖嗎？ ::
	- 能說明溶液是均勻的 ^m3n4p5
	    - 糖水上下一樣甜嗎？ :: 一樣甜
`;
/** 量速度用：300 個目標、每個三題（§1-5）。 */
function bigDeck(): string {
  const parts = ['---\n年級學期: 國二上\n科目: 自然\n單元: 2-2 水溶液\n---\n'];
  for (let i = 0; i < 300; i++) parts.push(`- 能說明第 ${i} 個概念\n    - 出處：p.${i}｜類型：定義\n    - 第 ${i} 題的問題？ :: 答案**${i}**\n    - 第 ${i} 個的例子 :: 例子\n    - 水溫越==高==，溶解越快 ${i}\n`);
  return parts.join('');
}

/** 寫回與 §1-4 用（§6-3）：看不懂的出處、可以加一段的出處、欄位名稱寫錯、半形冒號。 */
const WRITE_DECK = `---
年級學期: 國二上
科目: 自然
單元: 2-2 水溶液
狀態: 啟用
---

- 能說出溶質與溶劑的意思 ^k3m9x2
    - 出處：老師說過 p.44｜類型:定義
    - 糖水裡，哪一個是溶質？ :: 糖是**溶質**
- 能說明溶液的質量組成 ^h2m8qd
    - 出處：p.43
    - 溶液的質量怎麼算？ :: **溶質**加上**溶劑**
    - 來源：p.45
- 能說出影響溶解快慢的因素 ^w4s8nd
    - 重要性:高
    - 水溫越==高==，糖溶解得越快
`;

const rect = (el: Element | null | undefined) => {
  const r = el?.getBoundingClientRect();
  return r ? { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) } : null;
};

/**
 * 寫回與 §1-4 的實機（§6-3）：點看不懂的出處 → 表單 → 套用 → 筆記的字 → Ctrl+Z 一次復原；從圖示加一段；§1-4 的「不用」「修改」與復原。
 * 每一步記下筆記的字與面板上的字，不只寫「通過」。
 */
async function writeBackCheck(app: App, path: string, shoot: (name: string) => Promise<void>): Promise<{ leaf: { detach(): void }; out: Record<string, unknown> }> {
  const out: Record<string, unknown> = {};
  const file = await writeFile(app, path, WRITE_DECK);
  const { leaf, view, cm } = await openTab(app, file);
  await until(() => view.containerEl.querySelectorAll('.essence-cards-target').length > 0);
  await sleep(500);
  const content = view.containerEl;
  const commands = (app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands;
  const text = (): string => cm.state.doc.toString();
  const panel = () => document.querySelector<HTMLElement>('.essence-cards-source-form');
  const button = (label: string) => Array.from(panel()?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(each => each.textContent === label) ?? null;
  /** 在那個元素的中間點一下（標示的 click 用座標找位置）。 */
  const clickAt = (el: Element | null | undefined): void => {
    const r = el?.getBoundingClientRect();
    if (!el || !r) return;
    for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  };
  /** Ctrl+Z 一次：Obsidian 的復原命令。 */
  const undoOnce = async (): Promise<boolean> => { cm.focus(); commands.executeCommandById('editor:undo'); await sleep(300); return text() === WRITE_DECK; };
  cm.focus();
  out.fixMarks = Array.from(content.querySelectorAll<HTMLElement>('.essence-cards-fix')).map(el => ({ text: el.textContent, label: el.getAttribute('aria-label'), decoration: getComputedStyle(el).textDecorationStyle + ' ' + getComputedStyle(el).textDecorationColor, cursor: getComputedStyle(el).cursor }));
  out.sourceMarks = Array.from(content.querySelectorAll<HTMLElement>('.essence-cards-source')).map(el => ({ text: el.textContent, label: el.getAttribute('aria-label') }));
  await shoot('寫回前');

  // 1. 看不懂的出處 → 表單（先填好猜的）→ 套用 → Ctrl+Z。
  clickAt(content.querySelector('.essence-cards-source'));
  await sleep(400);
  out.unreadableForm = panel()?.innerText ?? null;
  await sleep(300);
  out.unreadableWritten = panel()?.querySelector('code')?.textContent ?? null;
  await shoot('看不懂的出處的表單');
  button('套用')?.click();
  await sleep(300);
  out.unreadableApplied = { closed: !panel(), line: text().split('\n').find(line => line.includes('出處：') && line.includes('類型')) ?? null };
  out.unreadableUndo = await undoOnce();

  // 2. 從圖示加一段：游標放在第二個目標的出處那一行。
  const sourceLine = text().split('\n').findIndex(line => line === '    - 出處：p.43') + 1;
  cm.dispatch({ selection: { anchor: cm.state.doc.line(sourceLine).to }, userEvent: 'select' });
  await sleep(300);
  const add = content.querySelector<HTMLElement>('.essence-cards-add');
  add?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  add?.click();
  await sleep(300);
  const input = panel()?.querySelector<HTMLInputElement>('.essence-cards-place input');
  if (input) { input.value = '46'; input.dispatchEvent(new Event('input')); }
  await sleep(500);
  out.addWritten = { written: panel()?.querySelector('code')?.textContent ?? null, apply: button('套用')?.disabled ?? null };
  button('套用')?.click();
  await sleep(300);
  out.addApplied = text().split('\n')[sourceLine - 1];
  out.addUndo = await undoOnce();

  // 3. §1-4 欄位名稱寫錯：「不用」只是關掉，標示還在；「修改」寫回，Ctrl+Z 一次回到原文。
  await sleep(400);
  const renameMark = () => Array.from(content.querySelectorAll('.essence-cards-fix')).find(el => el.textContent === '來源：p.45');
  clickAt(renameMark());
  await sleep(300);
  out.renamePanel = panel()?.innerText ?? null;
  await shoot('欄位名稱寫錯的面板');
  button('不用')?.click();
  await sleep(200);
  out.renameNo = { closed: !panel(), markStays: !!renameMark(), same: text() === WRITE_DECK };
  clickAt(renameMark());
  await sleep(300);
  button('修改')?.click();
  await sleep(600);
  out.renameApplied = { closed: !panel(), lines: text().split('\n').slice(11, 15), markGone: !renameMark() };
  out.renameUndo = await undoOnce();

  // 4. 半形冒號：一次改完整篇，Ctrl+Z 一次回到原文。
  await sleep(400);
  clickAt(Array.from(content.querySelectorAll('.essence-cards-fix')).find(el => el.textContent === '類型:'));
  await sleep(300);
  out.colonPanel = panel()?.innerText ?? null;
  await shoot('半形冒號的面板');
  button('修改')?.click();
  await sleep(600);
  out.colonApplied = { halfLeft: text().split('\n').filter(line => /(類型|重要性):/.test(line)).length, fixMarks: content.querySelectorAll('.essence-cards-fix').length };
  out.colonUndo = await undoOnce();
  // Esc 關掉面板。
  await sleep(400);
  clickAt(content.querySelector('.essence-cards-fix'));
  await sleep(300);
  const opened = !!panel();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(200);
  out.escCloses = opened && !panel();
  return { leaf, out };
}

export async function markupCheck(app: App, wiring: IdsWiring | null, folder: string): Promise<unknown> {
  if (!wiring) throw Error('沒有編輯器的接線（不是電腦？）');
  const rendering = keepRendering();
  const shots: string[] = [];
  const shoot = shooter(app, folder, shots);
  const out: Record<string, unknown> = { shots };
  const stamp = Date.now().toString(36);
  const paths = [`${TRIAL}/標示 ${stamp}（卡片）.md`, `${TRIAL}/標示速度 ${stamp}（卡片）.md`, `${TRIAL}/寫回 ${stamp}（卡片）.md`];
  const leaves: { detach(): void }[] = [];
  try {
    const file = await writeFile(app, paths[0], DECK);
    const { leaf, view, cm } = await openTab(app, file);
    leaves.push(leaf);
    await until(() => view.containerEl.querySelectorAll('.essence-cards-target').length > 0);
    await sleep(400);
    const content = view.containerEl;
    const lines = (cls: string) => Array.from(content.querySelectorAll<HTMLElement>(cls));
    out.marks = wiring.markup.marks(cm.state).map(mark => ({ ...mark, text: cm.state.sliceDoc(mark.from, mark.to) || cm.state.doc.lineAt(mark.from).text.slice(0, 20) }));
    // 細線的位置：::before 的左邊和清單圓點的左邊（§1-6 要在 Obsidian 裡對過）。
    out.targets = lines('.cm-line.essence-cards-target').map(line => {
      const before = getComputedStyle(line, '::before');
      const bullet = line.querySelector('.list-bullet') ?? line.querySelector('.cm-formatting-list');
      return {
        text: (line.textContent ?? '').slice(0, 16), line: rect(line), bullet: rect(bullet),
        bar: { left: before.left, width: before.width, opacity: before.opacity, background: before.backgroundColor, content: before.content },
      };
    });
    out.separators = lines('.essence-cards-separator').map(el => ({ text: el.textContent, color: getComputedStyle(el).color, opacity: getComputedStyle(el).opacity }));
    out.problems = lines('.essence-cards-error, .essence-cards-hint').map(el => ({
      kind: el.className, text: el.textContent, label: el.getAttribute('aria-label'),
      decoration: getComputedStyle(el).textDecorationLine + ' ' + getComputedStyle(el).textDecorationStyle + ' ' + getComputedStyle(el).textDecorationColor,
    }));
    await shoot('即時預覽');
    // tooltip：DOM 事件叫不出 Obsidian 的 tooltip，用 displayTooltip（memory 的做法）；另外送 mouseover 看會不會自己出現。
    const hint = content.querySelector<HTMLElement>('.essence-cards-hint');
    if (hint) {
      hint.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await sleep(900);
      out.tooltipByHover = document.querySelector('.tooltip')?.textContent ?? null;
      document.querySelectorAll('.tooltip').forEach(el => { el.remove(); });
      displayTooltip(hint, hint.getAttribute('aria-label') ?? '', { placement: 'top' });
      await sleep(400);
      out.tooltip = document.querySelector('.tooltip')?.textContent ?? null;
      await shoot('滑過的說明');
      document.querySelectorAll('.tooltip').forEach(el => { el.remove(); });
    }
    // 游標放在第三個目標的出處那一行：行尾有圖示。
    const sourceLine = cm.state.doc.toString().split('\n').findIndex(text => text.includes('出處：p.44、圖 2-14')) + 1;
    cm.focus();
    cm.dispatch({ selection: { anchor: cm.state.doc.line(sourceLine).from + 8 }, userEvent: 'select' });
    await sleep(300);
    const add = () => content.querySelector<HTMLElement>('.essence-cards-add');
    out.icon = { line: wiring.markup.icon(cm.state), expected: sourceLine, dom: rect(add()), label: add()?.getAttribute('aria-label') ?? null, lineRect: rect(cm.domAtPos(cm.state.doc.line(sourceLine).from).node.parentElement?.closest('.cm-line')) };
    await shoot('游標在出處那一行');
    // 點圖示：游標不動，打開空白的表單。
    const head = cm.state.selection.main.head;
    add()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    add()?.click();
    await sleep(300);
    const form = () => document.querySelector<HTMLElement>('.essence-cards-source-form');
    out.form = { open: !!form(), headSame: cm.state.selection.main.head === head, rect: rect(form()), text: form()?.innerText ?? null };
    const input = form()?.querySelector<HTMLInputElement>('.essence-cards-place input');
    if (input) { input.value = '20'; input.dispatchEvent(new Event('input')); }
    await sleep(150);
    out.formFilled = { written: form()?.querySelector('code')?.textContent ?? null, apply: form()?.querySelector<HTMLButtonElement>('button.mod-cta')?.disabled };
    await shoot('空白的表單');
    // 其他單元…
    Array.from(form()?.querySelectorAll<HTMLButtonElement>('.essence-cards-chip') ?? []).find(chip => chip.textContent === '其他單元…')?.click();
    await sleep(200);
    out.otherUnits = Array.from(form()?.querySelectorAll('select') ?? []).map(select => Array.from(select.options).map(option => option.text));
    await shoot('其他單元');
    // 格式不對：那一格標紅，套用不能按。
    const again = form()?.querySelector<HTMLInputElement>('.essence-cards-place input');
    if (again) { again.value = '4a'; again.dispatchEvent(new Event('input')); }
    await sleep(150);
    out.invalid = { red: again?.classList.contains('is-invalid') ?? null, apply: form()?.querySelector<HTMLButtonElement>('button.mod-cta')?.disabled ?? null };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(200);
    out.escCloses = !form();
    // 命令「填出處」：游標在目標裡可用；在一般筆記那一行不可用。
    const commands = (app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands;
    const nameLine = cm.state.doc.toString().split('\n').findIndex(text => text.startsWith('- 能說明溶液的質量組成')) + 1;
    cm.dispatch({ selection: { anchor: cm.state.doc.line(nameLine).to - 9 }, userEvent: 'select' });
    out.commandInTarget = commands.executeCommandById('essence-cards:fill-source');
    await sleep(300);
    out.commandOpens = !!form();
    // 改到筆記時表單關掉（打字照常進編輯器）。
    // 只送 changes 時游標留在插入的字前面：刪掉的是剛插入的那一個字，不是游標前一個（第一次實測刪錯了字）。
    const typedAt = cm.state.selection.main.head;
    cm.dispatch({ changes: { from: typedAt, insert: 'X' }, userEvent: 'input.type' });
    await sleep(200);
    out.editCloses = !form();
    cm.dispatch({ changes: { from: typedAt, to: typedAt + 1 }, userEvent: 'delete.backward' });
    out.restored = cm.state.doc.toString() === DECK;
    const noteLine = cm.state.doc.toString().split('\n').findIndex(text => text.startsWith('- 老師說')) + 1;
    cm.dispatch({ selection: { anchor: cm.state.doc.line(noteLine).from + 3 }, userEvent: 'select' });
    // executeCommandById 的回傳值不代表可用（第一次實測在一般筆記也是 true）：看表單有沒有打開。
    commands.executeCommandById('essence-cards:fill-source');
    await sleep(200);
    out.commandOnNoteOpens = !!form();
    document.querySelector('.essence-cards-source-form')?.remove();
    // 原始碼模式。
    const state = leaf.getViewState();
    await leaf.setViewState({ ...state, state: { ...state.state, mode: 'source', source: true } });
    await sleep(500);
    out.sourceMode = { targets: lines('.cm-line.essence-cards-target').length, separators: lines('.essence-cards-separator').length };
    await shoot('原始碼模式');
    await leaf.setViewState(state);

    // 寫回與 §1-4（§6-3）。
    const written = await writeBackCheck(app, paths[2], shoot);
    leaves.push(written.leaf);
    out.writeBack = written.out;

    // 速度（§1-5）：300 個目標的卡組，重新解析加產生標示加畫面更新的時間；連續打字時每一個交易的時間。
    const big = await writeFile(app, paths[1], bigDeck());
    const opened = await openTab(app, big);
    leaves.push(opened.leaf);
    await until(() => (opened.view).containerEl.querySelectorAll('.essence-cards-target').length > 0);
    await sleep(500);
    const bigCm: EditorView = opened.cm;
    const refresh: number[] = [];
    for (let i = 0; i < 10; i++) { const t = performance.now(); bigCm.dispatch({ effects: wiring.markup.refresh }); refresh.push(performance.now() - t); await sleep(50); }
    const typing: number[] = [];
    const at = bigCm.state.doc.line(200).to;
    for (let i = 0; i < 30; i++) { const t = performance.now(); bigCm.dispatch({ changes: { from: at + i, insert: 'x' }, userEvent: 'input.type' }); typing.push(performance.now() - t); await sleep(30); }
    const sorted = (list: number[]) => [...list].sort((a, b) => a - b);
    out.speed = {
      marks: wiring.markup.marks(bigCm.state).length,
      refreshMs: { median: Math.round(sorted(refresh)[5] * 10) / 10, max: Math.round(sorted(refresh)[9] * 10) / 10 },
      typingMs: { median: Math.round(sorted(typing)[15] * 10) / 10, max: Math.round(sorted(typing)[29] * 10) / 10 },
    };
    // 打字停下來 250 ms 後重新解析：等一下，標示和重新打開時一樣。
    await sleep(600);
    out.afterTyping = wiring.markup.marks(bigCm.state).length;
  } finally {
    for (const leaf of leaves) leaf.detach();
    rendering.restore();
    // 剛寫過的檔 iCloud 可能鎖住一陣子：隔 2 秒再試。
    for (const path of paths) {
      for (let i = 0; i < 5 && app.vault.getFileByPath(path); i++) {
        try { await app.vault.delete(app.vault.getFileByPath(path)!); }
        catch (error) { out.cleanup = String(error); await sleep(2000); }
      }
    }
    if (paths.every(path => !app.vault.getFileByPath(path))) delete out.cleanup;
  }
  return out;
}
