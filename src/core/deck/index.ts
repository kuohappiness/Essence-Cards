export { parseDeck } from './parse.ts';
export { assignIds } from './assign.ts';
export { setTargetId, blockIds } from './ids.ts';
// 學習目標名稱那一行的 ID 寫法：編輯器的鎖定和解析用同一個辨識（W5 §8-4、Codex 審查第二部分的 F2）。
export { nameIds } from './markdown.ts';
export type { NameIds } from './markdown.ts';
export { isDeckPath, readDecks } from './read.ts';
export type { Deck, DeckProps, Target, Fields, Prompt, Problem, ProblemCode, AssignOptions, AssignResult } from './types.ts';
