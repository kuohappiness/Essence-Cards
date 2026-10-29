import type { EditorHandle, IdIssue, State } from '../../src/state/index.ts';
import type { MemoryFiles } from './memory-files.ts';

/**
 * 記憶體的編輯器（tasks/state-writes.md §8 的測試替身，不是產品出口）：有自己的文字；persist 把文字寫進記憶體 Files
 * 並送通知，寫到「這個編輯器現在開著的路徑」（模擬 Obsidian 的 view.file：改名後就是新路徑，換篇後是別篇）。
 */
export interface MemoryEditor extends EditorHandle {
  /** 編輯器現在的文字。 */
  value: string;
  /** 這個編輯器現在開著的路徑；和 path 不同（換篇、改名）時 text() 回傳 null。 */
  open: string;
  /** apply 成功與 persist 被呼叫的次數。 */
  applies: number;
  persists: number;
  /** persist 失敗。 */
  fail: boolean;
  /** 下一次 persist 等 release 才寫（寫完才回傳）。 */
  hold(): { started: Promise<void>; release: () => void };
}

export function createMemoryEditor(memory: MemoryFiles, path: string, text: string): MemoryEditor {
  let held: { begin: () => void; wait: Promise<void> } | null = null;
  const editor: MemoryEditor = {
    path, value: text, open: path, applies: 0, persists: 0, fail: false,
    text: () => editor.open === path ? editor.value : null,
    apply(before, after) {
      if (editor.value !== before) return false;
      editor.value = after;
      editor.applies++;
      return true;
    },
    async persist() {
      editor.persists++;
      const wait = held;
      held = null;
      if (wait) { wait.begin(); await wait.wait; }
      if (editor.fail) throw Error('存不進去');
      // 內容和磁碟相同時不寫（Obsidian 的 save 沒有變更時也不寫）。
      if (memory.texts.get(editor.open) !== editor.value) memory.write(editor.open, editor.value);
    },
    hold() {
      let begin = (): void => {}, release = (): void => {};
      const started = new Promise<void>(resolve => { begin = resolve; });
      held = { begin, wait: new Promise<void>(resolve => { release = resolve; }) };
      return { started, release };
    },
  };
  return editor;
}

/**
 * 既有測試從 fillText／resolveText 換到 save／resolve 時用（限制第 3 點：原本一行的呼叫還是一行）：用 text 開一個記憶體編輯器存檔，
 * 回傳存檔之後編輯器的文字；resolveText 在結果不是 done 時回傳 null。
 */
export async function fillText(state: State, memory: MemoryFiles, path: string, text: string): Promise<string> {
  const editor = createMemoryEditor(memory, path, text);
  await state.save(editor);
  return editor.value;
}
export async function resolveText(state: State, memory: MemoryFiles, issue: IdIssue, choice: 'restore' | 'new', text: string): Promise<string | null> {
  const editor = createMemoryEditor(memory, issue.path, text);
  const result = await state.resolve(issue, choice, editor);
  return result.kind === 'done' ? editor.value : null;
}
