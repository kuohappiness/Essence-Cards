import type { Prompt } from '../deck/index.ts';
import { dueAt, review } from './fsrs.ts';
import { compareText, firstAtOrAfter } from './plan.ts';
import { dayOf, dayStart } from './time.ts';
import type { Next, Pick, Progress, QueueItem, ReviewEntry, Slot, SubjectRow, Today, TodayInput } from './types.ts';

interface Answers {
  /** 今天的作答，不含錯題補強，依時間排。 */
  valid: Map<string, ReviewEntry[]>;
  /** 今天有任何紀錄（含錯題補強）的目標。 */
  any: Set<string>;
}

/** 今天的作答：照排這一份時的時區算今天從什麼時候開始，和記憶狀態用同一條界線。 */
function answersOf(today: Today, input: TodayInput): Answers {
  const reviews = input.history.reviews;
  const valid = new Map<string, ReviewEntry[]>(), any = new Set<string>();
  for (let i = firstAtOrAfter(reviews, dayStart(today.day, today.offset)); i < reviews.length; i++) {
    const entry = reviews[i];
    any.add(entry.lt);
    if (entry.src === 'mistake') continue;
    const list = valid.get(entry.lt);
    if (list) list.push(entry);
    else valid.set(entry.lt, [entry]);
  }
  return { valid, any };
}

function slotOf(today: Today, lt: string): Slot {
  const slot = today.slots.get(lt);
  if (!slot) throw Error('今天的份裡沒有 ' + lt + '：today 不是 planToday 的結果');
  return slot;
}

const wrong = (entry: ReviewEntry | undefined): boolean => entry?.r === 'miss' || entry?.r === 'near';

/** 等再出的時間：今天以前的記憶依序套上今天的作答。 */
function againAt(slot: Slot, entries: readonly ReviewEntry[]): number {
  let memory = review(slot.memory, entries[0]);
  for (let i = 1; i < entries.length; i++) memory = review(memory, entries[i]);
  return dueAt(memory, slot.retention);
}

function choosePrompt(slot: Slot, entries: readonly ReviewEntry[]): Prompt {
  const { prompts } = slot.target;
  const last = entries.at(-1);
  if (last && wrong(last)) {
    const again = prompts.find(prompt => prompt.fingerprint === last.v);
    if (again) return again;
  }
  if (!slot.correct && !entries.some(entry => entry.r === 'good' || entry.r === 'easy')) return prompts[0];
  if (prompts.length === 1) return prompts[0];
  const seen = new Map(slot.seen);
  for (const entry of entries) if (entry.v !== null) seen.set(entry.v, entry.at);
  // 進階題裡最久沒出的：從沒出過的先（照筆記順序），再來是最後一次出現最早的。
  let best = prompts[1], bestAt = seen.get(best.fingerprint) ?? -Infinity;
  for (const prompt of prompts.slice(2)) {
    const at = seen.get(prompt.fingerprint) ?? -Infinity;
    if (at < bestAt) { best = prompt; bestAt = at; }
  }
  return best;
}

export function nextCard(today: Today, input: TodayInput, pick: Pick): Next {
  if (input.offset !== today.offset || dayOf(input.now, input.offset) !== today.day) return { kind: 'stale' };
  const { valid, any } = answersOf(today, input);
  let scope: QueueItem[];
  if ('more' in pick) scope = today.more.filter(item => { const pair = slotOf(today, item.lt).pair; return pair === null || !valid.has(pair); });
  else if ('deck' in pick) scope = today.share.filter(item => item.deck === pick.deck);
  else scope = today.share.filter(item => item.subject === pick.subject);

  let ready: { item: QueueItem; at: number } | null = null;
  let waiting: { item: QueueItem; at: number } | null = null;
  let fresh: QueueItem | null = null;
  for (const item of scope) {
    const entries = valid.get(item.lt);
    if (!entries) { fresh ??= item; continue; }
    if (!wrong(entries.at(-1))) continue;
    const at = againAt(slotOf(today, item.lt), entries);
    if (at <= input.now) { if (!ready || at < ready.at) ready = { item, at }; }
    else if (!waiting || at < waiting.at) waiting = { item, at };
  }
  const item = ready?.item ?? fresh ?? waiting?.item;
  if (!item) return { kind: 'done' };
  const slot = slotOf(today, item.lt);
  const prompt = choosePrompt(slot, valid.get(item.lt) ?? []);
  return { kind: 'card', card: {
    lt: item.lt, deck: item.deck, target: slot.target, prompt,
    isNew: slot.memory === null && !any.has(item.lt),
    typed: prompt.kind === 'qa' && prompt.typed !== null,
    early: !ready && !fresh,
  } };
}

export function progress(today: Today, input: TodayInput): Progress {
  const { valid } = answersOf(today, input);
  const rows = new Map<string | null, SubjectRow>();
  // 這一科在今天的份裡一開始要花的秒數：做完的列照當天一開始的順序排。
  const planned = new Map<SubjectRow, number>();
  for (const item of today.share) {
    let row = rows.get(item.subject);
    if (!row) rows.set(item.subject, row = { subject: item.subject, done: 0, total: 0, remainingSeconds: 0, inExam: false });
    row.total++;
    planned.set(row, (planned.get(row) ?? 0) + item.seconds);
    const last = valid.get(item.lt)?.at(-1);
    // 還沒碰過、等再出的都還要一份時間；答對才算完成。
    if (!last || wrong(last)) row.remainingSeconds += item.seconds;
    else row.done++;
  }
  if (input.exam) {
    for (const item of [...today.share, ...today.more]) {
      const row = rows.get(item.subject);
      if (row && slotOf(today, item.lt).inExam) row.inExam = true;
    }
  }
  const finished = (row: SubjectRow): number => row.done === row.total ? 1 : 0;
  // 學業以外的那一列（null）排在學業科目後面，沒做完、做完的都一樣（D-133）。
  const other = (row: SubjectRow): number => row.subject === null ? 1 : 0;
  const subjects = [...rows.values()].sort((a, b) => finished(a) - finished(b) || other(a) - other(b) || Number(b.inExam) - Number(a.inExam)
    || (finished(a) ? (planned.get(b) ?? 0) - (planned.get(a) ?? 0) : b.remainingSeconds - a.remainingSeconds)
    || compareSubject(a.subject, b.subject));
  return { done: subjects.reduce((sum, row) => sum + row.done, 0), total: subjects.reduce((sum, row) => sum + row.total, 0), subjects };
}

function compareSubject(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return compareText(a, b);
}

/** 對中 prompt.typed 的任何一個就算對（D-122）：去掉頭尾空白、不分大小寫，其餘完全相同。不是打字題時丟出錯誤。 */
export function checkTyped(prompt: Prompt, input: string): boolean {
  if (prompt.kind !== 'qa' || prompt.typed === null) throw TypeError('不是打字題');
  const normalize = (text: string): string => text.trim().toLowerCase();
  return prompt.typed.some(answer => normalize(input) === normalize(answer));
}
