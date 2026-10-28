/** 每一種紀錄用到的欄位，第一個是那一種一定要有的；一筆紀錄只能是其中一種（Codex L2 再審的 S3）。 */
const KINDS = {
  check: ['expect', 'deck', 'ids', 'issues'],
  button: ['expectButton', 'button'],
  done: ['done', 'detail'],
  skipped: ['skipped'],
  error: ['error'],
  note: ['note'],
} as const;
type Kind = keyof typeof KINDS;
type Field = (typeof KINDS)[keyof typeof KINDS][number];
/** 只有 T 的欄位，其他種類的欄位都不能出現。 */
type Only<T> = T & { [K in Exclude<Field, keyof T>]?: never };

/**
 * 開發命令 a3check 每一步記下的東西（技術債 A3；Codex L2 的 R1）：
 * 看 ID 數（expect 是這時預期的 ID 數）、看存檔按鈕、必要的操作有沒有做到（done）、做不到的子項（skipped，寫原因）、只記下來的觀察（note）。
 */
export type Mark =
  | Only<{ at: string; deck: string; ids: number; expect: number; issues: number }>
  | Only<{ at: string; button: string | null; expectButton: string | null }>
  | Only<{ at: string; done: boolean; detail?: unknown }>
  | Only<{ at: string; skipped: string }>
  | Only<{ at: string; error: string }>
  | Only<{ at: string; note: unknown }>;

export interface Judged { ok: boolean; failed: string[]; skipped: string[] }

/**
 * 一個情境通過：至少有一項真的檢查過（ID、按鈕或必要的操作），而且沒有一項不符或出錯。
 * skipped 不算通過也不算失敗，另外列出來；必要的操作沒做到（done 是 false）就算失敗，不能靠後面的 ID 相符過關。
 * 一筆紀錄混了兩種欄位（型別擋得住，這裡再擋一次）算失敗，不讓其中一種蓋掉另一種的結果。
 */
export function judge(marks: readonly Mark[]): Judged {
  const failed: string[] = [], skipped: string[] = [];
  let checked = 0;
  for (const mark of marks) {
    const kinds = (Object.keys(KINDS) as Kind[]).filter(kind => KINDS[kind].some(field => field in mark));
    if (kinds.length !== 1 || !(KINDS[kinds[0]][0] in mark)) { failed.push(`${mark.at}：一筆紀錄的種類是 ${kinds.join('、') || '無'}`); continue; }
    if ('error' in mark) failed.push(`${mark.at}：${mark.error}`);
    else if ('skipped' in mark) skipped.push(`${mark.at}：${mark.skipped}`);
    else if ('done' in mark) { checked++; if (!mark.done) failed.push(`${mark.at}：沒做到`); }
    else if ('expect' in mark) { checked++; if (mark.ids !== mark.expect || mark.issues !== 0) failed.push(`${mark.at}：${mark.deck} ID ${mark.ids}（預期 ${mark.expect}）、問題 ${mark.issues}`); }
    else if ('expectButton' in mark) { checked++; if (mark.button !== mark.expectButton) failed.push(`${mark.at}：按鈕 ${String(mark.button)}（預期 ${String(mark.expectButton)}）`); }
  }
  return { ok: checked > 0 && !failed.length, failed, skipped };
}
