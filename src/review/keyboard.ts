// iPhone 的鍵盤（W6 §3-2、L2 的 S2）：打字卡的鍵盤不能擋住輸入框和按鈕。系統沒有自己縮小版面時，全螢幕那一層改成
// visualViewport 看得到的那一塊；系統已經縮小（兩個高度一樣）時不再縮一次。只看這兩個高度不能保證對，iPhone 實測（§7 的 J7）驗收。

export interface VisibleArea { height: number; offsetTop: number; scale: number }

/** 全螢幕那一層要改成的上緣與高度（px）；不用調整是 null（沒有鍵盤、系統已經縮小版面、或是放大造成的）。 */
export function keyboardFit(innerHeight: number, area: VisibleArea | null): { top: number; height: number } | null {
  if (!area || Math.abs(area.scale - 1) > 0.01 || innerHeight - area.height < 1) return null;
  return { top: area.offsetTop, height: area.height };
}
