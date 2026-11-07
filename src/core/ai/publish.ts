import { stringify } from 'yaml';
import { blockIds } from '../deck/index.ts';
import { freeName, rawPath } from './draft.ts';
import type { PlannedDraft } from './draft.ts';
import type { CardJob, SavedDeck, SaveState } from './job.ts';
import { sha256Hex, stamp } from './prompt.ts';

// 存草稿與快照的順序（tasks/ai-cards-mvp.md §5）：先存恢復資料 → 原文 → 一篇一篇建卡組 → 準備發布 → 發布（快照寫成＝成功）→ 清理。
// 中斷之後照恢復資料逐一核對實際的檔再接著做，不再貼一次、不重新配號。

/** 只建立的寫入（state 的寫入佇列）：寫成、讀回核對過是 done；已經有檔是 exists（不蓋掉）；門檻沒過是 blocked；寫不進去是 failed。 */
export type CreateResult = { kind: 'done' } | { kind: 'exists' } | { kind: 'blocked'; reason: string } | { kind: 'failed'; error: unknown };

export interface PublishIo {
  /** 存恢復資料（這台電腦）；存不進去丟錯，後面不做。 */
  store(job: CardJob): void;
  /** 工作完成或放棄：從這台電腦拿掉。 */
  remove(job: CardJob): void;
  /** 讀檔；不存在是 null，讀不到丟錯（讀不到不算不存在）。 */
  read(path: string): Promise<string | null>;
  create(path: string, text: string): Promise<CreateResult>;
  /** 這些 ID 現在在哪幾篇卡組（含引言框的行尾 ID）；占用資訊不完整（有讀不到的、還沒讀完）是 null。 */
  where(ids: readonly string[]): ReadonlyMap<string, readonly string[]> | null;
  /** 整個 vault 現在的檔名（小寫、不含 .md）。 */
  names(): Set<string>;
  now(): { ms: number; offset: number };
}

/** 一篇停下來要家長選（§5〈中斷與重試〉）：missing 是 ID 一個都找不到（可以重建）；split 是 ID 分在好幾篇或只剩一部分。 */
export interface DeckStop { kind: 'deck'; index: number; situation: 'missing' | 'split'; path: string }
export type PublishResult =
  | { kind: 'done'; decks: string[]; targets: number }
  | { kind: 'blocked'; reason: string }
  | { kind: 'failed'; error: unknown }
  | { kind: 'unreadable'; path: string; error: unknown }
  /** 原文或快照的位置有檔、內容不同：不蓋掉。 */
  | { kind: 'conflict'; path: string; what: 'raw' | 'snapshot' }
  | DeckStop;

/** 存草稿的第 2 步：恢復資料。reply 是輸入框交出的文字。 */
export function beginSave(job: CardJob, reply: string, service: string | null, planned: PlannedDraft, startedAt: string): CardJob {
  const save: SaveState = {
    reply, replySha: sha256Hex(reply), service, startedAt,
    decks: planned.decks.map(deck => ({ path: deck.path, text: deck.text, sha256: deck.sha256, ids: deck.ids, stage: 'pending', skipped: false })),
    snapshotPath: planned.snapshotPath, snapshotBody: planned.snapshotBody, edits: planned.edits, published: null,
  };
  return { ...job, save };
}

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
const folderOf = (path: string): string => path.slice(0, path.lastIndexOf('/'));

/** 快照的全文（§5〈快照〉）：time 是準備發布那一刻，之後重試沿用；對象是實際寫成、沒跳過的篇。 */
function snapshotText(job: CardJob, time: string): string {
  const save = job.save!;
  const rules = job.parts.slice(0, -1);
  const fields: Record<string, unknown> = {
    日期: time.slice(0, 10),
    時間: time,
    識別碼: job.id,
    工作: '製卡',
    對象: save.decks.filter(deck => !deck.skipped).map(deck => `[[${fileName(deck.path)}]]`),
    規則版本: rules.map(part => `${part.name} ${part.version}`).join('、'),
    送出: job.parts.map(part => `${part.name} ${part.version} ${part.sha256}`),
    提示雜湊: job.promptSha,
    回覆原文: save.replySha,
    複製時間: job.copiedAt,
    已有目標: job.existing.length,
    記穩目標: '無（初次製卡）',
  };
  if (job.form.material.trim()) fields['教材說明'] = job.form.material.trim();
  fields['接法'] = '複製貼上';
  if (save.service) fields['服務'] = save.service;
  fields['模型'] = '未記錄';
  if (save.edits.length) fields['程式改動'] = save.edits;
  const body = save.snapshotBody.endsWith('\n') ? save.snapshotBody : save.snapshotBody + '\n';
  return '---\n' + stringify(fields, { lineWidth: 0 }) + '---\n\n' + body;
}

