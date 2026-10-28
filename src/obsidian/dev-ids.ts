import { MarkdownView, TFile } from 'obsidian';
import type { App, WorkspaceLeaf } from 'obsidian';
import { StateEffect, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { nameIds, parseDeck } from '../core/deck/index.ts';
import type { State } from '../state/index.ts';
import type { IdToken } from './lock.ts';
import { BUTTONS, MESSAGES, TIPS, type Saver } from './save.ts';
import { leafPath, removeTestPaths } from './dev-events.ts';
import { keepRendering } from './dev-review.ts';
import { createObsidianFiles } from './files.ts';

// 開發命令 lock 與 save（W5 §8-7 的 I7、I8）：只在開發版建置。AI 在 Windows 版 Obsidian 用 URI 執行，
// 每一種操作都寫出操作後的文字或判斷，不只寫「通過」。

/** dev.ts 訂閱外掛的事件記下來的（技術債 A10）：提示、事件、編輯器拿掉的 ID，以及鎖定與存檔的接線。 */
export interface DevLog { notices: string[]; events: string[]; removed: { path: string; ids: string[] }[]; tokens: ((state: EditorState) => IdToken[]) | null; save: Saver | null }
export interface IdsHost { app: App; readonly state: State | null; devLog: DevLog }

const sleep = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });
async function until(check: () => boolean, ms = 8000): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) { if (check()) return true; await sleep(50); }
  return check();
}
async function ensureFolder(app: App, folder: string): Promise<void> {
  let path = '';
  for (const part of folder.split('/')) {
    path = path ? path + '/' + part : part;
    if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
  }
}
async function writeFile(app: App, path: string, text: string): Promise<TFile> {
  await ensureFolder(app, path.slice(0, path.lastIndexOf('/')));
  const found = app.vault.getFileByPath(path);
  if (found) { await app.vault.modify(found, text); return found; }
  return app.vault.create(path, text);
}
async function open(app: App, file: TFile): Promise<{ leaf: WorkspaceLeaf; view: MarkdownView; cm: EditorView }> {
  const leaf = app.workspace.getLeaf('tab');
  await leaf.openFile(file);
  const view = leaf.view;
  if (!(view instanceof MarkdownView)) throw Error('不是 Markdown 分頁');
  return { leaf, view, cm: (view.editor as unknown as { cm: EditorView }).cm };
}
/** 每一個最上層、有 ID 的目標行剛好一個 ID 在行尾；名稱中間沒有程式格式的 ID。 */
function invariant(text: string): string[] {
  const problems: string[] = [];
  // 名稱中間或兩個 ID 用解析同一個辨識判斷（程式碼、公式、連結裡的字不算）。
  for (const [i, line] of text.split('\n').entries()) {
    if (/^ {0,3}[-*+] /.test(line) && nameIds(line).middle.length) problems.push(`第 ${i + 1} 行名稱中間有 ID：${line}`);
  }
  for (const problem of parseDeck(text).problems) if (problem.code === 'ambiguous-id' || problem.code === 'misplaced-id') problems.push(problem.code + ' 第 ' + (problem.line + 1) + ' 行');
  const ids = text.match(/(?<=[ \t]\^)[A-Za-z0-9-]+(?=\s*$)/gm) ?? [];
  if (new Set(ids).size !== ids.length) problems.push('ID 重複：' + ids.join(','));
  return problems;
}

const A = '- 能說明擴散 ^k3m9x2', B = '- 能說明溶解 ^p7q2w8';
const BASE = A + '\n    - Q1 :: A1\n' + B + '\n    - Q2 :: A2\n';
const nameEnd = A.indexOf(' ^');
const bLine = BASE.indexOf(B);

