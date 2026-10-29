import type { App, TFile } from 'obsidian';

/**
 * 開發命令的暫存檔：在 base 建一篇內容是 text 的檔、跑 run，結束後只清掉這次自己建的那一篇（Codex 再審與第二次再審的 F3）。
 * 不覆寫已有的檔：base.md 被占用就換 `base 2.md`、`base 3.md`…。清理時認的是建立時拿到的那個檔（Obsidian 對同一篇檔案一直是
 * 同一個 TFile，改名也不換）：原路徑上還是它、內容也還是這次寫的，讀完再確認一次才刪；內容相同的另一篇不算。沒刪掉、還在的
 * 這次的檔（被改過、被搬走），回報它現在的路徑在 left。run 失敗也照樣清理，再把錯誤丟出去。
 */
export async function withTempFile<T>(app: App, base: string, text: string, run: (path: string) => Promise<T>): Promise<{ result: T; path: string; left: string | null }> {
  let path = base + '.md';
  for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = `${base} ${String(n)}.md`;
  // vault.create 遇到已有的檔會丟錯，不覆寫；丟錯就是還沒建，不用清。
  const created: TFile = await app.vault.create(path, text);
  let outcome: { result: T } | { error: unknown };
  try { outcome = { result: await run(path) }; } catch (error) { outcome = { error }; }
  const here = (): boolean => app.vault.getFileByPath(path) === created;
  if (here() && await app.vault.read(created) === text && here()) await app.vault.delete(created);
  // 還在的就是沒刪掉的這次的檔（可能被搬到別的路徑）。
  const left = app.vault.getFileByPath(created.path) === created ? created.path : null;
  if ('error' in outcome) throw outcome.error;
  return { result: outcome.result, path, left };
}
