import test from 'node:test';
import assert from 'node:assert/strict';
import { blockIds, isDeckPath, parseDeck } from '../src/core/deck/index.ts';
import { abandonJob, beginSave, buildPrompt, inspectReply, isJob, planDraft, publish, rawPath, rebuildDeck, RULE_SUBJECTS, sha256Hex, skipDeck, stamp } from '../src/core/ai/index.ts';
import type { CardForm, CardJob, CreateResult, EmbeddedRule, ExistingNow, PublishIo } from '../src/core/ai/index.ts';

// tasks/ai-cards-mvp.md §5 的順序、中斷與重試、ID 的預留（F2、F3、R2-1、R2-2、R3-1、R4-1）。檔案在記憶體裡，當掉用丟錯模擬：恢復資料只留最後一次存成功的。

const english = RULE_SUBJECTS.find(each => each.key === 'english')!;
const rule = (name: string, version: string, text: string): EmbeddedRule => ({ name, version, text, sha256: sha256Hex(text) });
const form: CardForm = { subject: 'english', term: '國二上', unit: 'L3 Sports: Week 1', purpose: '準備段考', supplement: false, adjust: '', material: '課本 p.40～45 的照片' };
const REPLY = [
  '國二上英文 L3 單字', '', '## 單字', '', '- borrow 英翻中 ^zzz', '    - 出處：p.40', '    - borrow :: 借入', '',
  '> [!note]- 候選卡片', '> - lend 英翻中', '>     - 理由：課本只出現一次', '>     - lend :: 借出', '',
  '國二上英文 L3 文法', '', '## 文法', '', '- 能用 be going to 說未來的計畫', '    - 出處：p.42', '    - 我明天要去游泳。I ＿＿ swim tomorrow. :: am going to', '<<<完>>>',
].join('\r\n');
const NOW = Date.UTC(2026, 10, 7, 2, 23, 45);
const nobody = (): ExistingNow => ({ kind: 'none' });

/** 複製提示 A 的當下存的工作，之後規則改成 B（模擬外掛更新）也照 A。 */
function copied(): CardJob {
  const prompt = buildPrompt(form, english, [rule('通用', 'v0.15', '# 通用 A'), rule('英文', 'v0.14', '# 英文 A')], []);
  return { id: 'm4k8q2', copiedAt: stamp(NOW - 21 * 60_000, 480), copiedMs: NOW - 21 * 60_000, form, subject: english, parts: prompt.parts, promptSha: prompt.sha256, existing: [], save: null };
}
/** 存草稿的第 1、2 步：檢查、配號、做出全文，存成恢復資料。 */
function saved(job: CardJob, taken = new Set<string>()): CardJob {
  const inspection = inspectReply(REPLY, form, english, [], nobody);
  assert.deepEqual(inspection.errors, []);
  const ids = ['aaaaa2', 'bbbbb2', 'ccccc2'];
  let n = 0;
  const plan = planDraft(inspection, form, english, [], nobody, () => ids[n++], taken, '2026-11-07');
  return beginSave(job, REPLY, 'ChatGPT', plan, stamp(NOW, 480));
}

class Crash extends Error {}
/** 記憶體裡的 vault 與這台電腦的恢復資料。crash 回傳 true 的那一次呼叫當掉（之前的都做完了）。 */
function vault(files = new Map<string, string>()) {
  const box: { stored: string | null; removed: boolean; crash: (what: 'store' | 'create' | 'remove', path?: string) => boolean } = { stored: null, removed: false, crash: () => false };
  const io: PublishIo = {
    store(job) { if (box.crash('store')) throw new Crash(); box.stored = JSON.stringify(job); },
    remove() { if (box.crash('remove')) throw new Crash(); box.stored = null; box.removed = true; },
    read: path => Promise.resolve(files.get(path) ?? null),
    create(path, text): Promise<CreateResult> {
      if (box.crash('create', path)) throw new Crash();
      if ([...files.keys()].some(each => each.toLowerCase() === path.toLowerCase())) return Promise.resolve({ kind: 'exists' });
      files.set(path, text);
      return Promise.resolve({ kind: 'done' });
    },
    where(ids) {
      const found = new Map<string, string[]>();
      for (const [path, text] of files) if (isDeckPath(path)) for (const id of blockIds(text)) if (ids.includes(id)) found.set(id, [...found.get(id) ?? [], path]);
      return found;
    },
    names: () => new Set([...files.keys()].map(path => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '').toLowerCase())),
    now: () => ({ ms: NOW + 3 * 3_600_000, offset: 480 }),
  };
  /** 重開：只拿得到最後一次存成功的恢復資料（JSON 往返）。 */
  const reload = (): CardJob => { const value: unknown = JSON.parse(box.stored!); assert.ok(isJob(value)); return value; };
  return { files, io, box, reload };
}
const WORD = 'Essence Cards/學業/國二上/英文/國二上英文 L3 單字.md';
const GRAMMAR = 'Essence Cards/學業/國二上/英文/國二上英文 L3 文法.md';
const SNAPSHOT = 'Essence Cards/紀錄/AI 輸出/2026-11-07 國二上英文 L3 Sports： Week 1.md';

