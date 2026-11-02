// 全螢幕的外殼（D-109、D-163 第 2 點）：一層蓋滿整個視窗，直接掛在 document.body，蓋住 Obsidian 的上下欄；
// 觸控不往外傳給 Obsidian（往右滑才不會打開側欄）；鍵盤焦點留在畫面裡；關掉時焦點還原。入口與複習共用，裡面畫什麼由呼叫的一方決定。

/** Tab 會停的元素（Obsidian 渲染的連結、音檔也算）。 */
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), a[href], audio[controls], [tabindex]:not([tabindex="-1"])';

export interface Fullscreen {
  element: HTMLElement;
  /** 從畫面拿掉，焦點還原到打開前的地方。 */
  close(): void;
}

export function openFullscreen(): Fullscreen {
  const element = document.createElement('div');
  element.className = 'ec-fullscreen';
  element.tabIndex = -1;
  // 畫面上的觸控不往外傳；左右滑的 preventDefault 在卡片那一層做。
  element.addEventListener('touchstart', event => { event.stopPropagation(); }, { passive: true });
  element.addEventListener('touchmove', event => { event.stopPropagation(); }, { passive: false });
  element.addEventListener('touchend', event => { event.stopPropagation(); });
  // 鍵盤焦點留在畫面裡（試作外掛 main.ts 的做法，Codex L2 F6）：Tab 從最後一個、Shift+Tab 從第一個或畫面本身繞到另一端；
  // 不然焦點跑到被蓋住的 Obsidian（2026-10-27 用 Electron 送真的 Shift+Tab 實測），之後的快捷鍵都到不了複習畫面。
  element.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    // inert 的不算（回報的選單開著時背後那幾塊，Codex L2 的 R1）：Tab 只在選單裡繞。
    const items = Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(item => item.getClientRects().length > 0 && !item.closest('[inert]'));
    const index = items.findIndex(item => item === document.activeElement);
    if (!items.length) { event.preventDefault(); return; }
    if (event.shiftKey ? index <= 0 : index === -1 || index === items.length - 1) {
      event.preventDefault();
      (event.shiftKey ? items[items.length - 1] : items[0]).focus();
    }
  });
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.append(element);
  return {
    element,
    close() {
      element.remove();
      previous?.focus({ preventScroll: true });
    },
  };
}
