// 最低版本標記（syntax.md §0-1、D-149 第 3 點）：卡組的屬性「需要版本」與紀錄的 need 都用這裡判斷讀不讀得懂。

/** 正式版號 `主.次.修`：三段十進位的非負整數、不帶前導零（`0` 本身可以）。 */
const RELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** 每段都沒有前導零：先比位數，位數相同再逐字比，不轉成會失去精度的數字。 */
function compareRelease(a: string, b: string): number {
  const left = a.split('.'), right = b.split('.');
  for (let i = 0; i < 3; i++) {
    const x = left[i], y = right[i];
    if (x.length !== y.length) return x.length - y.length;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 這台的讀取能力：建置版本 `BUILD` 的 `+` 前面（`+commit`、`.dirty` 不參與）；不是正式版號時是 null。 */
export function releaseOf(build: string): string | null {
  const release = build.split('+')[0];
  return RELEASE.test(release) ? release : null;
}

/**
 * 標記讀不讀得懂：是正式版號、而且不比這台新。格式不對（含 `+commit`、數字、清單）或這台的版本不明（null）都是讀不懂；
 * 沒有標記由呼叫端判斷，不經過這裡。
 */
export function canRead(need: unknown, version: string | null): boolean {
  return typeof need === 'string' && RELEASE.test(need) && version !== null && compareRelease(need, version) <= 0;
}