/** §8-7 I7：在 Essence W5/暫存/ 的卡組副本上用真的編輯器跑每一種操作；Live Preview 與 Source mode 各一次。 */
export async function lockTest(host: IdsHost): Promise<unknown> {
  const { app } = host;
  const folder = 'Essence W5/暫存';
  const file = await writeFile(app, folder + '/鎖定測試.md', BASE);
  const other = await writeFile(app, folder + '/鎖定測試 另一篇.md', '- 別的目標 ^aaaaaa\n    - Q :: A\n');
  await writeFile(app, folder + '/鎖定測試 連結.md', '[[鎖定測試#^k3m9x2]]\n');
  const { leaf, view, cm } = await open(app, file);
  const tokens = () => (host.devLog.tokens?.(cm.state) ?? []).map(t => t.id);
  const removedSince = (count: number) => host.devLog.removed.slice(count).flatMap(entry => entry.ids);
  const key = (name: string, init: KeyboardEventInit = {}) => {
    cm.focus();
    cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: name, code: name, bubbles: true, cancelable: true, ...init }));
  };
  const type = (text: string, event = 'input.type') => { cm.dispatch({ ...cm.state.replaceSelection(text), userEvent: event, scrollIntoView: true }); };
  const clip = (kind: 'copy' | 'cut' | 'paste', text = '') => {
    const data = new DataTransfer();
    if (kind === 'paste') data.setData('text/plain', text);
    cm.focus();
    cm.contentDOM.dispatchEvent(new ClipboardEvent(kind, { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData('text/plain');
  };
  const select = (anchor: number, head = anchor) => { cm.dispatch({ selection: { anchor, head } }); };
  const reset = (text = BASE) => { cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: text }, annotations: Transaction.addToHistory.of(false) }); };
  const line = (n: number) => cm.state.doc.line(n).text;
  type Scenario = [string, () => Promise<{ ok: boolean; note?: string }> | { ok: boolean; note?: string }];
  const scenarios: Scenario[] = [
    ['End 後游標停在名稱最後（ID 前面）', () => { select(0); key('End'); return { ok: cm.state.selection.main.head === nameEnd, note: 'head ' + cm.state.selection.main.head }; }],
    ['名稱後面打字', () => { select(0); key('End'); type('的現象'); return { ok: line(1) === '- 能說明擴散的現象 ^k3m9x2' }; }],
    ['名稱後面貼上帶 ID 的文字', () => { select(nameEnd); clip('paste', '貼上 ^zzzzz9'); return { ok: line(1) === '- 能說明擴散貼上 ^k3m9x2' }; }],
    ['貼上程式碼、公式、連結（裡面像 ID 的字是正文，原樣保留）', () => {
      const pasted = ' `^p7q2w8` $x ^p7q2w8$ [[筆記 ^p7q2w8]] [說明 ^p7q2w8](筆記.md)';
      select(nameEnd); clip('paste', pasted);
      return { ok: line(1) === '- 能說明擴散' + pasted + ' ^k3m9x2', note: line(1) };
    }],
    ['中文組字（compositionstart／end 加上組字的交易）', () => {
      select(nameEnd);
      cm.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
      // 輸入法組字時，每一步取代上一步組好的字。
      type('ㄗ', 'input.type.compose');
      cm.dispatch({ changes: { from: nameEnd, to: nameEnd + 1, insert: '組' }, selection: { anchor: nameEnd + 1 }, userEvent: 'input.type.compose' });
      cm.dispatch({ changes: { from: nameEnd, to: nameEnd + 1, insert: '組字' }, selection: { anchor: nameEnd + 2 }, userEvent: 'input.type.compose' });
      cm.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { data: '組字', bubbles: true }));
      return { ok: line(1) === '- 能說明擴散組字 ^k3m9x2', note: '不是真的輸入法：模擬組字的事件與 CodeMirror 組字時的交易' };
    }],
    ['名稱最後按 Enter', () => { select(nameEnd); key('Enter'); return { ok: line(1) === A && !line(2).includes('^'), note: '第 2 行：' + JSON.stringify(line(2)) }; }],
    ['名稱最後按 Backspace（刪名稱最後一個字，ID 不動）', () => { select(nameEnd); key('Backspace'); return { ok: line(1) === '- 能說明擴 ^k3m9x2' }; }],
    ['在 ID 前面的空白前按 Delete（ID 與空白不動）', () => { select(nameEnd); key('Delete'); return { ok: cm.state.doc.toString() === BASE }; }],
    ['選一段跨到 ID 再打字', () => { select(4, A.length); type('新的名稱'); return { ok: line(1) === '- 能說新的名稱 ^k3m9x2' }; }],
    ['選一段跨到 ID 再貼上', () => { select(4, A.length); clip('paste', '貼上的名稱'); return { ok: line(1) === '- 能說貼上的名稱 ^k3m9x2' }; }],
    ['Home 後打字', () => { select(nameEnd); key('Home'); type('甲'); return { ok: line(1).endsWith(' ^k3m9x2') && line(1).includes('甲'), note: line(1) }; }],
    ['拖放一段文字到名稱尾', () => {
      const at = cm.coordsAtPos(nameEnd);
      if (!at) return { ok: false, note: '拿不到座標' };
      const data = new DataTransfer();
      data.setData('text/plain', '拖來的');
      cm.contentDOM.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: at.left, clientY: (at.top + at.bottom) / 2, bubbles: true, cancelable: true }));
      return { ok: line(1).endsWith(' ^k3m9x2') && line(1).includes('拖來的'), note: line(1) };
    }],
    // 縮排之後那一行不是最上層的目標（不再鎖），ID 仍在它自己那一行的最後。
    ['清單縮排（Tab）', () => { select(bLine + 3); key('Tab'); return { ok: /^\s+- 能說明溶解 \^p7q2w8$/m.test(cm.state.doc.toString()) && tokens().join() === 'k3m9x2', note: JSON.stringify(cm.state.doc.toString()) }; }],
    ['上下移動整行（命令 editor:swap-line-up）', () => {
      select(bLine + 3);
      (app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById('editor:swap-line-up');
      return { ok: cm.state.doc.toString().split('\n').includes(B) && tokens().length === 2, note: JSON.stringify(cm.state.doc.toString()) };
    }],
    ['Undo／Redo', () => {
      select(nameEnd); type('的現象');
      view.editor.undo();
      const undone = cm.state.doc.toString();
      view.editor.redo();
      return { ok: undone === BASE && line(1) === '- 能說明擴散的現象 ^k3m9x2', note: 'undo 後：' + JSON.stringify(undone) };
    }],
    ['Undo 掉存檔補上的 ID：鎖定回報拿掉，Redo 回報補回', () => {
      const seen: string[] = [];
      cm.dispatch({ effects: StateEffect.appendConfig.of(EditorView.updateListener.of(update => {
        for (const tr of update.transactions) if (tr.docChanged) seen.push(String(tr.annotation(Transaction.userEvent)));
      })) });
      reset(BASE.replace(' ^k3m9x2', ''));
      view.editor.transaction({ changes: [{ from: view.editor.offsetToPos(nameEnd), to: view.editor.offsetToPos(nameEnd), text: ' ^k3m9x2' }] });
      const count = host.devLog.removed.length, events = host.devLog.events.length;
      view.editor.undo();
      const undone = cm.state.doc.toString();
      view.editor.redo();
      return { ok: undone === BASE.replace(' ^k3m9x2', '') && removedSince(count).includes('k3m9x2') && host.devLog.events.slice(events).some(e => e.includes('補回 k3m9x2')),
        note: 'userEvent：' + seen.join(',') + '；紀錄：' + host.devLog.events.slice(events).join('；') };
    }],
    ['刪掉整個目標（removedInEditor 收到）', () => {
      const count = host.devLog.removed.length;
      select(0, bLine); key('Delete');
      return { ok: cm.state.doc.toString() === BASE.slice(bLine) && removedSince(count).includes('k3m9x2'), note: '收到：' + removedSince(count).join(',') };
    }],
    ['剪下整個目標貼到另一篇（ID 跟著走）', async () => {
      const count = host.devLog.removed.length;
      select(0, bLine);
      const cut = clip('cut');
      const second = await open(app, other);
      second.cm.dispatch({ selection: { anchor: second.cm.state.doc.length } });
      second.cm.focus();
      const data = new DataTransfer();
      data.setData('text/plain', cut);
      second.cm.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      const pasted = second.cm.state.doc.toString();
      second.cm.dispatch({ changes: { from: 0, to: pasted.length, insert: '- 別的目標 ^aaaaaa\n    - Q :: A\n' }, annotations: Transaction.addToHistory.of(false) });
      second.leaf.detach();
      app.workspace.setActiveLeaf(leaf, { focus: true });
      return { ok: cut.includes(' ^k3m9x2') && pasted.includes(A) && removedSince(count).includes('k3m9x2') && invariant(pasted).length === 0, note: '貼上後：' + JSON.stringify(pasted) };
    }],
    ['只選目標那一行刪掉（整行清空，不留孤立的 ID）', () => {
      const count = host.devLog.removed.length;
      select(0, A.length); key('Delete');
      return { ok: !cm.state.doc.toString().includes('k3m9x2') && removedSince(count).includes('k3m9x2'), note: JSON.stringify(cm.state.doc.toString()) };
    }],
    ['跨兩個目標的一部分剪下再貼上', () => {
      select(4, bLine + 4);
      const cut = clip('cut');
      const middle = cm.state.doc.toString();
      select(4); clip('paste', cut);
      return { ok: cm.state.doc.toString() === BASE && !middle.includes('k3m9x2') && middle.includes('p7q2w8'), note: '剪下後：' + JSON.stringify(middle) };
    }],
    ['全選取代', () => {
      const count = host.devLog.removed.length;
      select(0, cm.state.doc.length); type('新內容');
      return { ok: cm.state.doc.toString() === '新內容' && removedSince(count).sort().join() === 'k3m9x2,p7q2w8' };
    }],
    ['同一篇開兩個分頁：另一個分頁看到同樣的文字與鎖定', async () => {
      const second = await open(app, file);
      app.workspace.setActiveLeaf(leaf, { focus: true });
      select(nameEnd); type('丙');
      const same = await until(() => second.cm.state.doc.toString() === cm.state.doc.toString(), 3000);
      const locked = (host.devLog.tokens?.(second.cm.state) ?? []).map(t => t.id).join();
      second.leaf.detach();
      app.workspace.setActiveLeaf(leaf, { focus: true });
      return { ok: same && locked === 'k3m9x2,p7q2w8' && line(1) === '- 能說明擴散丙 ^k3m9x2', note: '另一個分頁的鎖定：' + locked };
    }],
    ['[[筆記#^id]] 的連結跳轉', async () => {
      await app.workspace.openLinkText('鎖定測試#^k3m9x2', folder + '/鎖定測試 連結.md', false);
      await sleep(500);
      const active = app.workspace.getActiveViewOfType(MarkdownView);
      const at = active?.editor.getCursor();
      return { ok: active?.file?.path === file.path && at?.line === 0, note: '游標：' + JSON.stringify(at) };
    }],
    ['複製整行（沒有選取）：剪貼簿內容含 ^id', () => { select(3); const copied = clip('copy'); return { ok: copied.includes(' ^k3m9x2'), note: JSON.stringify(copied) }; }],
    ['外部改檔拿掉 ID：編輯器重新載入，鎖定不補回也不回報', async () => {
      const count = host.devLog.removed.length;
      await app.vault.adapter.write(file.path, BASE.replace(' ^k3m9x2', ''));
      await until(() => !cm.state.doc.toString().includes('k3m9x2'), 5000);
      return { ok: cm.state.doc.toString() === BASE.replace(' ^k3m9x2', '') && removedSince(count).length === 0, note: JSON.stringify(cm.state.doc.toString()) };
    }],
  ];
  const results: unknown[] = [];
  for (const source of [false, true]) {
    await leaf.setViewState({ type: 'markdown', state: { ...leaf.getViewState().state, mode: 'source', source } });
    await sleep(300);
    for (const [name, run] of scenarios) {
      await app.vault.modify(file, BASE);
      await sleep(150);
      app.workspace.setActiveLeaf(leaf, { focus: true });
      reset();
      let outcome: { ok: boolean; note?: string };
      try { outcome = await run(); } catch (error) { outcome = { ok: false, note: String(error) }; }
      await sleep(50);
      const after = cm.state.doc.toString();
      const problems = name.startsWith('外部改檔') ? [] : invariant(after);
      results.push({ mode: source ? 'source' : 'live preview', name, ok: outcome.ok && !problems.length, after, ...(outcome.note ? { note: outcome.note } : {}), ...(problems.length ? { problems } : {}) });
    }
  }
  leaf.detach();
  return { passed: results.filter(r => (r as { ok: boolean }).ok).length, failed: results.filter(r => !(r as { ok: boolean }).ok).length, results };
}