void test('§5 一次做完：原文（送出的每一部分與回覆原文逐位元組相同）→ 兩篇卡組 → 快照 → 清理', async () => {
  const { files, io, box } = vault();
  const job = saved(copied());
  io.store(job);
  const result = await publish(job, io);
  assert.deepEqual(result, { kind: 'done', decks: [WORD, GRAMMAR], targets: 3 });
  assert.equal(box.stored, null);
  // 原文：規則 A（不是之後的 B）、任務段、回覆原文（CRLF 照輸入框交出的）。
  for (const text of [...job.parts.map(part => part.text), REPLY]) assert.equal(files.get(rawPath(sha256Hex(text))), text);
  assert.equal(files.get(rawPath(sha256Hex(REPLY)))!.includes('\r\n'), true);
  assert.equal(parseDeck(files.get(WORD)!).props.status, 'draft');
  assert.ok(files.get(WORD)!.includes('- borrow 英翻中 ^aaaaa2\n') && files.get(WORD)!.includes('> - lend 英翻中 ^bbbbb2\n'));
  assert.ok(files.get(GRAMMAR)!.includes('- 能用 be going to 說未來的計畫 ^ccccc2\n'));
  const snapshot = files.get(SNAPSHOT)!;
  assert.equal(snapshot, [
    '---',
    '日期: 2026-11-07',
    '時間: 2026-11-07T13:23:45+08:00',
    '識別碼: m4k8q2',
    '工作: 製卡',
    '對象:',
    '  - "[[國二上英文 L3 單字]]"',
    '  - "[[國二上英文 L3 文法]]"',
    '規則版本: 通用 v0.15、英文 v0.14',
    '送出:',
    ...job.parts.map(part => `  - ${part.name} ${part.version} ${part.sha256}`),
    `提示雜湊: ${job.promptSha}`,
    `回覆原文: ${sha256Hex(REPLY)}`,
    '複製時間: 2026-11-07T10:02:45+08:00',
    '已有目標: 0',
    '記穩目標: 無（初次製卡）',
    '教材說明: 課本 p.40～45 的照片',
    '接法: 複製貼上',
    '服務: ChatGPT',
    '模型: 未記錄',
    '程式改動:',
    '  - 第 5 行 拿掉 ^zzz',
    '---',
    '',
    REPLY.replaceAll('\r\n', '\n').replace('- borrow 英翻中 ^zzz', '- borrow 英翻中 ^aaaaa2').replace('> - lend 英翻中', '> - lend 英翻中 ^bbbbb2').replace('說未來的計畫', '說未來的計畫 ^ccccc2') + '\n',
  ].join('\n'));
  // 快照與卡組的新目標、候選 ID 完全一致。
  const deckIds = new Set([...blockIds(files.get(WORD)!), ...blockIds(files.get(GRAMMAR)!)]);
  // 屬性區的 `程式改動` 那一行行尾也像區塊 ID（`拿掉 ^zzz`），只比本文。
  const body = snapshot.slice(snapshot.indexOf('\n---\n'));
  assert.deepEqual([...blockIds(body)].sort(), [...deckIds].sort());
});

/** 在第 n 次 create（或指定的步驟）當掉，重開再繼續（不再貼一次），最後的檔和一次做完的逐位元組相同。 */
async function crashThenResume(crash: (what: 'store' | 'create' | 'remove', path?: string) => boolean): Promise<Map<string, string>> {
  const { files, io, box, reload } = vault();
  const job = saved(copied());
  io.store(job);
  box.crash = crash;
  await assert.rejects(publish(job, io), Crash);
  box.crash = () => false;
  const result = await publish(reload(), io);
  assert.equal(result.kind, 'done', JSON.stringify(result));
  return files;
}