/** 這一篇在目的地寫成了：內容和恢復資料相同，或這一篇配的每一個 ID 都在這個檔裡（寫成之後被家長改過字）。 */
const writtenIn = (deck: SavedDeck, text: string | null): boolean => text !== null && (sha256Hex(text) === deck.sha256 || (() => { const ids = blockIds(text); return deck.ids.every(id => ids.has(id)); })());

/**
 * 照恢復資料做第 3～7 步（§5）。每一步改了恢復資料就先存再往下。停下來的情況回傳原因，恢復資料留著，之後可以再呼叫。
 */
export async function publish(start: CardJob, io: PublishIo): Promise<PublishResult> {
  let job = start;
  const save = (): SaveState => job.save!;
  const keep = (next: SaveState): void => { job = { ...job, save: next }; io.store(job); };
  const read = async (path: string): Promise<{ text: string | null } | PublishResult> => {
    try { return { text: await io.read(path) }; } catch (error) { return { kind: 'unreadable', path, error }; }
  };
  const done = (): PublishResult => {
    io.remove(job);
    const decks = save().decks.filter(deck => !deck.skipped);
    return { kind: 'done', decks: decks.map(deck => deck.path), targets: decks.reduce((sum, deck) => sum + deck.ids.length, 0) };
  };
  if (!job.save) throw Error('這個工作還沒開始存草稿');

  // 已發布：恢復資料裡有快照的雜湊、那個位置的檔存在而且相同，只做清理。卡組之後怎麼改都不影響。
  if (save().published) {
    const found = await read(save().snapshotPath);
    if ('kind' in found) return found;
    if (found.text !== null) return sha256Hex(found.text) === save().published!.sha256 ? done() : { kind: 'conflict', path: save().snapshotPath, what: 'snapshot' };
  }

  // 第 3 步：原文（送出的每一部分與回覆原文），只建立；已存在而且內容相同就跳過。
  for (const text of [...job.parts.map(part => part.text), save().reply]) {
    const path = rawPath(sha256Hex(text));
    const found = await read(path);
    if ('kind' in found) return found;
    if (found.text === text) continue;
    if (found.text !== null) return { kind: 'conflict', path, what: 'raw' };
    const created = await io.create(path, text);
    if (created.kind === 'exists') {
      const again = await read(path);
      if ('kind' in again) return again;
      if (again.text !== text) return { kind: 'conflict', path, what: 'raw' };
    } else if (created.kind !== 'done') return created;
  }

  // 第 4 步：一篇一篇建卡組，每一篇先記成開始建了、存好，才去建檔；建好、讀回核對過，再記成寫出過。
  for (let index = 0; index < save().decks.length; index++) {
    const deck = save().decks[index];
    if (deck.skipped) continue;
    const found = await read(deck.path);
    if ('kind' in found) return found;
    const update = (change: Partial<SavedDeck>): void => { keep({ ...save(), decks: save().decks.map((each, i) => i === index ? { ...each, ...change } : each) }); };
    if (writtenIn(deck, found.text)) {
      if (deck.stage !== 'written') update({ stage: 'written' });
      continue;
    }
    const where = io.where(deck.ids);
    if (!where) return { kind: 'blocked', reason: 'unread' };
    // 目的地的檔照剛讀到的內容算（state 可能還沒讀到它），其他卡組問 state。
    const here = found.text === null ? new Set<string>() : blockIds(found.text);
    const paths = deck.ids.map(id => (where.get(id) ?? []).filter(path => path !== deck.path));
    const other = paths[0]?.[0];
    if (!here.size && other !== undefined && paths.every(each => each.length === 1 && each[0] === other)) {
      // 家長把它改名或搬走了：照現在的位置算寫成，不在舊位置再建一份。
      update({ path: other, stage: 'written' });
      continue;
    }
    // ID 分在好幾篇或只剩一部分（家長拆開、刪了一些目標）：停下，不自動補回。
    if (deck.ids.some(id => here.has(id)) || paths.some(each => each.length)) return { kind: 'deck', index, situation: 'split', path: deck.path };
    // 記成開始建了或寫出過、但 ID 一個都找不到：可能建好之後在記下之前中斷、家長又刪了，也可能真的沒建成，分不出來就停下（R4-1）。
    if (deck.stage !== 'pending') return { kind: 'deck', index, situation: 'missing', path: deck.path };
    // ID 一個都不在任何卡組、從來沒碰過 vault：照全文建；目的地被別人用了往後加。
    let path = deck.path;
    if (found.text !== null) path = `${folderOf(deck.path)}/${freeName(fileName(deck.path), io.names())}.md`;
    update({ path, stage: 'started' });
    const created = await io.create(path, deck.text);
    if (created.kind === 'exists') return { kind: 'deck', index, situation: 'missing', path };
    if (created.kind !== 'done') return created;
    update({ stage: 'written' });
  }

  // 第 5 步：準備發布。時間取一次就存起來；快照的位置被別人用了往後加。
  let time = save().published?.time;
  if (time === undefined) {
    const at = io.now();
    time = stamp(at.ms, at.offset);
    const found = await read(save().snapshotPath);
    if ('kind' in found) return found;
    const snapshotPath = found.text === null ? save().snapshotPath : `${folderOf(save().snapshotPath)}/${freeName(fileName(save().snapshotPath), io.names())}.md`;
    keep({ ...save(), snapshotPath, published: { time, sha256: '' } });
  }
  const text = snapshotText(job, time);
  if (save().published!.sha256 !== sha256Hex(text)) keep({ ...save(), published: { time, sha256: sha256Hex(text) } });

  // 第 6 步：發布。快照寫成、讀回來相同，就是這次製卡成功。
  const created = await io.create(save().snapshotPath, text);
  if (created.kind === 'exists') {
    const found = await read(save().snapshotPath);
    if ('kind' in found) return found;
    if (found.text === null || sha256Hex(found.text) !== save().published!.sha256) return { kind: 'conflict', path: save().snapshotPath, what: 'snapshot' };
  } else if (created.kind !== 'done') return created;
  // 第 7 步：清理。
  return done();
}