/** save 命令每個情境用自己的新卡組，結束時整個資料夾刪掉。 */
const TRIAL_FOLDER = 'Essence Cards/W5 範例/存檔測試';
const TRIAL_TEXT = '---\n科目: 自然\n---\n- 能說明蒸發\n    - 水變成水蒸氣叫什麼？ :: 蒸發\n- 能說明凝結\n    - 水蒸氣變成水叫什麼？ :: 凝結\n';

/** §8-7 I8：存檔按鈕的三種樣子、按下去補 ID、離開筆記的備援、外部弄丟 ID 之後的小視窗。 */
export async function saveTest(host: IdsHost): Promise<unknown> {
  const { app } = host;
  const state = host.state;
  if (!state) throw Error('state 還沒建立');
  await state.ready();
  const out: Record<string, unknown> = {};
  const events = host.devLog.events.length;
  // 前一次留下沒關的小視窗先關掉。
  Array.from(document.querySelectorAll('.modal-container')).filter(el => el.querySelector('.essence-cards-issue')).forEach(el => { el.remove(); });
  const button = (view: MarkdownView) => view.containerEl.querySelector<HTMLElement>('.essence-cards-save');
  const look = (view: MarkdownView) => {
    host.devLog.save?.refresh();
    const el = button(view);
    return el ? { tip: el.getAttribute('aria-label'), kind: ['done', 'missing', 'issues'].find(kind => el.hasClass('is-' + kind)) } : null;
  };
  // 每個情境一篇新的、沒有 ID 的卡組。不改寫舊的：直接改寫會被當成在編輯器以外弄丟 ID（那正是 §8-5 要抓的）；
  // 也不刪了再建同名檔：iCloud 會把那個檔鎖住一段時間（2026-10-25 實測）。
  let trial = '', count = 0;
  const stamp = Date.now().toString(36);
  async function fresh(): Promise<TFile> {
    trial = `${TRIAL_FOLDER}/試用 ${stamp}-${++count}（卡片）.md`;
    const created = await writeFile(app, trial, TRIAL_TEXT);
    await until(() => state!.deckStatus(trial).missing === 2);
    return created;
  }
  // 1. 兩個目標沒有 ID：醒目。不是卡組的筆記沒有按鈕。
  let file = await fresh();
  const first = await open(app, file);
  out.missing = look(first.view);
  out.missingExpected = TIPS.missing(2);
  const plain = await writeFile(app, 'Essence W5/暫存/一般筆記.md', '一般筆記\n');
  const other = await open(app, plain);
  out.plainNoteHasButton = !!button(other.view);
  other.leaf.detach();
  // 2. 按存檔：補好、提示、按鈕變淡；游標與選取沒變；Undo 一次復原。
  app.workspace.setActiveLeaf(first.leaf, { focus: true });
  const editor = first.view.editor;
  const target = TRIAL_TEXT.split('\n').findIndex(lineText => lineText.includes('水蒸氣變成水'));
  editor.setSelection({ line: target, ch: 6 }, { line: target, ch: 9 });
  const selectedBefore = { text: editor.getSelection(), from: editor.getCursor('from'), to: editor.getCursor('to') };
  const notices = host.devLog.notices.length;
  button(first.view)?.click();
  // 按鈕的存檔要等寫進磁碟、核對讀取之後才有結果（tasks/state-writes.md §7）：同一篇還沒結束時 save 回傳同一個 Promise。
  await host.devLog.save?.save(first.view);
  const filled = editor.getValue();
  out.filled = filled;
  out.notice = host.devLog.notices.slice(notices);
  out.noticeExpected = TIPS.added(2);
  const selectedAfter = { text: editor.getSelection(), from: editor.getCursor('from'), to: editor.getCursor('to') };
  out.selection = { before: selectedBefore, after: selectedAfter };
  out.selectionSame = JSON.stringify(selectedBefore) === JSON.stringify(selectedAfter);
  await sleep(300);
  out.done = look(first.view);
  out.doneExpected = TIPS.done;
  editor.undo();
  out.undoRestores = editor.getValue() === TRIAL_TEXT;
  editor.redo();
  out.redoAgain = editor.getValue() === filled;
  // 3. 外部（Obsidian 以外）拿掉一個 ID：按鈕變警示，小視窗的文字與按鈕，選「還原」後 ID 回來。
  await sleep(2500);
  const id = /能說明蒸發 \^([a-z0-9]{6})/.exec(filled)?.[1] ?? '';
  await app.vault.adapter.write(trial, filled.replace(' ^' + id, ''));
  await until(() => state.deckStatus(trial).issues.length === 1);
  out.issueFound = state.deckStatus(trial).issues.map(issue => ({ ...issue }));
  out.eventsAtIssue = host.devLog.events.slice(events);
  await until(() => !editor.getValue().includes(id), 3000);
  out.issues = look(first.view);
  out.beforeClick = { editorReloaded: !editor.getValue().includes(id), editor: editor.getValue(), issues: state.deckStatus(trial).issues.map(issue => ({ ...issue })) };
  out.issuesExpected = TIPS.issues(1);
  button(first.view)?.click();
  await host.devLog.save?.save(first.view);
  await sleep(300);
  out.afterClick = { editor: editor.getValue(), issues: state.deckStatus(trial).issues.map(issue => ({ ...issue })), events: host.devLog.events.slice(events) };
  const modal = Array.from(document.querySelectorAll('.modal-container .essence-cards-issue')).at(-1);
  out.modal = { text: modal?.querySelector('p')?.textContent, buttons: Array.from(modal?.querySelectorAll('button') ?? []).map(b => b.textContent) };
  out.modalExpected = { text: MESSAGES.lost('能說明蒸發'), buttons: [BUTTONS.restore, BUTTONS.fresh] };
  (modal?.querySelector('button.mod-cta') as HTMLElement | null)?.click();
  await sleep(300);
  out.restored = editor.getValue().includes('能說明蒸發 ^' + id);
  out.modalClosed = !!modal && !modal.isConnected;
  out.staleModals = document.querySelectorAll('.modal-container .essence-cards-issue').length;
  out.afterRestore = look(first.view);
  first.leaf.detach();
  // 4. 離開筆記的備援：開著一個分頁（等 2 秒）、開到第二個分頁並關掉一個、兩個都關掉之後（等 2 秒）。
  await sleep(2500);
  file = await fresh();
  const timeline: { step: string; hasIds: boolean; text: string }[] = [];
  const snap = async (step: string) => { const text = await app.vault.read(file); timeline.push({ step, hasIds: /\^[a-z0-9]{6}$/m.test(text), text }); };
  const one = await open(app, file);
  await sleep(2000); await snap('開在一個分頁（等 2 秒）');
  const two = await open(app, file);
  one.leaf.detach();
  await sleep(2000); await snap('開到第二個分頁並關掉一個（等 2 秒）');
  two.leaf.detach();
  await sleep(2500); await snap('兩個都關掉之後（等 2.5 秒）');
  out.leave = timeline;
  out.leaveOk = timeline.map(t => t.hasIds).join() === 'false,false,true';
  // Codex 審查第二部分要補證據的情境。
  const idCount = (text: string) => (text.match(/ \^[a-z0-9]{6}$/gm) ?? []).length;
  const restoreButton = () => Array.from(document.querySelectorAll<HTMLElement>('.modal-container .essence-cards-issue button.mod-cta')).at(-1);
  const addTarget = (view: MarkdownView) => { view.editor.replaceRange('- 能說明沸騰\n    - 水沸騰時是幾度？ :: 100 度\n', { line: view.editor.lastLine(), ch: 0 }); };
  // 5.（F1）小視窗開著時，那個目標的題目在 Obsidian 以外改了：小視窗換成現在的內容（舊的按鈕不在了），新的「還原」照常。
  file = await fresh();
  const stale = await open(app, file);
  await until(() => { host.devLog.save?.refresh(); return !!button(stale.view); });
  button(stale.view)?.click();
  await host.devLog.save?.save(stale.view);
  await sleep(2500);
  const staleFilled = stale.view.editor.getValue();
  const staleId = /能說明蒸發 \^([a-z0-9]{6})/.exec(staleFilled)?.[1] ?? '';
  await app.vault.adapter.write(trial, staleFilled.replace(' ^' + staleId, ''));
  await until(() => state.deckStatus(trial).issues.length === 1);
  await until(() => !stale.view.editor.getValue().includes(staleId), 3000);
  button(stale.view)?.click();
  await host.devLog.save?.save(stale.view);
  await sleep(300);
  const oldButton = restoreButton();
  const edited = staleFilled.replace(' ^' + staleId, '').replace('水變成水蒸氣叫什麼？', '水加熱變成水蒸氣叫什麼？');
  await app.vault.adapter.write(trial, edited);
  await until(() => stale.view.editor.getValue() === edited, 3000);
  await until(() => !oldButton?.isConnected, 3000);
  restoreButton()?.click();
  await sleep(300);
  const afterStale = stale.view.editor.getValue();
  out.staleModal = { oldButtonGone: !!oldButton && !oldButton.isConnected, restored: afterStale.includes('能說明蒸發 ^' + staleId) && afterStale.includes('水加熱'), text: afterStale };
  stale.leaf.detach();
  await sleep(2500);
  // 6. 打完字、還沒重讀就按存檔：提示的數量是這次真的補上的。
  file = await fresh();
  const typed = await open(app, file);
  await until(() => { host.devLog.save?.refresh(); return !!button(typed.view); });
  addTarget(typed.view);
  const typedNotices = host.devLog.notices.length;
  button(typed.view)?.click();
  await host.devLog.save?.save(typed.view);
  out.typedNotice = host.devLog.notices.slice(typedNotices);
  typed.leaf.detach();
  await sleep(2500);
  // 7. 打完字馬上關分頁：檔案裡有剛打的字，也補了 ID，沒有誤報。
  file = await fresh();
  const quick = await open(app, file);
  addTarget(quick.view);
  quick.leaf.detach();
  await sleep(2500);
  const quickText = await app.vault.read(file);
  out.closeRightAway = { hasTyped: quickText.includes('能說明沸騰'), ids: idCount(quickText), issues: state.deckStatus(trial).issues.length, text: quickText };
  // 8. 改名開著的卡組：舊路徑不補、新路徑還開著也不補，沒有問題；關掉之後在新路徑補。
  file = await fresh();
  const renamedPath = trial.replace('（卡片）', ' 改名（卡片）');
  const renaming = await open(app, file);
  await app.vault.rename(file, renamedPath);
  await sleep(2500);
  const whileOpen = await app.vault.read(file);
  const renameIssues = state.deckStatus(renamedPath).issues.length;
  renaming.leaf.detach();
  await sleep(2500);
  const afterClose = await app.vault.read(file);
  out.rename = { whileOpen: idCount(whileOpen), issues: renameIssues, afterClose: idCount(afterClose) };
  // 9. 開在另一個視窗：主視窗的分頁關掉時另一個視窗還開著，不補；那個視窗也關掉之後才補。
  file = await fresh();
  const inMain = await open(app, file);
  const popout = app.workspace.openPopoutLeaf();
  await popout.openFile(file);
  await sleep(500);
  inMain.leaf.detach();
  await sleep(2500);
  const popoutOpen = await app.vault.read(file);
  popout.detach();
  await sleep(2500);
  const popoutClosed = await app.vault.read(file);
  out.popout = { whileOpen: idCount(popoutOpen), afterClose: idCount(popoutClosed) };
  // 10.（Codex 再審的 R3）開到背景分頁、什麼都不改就關掉：仍然補。
  file = await fresh();
  const background = app.workspace.getLeaf('tab');
  await background.openFile(file, { active: false });
  background.detach();
  await sleep(2500);
  out.openOnly = { ids: idCount(await app.vault.read(file)) };
  out.events = host.devLog.events.slice(events);
  // 清掉這次建的卡組（只刪，不再建同名檔）。
  const folder = app.vault.getAbstractFileByPath(TRIAL_FOLDER);
  if (folder) await app.vault.delete(folder, true);
  out.checks = {
    staleModal: (out.staleModal as { oldButtonGone: boolean; restored: boolean }).oldButtonGone && (out.staleModal as { restored: boolean }).restored,
    typedNotice: (out.typedNotice as string[]).includes(TIPS.added(3)),
    closeRightAway: (out.closeRightAway as { hasTyped: boolean; ids: number; issues: number }).hasTyped && (out.closeRightAway as { ids: number }).ids === 3 && (out.closeRightAway as { issues: number }).issues === 0,
    rename: JSON.stringify(out.rename) === JSON.stringify({ whileOpen: 0, issues: 0, afterClose: 2 }),
    popout: JSON.stringify(out.popout) === JSON.stringify({ whileOpen: 0, afterClose: 2 }),
    openOnly: (out.openOnly as { ids: number }).ids === 2,
    missing: (out.missing as { tip?: string } | null)?.tip === TIPS.missing(2),
    plainNoNoteButton: out.plainNoteHasButton === false,
    filled: invariant(filled).length === 0 && (filled.match(/\^[a-z0-9]{6}$/gm) ?? []).length === 2,
    notice: (out.notice as string[]).includes(TIPS.added(2)),
    selection: out.selectionSame,
    done: (out.done as { tip?: string } | null)?.tip === TIPS.done,
    undo: out.undoRestores,
    issues: (out.issues as { tip?: string } | null)?.tip === TIPS.issues(1),
    modal: JSON.stringify(out.modal) === JSON.stringify(out.modalExpected),
    restored: out.restored && out.modalClosed,
    leave: out.leaveOk,
  };
  return out;
}

