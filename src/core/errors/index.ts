// 正式版的錯誤紀錄（D-155、D-160）：只靠 Files，不碰 Obsidian、Node 與畫面。
export { ERROR_FOLDER, createErrorLog, errorLogPath, hasOwnFrame, isErrorLogPath } from './log.ts';
export type { ErrorLog, ErrorWhere, ReportKind } from './log.ts';
