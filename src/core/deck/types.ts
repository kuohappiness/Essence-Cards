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
   * 資料欄位那一行的其中一段（tasks/edit-markup.md §1-2）：那一行原文的位置，從 0 算。只有 unknown-field-value、duplicate-field
   * （那一段的值）與 unknown-field（整段）會填，而且只在那一段寫在欄位的第一行時；沒填的是整行。
   */
  columns?: { from: number; to: number };
}
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