// Codex 第三次審查的 T1：layout 已經 ready 時重新啟用外掛，第一個事件就是關掉原本開著的卡組。
// 分兩個命令，中間重新啟用外掛（URI 的 reload）或重新載入整個 Obsidian 視窗（app-reload，冷啟動）：t1prep 建兩篇沒有 ID 的卡組
// 開在背景分頁（不改字）；t1close 直接關掉它們，包括冷啟動後還沒載入的分頁，記下每個分頁關掉前是不是未載入（A3 設計稿〈Codex 回應〉第 3 題）。
const T1_FOLDER = 'Essence Cards/W5 範例/重新啟用測試';
const t1Leaves = (app: App) => app.workspace.getLeavesOfType('markdown').filter(leaf => leafPath(leaf)?.startsWith(T1_FOLDER + '/'));
export async function t1Prep(host: IdsHost): Promise<unknown> {
  const { app } = host;
  // 上一次沒跑 t1close 留下的先清掉，t1close 才能核對「剛好是這次建的兩篇」。
  const old = app.vault.getAbstractFileByPath(T1_FOLDER);
  if (old) await app.vault.delete(old, true);
  const stamp = Date.now().toString(36);
  const files = await Promise.all(['甲', '乙'].map(name => writeFile(app, `${T1_FOLDER}/重新啟用 ${name} ${stamp}（卡片）.md`, TRIAL_TEXT)));
  if (host.state) await until(() => files.every(file => host.state!.deckStatus(file.path).missing === 2));
  for (const file of files) await app.workspace.getLeaf('tab').openFile(file, { active: false });
  return { leaves: t1Leaves(app).map(leaf => ({ path: leafPath(leaf), deferred: leaf.isDeferred })), texts: await Promise.all(files.map(file => app.vault.read(file))) };
}
/**
 * cold：冷啟動那一組（app-reload 之後），至少要有一個分頁是未載入的。通過要全部成立（Codex L2 的 R2）：t1prep 建的兩篇都還開著、
 * 關之前都沒有 ID（啟動與重新啟用時沒有寫）、關之後各補 2 個、拿掉 ID 和原文相同、沒有待處理的問題。
 */
