import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { compareCode, compareTerm } from '../catalog/index.ts';
import type { Deck } from '../deck/index.ts';
import { termKey, termRank } from '../deck/index.ts';
import { formatTime } from '../study/index.ts';
import type { EmbeddedRule, RuleSubject } from './rules.ts';

// 提示的組成（tasks/ai-cards-mvp.md §3）：規則組的每一份 → 任務段，照順序、中間空一行接起來；每一部分與整份提示各算 SHA-256。

/** §3 的任務段與附加說明的版號：改字就加一（§1〈提示模板的版本〉）。 */
const PROMPT_VERSION = '提示 v2';
export const PURPOSES = ['準備段考', '準備小考', '平常複習'] as const;
export type Purpose = (typeof PURPOSES)[number];

/** 製卡畫面第一步的表單（§2）。subject 是規則表的 key。 */
export interface CardForm {
  subject: string;
  term: string;
  unit: string;
  purpose: Purpose;
  supplement: boolean;
  /** 這次的調整：寫進任務資料的「家長調整」；空的寫「無」。 */
  adjust: string;
  /** 教材：家長自己的說明，寫進任務資料與快照；程式沒有看過教材。 */
  material: string;
}

/** 學生已有的一個學習目標（§2）：送出時在哪一篇（之後轉成連結時核對，§5）。 */
export interface ExistingTarget { id: string; name: string; source: string; path: string }
/** 送出的一部分：名稱、版號、全文與它的 SHA-256。 */
export interface SentPart { name: string; version: string; text: string; sha256: string }
export interface Prompt { parts: SentPart[]; text: string; sha256: string }

export const sha256Hex = (text: string): string => bytesToHex(sha256(utf8ToBytes(text)));
/** 帶時區、到秒的時間（快照的 `時間`、`複製時間`）。 */
export const stamp = (ms: number, offset: number): string => formatTime(Math.floor(ms / 1000) * 1000, offset).replace(/\.\d{3}(?=[+-])/, '');

const STAGES: Record<string, string> = { 小: '國小', 國: '國中', 高: '高中' };
/** 「學生」那一行：`國二上` → `國中二年級（國二上）`；認不得的年級學期照原字。 */
export function studentOf(term: string): string {
  const key = termKey(term);
  if (termRank(key) === null) return term;
  return `${STAGES[key[0]]}${key[1]}年級（${key}）`;
}

/** 單元欄的編號：第一個空白前（syntax §2-1）；沒有空白時整段就是編號。 */
export function unitCode(unit: string): string {
  const text = unit.trim();
  const at = text.search(/[ \t　]/);
  return at < 0 ? text : text.slice(0, at);
}

/** 一課分成幾篇時的篇名開頭（§3、§4）：`<年級學期><科目> <單元編號>`；一般知識不分篇，是 null。 */
export function titlePrefix(form: Pick<CardForm, 'term' | 'unit'>, subject: Pick<RuleSubject, 'subject'>): string | null {
  return subject.subject === null ? null : `${form.term.trim()}${subject.subject} ${unitCode(form.unit)}`;
}

/**
 * 會一起送出的已有學習目標（§2）：同一科、年級學期在這一篇之前或相同（認不得的年級學期只算完全相同的）、啟用與暫停的卡組裡讀得懂、有 ID 的目標；
 * 草稿、轉錄稿不算，需要新版的卡組呼叫的一方不傳進來。skip 是不能用的 ID（重複的，D-157）。照年級學期、單元、筆記順序排。
 * 一般知識（subject 是 null）：不是學業卡組的卡組裡的目標。
 */
