import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { sourceLinks } from '../deck/index.ts';
import type { Deck } from '../deck/index.ts';
import { unitInScope } from './scope.ts';
import type { ScopeFile } from './scope.ts';

/**
 * 考試切面的格式（tasks/record-gaps.md §2、syntax §5-4）：每次考試一台一份，留下這台當時看得到的範圍內卡組原文。只有格式與判斷，讀寫在 state。
 */

export const SNAPSHOT_FOLDER = 'Essence Cards/紀錄/考試切面';

/** 第一行的檔頭。exam 是範圍的識別碼，沒有是 null；decks 是底下有幾篇，用來看出沒寫完。 */
export interface SnapshotHeader { t: string; exam: string | null; scope: string; start: string; end: string; units: string[]; decks: number }
export interface SnapshotDeck { path: string; text: string }

/** 檔名裡的鍵：識別碼手寫可以有 `/`、`:`、空白，也有沒有識別碼的範圍，不能直接放。和 chooseScope 分組同一個字串。 */
export function snapshotKey(exam: string | null, scope: string): string {
  return bytesToHex(sha256(utf8ToBytes(exam === null ? 'path:' + scope : 'id:' + exam))).slice(0, 12);
}
const baseName = (start: string, key: string, device: string): string => `${SNAPSHOT_FOLDER}/${start} ${key} ${device}`;
/** 基本檔名被無效的檔占住時，序號接在裝置碼後面。 */
export function snapshotPath(start: string, key: string, device: string, suffix: number): string {
  return `${baseName(start, key, device)}${suffix === 1 ? '' : ' ' + String(suffix)}.jsonl`;
}
/** 這個路徑是這台這一份（或它的序號版）時回傳序號，不是回傳 null。別台的檔不算。 */
export function snapshotSuffix(path: string, start: string, key: string, device: string): number | null {
  const base = baseName(start, key, device);
  if (!path.startsWith(base) || !path.endsWith('.jsonl')) return null;
  const rest = path.slice(base.length, -'.jsonl'.length);
  if (rest === '') return 1;
  return /^ [1-9]\d*$/.test(rest) ? Number(rest.slice(1)) : null;
}

export function snapshotText(header: SnapshotHeader, decks: readonly SnapshotDeck[]): string {
  return [header, ...decks.map(({ path, text }) => ({ path, text }))].map(line => JSON.stringify(line)).join('\n') + '\n';
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function validHeader(value: unknown): value is SnapshotHeader {
  return isObject(value) && typeof value.t === 'string' && (value.exam === null || typeof value.exam === 'string') && typeof value.scope === 'string'
    && typeof value.start === 'string' && typeof value.end === 'string' && Array.isArray(value.units) && value.units.every(unit => typeof unit === 'string')
    && typeof value.decks === 'number' && Number.isInteger(value.decks) && value.decks >= 0;
}

/** 這份檔算不算寫完的切面（§2 的「有效」）：檔頭合法、鍵與開始日相符、後面每行都是 {path, text}、行數對、path 不重複。 */
export function snapshotValid(text: string, key: string, start: string): boolean {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let parsed: unknown[];
  try { parsed = lines.map(line => JSON.parse(line) as unknown); } catch { return false; }
  const [header, ...decks] = parsed;
  if (!validHeader(header) || snapshotKey(header.exam, header.scope) !== key || header.start !== start || decks.length !== header.decks) return false;
  const paths = decks.map(deck => isObject(deck) && typeof deck.path === 'string' && typeof deck.text === 'string' ? deck.path : null);
  return !paths.includes(null) && new Set(paths).size === paths.length;
}

/**
 * 這一篇要不要放進切面：自己的單元在範圍內，或任何一個目標（不管暫停、有沒有 ID、待處理）的出處讀出的單元在範圍內。轉錄稿不算。
 * 屬性區壞掉、讀不出單元的篇收不到，這是查核的限制，不能推成卡片不存在。
 */
export function deckInScope(file: Pick<ScopeFile, 'lines'>, deck: Deck): boolean {
  const { term, subject, unit, isTranscript } = deck.props;
  if (isTranscript || subject === null) return false;
  if (term !== null && unit !== null && unitInScope(file, { term, subject, code: unit.code })) return true;
  return deck.targets.some(target => sourceLinks(target.fields.sources, deck.props).some(({ link }) => link.kind === 'unit' && unitInScope(file, { term: link.term, subject, code: link.unit })));
}