export async function t1Close(host: IdsHost, cold = false): Promise<unknown> {
  const { app } = host;
  const files = app.vault.getFiles().map(file => file.path).filter(path => path.startsWith(T1_FOLDER + '/')).sort();
  const leaves = t1Leaves(app);
  const before = leaves.map(leaf => ({ path: leafPath(leaf) ?? '', deferred: leaf.isDeferred }));
  // 找不到分頁時也先清掉這次建的卡組，不留在 vault 裡變成 iPhone 上的卡組。
  if (!before.length) throw Error('找不到 t1prep 開的分頁；還留著的路徑：' + JSON.stringify(await removeTestPaths(app, [T1_FOLDER])));
  const count = (text: string) => (text.match(/ \^[a-z0-9]{6}$/gm) ?? []).length;
  const idsBefore = await Promise.all(files.map(async path => count(await app.vault.adapter.read(path))));
  const events = host.devLog.events.length;
  for (const leaf of leaves) leaf.detach();
  await sleep(2500);
  const texts = await Promise.all(files.map(path => app.vault.adapter.read(path)));
  const result = {
    files, leaves: before, idsBefore, ids: texts.map(count),
    issues: files.map(path => host.state?.deckStatus(path).issues.length ?? -1),
    events: host.devLog.events.slice(events),
  };
  const checks = {
    twoDecksOpen: files.length === 2 && files.every(path => before.some(leaf => leaf.path === path)),
    noWriteBeforeClose: idsBefore.every(n => n === 0),
    filled: result.ids.every(n => n === 2),
    textKept: texts.every(text => text.replace(/ \^[a-z0-9]{6}$/gm, '') === TRIAL_TEXT),
    noIssues: result.issues.every(n => n === 0),
    ...(cold ? { deferred: before.some(leaf => leaf.deferred) } : {}),
  };
  const cleanupLeft = await removeTestPaths(app, [T1_FOLDER]);
  return { ...result, checks, cleanupLeft, ok: Object.values(checks).every(Boolean) };
}

