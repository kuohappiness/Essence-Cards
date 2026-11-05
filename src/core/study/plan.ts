import type { Target } from '../deck/index.ts';
import { findDuplicateIds } from './duplicates.ts';
import { dueAt, recall, replay } from './fsrs.ts';
import { addShown } from './shown.ts';
import { dayOf, dayStart } from './time.ts';
import type { DeckEntry, Lane, Memory, QueueItem, ReviewEntry, Shown, Slot, Today, TodayInput } from './types.ts';

const LANES: readonly Lane[] = ['relearn', 'exam-due', 'exam-new', 'due', 'new'];
const IMPORTANCE = { high: 0, medium: 1, low: 2 } as const;
const IMPORTANCE_LABEL = { 高: 'high', 中: 'medium', 低: 'low' } as const;
const DEFAULT_SECONDS = 15;
const MIN_GAPS = 30;
const MAX_GAP = 120_000;

export const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** 這個目標現在用的保持率（tasks/exam-scope.md §5）：今天的份、全部卡與顏色都看這一個。考試範圍內、有考試期間才提高。 */
export function retentionOf(input: Pick<TodayInput, 'exam' | 'settings'>, entry: DeckEntry, target: Target): number {
  const { exam, settings } = input;
  return exam?.hasPeriod && exam.contains(entry, target) ? Math.max(settings.retention, 0.9) : settings.retention;
}

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
  let previous: number | null = null, batch: string | null = null;
  for (let i = firstAtOrAfter(reviews, from); i < reviews.length && reviews[i].at < to; i++) {
    const entry = reviews[i];
    if (entry.src === 'mistake') continue;
    const gap = previous === null ? 0 : entry.at - previous;
    previous = entry.at;
    // 同一張比較卡的行（tasks/question-type-seam.md §5-4）：with 等於前一行的批次時不算一個間隔。第一行還沒同步時，看得到的第一行代表這張卡。
    const sameCard = entry.with !== undefined && entry.with === batch;
    batch = entry.with ?? entry.t;
    const subject = subjectOf.get(entry.lt);
    if (sameCard || gap <= 0 || gap > MAX_GAP || subject === undefined) continue;
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
  const decks = [...input.decks].sort((a, b) => compareText(a.path, b.path));

  const levels = new Set<string>(), categories = new Set<string>();
  for (const label of settings.filter) {
    const level = /^重要性\s*[：:]\s*(高|中|低)$/.exec(label)?.[1] as keyof typeof IMPORTANCE_LABEL | undefined;
    if (level) levels.add(IMPORTANCE_LABEL[level]);
    else categories.add(label);
  }

  // 前提是 state 交進來的 ID 不重複（D-157：用了重複 ID 的目標已經拿掉）。直接收到重複的 ID 時（測試）是防呆：
  // 不照位置或路徑決定誰保留，輸入裡這個 ID 的目標都不出、不占配對、作答不算進估秒。只看輸入裡的，不冒充檢查過 state 已經拿掉的。
  const duplicated = new Set(findDuplicateIds(decks).map(each => each.id));
  const subjectOf = new Map<string, string | null>();
  const chosen: { entry: DeckEntry; target: Target; id: string }[] = [];
  // 讀不懂的紀錄行停掉的目標（syntax.md §5-2）：只是不排程，科目與配對照算。
  const held = new Set(input.history.held);
  const stopped = (id: string): boolean => input.history.incomplete || held.has(id);
  for (const entry of decks) {
    const { props, targets } = entry.deck;
    const active = !props.isTranscript && props.status === 'active';
    const filtered = props.categories.some(category => categories.has(category));
    for (const target of targets) {
      const id = target.id;
      if (id === null || duplicated.has(id)) continue;
      subjectOf.set(id, props.subject);
      if (active && target.ok && !target.fields.paused && target.prompts.length > 0 && !filtered && !levels.has(target.fields.importance) && !stopped(id)) chosen.push({ entry, target, id });
    }
  }

  // 只用今天以前的紀錄；記憶狀態只有候選用得到，各目標的重播互不影響。
  const ids = new Set(chosen.map(c => c.id));
  const before = reviews.slice(0, firstAtOrAfter(reviews, start)).filter(entry => ids.has(entry.lt));
  const memories = replay(before);
  const correct = new Set<string>();
  const seen = new Map<string, Shown>();
  for (const entry of before) {
    if (entry.src === 'mistake') continue;
    if (entry.r === 'good' || entry.r === 'easy') correct.add(entry.lt);
    const shown = seen.get(entry.lt);
    if (shown) addShown(shown, entry);
    else seen.set(entry.lt, addShown(new Map(), entry));
  }

  const candidates = new Map<string, Candidate>();
  for (const { entry, target, id } of chosen) {
    const inExam = exam !== null && exam.contains(entry, target);
    const retention = retentionOf(input, entry, target);
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

  // 英文的兩個方向：同一篇裡 pairKey 相同，各方向取行號小的；重複的 ID 不算，另一個方向照「這個方向不在」排。
  const pairOf = new Map<string, string>();
  const dropped = new Set<string>();
  for (const entry of decks) {
    if (entry.deck.props.isTranscript || entry.deck.props.status !== 'active') continue;
    const pairs = new Map<string, { en?: Target; zh?: Target }>();
    for (const target of entry.deck.targets) {
      if (target.pairKey === null || target.direction === null || target.id === null || duplicated.has(target.id)) continue;
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
      correct: correct.has(c.id), seen: seen.get(c.id) ?? new Map() as Shown });
  }
  return { day, offset, share, more, slots };
}

function compareInLane(a: Candidate, b: Candidate): number {
  switch (a.lane) {
    case 'relearn': return (a.due ?? 0) - (b.due ?? 0);
    case 'exam-due':
    case 'due': return IMPORTANCE[a.target.fields.importance] - IMPORTANCE[b.target.fields.importance] || a.recall - b.recall;
    default: return compareText(a.entry.path, b.entry.path) || a.target.line - b.target.line;
  }
}
