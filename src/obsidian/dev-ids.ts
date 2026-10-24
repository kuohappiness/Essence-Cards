import { MarkdownView, TFile } from 'obsidian';
import type { App, Plugin, WorkspaceLeaf } from 'obsidian';
import { StateEffect, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { parseDeck } from '../core/deck/index.ts';
import type { State } from '../state/index.ts';
import type { IdToken } from './lock.ts';
import { BUTTONS, MESSAGES, TIPS, type wireSave } from './save.ts';

// 開發命令 lock 與 save（W5 §8-7 的 I7、I8）：只在開發版建置。AI 在 Windows 版 Obsidian 用 URI 執行，
// 每一種操作都寫出操作後的文字或判斷，不只寫「通過」。

interface DevLog { notices: string[]; events: string[]; removed: { path: string; ids: string[] }[]; tokens: ((state: EditorState) => IdToken[]) | null; save: ReturnType<typeof wireSave> | null }
export interface IdsHost extends Plugin { state: State | null; devLog: DevLog }

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
  for (const [i, line] of text.split('\n').entries()) {
    if (/[ \t]\^[a-z0-9]{6}(?![A-Za-z0-9-])[^\n]*[ \t]\^[A-Za-z0-9-]+\s*$/.test(line)) problems.push(`第 ${i + 1} 行有兩個 ID：${line}`);
    else if (/[ \t]\^[abcdefghjkmnpqrstuvwxyz23456789]{6}(?![A-Za-z0-9-])\S/.test(line.replace(/[ \t]\^[A-Za-z0-9-]+\s*$/, ''))) problems.push(`第 ${i + 1} 行 ID 在中間：${line}`);
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

const TRIAL = 'Essence Cards/W5 範例/補 ID 試用（卡片）.md';
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
  // 重設成沒有 ID 的內容：先刪掉、等 state 忘掉上一版再建立；直接改寫會被當成在編輯器以外弄丟 ID（那正是 §8-5 要抓的）。
  async function fresh(): Promise<TFile> {
    const old = app.vault.getFileByPath(TRIAL);
    if (old) await app.vault.delete(old);
    await until(() => !state!.decks().some(entry => entry.path === TRIAL));
    const created = await writeFile(app, TRIAL, TRIAL_TEXT);
    await until(() => state!.deckStatus(TRIAL).missing === 2);
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
  await app.vault.adapter.write(TRIAL, filled.replace(' ^' + id, ''));
  await until(() => state.deckStatus(TRIAL).issues.length === 1);
  out.issueFound = state.deckStatus(TRIAL).issues.map(issue => ({ ...issue }));
  out.eventsAtIssue = host.devLog.events.slice(events);
  await until(() => !editor.getValue().includes(id), 3000);
  out.issues = look(first.view);
  out.beforeClick = { editorReloaded: !editor.getValue().includes(id), editor: editor.getValue(), issues: state.deckStatus(TRIAL).issues.map(issue => ({ ...issue })) };
  out.issuesExpected = TIPS.issues(1);
  button(first.view)?.click();
  await sleep(300);
  out.afterClick = { editor: editor.getValue(), issues: state.deckStatus(TRIAL).issues.map(issue => ({ ...issue })), events: host.devLog.events.slice(events) };
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
  out.events = host.devLog.events.slice(events);
  out.leaveOk = timeline.map(t => t.hasIds).join() === 'false,false,true';
  out.checks = {
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