// ── save-flow：tasks/state-writes.md §9 的 Windows 實測（V1～V7）：存檔排進寫入的那一列、view.save() 加核對讀取 ──
// 每個情境一篇新的、沒有 ID 的卡組；每一步記下磁碟的文字（Files.read）、編輯器的文字、deckStatus，以及這段時間的 vault 事件與
// Files 通知，在存檔的 Promise 完成前、後各記一次。V6 的 B 被蓋掉、或 persist 完成時磁碟還不是編輯器的內容，結果檔標出來，由 AI 停下來回報。

const FLOW_FOLDER = 'Essence Cards/W5 範例/存檔流程';
const FLOW_TEXT = '- 能說明擴散\n    - 擴散是什麼？ :: 粒子由濃度高往濃度低移動\n- 能說明溶解\n    - 溶解是什麼？ :: 溶質均勻分散在溶劑中\n';
const FLOW_B = '- 能說明蒸發 ^vflowb\n    - 蒸發是什麼？ :: 液體表面變成氣體\n';

/** 這段時間的 vault 事件與 Files 通知（只記這個資料夾的）。 */
function flowRecorder(app: App): { take: () => string[]; stop: () => void } {
  const started = performance.now();
  let list: string[] = [];
  const push = (line: string, path: string) => { if (path.startsWith(FLOW_FOLDER)) list.push(`${String(Math.round(performance.now() - started))} ${line} ${path.slice(FLOW_FOLDER.length + 1)}`); };
  const refs = [
    app.vault.on('create', file => { push('create', file.path); }),
    app.vault.on('modify', file => { push('modify', file.path); }),
    app.vault.on('delete', file => { push('delete', file.path); }),
    app.vault.on('rename', (file, from) => { push('rename ← ' + from.slice(FLOW_FOLDER.length + 1), file.path); }),
  ];
  const stopFiles = createObsidianFiles(app).watch(path => { push('notify', path); });
  return {
    take: () => { const taken = list; list = []; return taken; },
    stop: () => { for (const ref of refs) app.vault.offref(ref); stopFiles(); },
  };
}

