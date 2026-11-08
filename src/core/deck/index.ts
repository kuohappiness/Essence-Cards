export { parseDeck } from './parse.ts';
export { markNeed } from './need.ts';
export { baseForm } from './base-form.ts';
export { assignIds, newId } from './assign.ts';
export { setTargetId, blockIds } from './ids.ts';
export { setDeckStatus } from './status.ts';
// 學習目標名稱那一行的 ID 寫法：編輯器的鎖定和解析用同一個辨識（W5 §8-4、Codex 審查第二部分的 F2）。
export { nameIds } from './markdown.ts';
export type { NameIds } from './markdown.ts';
export { isDeckPath, listDeckPaths, readDecks } from './read.ts';
export { folderIssues, folderLabel, guardedMoves, misplacedFolders, presentFolders } from './folders.ts';
export type { FolderIssue } from './folders.ts';
export { chapterAlias, codeKey, headingKey, readSourceParts, readTerm, sourceLabel, sourceLinks, splitSource, splitUnit, termKey, termRank, tidy } from './sources.ts';
export type { SourceItem, SourceLink, SourceOwner, SourcePart, SourceProblem, SourceScope } from './sources.ts';
export type { Deck, DeckProps, PickGroup, PropertyIssue, Target, Fields, Prompt, Problem, ProblemCode, AssignOptions, AssignResult, FieldColon, FieldName, SourceFieldLayout, Span, TargetLayout } from './types.ts';
export { NEEDS_NEWER, canEditSource, editSource, fieldFixes, fixField, fixQuestion, verifySourceEdit } from './source-edit.ts';
export type { FieldFix, FieldFixAction, SourceEditAction, SourceEditInput, SourceEditPlan, SourceEditResult, TextChange } from './source-edit.ts';
