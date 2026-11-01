import { displayTooltip, MarkdownView } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { keepRendering } from './dev-review.ts';
import { openTab, shooter, sleep, until, writeFile, type IdsHost } from './dev-ids.ts';
import { TIPS } from './save.ts';

// 開發命令 duplicates（tasks/duplicate-ids.md §9，D-157）：只在開發版建置。用真的編輯器貼上副本（同一篇貼在上面、貼在下面、貼到別篇），
// 點真的存檔按鈕與小視窗的按鈕，截圖寫在 folder；每個情境都寫出操作後的文字與判斷，結束時刪掉測試的卡組。

const FOLDER = 'Essence Cards/W5 範例/重複測試';
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const newId = (): string => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const goal = (name: string, id: string): string => `- ${name} 英翻中 ^${id}\n    - ${name} :: ${name} 的意思\n`;
/** 別篇跳轉要捲得到：原本的目標前面有這麼多個目標。 */
const FILLERS = 40;

const rows = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.modal-container .essence-cards-issue'));
const rowTexts = () => rows().map(row => ({ text: row.querySelector('p')?.textContent ?? null, others: Array.from(row.querySelectorAll('li')).map(item => item.textContent), buttons: Array.from(row.querySelectorAll('button')).map(button => button.textContent) }));
function closeModals(): void {
  document.querySelectorAll<HTMLElement>('.modal-container .modal-close-button').forEach(el => { el.click(); });
}
function paste(cm: EditorView, at: number, text: string): void {
  cm.dispatch({ selection: { anchor: at } });
  const data = new DataTransfer();
  data.setData('text/plain', text);
  cm.focus();
  cm.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
}