export async function saveFlow(host: IdsHost): Promise<unknown> {
  const { app } = host;
  const state = host.state, saver = host.devLog.save;
  if (!state || !saver) throw Error('state 或存檔接線還沒建立');
  await state.ready();
  const files = createObsidianFiles(app);
  const rendering = keepRendering();
  const rec = flowRecorder(app);
  const stamp = Date.now().toString(36);
  let count = 0;
  const out: Record<string, unknown> = { renderingBefore: rendering.before };
  const ids = (text: string | null) => (text?.match(/ \^[a-z0-9]{6}$/gm) ?? []).length;
  async function fresh(text = FLOW_TEXT): Promise<{ file: TFile; path: string }> {
    const path = `${FLOW_FOLDER}/流程 ${stamp}-${String(++count)}（卡片）.md`;
    const file = await writeFile(app, path, text);
    await until(() => state?.deckStatus(path).missing === 2);
    return { file, path };
  }
  const t0 = performance.now();
  async function snap(step: string, path: string, view: MarkdownView | null): Promise<Record<string, unknown>> {
    return { step, ms: Math.round(performance.now() - t0), disk: await files.read(path), editor: view && view.file?.path === path ? view.editor.getValue() : null,
      status: state?.deckStatus(path), events: rec.take() };
  }
  /** persist 完成那一刻的磁碟與編輯器（包住這個 view 的 save）。 */
  function watchPersist(view: MarkdownView, path: string): { at: { disk: string | null; editor: string; same: boolean }[]; restore: () => void } {
    const at: { disk: string | null; editor: string; same: boolean }[] = [];
    const original = view.save.bind(view);
    view.save = async (clear?: boolean) => {
      await original(clear);
      const disk = await files.read(path), editor = view.editor.getValue();
      at.push({ disk, editor, same: disk === editor });
    };
    return { at, restore: () => { view.save = original; } };
  }
  const notices = () => host.devLog.notices.length;
  try {
    // V1 一般的存檔。
    {
      const { file, path } = await fresh();
      const { leaf, view } = await open(app, file);
      await sleep(500);
      const persist = watchPersist(view, path);
      const before = notices();
      const steps = [await snap('按下前', path, view)];
      const started = performance.now();
      const saving = saver.save(view);
      steps.push(await snap('按下後（Promise 完成前）', path, view));
      await saving;
      const ms = Math.round(performance.now() - started);
      steps.push(await snap('Promise 完成後', path, view));
      persist.restore();
      out.V1 = { ms, persisted: persist.at, notices: host.devLog.notices.slice(before), steps };
      leaf.detach();
    }
    // V2 N1：打一個字，等到這篇的 modify 事件（自動存檔）後 100 ms 內按存檔；之後 3 秒每 50 ms 看一次 deckStatus。
    {
      const { file, path } = await fresh();
      const { leaf, view } = await open(app, file);
      await sleep(500);
      rec.take();
      let modified = 0;
      const ref = app.vault.on('modify', changed => { if (changed.path === path) modified = performance.now(); });
      view.editor.replaceRange('，', { line: 1, ch: view.editor.getLine(1).length });
      await until(() => modified > 0, 5000);
      const gap = Math.round(performance.now() - modified);
      const steps = [await snap('自動存檔之後', path, view)];
      const saving = saver.save(view);
      const seen: string[] = [];
      const polling = (async () => {
        const end = performance.now() + 3000;
        while (performance.now() < end) {
          const issues = state.deckStatus(path).issues;
          if (issues.length) seen.push(`${String(Math.round(performance.now() - t0))} ${JSON.stringify(issues.map(issue => ({ ...issue })))}`);
          await sleep(50);
        }
      })();
      await saving;
      steps.push(await snap('Promise 完成後', path, view));
      await polling;
      app.vault.offref(ref);
      steps.push(await snap('3 秒後', path, view));
      out.V2 = { autosaveSeen: modified > 0, msAfterAutosave: gap, issuesSeen: seen, steps };
      leaf.detach();
    }
    // V3 同一個 tick 連按兩次按鈕。
    {
      const { file, path } = await fresh();
      const { leaf, view } = await open(app, file);
      await until(() => { saver.refresh(); return !!view.containerEl.querySelector('.essence-cards-save'); });
      const button = view.containerEl.querySelector<HTMLElement>('.essence-cards-save');
      const before = notices();
      button?.click();
      button?.click();
      await saver.save(view);
      await sleep(300);
      out.V3 = { ids: ids(view.editor.getValue()), notices: host.devLog.notices.slice(before), steps: [await snap('之後', path, view)] };
      leaf.detach();
    }
    // V4 兩個分頁開同一篇，在其中一個按存檔。
    {
      const { file, path } = await fresh();
      const one = await open(app, file);
      const two = await open(app, file);
      await sleep(500);
      const saving = saver.save(one.view);
      const steps = [await snap('Promise 完成前', path, one.view)];
      await saving;
      await sleep(300);
      steps.push(await snap('Promise 完成後', path, one.view));
      const disk = await files.read(path);
      out.V4 = { editorsAndDiskSame: one.view.editor.getValue() === disk && two.view.editor.getValue() === disk, second: two.view.editor.getValue(), steps };
      one.leaf.detach();
      two.leaf.detach();
    }
    // V5 按下後同一個 tick 換篇；另一次按下後立刻改名。
    {
      const { file, path } = await fresh();
      const other = await fresh();
      const { leaf, view } = await open(app, file);
      await sleep(500);
      const before = notices();
      const saving = saver.save(view);
      const switching = leaf.openFile(other.file);
      await saving;
      await switching;
      await sleep(1500);
      const otherDisk = await files.read(other.path);
      out.V5switch = { notices: host.devLog.notices.slice(before), otherUntouched: otherDisk === FLOW_TEXT,
        steps: [await snap('之後（原本那篇）', path, null), await snap('之後（換到的那篇）', other.path, view)] };
      leaf.detach();
      const renamed = await fresh();
      const tab = await open(app, renamed.file);
      await sleep(500);
      const newPath = renamed.path.replace('（卡片）', ' 改名（卡片）');
      const listed = (await files.list(FLOW_FOLDER)).length;
      const renameNotices = notices();
      const savingRename = saver.save(tab.view);
      const renaming = app.vault.rename(renamed.file, newPath);
      await savingRename;
      await renaming;
      await sleep(1500);
      out.V5rename = { notices: host.devLog.notices.slice(renameNotices), filesBefore: listed, filesAfter: (await files.list(FLOW_FOLDER)).length,
        oldPathIssues: state.deckStatus(renamed.path).issues.length, steps: [await snap('之後（新路徑）', newPath, tab.view)] };
      tab.leaf.detach();
    }
    // V6 外部用 adapter.write 把 B（含 ID）加進開著的這一篇：同一個 tick、50 ms 後、200 ms 後各按一次存檔。
    {
      const results: Record<string, unknown>[] = [];
      for (const wait of [0, 50, 200]) {
        const { file, path } = await fresh();
        const { leaf, view } = await open(app, file);
        await sleep(500);
        rec.take();
        const written = app.vault.adapter.write(path, FLOW_TEXT + FLOW_B);
        if (wait) await sleep(wait);
        const saving = saver.save(view);
        await written;
        await saving;
        await sleep(2500);
        const disk = await files.read(path);
        results.push({ wait, diskHasB: !!disk?.includes('能說明蒸發'), editorHasB: view.editor.getValue().includes('能說明蒸發'), steps: [await snap('2.5 秒後', path, view)] });
        leaf.detach();
      }
      out.V6 = results;
    }
    // V7 保存失敗：試著讓檔案暫時唯讀。
    {
      const { file, path } = await fresh();
      const { leaf, view } = await open(app, file);
      await sleep(500);
      const load = (window as unknown as { require?: (name: string) => unknown }).require;
      const fs = load?.('fs') as { chmodSync(path: string, mode: number): void } | undefined;
      const full = (app.vault.adapter as unknown as { getFullPath(path: string): string }).getFullPath(path);
      const before = notices();
      let made = false;
      try { fs?.chmodSync(full, 0o444); made = !!fs; } catch { made = false; }
      const persist = watchPersist(view, path);
      await saver.save(view);
      const whileReadOnly = { notices: host.devLog.notices.slice(before), persisted: persist.at.slice(), steps: [await snap('唯讀時存檔之後', path, view)] };
      try { fs?.chmodSync(full, 0o666); } catch { /* 下面的結果看得出來 */ }
      const again = notices();
      await saver.save(view);
      persist.restore();
      out.V7 = { readOnlyMade: made, whileReadOnly, afterWritable: { notices: host.devLog.notices.slice(again), steps: [await snap('恢復可寫後再存一次', path, view)] } };
      leaf.detach();
    }
  } finally {
    rec.stop();
    rendering.restore();
  }
  await sleep(2500);
  out.cleanupLeft = await removeTestPaths(app, [FLOW_FOLDER]);
  const v1 = out.V1 as { persisted: { same: boolean }[]; ms: number; notices: string[] };
  const v2 = out.V2 as { issuesSeen: string[]; autosaveSeen: boolean };
  const v3 = out.V3 as { ids: number; notices: string[] };
  const v5 = out.V5rename as { filesBefore: number; filesAfter: number; oldPathIssues: number };
  out.checks = {
    V1persistSame: v1.persisted.length > 0 && v1.persisted.every(each => each.same), V1oneNotice: v1.notices.length === 1, V1ms: v1.ms,
    V2noIssues: v2.autosaveSeen && !v2.issuesSeen.length,
    V3: v3.ids === 2 && v3.notices.length === 1,
    V4: (out.V4 as { editorsAndDiskSame: boolean }).editorsAndDiskSame,
    V5switchOtherUntouched: (out.V5switch as { otherUntouched: boolean }).otherUntouched,
    V5rename: v5.filesBefore === v5.filesAfter && v5.oldPathIssues === 0,
    V6bKept: (out.V6 as { diskHasB: boolean }[]).map(each => each.diskHasB),
  };
  return out;
}

