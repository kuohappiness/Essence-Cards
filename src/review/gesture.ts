/** 觸控手勢的判斷（D-084、D-109；移植試作外掛的 lockAxis、gesture）。滑動只換卡，評分只用按鈕。 */
export type Axis = 'pending' | 'horizontal' | 'vertical';
/** scroll：上下捲動；tap：點一下；bounce：彈回；back：上一張；forward：往後一張（回看時）。 */
export type Gesture = 'scroll' | 'tap' | 'bounce' | 'back' | 'forward';

/** 先鎖方向：水平要明顯大於垂直才算左右滑；一旦判成上下捲動就不再改判。 */
export function lockAxis(axis: Axis, dx: number, dy: number): Axis {
  if (axis !== 'pending') return axis;
  if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.6) return 'horizontal';
  if (Math.abs(dy) > 10 || Math.abs(dx) > 10) return 'vertical';
  return 'pending';
}

/**
 * 手指放開時的結果：短的水平移動彈回（除了快速一撥）；往右是上一張（沒有上一張就彈回）；往左是往後一張
 * （不在回看時彈回）。
 */
export function gesture(axis: Axis, dx: number, dy: number, ms: number, canBack: boolean, viewing: boolean): Gesture {
  if (axis === 'vertical') return 'scroll';
  if (axis === 'pending') return Math.hypot(dx, dy) < 10 ? 'tap' : 'bounce';
  if (Math.abs(dx) < 60 && !(Math.abs(dx) > 10 && Math.abs(dx) / Math.max(ms, 1) > 0.5)) return 'bounce';
  return dx > 0 ? (canBack ? 'back' : 'bounce') : (viewing ? 'forward' : 'bounce');
}
