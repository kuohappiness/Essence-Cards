import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** 一個學習目標、一題（自編內容）。 */
export const goal = (id: string, answer = '答案 ' + id): string => `- 能說明 ${id} ^${id}\n    - 題目 ${id} :: ${answer}\n`;
/** 一行作答紀錄（syntax §5）。 */
export const review = (t: string, lt: string, r = 'good', v = '12345678'): string => JSON.stringify({ t, lt, r, v });

/**
 * 暫存資料夾裡的 vault：設定資料夾（預設 .obsidian）裡裝好外掛的 manifest.json，再放 files。測試結束時刪掉。
 * plugin: false 時不放外掛的 manifest.json（設定資料夾確定不了）。
 */
export async function makeVault(t: { after: (fn: () => Promise<void>) => void }, files: Record<string, string | Uint8Array>,
  { config = '.obsidian', plugin = true }: { config?: string; plugin?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'essence-vault-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = join(root, 'Vault');
  await mkdir(vault);
  if (plugin) await put(vault, config + '/plugins/essence-cards/manifest.json', '{"id":"essence-cards"}');
  for (const [path, content] of Object.entries(files)) await put(vault, path, content);
  return vault;
}

/** 暫存的空資料夾（備份位置等），測試結束時刪掉。 */
export async function tempFolder(t: { after: (fn: () => Promise<void>) => void }, prefix = 'essence-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export async function put(vault: string, path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(join(vault, path)), { recursive: true });
  await writeFile(join(vault, path), content);
}