export function existingTargets(decks: readonly { path: string; deck: Deck }[], subject: string | null, term: string, skip: ReadonlySet<string> = new Set()): ExistingTarget[] {
  const mine = termKey(term.trim()), rank = termRank(mine);
  const before = (other: string): boolean => {
    const key = termKey(other.trim()), at = termRank(key);
    return rank !== null && at !== null ? at <= rank : key === mine;
  };
  const chosen = decks.filter(({ deck: { props } }) => props.status !== 'draft' && !props.isTranscript && (subject === null
    ? props.subject === null && props.term === null
    : props.subject?.trim() === subject && props.term !== null && before(props.term)));
  const sorted = [...chosen].sort((a, b) => compareTerm(a.deck.props.term ?? '', b.deck.props.term ?? '')
    || compareCode(a.deck.props.unit?.code ?? '', b.deck.props.unit?.code ?? '') || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sorted.flatMap(({ path, deck: { props, targets } }) => targets.filter(t => t.id !== null && t.ok && !skip.has(t.id)).map(t => {
    const where = [props.term, props.unit?.code, t.fields.sources.join('、')].filter(Boolean).join(' ');
    return { id: t.id!, name: t.name, source: where, path };
  }));
}

/** 任務段（§3）：`## 這一次的任務`、任務資料、附加說明。 */
export function taskSection(form: CardForm, subject: Pick<RuleSubject, 'subject' | 'r3'>, existing: readonly ExistingTarget[]): string {
  const prefix = titlePrefix(form, subject);
  const lines = [
    '## 這一次的任務',
    '',
    `- 學生：${studentOf(form.term)}`,
    `- 科目：${subject.subject ?? '一般知識'}`,
    `- 單元：${form.unit.trim()}`,
    `- 學習目的：${form.purpose}`,
    `- 允許 AI 補充：${form.supplement ? '是' : '否'}`,
    `- 家長調整：${form.adjust.trim() || '無'}`,
    `- 教材：${form.material.trim() ? `附件（${form.material.trim()}）` : '附件的課本頁面'}`,
    existing.length ? '- 學生已有的學習目標：' : '- 學生已有的學習目標：無',
    ...existing.map(each => `  - ${each.id} ${each.name}｜${each.source}`),
    '',
    '另外：',
    '',
    '- 教材在附件。附件沒有圖檔可以連，**不要寫 `![[…]]`**；要提到課本的圖，在出處寫圖號（例如 `p.42、圖 2`）。',
    ...prefix === null ? [] : [`- 一課分成幾篇時，篇名照 \`${prefix} <篇名>\` 寫${subject.subject === '英文' ? `，例如 \`${prefix} 單字\`` : ''}，單獨一行、前面不加 \`#\`。`],
    '- 不要寫學習目標 ID 與屬性區，程式會加。',
    ...subject.r3 ? ['- 照規則交三段，標記照抄（`<<<全貌>>>`、`<<<架構>>>`、`<<<卡組>>>`）。'] : [],
    '- 回覆的最後單獨一行寫 `<<<完>>>`。',
    // 提示 v2（真人測試 2026-11-07）：網頁的回覆複製按鈕會壓平縮排或跳脫清單符號；程式碼區塊的「複製」照原文。
    '- 整段回覆放進**一個**程式碼區塊：第一行寫 ````markdown（四個反引號），最後一行寫 ````，`<<<完>>>` 是框裡的最後一行。家長會按程式碼區塊的「複製」把它貼回來，框外不用寫說明。',
  ];
  return lines.join('\n');
}

/** 整份提示：規則組照順序，最後是任務段；部分之間空一行。 */
export function buildPrompt(form: CardForm, subject: Pick<RuleSubject, 'subject' | 'r3'>, rules: readonly EmbeddedRule[], existing: readonly ExistingTarget[]): Prompt {
  const task = taskSection(form, subject, existing);
  const parts: SentPart[] = [
    ...rules.map(rule => ({ name: rule.name, version: rule.version, text: rule.text, sha256: rule.sha256 })),
    { name: '任務段', version: PROMPT_VERSION, text: task, sha256: sha256Hex(task) },
  ];
  const text = parts.map(part => part.text).join('\n\n');
  return { parts, text, sha256: sha256Hex(text) };
}
