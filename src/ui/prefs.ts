import type { App } from 'obsidian';

// 只存在這台裝置的選擇（saveLocalStorage，同 D-116，不隨 vault 同步）：全部卡的提醒（D-146）、預覽的兩個開關（D-163 第 6 點）、
// 目錄的學期收合（D-097）、目錄的小考按鈕（tasks/quiz-mark.md §2，入口那一列不看它）。

const flag = (key: string) => ({
  get: (app: App): boolean => app.loadLocalStorage(key) === true,
  set: (app: App, on: boolean): void => { app.saveLocalStorage(key, on); },
});
export const noRemind = flag('essence-cards-full-deck-no-remind');
export const previewButton = flag('essence-cards-preview-button');
export const previewReveal = flag('essence-cards-preview-reveal');
export const quizMark = flag('essence-cards-quiz-mark');

const TERMS = 'essence-cards-catalog-terms';
/** 學期收合：只記使用者動過的；沒有記的照預設（最新的學期展開）。 */
export type TermOpen = Record<string, boolean>;
export function loadTerms(app: App): TermOpen {
  const value: unknown = app.loadLocalStorage(TERMS);
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as TermOpen : {};
}
export function saveTerms(app: App, terms: TermOpen): void { app.saveLocalStorage(TERMS, terms); }