/** 跳過、重建、放棄之後 ID 怎麼處理（§5〈ID 的預留〉）：retire 進這台電腦的「不再配出」清單。 */
export interface Released { job: CardJob | null; retire: string[] }

/** 跳過這一篇：快照的對象不列它，其他篇照常發布。記成開始建了的篇，ID 不再配出。 */
export function skipDeck(job: CardJob, index: number): Released {
  const deck = job.save!.decks[index];
  const decks = job.save!.decks.map((each, i) => i === index ? { ...each, skipped: true } : each);
  return { job: { ...job, save: { ...job.save!, decks } }, retire: deck.stage === 'pending' ? [] : deck.ids };
}

/** 重建這一篇（只在 ID 一個都找不到時可以選）：當成還沒碰過 vault，照全文建；目的地被用了往後加。 */
export function rebuildDeck(job: CardJob, index: number): CardJob {
  const decks = job.save!.decks.map((each, i) => i === index ? { ...each, stage: 'pending' as const } : each);
  return { ...job, save: { ...job.save!, decks } };
}

/**
 * 放棄（只有還沒發布的能放棄，呼叫的一方先確認快照不在）：已寫成的卡組照樣是草稿、不刪；沒有快照。
 * 記成開始建了或寫出過的篇，ID 不再配出；沒碰過 vault 的篇的 ID 拿掉預留。回傳留下的篇。
 */
export function abandonJob(job: CardJob): { retire: string[]; left: string[] } {
  const decks = job.save?.decks ?? [];
  const touched = decks.filter(deck => deck.stage !== 'pending');
  return { retire: touched.flatMap(deck => deck.ids), left: decks.filter(deck => deck.stage === 'written' && !deck.skipped).map(deck => deck.path) };
}