export async function duplicatesCheck(host: IdsHost, folder: string): Promise<unknown> {
  const { app } = host;
  const state = host.state;
  if (!state) throw Error('state 還沒建立');
  await state.ready();
  const rendering = keepRendering();
  const shots: string[] = [];
  const shoot = shooter(app, folder, shots);
  const out: Record<string, unknown> = { shots };
  const checks: Record<string, boolean> = {};
  const created: string[] = [];
  const stamp = Date.now().toString(36);
  const inToday = (id: string): boolean => { const today = state.today(); return [...today.share, ...today.more].some(item => item.lt === id); };
  const conflictOf = (id: string) => state.conflicts().find(each => each.id === id);
  const deck = async (name: string, text: string) => {
    const path = `${FOLDER}/${name} ${stamp}（卡片）.md`;
    created.push(path);
    const file = await writeFile(app, path, text);
    await until(() => state.decks().some(entry => entry.path === path));
    return { path, file };
  };
  const button = (view: MarkdownView) => view.containerEl.querySelector<HTMLElement>('.essence-cards-save');
  /** 點存檔按鈕，等這次點擊觸發的存檔結束（技術債 N1）；按鈕不在或點了沒有觸發存檔是 false。 */
  const click = async (view: MarkdownView): Promise<boolean> => {
    const el = button(view), path = view.file?.path, at = host.devLog.events.length;
    if (!el || !path) return false;
    el.click();
    return until(() => host.devLog.events.slice(at).some(event => event.endsWith(' 存檔結束 ' + path)), 15000);
  };
  /** 小視窗裡，文字含 name 的那一列按「這一個是新加的」。 */
  const choose = async (name: string): Promise<boolean> => {
    const before = rows().length;
    const row = rows().find(each => each.querySelector('p')?.textContent.includes(name));
    const cta = row?.querySelector<HTMLElement>('button.mod-cta');
    if (!cta) return false;
    cta.click();
    return until(() => rows().length < before, 15000);
  };
  /** 拿掉通知與說明，看存檔按鈕的樣子與畫面上的說明。 */
  const hover = async (view: MarkdownView) => {
    host.devLog.save?.refresh();
    document.querySelectorAll('.notice').forEach(el => { el.remove(); });
    const el = button(view), label = el?.getAttribute('aria-label') ?? null;
    if (el && label) displayTooltip(el, label, { placement: 'bottom' });
    await sleep(500);
    return { kind: ['done', 'missing', 'issues', 'malformed', 'needs-update'].find(kind => el?.hasClass('is-' + kind)), label, tooltip: document.querySelector('.tooltip')?.textContent ?? null };
  };
  const away = () => { document.querySelectorAll('.tooltip').forEach(el => { el.remove(); }); };

  try {
    // 1. 同一篇：貼在上面、貼在下面。按存檔不換號、小視窗選副本之後只換副本那一行。
    for (const where of ['上面', '下面'] as const) {
      const id = newId(), original = goal('borrow', id), copy = goal('lend', id);
      const { file } = await deck('同一篇 ' + where, original);
      const { leaf, view, cm } = await openTab(app, file);
      paste(cm, where === '上面' ? 0 : cm.state.doc.length, copy);
      const pasted = view.editor.getValue();
      await view.save();
      const seen = await until(() => conflictOf(id) !== undefined);
      const trial: Record<string, unknown> = { pasted, conflict: conflictOf(id), inToday: inToday(id), canAnswer: state.canAnswer(id) };
      checks[where + ' 貼上照原樣'] = pasted === (where === '上面' ? copy + original : original + copy);
      checks[where + ' 看到衝突'] = seen;
      checks[where + ' 今天的份不出'] = !inToday(id);
      checks[where + ' 不收作答'] = !state.canAnswer(id);
      if (where === '上面') {
        trial.button = await hover(view);
        checks['按鈕是待處理'] = (trial.button as { kind?: string }).kind === 'issues' && (trial.button as { label: string | null }).label === TIPS.issues(2);
        await shoot('存檔按鈕的說明');
        away();
      }
      checks[where + ' 按到存檔'] = await click(view);
      await sleep(300);
      trial.modal = rowTexts();
      checks[where + ' 按存檔不換號'] = view.editor.getValue() === pasted;
      checks[where + ' 小視窗兩列'] = rows().length === 2;
      if (where === '上面') await shoot('小視窗 同一篇兩個');
      checks[where + ' 選了副本'] = await choose('lend 英翻中');
      const final = view.editor.getValue();
      const fresh = /lend 英翻中 \^([a-z0-9]{6})/.exec(final)?.[1] ?? '';
      trial.final = final;
      checks[where + ' 只換副本那一行'] = fresh !== id && final === (where === '上面' ? goal('lend', fresh) + original : original + goal('lend', fresh));
      await until(() => conflictOf(id) === undefined);
      checks[where + ' 衝突解除'] = conflictOf(id) === undefined;
      checks[where + ' 原本的照常出'] = inToday(id) && state.canAnswer(id);
      checks[where + ' 新加的照常出'] = inToday(fresh) && state.canAnswer(fresh);
      closeModals();
      leaf.detach();
      out['同一篇' + where] = trial;
    }

    // 2. 刪掉副本後恢復。
    {
      const id = newId(), original = goal('borrow', id), copy = goal('lend', id);
      const { file } = await deck('刪掉副本', original);
      const { leaf, view, cm } = await openTab(app, file);
      paste(cm, cm.state.doc.length, copy);
      await view.save();
      checks['刪除 看到衝突'] = await until(() => conflictOf(id) !== undefined);
      checks['刪除 不出'] = !inToday(id);
      cm.dispatch({ changes: { from: original.length, to: cm.state.doc.length }, userEvent: 'delete.cut' });
      await view.save();
      checks['刪除 衝突解除'] = await until(() => conflictOf(id) === undefined);
      out.afterDelete = view.editor.getValue();
      checks['刪除 文字剩原本的'] = view.editor.getValue() === original;
      checks['刪除 恢復出題'] = inToday(id) && state.canAnswer(id);
      leaf.detach();
    }

    // 3. 貼到別篇（路徑排在前面、後面）：小視窗有跳轉；只改開著的那一篇。
    for (const [name, label] of [['甲 副本', '路徑在前'], ['丙 副本', '路徑在後']] as const) {
      const id = newId(), original = goal('borrow', id), copy = goal('lend', id);
      const fillers = Array.from({ length: FILLERS }, (_, i) => goal('filler' + String(i), newId())).join('');
      const home = await deck('乙 原本 ' + label, fillers + original);
      const away_ = await deck(name, goal('other', newId()));
      const { leaf, view, cm } = await openTab(app, away_.file);
      const start = view.editor.getValue();
      paste(cm, cm.state.doc.length, copy);
      const pasted = view.editor.getValue();
      await view.save();
      checks[label + ' 看到衝突'] = await until(() => conflictOf(id) !== undefined);
      checks[label + ' 兩邊都不出'] = !inToday(id) && !state.canAnswer(id);
      checks[label + ' 按到存檔'] = await click(view);
      await sleep(300);
      const trial: Record<string, unknown> = { modal: rowTexts(), conflict: conflictOf(id) };
      checks[label + ' 按存檔不換號'] = view.editor.getValue() === pasted;
      const link = document.querySelector<HTMLElement>('.modal-container .essence-cards-issue a.essence-cards-issue-link');
      checks[label + ' 有跳轉'] = !!link;
      if (label === '路徑在前') {
        await shoot('小視窗 跨篇有跳轉');
        link?.click();
        checks['跳轉 打開那一篇'] = await until(() => app.workspace.getActiveViewOfType(MarkdownView)?.file?.path === home.path);
        checks['跳轉 小視窗關了'] = rows().length === 0;
        await sleep(1000);
        const active = app.workspace.getActiveViewOfType(MarkdownView);
        if (active) {
          const target = (active.editor as unknown as { cm: EditorView }).cm;
          const position = target.state.doc.line(FILLERS * 2 + 1).from;
          const coords = target.coordsAtPos(position), box = target.scrollDOM.getBoundingClientRect();
          trial.jump = { mode: active.getMode(), coords, box: { top: box.top, bottom: box.bottom }, line: target.state.doc.line(FILLERS * 2 + 1).text };
          checks['跳轉 捲到那一行'] = !!coords && coords.top >= box.top && coords.bottom <= box.bottom;
          await shoot('跳轉之後');
          if (active.leaf !== leaf) active.leaf.detach();
        }
        app.workspace.setActiveLeaf(leaf, { focus: true });
        await sleep(300);
        checks['跳轉 回來再按存檔'] = await click(view);
        await sleep(300);
      }
      checks[label + ' 選了副本'] = await choose('lend 英翻中');
      const final = view.editor.getValue();
      const fresh = /lend 英翻中 \^([a-z0-9]{6})/.exec(final)?.[1] ?? '';
      trial.final = final;
      checks[label + ' 只換副本那一行'] = fresh !== id && final === start + goal('lend', fresh);
      checks[label + ' 原本那篇逐字不變'] = await app.vault.read(home.file) === fillers + original;
      await until(() => conflictOf(id) === undefined);
      checks[label + ' 恢復'] = inToday(id) && state.canAnswer(id) && inToday(fresh);
      closeModals();
      leaf.detach();
      out[label] = trial;
      await sleep(500);
    }

    // 4. 離開筆記時的通知：不開小視窗。
    {
      const id = newId();
      await deck('離開 原本', goal('borrow', id));
      const copy = await deck('離開 副本', goal('lend', id));
      checks['離開 看到衝突'] = await until(() => conflictOf(id) !== undefined);
      const { leaf } = await openTab(app, copy.file);
      await sleep(300);
      const notices = host.devLog.notices.length;
      leaf.detach();
      const expected = TIPS.duplicates(`離開 副本 ${stamp}（卡片）`, 1);
      checks['離開 通知一次'] = await until(() => host.devLog.notices.slice(notices).includes(expected), 8000);
      out.leaveNotices = host.devLog.notices.slice(notices);
      checks['離開 不開小視窗'] = rows().length === 0;
      await shoot('離開筆記時的通知');
    }
  } finally {
    closeModals();
    rendering.restore();
    // 剛寫過的檔 iCloud 可能鎖住一陣子（EBUSY，2026-10-31）：隔 2 秒再試，最後還是刪不掉就記下來，不蓋掉結果。
    const left: string[] = [];
    for (const path of created) {
      for (let i = 0; i < 5 && app.vault.getFileByPath(path); i++) {
        try { await app.vault.delete(app.vault.getFileByPath(path)!); } catch { await sleep(2000); }
      }
      if (app.vault.getFileByPath(path)) left.push(path);
    }
    const emptied = app.vault.getFolderByPath(FOLDER);
    if (emptied && !emptied.children.length) await app.vault.delete(emptied).catch(() => {});
    if (left.length) out.cleanupLeft = left;
  }
  out.checks = checks;
  out.failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return out;
}