void test('§5 中斷與重試：存了恢復資料、原文、每一篇、準備發布、快照之後各當掉一次，不再貼一次就補齊，位元組相同、只有一份快照', async () => {
  const { files: whole, io } = vault();
  const job = saved(copied());
  io.store(job);
  await publish(job, io);
  const points: [string, (what: 'store' | 'create' | 'remove', path?: string) => boolean][] = [];
  const counted = (what: 'store' | 'create', n: number) => { let count = 0; return (kind: string) => kind === what && ++count === n; };
  // 建檔：第 1～4 次是原文、第 7 次是快照（第 5、6 次是卡組，當掉時照 R4-1 停下問，另外測）。
  for (const n of [1, 2, 3, 4, 7]) points.push([`第 ${String(n)} 次建檔`, counted('create', n)]);
  // 存恢復資料：第一篇開始建了、寫出過，第二篇開始建了、寫出過，準備發布的時間、快照的雜湊，共 6 次。
  for (let n = 1; n <= 6; n++) points.push([`第 ${String(n)} 次存恢復資料`, counted('store', n)]);
  points.push(['快照寫成、清理之前', what => what === 'remove']);
  for (const [name, crash] of points) {
    const files = await crashThenResume(crash);
    // 隔數小時才補快照時，時間照存下的值：這裡的 now 每次都一樣，所以比全文。
    assert.deepEqual([...files.entries()].sort(), [...whole.entries()].sort(), name);
  }
});

void test('§5 快照寫成、清理之前重開：卡組維持原文、被改字、被改成啟用、甚至刪掉都只清理', async () => {
  for (const change of [(text: string) => text, (text: string) => text.replace('借入', '借進來'), (text: string) => text.replace('狀態: 草稿', '狀態: 啟用'), () => null]) {
    const { files, io, box, reload } = vault();
    const job = saved(copied());
    io.store(job);
    box.crash = what => what === 'remove';
    await assert.rejects(publish(job, io), Crash);
    box.crash = () => false;
    const changed = change(files.get(WORD)!);
    if (changed === null) files.delete(WORD); else files.set(WORD, changed);
    const before = new Map(files);
    assert.equal((await publish(reload(), io)).kind, 'done');
    assert.deepEqual(files, before);
    assert.equal(box.stored, null);
  }
});

void test('§5 卡組寫成後被改字再繼續算寫成；原文同名異文擋、讀不到不當成不存在；快照的位置被佔了往後加', async () => {
  // 第一篇寫成後當掉，家長改了字（ID 都在）：算寫成，不再建一份。
  {
    const { files, io, box, reload } = vault();
    const job = saved(copied());
    io.store(job);
    let stores = 0;
    box.crash = what => what === 'store' && ++stores === 3;
    await assert.rejects(publish(job, io), Crash);
    box.crash = () => false;
    files.set(WORD, files.get(WORD)!.replace('借入', '借進來'));
    assert.equal((await publish(reload(), io)).kind, 'done');
    assert.ok(files.get(WORD)!.includes('借進來'));
  }
  // 原文同名異文：不蓋掉。
  {
    const { files, io } = vault();
    const job = saved(copied());
    files.set(rawPath(job.parts[0].sha256), '別的內容');
    io.store(job);
    assert.deepEqual(await publish(job, io), { kind: 'conflict', path: rawPath(job.parts[0].sha256), what: 'raw' });
    assert.equal(files.get(rawPath(job.parts[0].sha256)), '別的內容');
  }
  // 讀不到：停下，不當成不存在。
  {
    const { io } = vault();
    const job = saved(copied());
    io.store(job);
    const error = Error('iCloud 還沒下載');
    io.read = () => Promise.reject(error);
    assert.deepEqual(await publish(job, io), { kind: 'unreadable', path: rawPath(job.parts[0].sha256), error });
  }
  // 快照的位置在準備發布之前被佔了：往後加。
  {
    const { files, io } = vault();
    files.set(SNAPSHOT, '別人的筆記');
    const job = saved(copied());
    io.store(job);
    assert.equal((await publish(job, io)).kind, 'done');
    assert.equal(files.get(SNAPSHOT), '別人的筆記');
    assert.ok(files.get(SNAPSHOT.replace('.md', ' 2.md'))!.startsWith('---\n日期: 2026-11-07\n'));
  }
});

/** 第一篇寫成、第二篇還沒開始就當掉（第 3 次存恢復資料是第二篇記成開始建了）。 */
async function firstWritten() {
  const v = vault();
  const job = saved(copied());
  v.io.store(job);
  let stores = 0;
  v.box.crash = what => what === 'store' && ++stores === 3;
  await assert.rejects(publish(job, v.io), Crash);
  v.box.crash = () => false;
  return v;
}

