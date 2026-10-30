import { typedKey, typedUnits } from '../core/study/index.ts';
import type { TypedUnit } from '../core/study/index.ts';

/** 一個字母和它是不是拼錯（D-066、D-096：第 3 步才標出）。 */
interface Letter { char: string; bad: boolean }
export interface Spelling { ok: boolean; typed: Letter[]; expected: Letter[] }

// 比對的單位與規則都是核心的 typedUnits（D-158）：彎的單引號、空白字元與連續的空白不算錯也不標出；畫面上寫的是原本的字（小寫）。
const letters = (text: string): TypedUnit[] => typedUnits(text.trim());
const keys = (units: TypedUnit[]): string[] => units.map(unit => unit.key);
const letter = (unit: TypedUnit, bad: boolean): Letter => ({ char: unit.text.toLowerCase(), bad });

/** 編輯距離表（Levenshtein）。 */
function table(a: string[], b: string[]): number[][] {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
  return d;
}

/** 逐字比對（移植試作外掛的 spelling）：大小寫、前後空白與 D-158 的字元不算錯；用編輯距離對齊，插入、缺漏、錯字都標在對應的位置。 */
export function spelling(input: string, answer: string): Spelling {
  const a = letters(input), b = letters(answer);
  const ka = keys(a), kb = keys(b);
  const d = table(ka, kb);
  const typed: Letter[] = [], expected: Letter[] = [];
  let i = a.length, j = b.length;
  while (i || j) {
    if (i && j && d[i][j] === d[i - 1][j - 1] + Number(ka[i - 1] !== kb[j - 1])) {
      const bad = ka[i - 1] !== kb[j - 1];
      typed.unshift(letter(a[--i], bad)); expected.unshift(letter(b[--j], bad));
    } else if (j && d[i][j] === d[i][j - 1] + 1) expected.unshift(letter(b[--j], true));
    else typed.unshift(letter(a[--i], true));
  }
  return { ok: typedKey(input) === typedKey(answer), typed, expected };
}

/**
 * 第 3 步照打的即時比對：照位置一個一個比，打到哪裡比到哪裡（還沒打的不算錯），大小寫、開頭的空白與 D-158 的字元不算。
 * 還沒打完，所以只去開頭的空白，尾端的空白留著（剛打的詞間空白不能消失）。
 * 漏打或多打一個字母時，從那裡起都標出來（照著打的人看得出從哪裡開始不對）；用編輯距離對齊的話，
 * 漏打的字母標不在「你打的」那一行（2026-10-26 在 Obsidian 實測：打 mnd 時畫面上沒有任何標記）。
 */
export function copying(input: string, answer: string): Spelling {
  const a = typedUnits(input.trimStart()), b = letters(answer);
  return {
    ok: typedKey(input) === typedKey(answer),
    typed: a.map((unit, i) => letter(unit, unit.key !== b[i]?.key)),
    expected: b.map((unit, i) => letter(unit, i < a.length && a[i].key !== unit.key)),
  };
}

/** 編輯距離（大小寫、前後空白與 D-158 的字元不算）。 */
function distance(input: string, answer: string): number {
  const a = keys(letters(input)), b = keys(letters(answer));
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
