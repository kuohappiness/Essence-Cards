import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Pick } from '../../src/core/study/index.ts';
import { createSession } from '../../src/review/index.ts';
import type { CardView, PickView, Session } from '../../src/review/index.ts';
import { createState } from '../../src/state/index.ts';
import type { State } from '../../src/state/index.ts';
import { createMemoryFiles, type MemoryFiles } from './memory-files.ts';

// 比較卡的 session 測試共用（tests/pick-*.test.ts）：createSession 接真的 createState。
const DELAY = 30;
export const START = Date.parse('2026-10-24T19:00:00.000+08:00');
export const DECK = 'Essence Cards/國語/相似字.md';
export const PC = 'Essence Cards/紀錄/2026-10 PC-test.jsonl';
export const PHONE = 'Essence Cards/紀錄/2026-10 iPhone-test.jsonl';
const CHARS = `---
科目: 國語
---
- 寨（寨、塞、寒、賽） 相似字 ^zhai00
    - 盜匪躲在山＿＿裡。 :: 寨
    - 這座古老的＿＿子建在山頂上。 :: 寨
- 塞（寨、塞、寒、賽） 相似字 ^sai000
    - 下班時間大＿＿車。 :: 塞
    - 水管＿＿住了。 :: 塞
- 寒（寨、塞、寒、賽） 相似字 ^han000
    - 冬天很＿＿冷。 :: 寒
    - ＿＿假快到了。 :: 寒
- 賽（寨、塞、寒、賽） 相似字 ^yyy000
    - 明天有籃球比＿＿。 :: 賽
    - 運動會＿＿跑。 :: 賽
`;
export const TWO = `---
科目: 英文
---
- borrow（borrow、lend） 比較 ^borrow
    - Can I ＿＿ your pen? :: borrow
    - I ＿＿ books. :: borrow
    - May I ＿＿ this? :: borrow
- lend（borrow、lend） 比較 ^lendxx
    - Can you ＿＿ me a pen? :: lend
    - Banks ＿＿ money. :: lend
    - Please ＿＿ me that. :: lend
`;
export const QUESTION = `---
科目: 國語
---
- ？（？、！） 比較 ^askask
    - 這是問號：＿＿ :: ？
- ！（？、！） 比較 ^bangxx
    - 這是驚嘆號：＿＿ :: ！
`;

export interface Harness extends MemoryFiles {
  state: State;
  clock: { now: number };
  settle: () => Promise<void>;
  log: () => Record<string, unknown>[];
  open: (pick: Pick) => Promise<Session>;
}
const timed = new WeakSet<TestContext>();
export async function setup(t: TestContext, texts: Record<string, string> = { [DECK]: CHARS }): Promise<Harness> {
  if (!timed.has(t)) { t.mock.timers.enable({ apis: ['setTimeout'] }); timed.add(t); }
  const memory = createMemoryFiles(texts);
  const clock = { now: START };
  const state = createState({ files: memory.files, device: 'PC-test', delay: DELAY, fillIds: false, now: () => clock.now, offset: () => 480 });
  t.after(() => state.close());
  await state.ready();
  const sessions: Session[] = [];
  t.after(() => { for (const session of sessions) session.close(); });
  return {
    ...memory, state, clock,
    settle: async () => { t.mock.timers.tick(DELAY + 1); await new Promise<void>(resolve => setImmediate(resolve)); },
    log: () => (memory.texts.get(PC) ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>),
    async open(pick) {
      const session = createSession({ state, pick, now: () => clock.now });
      sessions.push(session);
      await session.ready();
      return session;
    },
  };
}
export function view(s: Session): CardView {
  const current = s.view();
  assert.equal(current.kind, 'card');
  if (current.kind !== 'card') throw Error();
  return current.card;
}
export function pick(s: Session): PickView {
  const found = view(s).pick;
  assert.ok(found, '不是比較卡');
  return found;
}
export const answers = (s: Session): string[] => view(s).card.blanks.map(blank => blank.answer ?? '');
export const stage = (s: Session): string => pick(s).stage;
export const texts = (s: Session): string[] => pick(s).cells.map(cell => cell.text);
/** 隔一段時間再按，不碰 0.3 秒的防連點。 */
export function tap(h: Harness, s: Session, key: string): void { h.clock.now += 400; s.act({ kind: 'key', key }); }
export function skip(h: Harness, s: Session): void { h.clock.now += 400; s.act({ kind: 'skip' }); }
export function check(h: Harness, s: Session): void { h.clock.now += 400; s.act({ kind: 'check' }); }
/** 一格一格填：each 回傳要點的字，null 是沒印象。 */
export function fill(h: Harness, s: Session, each: (answer: string, index: number) => string | null): void {
  answers(s).forEach((answer, index) => {
    const value = each(answer, index);
    if (value === null) skip(h, s); else tap(h, s, value);
  });
}
export const WRONG = (answer: string, keys: readonly string[]): string => keys.find(key => key !== answer) ?? '';
export const keysOf = (s: Session): readonly string[] => view(s).card.group?.keys ?? [];
export const rights = (h: Harness, s: Session): void => { fill(h, s, answer => answer); check(h, s); };
/** 螢幕上第一次出現的順序，一個目標一次。 */
export const ltsOnScreen = (s: Session): string[] => [...new Set(view(s).card.blanks.map(blank => blank.lt))];
export function printOf(s: Session, lt: string): string[] { return view(s).card.blanks.filter(blank => blank.lt === lt).map(blank => blank.prompt.fingerprint); }

export const heldLine = (lt: string): string => JSON.stringify({ t: '2026-10-24T18:00:00.000+08:00', need: '9.0.0', lt, r: 'miss', v: '12345678' });
