// AI 模組（D-110）：組好的提示、檢查過的草稿、快照。不碰 Obsidian、Node 與畫面。
export { RULE_MARKER, RULE_SUBJECTS, ruleText } from './rules.ts';
export type { EmbeddedRule, EmbeddedRules, RuleSubject } from './rules.ts';
export { check } from './check.ts';
export { buildPrompt, existingTargets, PURPOSES, sha256Hex, stamp, studentOf, taskSection, unitCode } from './prompt.ts';
export type { CardForm, ExistingTarget, Purpose } from './prompt.ts';
export { groupHints, issueText, normalizeReply } from './reply.ts';
export { freeName, inspectReply, planDraft, rawPath } from './draft.ts';
export type { ExistingNow, Inspection } from './draft.ts';
export { isJob, readJobs, reservedIds } from './job.ts';
export type { CardJob, SavedDeck } from './job.ts';
export { abandonJob, beginSave, publish, rebuildDeck, skipDeck } from './publish.ts';
export type { CreateResult, DeckStop, PublishIo, PublishResult } from './publish.ts';
