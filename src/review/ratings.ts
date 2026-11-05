import type { Rating } from '../core/study/index.ts';

/** 自評四級，照 D-062 的順序：沒印象、差一點、記住了、太簡單。 */
export const RATINGS: readonly Rating[] = ['miss', 'near', 'good', 'easy'];
/** 翻面與打字一定有自評；null 只屬於比較卡有錯時的「下一張」。 */
export function chosen(rating: Rating | null): Rating {
  if (rating === null) throw TypeError('這種題型沒有「下一張」');
  return rating;
}
export const RATING_LABELS: Record<Rating, string> = { miss: '沒印象', near: '差一點', good: '記住了', easy: '太簡單' };
