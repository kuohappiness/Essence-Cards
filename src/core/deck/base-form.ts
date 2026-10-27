import type { Target } from './types.ts';

/**
 * 中翻英目標的原形（D-121 的第 2 步提示）：名稱去掉最後的「 中翻英」，再去掉最後一組全形括號與它前後的空白
 * （一字多義的第二個意思，D-125：`light（輕的） 中翻英` → `light`）；名稱中間的全形括號不動。其他目標回傳 null。
 */
export function baseForm(target: Target): string | null {
  if (target.direction !== 'zh-en') return null;
  const name = target.name.replace(/ 中翻英$/, '');
  return name.replace(/\s*（[^（）]*）\s*$/, '').trim() || null;
}
