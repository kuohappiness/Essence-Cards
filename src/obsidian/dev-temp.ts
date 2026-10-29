import type { App } from 'obsidian';

/**
 * 開發命令的暫存檔：在 base 建一篇內容是 text 的檔、跑 run，結束後只清掉這次自己建的那一篇（Codex 再審的 F3）。
 * 不覆寫已有的檔：base.md 被占用就換 `base 2.md`、`base 3.md`…；內容還是這次寫的才刪，被改過就留著，回報在 left。
 * run 失敗也照樣清理，再把錯誤丟出去。
 */
export async function withTempFile<T>(app: App, base: string, text: string, run: (path: string) => Promise<T>): Promise<{ result: T; path: string; left: string | null }> {
  let path = base + '.md';
  for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = `${base} ${String(n)}.md`;
  // vault.create 遇到已有的檔會丟錯，不覆寫；丟錯就是還沒建，不用清。
  await app.vault.create(path, text);
  let outcome: { result: T } | { error: unknown };
  try { outcome = { result: await run(path) }; } catch (error) { outcome = { error }; }
  const file = app.vault.getFileByPath(path);
  const mine = file !== null && await app.vault.read(file) === text;
  if (file && mine) await app.vault.delete(file);
  if ('error' in outcome) throw outcome.error;
  return { result: outcome.result, path, left: file && !mine ? path : null };
}
