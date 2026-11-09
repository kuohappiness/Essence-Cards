import type { SourcePart } from './sources.ts';

export interface Deck {
  props: DeckProps;
  targets: Target[];
  problems: Problem[];
}
export interface DeckProps {
  term: string | null;
  subject: string | null;
  unit: { code: string; name: string } | null;
  materials: string[];
  status: 'draft' | 'active' | 'paused';
  /**
   * 屬性 `狀態` 寫得怎樣（tasks/record-gaps.md §1）：沒寫、合法，或無效（值認不得、空值、屬性區寫壞或沒有結束）。
   * status 無效時照舊當啟用（顯示與排程的預設）；紀錄端照這一欄判斷，無效的不比，不把預設值當成看到的值。
   */
  statusRead: 'missing' | 'valid' | 'invalid';
  categories: string[];
  isTranscript: boolean;
  /**
   * 屬性「需要版本」（syntax.md §0-1、§2-1）：沒寫是 null；值是字串時是那個字串，格式與新舊由知道這台版本的一方判斷；
   * 值不是字串，或屬性區讀不出來而原文含「需要版本」時是 false（有標記但壞掉，等於讀不懂）。
   */
  need: string | false | null;
  /** 屬性寫法有問題（`單元: 3`、沒加引號的 `材料: [[…]]`，§9-2）：目錄與存檔的提示共用，不默默變成沒有。 */
  issues: PropertyIssue[];
}
/** line 從 0 算（檔案的第幾行）。 */
export interface PropertyIssue { line: number; message: string }
export interface Target {
  id: string | null;
  name: string;
  line: number;
  implicit: boolean;
  section: string | null;
  fields: Fields;
  prompts: Prompt[];
  shared: string[];
  direction: 'en-zh' | 'zh-en' | null;
  pairKey: string | null;
  ok: boolean;
  /** 只有 ambiguous-id 的目標才有：那一行出現的 ID 寫法，照出現的順序、不重複（W5 §8-3）。 */
  idCandidates?: string[];
  /** 只有點選填空的目標才有（D-182、tasks/question-type-seam.md §3）。 */
  group?: PickGroup;
}
/**
 * 點選填空的組：名稱的字或詞、字鍵（照括號裡寫的）、組的身分（正規化後排序的陣列的 JSON）、結尾（卡片的標題）。
 * wordKey、memberKeys 是 word、members 正規化後的寫法（memberKeys 和 members 對齊）：出題端從 deck 只拿型別，比對同一個字用它們。
 */
export interface PickGroup { word: string; members: readonly string[]; key: string; title: string; wordKey: string; memberKeys: readonly string[] }
export interface Fields {
  sources: string[];
  type: string | null;
  importance: 'high' | 'medium' | 'low';
  paused: boolean;
  /** `狀態` 的第一個值認不得（tasks/record-gaps.md §1）：paused 照舊是 false，紀錄端不比。只有這種情況才有這一欄。 */
  statusInvalid?: true;
  remarks: string[];
  mistakes: string[];
}
export type Prompt =
  // typed：中翻英的正確答案，答案格照 | 拆開，第一個是課本用的（D-122）；其他題目是 null。answer 與指紋仍是整個答案格。
  | { kind: 'qa'; line: number; question: string; answer: string; extras: string[]; typed: readonly string[] | null; fingerprint: string }
  | { kind: 'cloze'; line: number; text: string; blanks: { start: number; end: number }[]; extras: string[]; fingerprint: string };
export interface Problem {
  line: number;
  level: 'error' | 'hint';
  code: ProblemCode;
  message: string;
  targetLine: number | null;
  /**
   * 資料欄位那一項的其中一段（tasks/edit-markup.md §1-2，座標照 §3-2）：line 是那一段所在的行（接續行照實），from、to 是那一行原文的位置。
   * 只有 unknown-field-value、duplicate-field（那一段的值）與 unknown-field（整段）會填；跨了兩行的不填，畫 line 那一行。
   */
  columns?: Span;
}
/**
 * 原文的一段（tasks/edit-markup.md §3-2）：line 從 0 算，是檔案的第幾行；from、to 是那一行原文的 UTF-16 位置，範圍是 [from, to)。
 * Tab、全形空白各算一個字元；縮排的顯示寬度（Item.indent、contentColumn）是另一種單位，不能拿來切字串。
 */
export interface Span { line: number; from: number; to: number }
/** 資料欄位的名稱（syntax §2-4）。 */
export type FieldName = '出處' | '類型' | '重要性' | '狀態' | '備註' | '錯題補強';
/**
 * 一個 `出處` 欄位（§3-3 第 1 點），照遞迴的順序；同一行用 `｜` 寫了兩個算兩個。line 是欄位那一項的第一行；
 * name、colon 各帶自己的行號（出處從接續行開始、名稱後面換行才打冒號時就在接續行）；value 是冒號後面同一行的值，那一行沒有字是 null。
 * joined：這一項用 `｜` 或半形 `|` 接了別的欄位；continued：這一項或當成出處值的子項目有接續行；children：當成出處值的子項目的第一行。
 */
export interface SourceFieldLayout { line: number; name: Span; colon: Span; value: Span | null; joined: boolean; continued: boolean; children: number[] }
/** 一個資料欄位的名稱與冒號（§3-3 第 4 點）：六個欄位都算，同一行用 `｜` 接的每一段也算；可以跨行。 */
export interface FieldColon { field: FieldName; name: Span; colon: Span }
/**
 * 一個目標的出處原文位置（§3-3），只有 parseDeck(text, { layout: true }) 才有；不放進 Target，改縮排與 ID 的保護比的是 targets（回報 R2）。
 * entries 和 fields.sources 一一對應，跨了接續行或原文沒有一段連續的字等於它時是 null；parts 是 sourceLinks 讀的時候切出的每一段，那一項是 null 時它的段也沒有位置。
 */
/** end：目標的範圍到哪一行之前（從 0 算，不含），和解析把題目歸給這個目標的範圍相同（L2 第一輪 R4）。 */
export interface TargetLayout { fields: SourceFieldLayout[]; entries: (Span | null)[]; parts: SourcePart[]; fieldColons: FieldColon[]; end: number }
export type ProblemCode =
  | 'empty-question' | 'missing-answer' | 'typed-answer-invalid'
  // typed-answer-words：hint，好幾個答案的字數不一樣，畫線照第一個（D-122）。
  | 'typed-answer-words'
  | 'duplicate-field' | 'unknown-field-value' | 'unknown-field'
  | 'unknown-property-value' | 'duplicate-id' | 'cloze-not-typed'
  // misplaced-id：hint，目標的 ID 不在行尾，照樣認得、存檔時移回行尾；ambiguous-id：error，目標那一行有兩個以上的 ID（D-134）。
  | 'misplaced-id' | 'ambiguous-id'
  // field-children：hint，分行的資料裡忽略的子項目（§9-4）。
  | 'field-children'
  // 點選填空（tasks/question-type-seam.md §3）：pick-answer-invalid 是 error，答案是組裡別的字；另外兩個是 hint，照原題型。一個目標最多一種。
  | 'pick-answer-invalid' | 'pick-mixed' | 'pick-not-recognized';
export interface AssignOptions {
  taken: ReadonlySet<string>;
  random?: () => number;
  /** 這些行的目標不補、不移動、不改縮排（待處理的，W5 §8-5）。 */
  skip?: ReadonlySet<number>;
}
export interface AssignResult {
  text: string;
  assigned: { line: number; id: string }[];
}
