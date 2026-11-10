/** 逐行的差異（兩邊都是 UTF-8 文字時），前後各留 2 行；不是文字回傳 null。`-` 是現在的，`+` 是備份的。 */
export function textDiff(before: Uint8Array, after: Uint8Array): string[] | null {
  const decode = (bytes: Uint8Array): string | null => {
    try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); return text.includes('\0') ? null : text; } catch { return null; }
  };
  const a = decode(before)?.split('\n'), b = decode(after)?.split('\n');
  if (!a || !b) return null;
  if (a.length * b.length > 4_000_000) return [`（行數太多，只列行數：現在 ${a.length} 行，備份 ${b.length} 行）`];
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const lines: { mark: ' ' | '-' | '+'; text: string }[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lines.push({ mark: ' ', text: a[i] }); i++; j++; }
    else if (j >= b.length || i < a.length && table[i + 1][j] >= table[i][j + 1]) lines.push({ mark: '-', text: a[i++] });
    else lines.push({ mark: '+', text: b[j++] });
  }
  const near = (index: number): boolean => lines.slice(Math.max(0, index - 2), index + 3).some(line => line.mark !== ' ');
  const out: string[] = [];
  lines.forEach((line, index) => {
    if (near(index)) out.push(line.mark + line.text);
    else if (out.at(-1) !== '…') out.push('…');
  });
  return out;
}
