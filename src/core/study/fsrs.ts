import { FSRSAlgorithm, generatorParameters } from 'ts-fsrs';
import { dayOf, dayStart } from './time.ts';
import type { Memory, Rating, ReviewEntry } from './types.ts';

const algorithm = new FSRSAlgorithm(generatorParameters({ enable_fuzz: false }));
const DAY = 86_400_000;
const grades: Record<Rating, number> = { miss: 1, near: 1, good: 3, easy: 4 };

export function review(memory: Memory | null, entry: ReviewEntry): Memory {
  const elapsed = memory ? Math.max(0, dayOf(entry.at, entry.offset) - dayOf(memory.last.at, memory.last.offset)) : 0;
  const state = algorithm.next_state(memory, elapsed, grades[entry.r]);
  if (entry.r === 'near') state.difficulty = algorithm.next_state(memory, elapsed, 2).difficulty;
  return { stability: state.stability, difficulty: state.difficulty, last: entry, reps: (memory?.reps ?? 0) + 1 };
}

export function replay(reviews: readonly ReviewEntry[]): Map<string, Memory> {
  const memories = new Map<string, Memory>();
  for (const entry of reviews) memories.set(entry.lt, review(memories.get(entry.lt) ?? null, entry));
  return memories;
}

export function intervalDays(memory: Memory, retention: number): number {
  return Math.max(1, Math.min(36500, Math.round(memory.stability * algorithm.calculate_interval_modifier(retention))));
}

export function dueAt(memory: Memory, retention: number): number {
  const { last } = memory;
  if (last.src === 'mistake') return last.at;
  if (last.r === 'miss') return last.at + 60_000;
  if (last.r === 'near') return last.at + 600_000;
  return dayStart(dayOf(last.at, last.offset) + intervalDays(memory, retention), last.offset);
}

export function recall(memory: Memory, now: number): number {
  return algorithm.forgetting_curve(Math.max(0, (now - memory.last.at) / DAY), memory.stability);
}