void test('§5 搬走與刪掉（R3-1）：改名與搬走跟到新位置、快照的對象指到實際位置；刪掉與拆開停下，不默默補回', async () => {
  for (const moved of ['Essence Cards/學業/國二上/英文/單字 改名.md', 'Essence Cards/別的資料夾/國二上英文 L3 單字.md']) {
    const { files, io, reload } = await firstWritten();
    files.set(moved, files.get(WORD)!);
    files.delete(WORD);
    const result = await publish(reload(), io);
    assert.deepEqual(result, { kind: 'done', decks: [moved, GRAMMAR], targets: 3 });
    assert.ok(!files.has(WORD));
    const name = moved.slice(moved.lastIndexOf('/') + 1, -3);
    assert.ok(files.get(SNAPSHOT)!.includes(`  - "[[${name}]]"\n`));
  }
  {
    const { files, io, reload } = await firstWritten();
    files.delete(WORD);
    assert.deepEqual(await publish(reload(), io), { kind: 'deck', index: 0, situation: 'missing', path: WORD });
    assert.ok(!files.has(WORD));
  }
  {
    const { files, io, reload } = await firstWritten();
    // 拆一部分目標到別篇：候選框的 ID 搬走了。
    const text = files.get(WORD)!;
    files.set(WORD, text.slice(0, text.indexOf('> [!note]-')));
    files.set('Essence Cards/別篇.md', text.slice(text.indexOf('> [!note]-')));
    assert.equal((await publish(reload(), io) as { situation: string }).situation, 'split');
  }
});

void test('§5 開始建了（R4-1）：兩個間隔各當掉一次、重開前刪掉那一篇，繼續停下、跳過與放棄都不把 ID 當成沒用過；開始建了、還沒建檔就當掉也停下', async () => {
  // 「記成開始建了 → 建檔」之間當掉：檔沒建，ID 哪裡都沒有，但不能確定，停下問。
  const between = async (crash: (what: 'store' | 'create' | 'remove', path?: string) => boolean, remove: boolean) => {
    const v = vault();
    const job = saved(copied());
    v.io.store(job);
    v.box.crash = crash;
    await assert.rejects(publish(job, v.io), Crash);
    v.box.crash = () => false;
    if (remove) v.files.delete(WORD);
    return v;
  };
  const createWord = (what: string, path?: string) => what === 'create' && path === WORD;
  let stores = 0;
  // 存「寫出過」那一次（第 1 次存是開始建了，第 2 次是寫出過）：建檔之後、記下之前。
  const writtenStore = (what: string) => what === 'store' && ++stores === 2;
  for (const [name, crash, remove] of [['開始建了之後、建檔之前', createWord, false], ['建檔之後、記成寫出過之前，又被刪掉', writtenStore, true]] as const) {
    stores = 0;
    const { io, reload } = await between(crash, remove);
    const job = reload();
    assert.equal(job.save!.decks[0].stage, 'started', name);
    const stop = await publish(job, io);
    assert.deepEqual(stop, { kind: 'deck', index: 0, situation: 'missing', path: WORD }, name);
    // 跳過：這一篇的 ID 進不再配出的清單；放棄也一樣。
    assert.deepEqual(skipDeck(job, 0).retire, ['aaaaa2', 'bbbbb2'], name);
    assert.deepEqual(abandonJob(job).retire, ['aaaaa2', 'bbbbb2'], name);
  }
  // 重建這一篇：照全文建，其他照常發布。
  {
    const { files, io, reload } = await between(createWord, false);
    const result = await publish(rebuildDeck(reload(), 0), io);
    assert.equal(result.kind, 'done');
    assert.ok(files.get(WORD)!.includes('^aaaaa2'));
  }
  // 跳過之後其他篇照常發布，快照的對象不列它。
  {
    const { files, io, reload } = await between(createWord, false);
    const skipped = skipDeck(reload(), 0).job!;
    assert.deepEqual(await publish(skipped, io), { kind: 'done', decks: [GRAMMAR], targets: 1 });
    assert.ok(!files.get(SNAPSHOT)!.includes('[[國二上英文 L3 單字]]'));
  }
  // 放棄：已寫成的篇照樣留著（草稿），沒碰過 vault 的篇的 ID 拿掉預留。
  {
    const { reload } = await firstWritten();
    const job = reload();
    assert.deepEqual(abandonJob(job), { retire: ['aaaaa2', 'bbbbb2'], left: [WORD] });
  }
});

void test('§5 目的地在存了恢復資料之後才被別人用了（F4）：還沒碰過 vault 的篇往後加，不蓋掉', async () => {
  const { files, io } = vault();
  const job = saved(copied());
  io.store(job);
  files.set(WORD, '家長剛建的筆記');
  const result = await publish(job, io);
  assert.deepEqual(result, { kind: 'done', decks: [WORD.replace('.md', ' 2.md'), GRAMMAR], targets: 3 });
  assert.equal(files.get(WORD), '家長剛建的筆記');
});
