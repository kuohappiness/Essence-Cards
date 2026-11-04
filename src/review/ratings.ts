import type { Rating } from '../core/study/index.ts';

/** 自評四級，照 D-062 的順序：沒印象、差一點、記住了、太簡單。 */
export const RATINGS: readonly Rating[] = ['miss', 'near', 'good', 'easy'];
export const RATING_LABELS: Record<Rating, string> = { miss: '沒印象', near: '差一點', good: '記住了', easy: '太簡單' };
