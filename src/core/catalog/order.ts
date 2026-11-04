import { codeKey, termKey, termRank } from '../deck/index.ts';

// 學期與編號的順序（D-142 原則 2）：目錄與範圍的字都照這一份排。

const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function compareDigits(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, ''), y = b.replace(/^0+(?=\d)/, '');
  return x.length - y.length || compareText(x, y);
}
/** 自然排序：連續的數字照數值比（`L2` 在 `L10` 前），平手時比原字串（`L01` 與 `L1`），不用輸入順序。 */
function natural(a: string, b: string): number {
  const parts = (text: string): string[] => text.match(/\d+|\D+/g) ?? [];
  const left = parts(a), right = parts(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i], y = right[i];
    const numeric = /^\d/.test(x) && /^\d/.test(y);
    const order = numeric ? compareDigits(x, y) : compareText(x, y);
    if (order) return order;
  }
  return left.length - right.length || compareText(a, b);
}
/** 同一學期同一科裡：數字編號 → 英文編號 → 其他（§9-2）。 */
const codeKind = (code: string): number => /^[0-9]+(?:-[0-9]+)*$/.test(code) ? 0 : /^[A-Za-z]+[0-9]+$/.test(code) ? 1 : 2;
/** 認得的學期照順序，其他文字排在認得的後面，彼此比原字串。 */
export function compareTerm(a: string, b: string): number {
  const x = termRank(termKey(a)), y = termRank(termKey(b));
  if (x !== null && y !== null) return x - y;
  if (x !== null) return -1;
  if (y !== null) return 1;
  return compareText(a, b);
}
export const compareCode = (a: string, b: string): number => {
  const x = codeKey(a), y = codeKey(b);
  return codeKind(x) - codeKind(y) || natural(x, y) || compareText(a, b);
};
