/**
 * 開發命令 a3check 每一步記下的東西（技術債 A3；Codex L2 的 R1）：
 * 看 ID 數（expect 是這時預期的 ID 數）、看存檔按鈕、必要的操作有沒有做到（done）、做不到的子項（skipped，寫原因）、只記下來的觀察（note）。
 */
export type Mark =
  | { at: string; deck: string; ids: number; expect: number; issues: number }
  | { at: string; button: string | null; expectButton: string | null }
  | { at: string; done: boolean; detail?: unknown }
  | { at: string; skipped: string }
  | { at: string; error: string }
  | { at: string; note: unknown };

export interface Judged { ok: boolean; failed: string[]; skipped: string[] }

/**
 * 一個情境通過：至少有一項真的檢查過（ID、按鈕或必要的操作），而且沒有一項不符或出錯。
 * skipped 不算通過也不算失敗，另外列出來；必要的操作沒做到（done 是 false）就算失敗，不能靠後面的 ID 相符過關。
 */
export function judge(marks: readonly Mark[]): Judged {
  const failed: string[] = [], skipped: string[] = [];
  let checked = 0;
  for (const mark of marks) {
    if ('error' in mark) failed.push(`${mark.at}：${mark.error}`);
    else if ('skipped' in mark) skipped.push(`${mark.at}：${mark.skipped}`);
    else if ('done' in mark) { checked++; if (!mark.done) failed.push(`${mark.at}：沒做到`); }
    else if ('expect' in mark) { checked++; if (mark.ids !== mark.expect || mark.issues !== 0) failed.push(`${mark.at}：${mark.deck} ID ${mark.ids}（預期 ${mark.expect}）、問題 ${mark.issues}`); }
    else if ('expectButton' in mark) { checked++; if (mark.button !== mark.expectButton) failed.push(`${mark.at}：按鈕 ${String(mark.button)}（預期 ${String(mark.expectButton)}）`); }
  }
  return { ok: checked > 0 && !failed.length, failed, skipped };
}
