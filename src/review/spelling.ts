/** 一個字母和它是不是拼錯（D-066、D-096：第 3 步才標出）。 */
interface Letter { char: string; bad: boolean }
export interface Spelling { ok: boolean; typed: Letter[]; expected: Letter[] }

const letters = (text: string): string[] => [...text.trim().toLowerCase()];

/** 編輯距離表（Levenshtein）。 */
function table(a: string[], b: string[]): number[][] {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
  return d;
}

/** 逐字比對（移植試作外掛的 spelling）：大小寫與前後空白不算錯；用編輯距離對齊，插入、缺漏、錯字都標在對應的位置。 */
export function spelling(input: string, answer: string): Spelling {
  const a = letters(input), b = letters(answer);
  const d = table(a, b);
  const typed: Letter[] = [], expected: Letter[] = [];
  let i = a.length, j = b.length;
  while (i || j) {
    if (i && j && d[i][j] === d[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1])) {
      const bad = a[i - 1] !== b[j - 1];
      typed.unshift({ char: a[--i], bad }); expected.unshift({ char: b[--j], bad });
    } else if (j && d[i][j] === d[i][j - 1] + 1) expected.unshift({ char: b[--j], bad: true });
    else typed.unshift({ char: a[--i], bad: true });
  }
  return { ok: a.join('') === b.join(''), typed, expected };
}

/** 編輯距離（大小寫、前後空白不算）。 */
function distance(input: string, answer: string): number {
  const a = letters(input), b = letters(answer);
  return table(a, b)[a.length][b.length];
}

/** 和學生打的字最接近的答案：編輯距離最小；一樣近時取前面的（W6 §2-3）。 */
export function closest(input: string, answers: readonly string[]): string {
  let best = answers[0], bestScore = Infinity;
  for (const answer of answers) {
    const score = distance(input, answer);
    if (score < bestScore) { best = answer; bestScore = score; }
  }
  return best;
}
