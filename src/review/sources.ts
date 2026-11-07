// 出處的字面讀法在 core/deck（D-142 原則 1），畫面從這裡拿，不直接碰核心的模組。
export { headingKey, readSourceParts, sourceLabel, sourceLinks, splitSource } from '../core/deck/index.ts';
export type { SourceItem, SourceLink, SourceOwner, SourcePart, Span, TargetLayout } from '../core/deck/index.ts';
