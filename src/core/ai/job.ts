import { PURPOSES } from './prompt.ts';
import type { CardForm, ExistingTarget, SentPart } from './prompt.ts';
import type { RuleSubject } from './rules.ts';

// 待貼回的工作（tasks/ai-cards-mvp.md §3）與存草稿的恢復資料（§5）：存在這台電腦，不寫進 vault。
// 按「複製提示」的當下就存每一部分的全文；之後外掛更新、規則或模板改了，這一份照舊是當時送出的文字。

/** 一篇卡組在恢復資料裡的樣子。base：還沒加後綴的檔名，再撞名照它遞增（R4-4）。stage：pending 還沒碰 vault；started 記成開始建了（可能已經建了）；written 建好、讀回核對過（R3-1、R4-1）；rebuild 曾經開始建過、家長選了重建（L2-4：允許重建和曾經建過是兩件事，ID 照樣不再配出）。 */
export interface SavedDeck { path: string; base: string; text: string; sha256: string; ids: string[]; stage: 'pending' | 'started' | 'written' | 'rebuild'; skipped: boolean }

/** 存草稿的恢復資料（§5 第 2 步）：之後每一步都照這份寫，不重新整理、不重新查已有目標、不重新配號。 */
export interface SaveState {
  /** 家長貼上的整段（照輸入框交出的文字）與它的 SHA-256。 */
  reply: string;
  replySha: string;
  /** 貼回時選的服務；沒選是 null。 */
  service: string | null;
  /** 第 1 步的時間（快照檔名的日期）。 */
  startedAt: string;
  decks: SavedDeck[];
  snapshotPath: string;
  /** 快照還沒加後綴的檔名（SavedDeck.base 的快照版）。 */
  snapshotBase: string;
  snapshotBody: string;
  edits: string[];
  /** 第 5 步（準備發布）取的 `時間`、做出的快照全文與 SHA-256、當時的 `對象`（路徑）：之後重試照存下的全文寫，對象變了才重做（L2-8）。 */
  published: { time: string; text: string; sha256: string; targets: string[] } | null;
}

export interface CardJob {
  /** 6 碼，和考試範圍同一套產生法。 */
  id: string;
  /** 按「複製提示」的時間（帶時區）與毫秒（過期用）。 */
  copiedAt: string;
  copiedMs: number;
  form: CardForm;
  /** 複製時的科目（規則表之後可能改）。 */
  subject: Pick<RuleSubject, 'key' | 'label' | 'subject' | 'r3'>;
  parts: SentPart[];
  promptSha: string;
  existing: ExistingTarget[];
  save: SaveState | null;
}

/** 最多留 5 個、14 天；過期的只丟還沒開始存草稿的（§3）。 */
const JOB_LIMIT = 5;
const JOB_DAYS = 14;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

function isPart(value: unknown): value is SentPart {
  return isObject(value) && isString(value.name) && isString(value.version) && isString(value.text) && isString(value.sha256);
}
function isForm(value: unknown): value is CardForm {
  return isObject(value) && isString(value.subject) && isString(value.term) && isString(value.unit) && PURPOSES.includes(value.purpose as CardForm['purpose'])
    && typeof value.supplement === 'boolean' && isString(value.adjust) && isString(value.material);
}
function isExisting(value: unknown): value is ExistingTarget {
  return isObject(value) && isString(value.id) && isString(value.name) && isString(value.source) && isString(value.path);
}
function isDeck(value: unknown): value is SavedDeck {
  return isObject(value) && isString(value.path) && isString(value.base) && isString(value.text) && isString(value.sha256) && strings(value.ids)
    && (value.stage === 'pending' || value.stage === 'started' || value.stage === 'written' || value.stage === 'rebuild') && typeof value.skipped === 'boolean';
}
function isSave(value: unknown): value is SaveState {
  if (!isObject(value)) return false;
  const published = value.published;
  return isString(value.reply) && isString(value.replySha) && (value.service === null || isString(value.service)) && isString(value.startedAt)
    && Array.isArray(value.decks) && value.decks.every(isDeck) && isString(value.snapshotPath) && isString(value.snapshotBase) && isString(value.snapshotBody) && strings(value.edits)
    && (published === null || (isObject(published) && isString(published.time) && isString(published.text) && isString(published.sha256) && strings(published.targets)));
}
/** 這份是不是完整的工作；缺欄位的不能貼回（§3：沒有送出的證據就不建快照）。 */
export function isJob(value: unknown): value is CardJob {
  if (!isObject(value)) return false;
  const subject = value.subject;
  return isString(value.id) && isString(value.copiedAt) && typeof value.copiedMs === 'number' && Number.isFinite(value.copiedMs) && isForm(value.form)
    && isObject(subject) && isString(subject.key) && isString(subject.label) && (subject.subject === null || isString(subject.subject)) && typeof subject.r3 === 'boolean'
    && Array.isArray(value.parts) && value.parts.length > 0 && value.parts.every(isPart) && isString(value.promptSha)
    && Array.isArray(value.existing) && value.existing.every(isExisting) && (value.save === null || isSave(value.save));
}

/**
 * 讀這台電腦存的工作：讀不懂的那一份記成 broken（沒開始存草稿的才可能，畫面請家長重新複製）；沒開始存草稿的過了 14 天、或超過 5 個（舊的先丟）就拿掉。
 * 開始存草稿的不過期，直到發布、清理或放棄（§5）。
 */
export function readJobs(value: unknown, nowMs: number): { jobs: CardJob[]; broken: number; expired: number } {
  const list = Array.isArray(value) ? value : [];
  const jobs = list.filter(isJob);
  const fresh = jobs.filter(job => job.save !== null || nowMs - job.copiedMs <= JOB_DAYS * 86_400_000);
  const unsaved = fresh.filter(job => job.save === null).sort((a, b) => b.copiedMs - a.copiedMs);
  const keep = new Set([...fresh.filter(job => job.save !== null), ...unsaved.slice(0, JOB_LIMIT)]);
  return { jobs: jobs.filter(job => keep.has(job)), broken: list.length - jobs.length, expired: jobs.length - keep.size };
}

/** 沒完成的工作配好的 ID（§5〈ID 的預留〉）：跳過的篇不算（它們的 ID 已經照規則拿掉或記進不再配出的清單）。 */
export function reservedIds(jobs: readonly CardJob[]): string[] {
  return jobs.flatMap(job => job.save?.decks.filter(deck => !deck.skipped).flatMap(deck => deck.ids) ?? []);
}
