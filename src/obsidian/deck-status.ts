import { MarkdownView, type App, type WorkspaceLeaf } from 'obsidian';
import type { DeckStatusValue, EditorHandle, State, WriteBlock, WriteResult } from '../state/index.ts';
import { editorOf } from './save.ts';

// 目錄的暫停／恢復（D-183 第 6 點、tasks/quiz-practice.md §5）：只在電腦。開著的筆記走編輯器（和存檔同一條），沒開著的走檔案（和離開筆記補 ID 同一條）。

/** 給家長看的提示：寫不進去時畫面不變，要說為什麼。 */
const STATUS_TIPS = {
  /** Obsidian 約 2 秒自動存一次，等一下就存好了。 */
  unsaved: '這篇筆記有還沒存進去的修改，狀態先不改；等一下再按一次',
  stale: '這篇筆記剛剛改過，請再按一次',
  failed: '這篇筆記暫時存不進去，狀態沒有改；請稍後再按一次',
  unwritable: '這篇筆記的屬性區寫法有問題，狀態沒有改；先打開筆記修好',
  blocked: '還有檔案沒讀到，狀態先不改；讀取完成後請再按一次',
  backup: '備份還沒成功，狀態先不改；到設定頁看原因',
  restore: '正在還原，狀態先不改；還原完再按一次',
  needsUpdate: '這篇筆記需要新版的外掛才讀得懂，更新外掛之前不能改狀態',
};
/** phone、closed 不提示：手機上沒有這個按鈕，關閉時畫面也不在了。 */
const BLOCKED: Partial<Record<WriteBlock | 'needs-update', string>> = { loading: STATUS_TIPS.blocked, unread: STATUS_TIPS.blocked, backup: STATUS_TIPS.backup, restore: STATUS_TIPS.restore, 'needs-update': STATUS_TIPS.needsUpdate };

function tipOf(result: WriteResult | { kind: 'unwritable' }): string | null {
  if (result.kind === 'blocked') return BLOCKED[result.reason] ?? null;
  if (result.kind === 'stale') return STATUS_TIPS.stale;
  if (result.kind === 'failed') return STATUS_TIPS.failed;
  if (result.kind === 'unwritable') return STATUS_TIPS.unwritable;
  return null;
}

const viewOf = (leaf: WorkspaceLeaf, path: string): MarkdownView | null => leaf.view instanceof MarkdownView && leaf.view.file?.path === path ? leaf.view : null;
/** 編輯器一律用 \n，檔案可能是 \r\n：換行不同不算有沒存的修改。 */
const sameText = (a: string, b: string): boolean => a.replace(/\r\n?/g, '\n') === b.replace(/\r\n?/g, '\n');

/** 暫停或恢復這一篇。回傳要提示的字，沒事是 null；不會 reject，寫不進去與讀不到都交給 onError。 */
export function changeDeckStatus(app: App, state: Pick<State, 'setDeckStatus'>, path: string, value: DeckStatusValue, onError: (error: unknown) => void): Promise<string | null> {
  return change(app, path, onError, editor => state.setDeckStatus(path, value, editor));
}
/** 草稿的「啟用」（tasks/ai-cards-mvp.md §7）：和暫停／恢復同一條路，只有草稿能改成啟用。 */
export function activateDeck(app: App, state: Pick<State, 'activateDraft'>, path: string, onError: (error: unknown) => void): Promise<string | null> {
  return change(app, path, onError, editor => state.activateDraft(path, editor));
}
async function change(app: App, path: string, onError: (error: unknown) => void, write: (editor: EditorHandle | null) => Promise<WriteResult | { kind: 'unwritable' }>): Promise<string | null> {
  try {
    const view = app.workspace.getLeavesOfType('markdown').map(leaf => viewOf(leaf, path)).find(each => each !== null) ?? null;
    if (view?.file && !sameText(view.editor.getValue(), await app.vault.read(view.file))) return STATUS_TIPS.unsaved;
    const result = await write(view && editorOf(view, path));
    if (result.kind === 'failed') onError(result.error);
    return tipOf(result);
  } catch (error) {
    onError(error);
    return STATUS_TIPS.failed;
  }
}
