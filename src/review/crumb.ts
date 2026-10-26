import type { DeckProps } from '../core/deck/index.ts';

/**
 * 卡片上方的路徑（D-070）：「科目 › 年級學期 › 單元」，缺的那一段省略。
 * 學業以外的卡組（沒有科目）：第一個分類，沒有分類時用檔名（去掉 .md）。
 */
export function crumb(props: DeckProps, path: string): string {
  if (props.subject === null) {
    if (props.categories.length) return props.categories[0];
    return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
  }
  const unit = props.unit ? (props.unit.code + ' ' + props.unit.name).trim() : null;
  return [props.subject, props.term, unit].filter((part): part is string => !!part).join(' › ');
}
