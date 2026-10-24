/** 把 before 改成 after 的最小修改（before 的位置，照位置排好、不重疊）。 */
export interface TextChange { from: number; to: number; insert: string }

/**
 * 開著的筆記寫回時只改有變的部分（W5 §8-2 第 4 點）：游標、選取與 Undo 才照常。
 * 先照行比對（最長共同子序列），改過的行再去掉頭尾相同的字；補 ID 只在行尾加字、補 implicit 的名稱是插入一行、
 * 改縮排只動行首，所以修改都很小。這個檔不 import obsidian，在 Node 測。
 */
export function textChanges(before: string, after: string): TextChange[] {
  if (before === after) return [];
  const a = split(before), b = split(after);
  // 頭尾相同的行先拿掉，LCS 只算中間。
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const n = endA - start, m = endB - start;
  // 行數太多時不算 LCS，整段換掉（仍然只在不同的那一段）。
  const pairs: [number, number][] = [];
  if (n * m <= 4_000_000) {
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[start + i] === b[start + j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
    for (let i = 0, j = 0; i < n && j < m;) {
      if (a[start + i] === b[start + j]) { pairs.push([start + i, start + j]); i++; j++; }
      else if (table[i + 1][j] >= table[i][j + 1]) i++;
      else j++;
    }
  }
  pairs.push([endA, endB]);
  const offsets: number[] = [0];
  for (const line of a) offsets.push(offsets.at(-1)! + line.length);
  const changes: TextChange[] = [];
  let i = start, j = start;
  for (const [pi, pj] of pairs) {
    if (pi > i || pj > j) {
      const from = offsets[i], to = offsets[pi];
      const insert = b.slice(j, pj).join('');
      changes.push(...trim(before.slice(from, to), insert, from));
    }
    i = pi + 1; j = pj + 1;
  }
  return changes;
}

/** 保留換行符號在每一行的尾巴，接起來就是原文。 */
function split(text: string): string[] {
  return text.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+$/g) ?? [];
}

/** 一段修改再去掉頭尾相同的字。 */
function trim(removed: string, insert: string, from: number): TextChange[] {
  let head = 0;
  while (head < removed.length && head < insert.length && removed[head] === insert[head]) head++;
  let tail = 0;
  while (tail < removed.length - head && tail < insert.length - head && removed[removed.length - 1 - tail] === insert[insert.length - 1 - tail]) tail++;
  // 不切開 UTF-16 的代理對。
  if (head > 0 && /[\uD800-\uDBFF]/.test(removed[head - 1])) head--;
  if (tail > 0 && /[\uDC00-\uDFFF]/.test(removed[removed.length - tail])) tail--;
  return [{ from: from + head, to: from + removed.length - tail, insert: insert.slice(head, insert.length - tail) }];
}

/** 把修改套到文字上（測試用，也是修改是否正確的定義）。 */
export function applyChanges(text: string, changes: readonly TextChange[]): string {
  let result = '', cursor = 0;
  for (const change of changes) { result += text.slice(cursor, change.from) + change.insert; cursor = change.to; }
  return result + text.slice(cursor);
}
