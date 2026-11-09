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

// AI 製卡（tasks/ai-cards-mvp.md §3、§5）：待貼回的工作與存草稿的恢復資料、不再配出的 ID、上一次選的科目與年級學期。只存在這台電腦，不寫進 vault。
const AI_JOBS = 'essence-cards-ai-jobs';
const AI_RETIRED = 'essence-cards-ai-retired';
const AI_LAST = 'essence-cards-ai-last';
export const aiPrefs = {
  /** 原樣讀出來，由 core/ai 的 readJobs 判斷讀不讀得懂。 */
  jobs: (app: App): unknown => app.loadLocalStorage(AI_JOBS),
  /** 存不進去時 Obsidian 丟錯，交給呼叫的一方（存草稿就停下）。 */
  saveJobs: (app: App, jobs: unknown[]): void => { app.saveLocalStorage(AI_JOBS, jobs); },
  retired(app: App): string[] {
    const value: unknown = app.loadLocalStorage(AI_RETIRED);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  },
  /** 不再配出的清單只增不減（§5〈ID 的預留〉）。 */
  retire(app: App, ids: readonly string[]): void {
    if (!ids.length) return;
    app.saveLocalStorage(AI_RETIRED, [...new Set([...aiPrefs.retired(app), ...ids])]);
  },
  last(app: App): { subject?: string; term?: string } {
    const value: unknown = app.loadLocalStorage(AI_LAST);
    if (value === null || typeof value !== 'object') return {};
    const { subject, term } = value as Record<string, unknown>;
    return { ...typeof subject === 'string' ? { subject } : {}, ...typeof term === 'string' ? { term } : {} };
  },
  saveLast: (app: App, last: { subject: string; term: string }): void => { app.saveLocalStorage(AI_LAST, last); },
};
