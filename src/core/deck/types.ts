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
}
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
}
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
}
export type ProblemCode =
  | 'empty-question' | 'missing-answer' | 'typed-answer-invalid'
  // typed-answer-words：hint，好幾個答案的字數不一樣，畫線照第一個（D-122）。
  | 'typed-answer-words'
  | 'duplicate-field' | 'unknown-field-value' | 'unknown-field'
  | 'unknown-property-value' | 'duplicate-id' | 'cloze-not-typed'
  // misplaced-id：hint，目標的 ID 不在行尾，照樣認得、存檔時移回行尾；ambiguous-id：error，目標那一行有兩個以上的 ID（D-134）。
  | 'misplaced-id' | 'ambiguous-id';
export interface AssignOptions {
  taken: ReadonlySet<string>;
  replace?: ReadonlySet<string>;
  random?: () => number;
  /** 這些行的目標不補、不移動、不改縮排（待處理的，W5 §8-5）。 */
  skip?: ReadonlySet<number>;
}
export interface AssignResult {
  text: string;
  assigned: { line: number; id: string }[];
}