/**
 * save-flow-v6：V6 的對照實驗。外部用 adapter.write 把 B（含 ID）加進開著的這一篇，同一個 tick 做下面三種事之一，每種 5 次，
 * 3 秒後看磁碟與編輯器有沒有 B：
 * - new：這個分支的存檔（state.save：Editor 交易後立刻 view.save()）；
 * - old：舊流程的模擬（只用 Editor 交易在第一個目標行尾加 ID，不呼叫 view.save()，等 Obsidian 約 2 秒後的自動存檔）；
 * - none：對照，什麼都不做（只看 Obsidian 自己怎麼接外部修改）。
 */
export async function saveFlowV6(host: IdsHost): Promise<unknown> {
  const { app } = host;
  const state = host.state, saver = host.devLog.save;
  if (!state || !saver) throw Error('state 或存檔接線還沒建立');
  await state.ready();
  const files = createObsidianFiles(app);
  const rendering = keepRendering();
  const stamp = Date.now().toString(36);
  let count = 0;
  const rows: { mode: string; run: number; diskHasB: boolean; editorHasB: boolean; diskHasEdit: boolean; issues: number }[] = [];
  try {
    for (const mode of ['new', 'old', 'none'] as const) {
      for (let run = 1; run <= 5; run++) {
        const path = `${FLOW_FOLDER}/對照 ${stamp}-${String(++count)}（卡片）.md`;
        const file = await writeFile(app, path, FLOW_TEXT);
        await until(() => state.deckStatus(path).missing === 2);
        const { leaf, view } = await open(app, file);
        await sleep(500);
        const mark = ` ^vold${String(count).padStart(2, '0')}`;
        const written = app.vault.adapter.write(path, FLOW_TEXT + FLOW_B);
        let saving: Promise<void> = Promise.resolve();
        if (mode === 'new') saving = saver.save(view);
        else if (mode === 'old') view.editor.replaceRange(mark, { line: 0, ch: view.editor.getLine(0).length });
        await written;
        await saving;
        await sleep(3000);
        const disk = await files.read(path) ?? '';
        rows.push({ mode, run, diskHasB: disk.includes('能說明蒸發'), editorHasB: view.editor.getValue().includes('能說明蒸發'),
          diskHasEdit: mode === 'new' ? / \^[a-z0-9]{6}$/m.test(disk.split('\n')[0]) : mode === 'old' ? disk.includes(mark) : true,
          issues: state.deckStatus(path).issues.length });
        leaf.detach();
        await sleep(300);
      }
    }
  } finally {
    rendering.restore();
  }
  await sleep(2500);
  const cleanupLeft = await removeTestPaths(app, [FLOW_FOLDER]);
  const summary = Object.fromEntries((['new', 'old', 'none'] as const).map(mode => {
    const mine = rows.filter(row => row.mode === mode);
    return [mode, { bKept: mine.filter(row => row.diskHasB).length, editKept: mine.filter(row => row.diskHasEdit).length, issues: mine.reduce((n, row) => n + row.issues, 0), of: mine.length }];
  }));
  return { summary, rows, cleanupLeft };
}
