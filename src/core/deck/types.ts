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
  | { kind: 'qa'; line: number; question: string; answer: string; extras: string[]; typed: string | null; fingerprint: string }
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
  | 'duplicate-field' | 'unknown-field-value' | 'unknown-field'
  | 'unknown-property-value' | 'duplicate-id' | 'cloze-not-typed';
export interface AssignOptions {
  taken: ReadonlySet<string>;
  replace?: ReadonlySet<string>;
  random?: () => number;
}
export interface AssignResult {
  text: string;
  assigned: { line: number; id: string }[];
}
