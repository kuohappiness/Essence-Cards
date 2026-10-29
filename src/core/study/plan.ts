import type { Target } from '../deck/index.ts';
import { dueAt, recall, replay } from './fsrs.ts';
import { dayOf, dayStart } from './time.ts';
import type { DeckEntry, Lane, Memory, QueueItem, ReviewEntry, Slot, Today, TodayInput } from './types.ts';

const LANES: readonly Lane[] = ['relearn', 'exam-due', 'exam-new', 'due', 'new'];
const IMPORTANCE = { high: 0, medium: 1, low: 2 } as const;
const IMPORTANCE_LABEL = { 高: 'high', 中: 'medium', 低: 'low' } as const;
const DEFAULT_SECONDS = 15;
const MIN_GAPS = 30;
const MAX_GAP = 120_000;

export const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** 第一筆 at ≥ time 的位置；reviews 依時間排好（mergeHistory 的結果）。 */
export function firstAtOrAfter(reviews: readonly ReviewEntry[], time: number): number {
  let low = 0, high = reviews.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (reviews[middle].at < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

interface Candidate {
  entry: DeckEntry;
  target: Target;
  id: string;
  memory: Memory | null;
  retention: number;
  inExam: boolean;
  due: number | null;
  /** 今天以前的記憶在今天開始時的 recall；新卡是 0。 */
  recall: number;
  lane: Lane;
}

/** 每一科最近 30 天作答間隔的中位數（秒）；間隔不夠的科目用預設。 */
function secondsBySubject(reviews: readonly ReviewEntry[], from: number, to: number, subjectOf: ReadonlyMap<string, string | null>): Map<string | null, number> {
  const gaps = new Map<string | null, number[]>();
  let previous: number | null = null;
  for (let i = firstAtOrAfter(reviews, from); i < reviews.length && reviews[i].at < to; i++) {
    const entry = reviews[i];
    if (entry.src === 'mistake') continue;
    const gap = previous === null ? 0 : entry.at - previous;
    previous = entry.at;
    const subject = subjectOf.get(entry.lt);
    if (gap <= 0 || gap > MAX_GAP || subject === undefined) continue;
    const list = gaps.get(subject);
    if (list) list.push(gap);
    else gaps.set(subject, [gap]);
  }
  const seconds = new Map<string | null, number>();
  for (const [subject, list] of gaps) {
    if (list.length < MIN_GAPS) continue;
    list.sort((a, b) => a - b);
    const middle = list.length >> 1;
    const median = list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
    seconds.set(subject, Math.max(1, Math.round(median / 1000)));
  }
  return seconds;
}

export function planToday(input: TodayInput): Today {
  const { settings, exam, offset } = input;
  const reviews = input.history.reviews;
  const day = dayOf(input.now, offset);
  const start = dayStart(day, offset), end = dayStart(day + 1, offset);
  const problems: Today['problems'] = [];
  const decks = [...input.decks].sort((a, b) => compareText(a.path, b.path));

  const levels = new Set<string>(), categories = new Set<string>();
  for (const label of settings.filter) {
    const level = /^重要性\s*[：:]\s*(高|中|低)$/.exec(label)?.[1] as keyof typeof IMPORTANCE_LABEL | undefined;
    if (level) levels.add(IMPORTANCE_LABEL[level]);
    else categories.add(label);
  }

  // ID 的歸屬：好幾篇啟用的卡組有同一個 ID 時，照路徑第一篇的算，同一篇照行號第一個。
  // 出卡、配對與科目都照這個歸屬；只在草稿、暫停的卡組裡的 ID，科目用路徑第一篇的。
  const subjectOf = new Map<string, string | null>();
  const owner = new Map<string, { path: string; target: Target }>();
  const chosen: { entry: DeckEntry; target: Target; id: string }[] = [];
  // 讀不懂的紀錄行停掉的目標（syntax.md §5-2）：照樣占著 ID 的歸屬，只是不排程。
  const held = new Set(input.history.held);
  const stopped = (id: string): boolean => input.history.incomplete || held.has(id);
  for (const entry of decks) {
    const { props, targets } = entry.deck;
    if (props.isTranscript || props.status !== 'active') {
      for (const target of targets) if (target.id !== null && !subjectOf.has(target.id)) subjectOf.set(target.id, props.subject);
      continue;
    }
    const filtered = props.categories.some(category => categories.has(category));
    for (const target of targets) {
      const id = target.id;
      if (id === null) continue;
      const first = owner.get(id);
      if (first !== undefined) {
        // 同一篇裡的重複 W2 已經回報。
        if (first.path !== entry.path) problems.push({ deck: entry.path, line: target.line, message: '學習目標 ID ' + id + ' 和「' + first.path + '」重複，這一篇的不出' });
        continue;
      }
      owner.set(id, { path: entry.path, target });
      subjectOf.set(id, props.subject);
      if (target.ok && !target.fields.paused && target.prompts.length > 0 && !filtered && !levels.has(target.fields.importance) && !stopped(id)) chosen.push({ entry, target, id });
    }
  }

  // 只用今天以前的紀錄；記憶狀態只有候選用得到，各目標的重播互不影響。
  const ids = new Set(chosen.map(c => c.id));
  const before = reviews.slice(0, firstAtOrAfter(reviews, start)).filter(entry => ids.has(entry.lt));
  const memories = replay(before);
  const correct = new Set<string>();
  const seen = new Map<string, Map<string, number>>();
  for (const entry of before) {
    if (entry.src === 'mistake') continue;
    if (entry.r === 'good' || entry.r === 'easy') correct.add(entry.lt);
    if (entry.v === null) continue;
    const times = seen.get(entry.lt);
    if (times) times.set(entry.v, entry.at);
    else seen.set(entry.lt, new Map([[entry.v, entry.at]]));
  }

  const candidates = new Map<string, Candidate>();
  for (const { entry, target, id } of chosen) {
    const inExam = exam !== null && exam.contains(entry, target);
    const retention = inExam && exam.hasPeriod ? Math.max(settings.retention, 0.9) : settings.retention;
    const memory = memories.get(id) ?? null;
    const due = memory && dueAt(memory, retention);
    let lane: Lane;
    if (!memory) lane = inExam ? 'exam-new' : 'new';
    else if ((memory.last.r === 'miss' || memory.last.r === 'near') && memory.last.src !== 'mistake') lane = 'relearn';
    else lane = inExam ? 'exam-due' : 'due';
    candidates.set(id, { entry, target, id, memory, retention, inExam, due, recall: memory ? recall(memory, start) : 0, lane });
  }
  const shows = (c: Candidate): boolean => c.due === null || c.due < end;
  const remembered = (c: Candidate): boolean => c.memory !== null && (c.memory.last.r === 'good' || c.memory.last.r === 'easy') && !shows(c);

  // 英文的兩個方向：同一篇裡 pairKey 相同，各方向取行號小的；重複而被排除的目標不算。
  const pairOf = new Map<string, string>();
  const dropped = new Set<string>();
  for (const entry of decks) {
    if (entry.deck.props.isTranscript || entry.deck.props.status !== 'active') continue;
    const pairs = new Map<string, { en?: Target; zh?: Target }>();
    for (const target of entry.deck.targets) {
      if (target.pairKey === null || target.direction === null || target.id === null || owner.get(target.id)?.target !== target) continue;
      const pair = pairs.get(target.pairKey) ?? {};
      const side = target.direction === 'en-zh' ? 'en' : 'zh';
      if (!pair[side] || target.line < pair[side].line) pair[side] = target;
      pairs.set(target.pairKey, pair);
    }
    for (const { en, zh } of pairs.values()) {
      if (!en || !zh) continue;
      if (en.id !== null && zh.id !== null) { pairOf.set(en.id, zh.id); pairOf.set(zh.id, en.id); }
      const e = en.id === null ? undefined : candidates.get(en.id);
      const z = zh.id === null ? undefined : candidates.get(zh.id);
      if (!z || z.target !== zh) continue;
      if (!e || e.target !== en) continue;
      // 中翻英還沒開始時，英翻中「記得」才出。
      if (!z.memory && !remembered(e)) { dropped.add(z.id); continue; }
      // 兩個方向今天都要出時，只留比較快忘的；相同時留英翻中。
      if (shows(e) && shows(z)) dropped.add(z.recall < e.recall ? e.id : z.id);
    }
  }

  const ordered = [...candidates.values()].filter(c => shows(c) && !dropped.has(c.id));
  ordered.sort((a, b) => LANES.indexOf(a.lane) - LANES.indexOf(b.lane) || compareInLane(a, b) || compareText(a.id, b.id));

  const seconds = secondsBySubject(reviews, dayStart(day - 30, offset), start, subjectOf);
  const budget = settings.capMinutes * 60;
  const share: QueueItem[] = [], more: QueueItem[] = [];
  const slots = new Map<string, Slot>();
  let used = 0;
  for (const c of ordered) {
    const subject = c.entry.deck.props.subject;
    const item: QueueItem = { lt: c.id, deck: c.entry.path, subject, lane: c.lane, seconds: seconds.get(subject) ?? DEFAULT_SECONDS };
    // 第一個放不下的和它後面的全部進 more，不跳過去找小的。
    if (more.length === 0 && used + item.seconds <= budget) { used += item.seconds; share.push(item); }
    else more.push(item);
    slots.set(c.id, { target: c.target, pair: pairOf.get(c.id) ?? null, memory: c.memory, retention: c.retention, inExam: c.inExam,
      correct: correct.has(c.id), seen: seen.get(c.id) ?? new Map<string, number>() });
  }
  return { day, offset, share, more, problems, slots };
}

function compareInLane(a: Candidate, b: Candidate): number {
  switch (a.lane) {
    case 'relearn': return (a.due ?? 0) - (b.due ?? 0);
    case 'exam-due':
    case 'due': return IMPORTANCE[a.target.fields.importance] - IMPORTANCE[b.target.fields.importance] || a.recall - b.recall;
    default: return compareText(a.entry.path, b.entry.path) || a.target.line - b.target.line;
  }
}
