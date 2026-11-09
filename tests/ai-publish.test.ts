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
    displaced: () => false,
    create(path, text): Promise<CreateResult> {
      if (box.crash('create', path)) throw new Crash();
      if ([...files.keys()].some(each => each.toLowerCase() === path.toLowerCase())) return Promise.resolve({ kind: 'exists' });
      files.set(path, text);
      return Promise.resolve({ kind: 'done' });
    },
    createDeck(path, text) { return this.create(path, text); },
    createSnapshot(path, text, decks) { return decks.some(deck => { const found = blockIds(files.get(deck.path) ?? ''); return !deck.ids.every(id => found.has(id)); }) ? Promise.resolve({ kind: 'refused', why: 'decks' }) : this.create(path, text); },
    where(ids) {
      const found = new Map<string, string[]>();
      for (const [path, text] of files) if (isDeckPath(path)) for (const id of blockIds(text)) if (ids.includes(id)) found.set(id, [...found.get(id) ?? [], path]);
      return Promise.resolve(found);
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
const fileNameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1, -3).toLowerCase();
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
  // 存恢復資料：第一篇開始建了、寫出過，第二篇開始建了、寫出過，準備發布（時間、快照全文與雜湊一次存），共 5 次。
  for (let n = 1; n <= 5; n++) points.push([`第 ${String(n)} 次存恢復資料`, counted('store', n)]);
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

void test('§5 判斷搬走只看這次配出的 ID（L2-6）：舊位置被無關的筆記占用仍跟到新位置；只有部分 ID 留在舊處、另一處有重複都停下', async () => {
  const moved = 'Essence Cards/學業/國二上/英文/單字 改名.md';
  {
    const { files, io, reload } = await firstWritten();
    files.set(moved, files.get(WORD)!);
    files.set(WORD, '- 別的筆記 ^unrelated\n    - 題目 :: 答案\n');
    const result = await publish(reload(), io);
    assert.deepEqual(result, { kind: 'done', decks: [moved, GRAMMAR], targets: 3 });
    assert.equal(files.get(WORD), '- 別的筆記 ^unrelated\n    - 題目 :: 答案\n');
    assert.ok(files.get(SNAPSHOT)!.includes('  - "[[單字 改名]]"\n'));
  }
  {
    const { files, io, reload } = await firstWritten();
    const text = files.get(WORD)!;
    files.set(moved, text);
    // 舊位置還留著其中一個 ID。
    files.set(WORD, '- borrow 英翻中 ^aaaaa2\n    - borrow :: 借入\n');
    assert.equal((await publish(reload(), io) as { situation: string }).situation, 'split');
  }
  {
    const { files, io, reload } = await firstWritten();
    const text = files.get(WORD)!;
    files.set(moved, text);
    files.set('Essence Cards/學業/國二上/英文/單字 副本.md', text);
    files.set(WORD, '- 別的筆記 ^unrelated\n    - 題目 :: 答案\n');
    assert.equal((await publish(reload(), io) as { situation: string }).situation, 'split');
  }
});

void test('§5 準備發布時再核對每一篇（L2-5）：後面的篇還在寫時前面的被刪、搬走、拆開，都不會寫出對不上的快照', async () => {
  /** 建第二篇的當下，對第一篇做 change。 */
  const during = (change: (files: Map<string, string>) => void) => {
    const v = vault();
    const job = saved(copied());
    v.io.store(job);
    const create = v.io.create.bind(v.io);
    v.io.createDeck = (path, text) => { if (path === GRAMMAR) change(v.files); return create(path, text); };
    return { ...v, job };
  };
  const moved = 'Essence Cards/學業/國二上/英文/單字 改名.md';
  {
    const { files, io, job } = during(each => { each.delete(WORD); });
    assert.deepEqual(await publish(job, io), { kind: 'deck', index: 0, situation: 'missing', path: WORD });
    assert.ok(!files.has(SNAPSHOT));
  }
  {
    const { files, io, job } = during(each => { each.set(moved, each.get(WORD)!); each.delete(WORD); });
    assert.deepEqual(await publish(job, io), { kind: 'done', decks: [moved, GRAMMAR], targets: 3 });
    assert.ok(files.get(SNAPSHOT)!.includes('  - "[[單字 改名]]"\n'));
    assert.ok(!files.get(SNAPSHOT)!.includes('[[國二上英文 L3 單字]]'));
  }
  {
    const { files, io, job } = during(each => { const text = each.get(WORD)!; each.set(WORD, text.slice(0, text.indexOf('> [!note]-'))); each.set('Essence Cards/別篇.md', text.slice(text.indexOf('> [!note]-'))); });
    assert.equal((await publish(job, io) as { situation: string }).situation, 'split');
    assert.ok(!files.has(SNAPSHOT));
  }
  // 跳過第一篇再繼續：快照不列它，通知只算剩下的。
  {
    const { files, io, box, reload, job } = during(each => { each.delete(WORD); });
    await publish(job, io);
    box.crash = () => false;
    const result = await publish(skipDeck(reload(), 0).job!, io);
    assert.deepEqual(result, { kind: 'done', decks: [GRAMMAR], targets: 1 });
    assert.ok(!files.get(SNAPSHOT)!.includes('[[國二上英文 L3 單字]]'));
  }
});

void test('§5 準備發布存下快照全文（L2-8）：重試照存下的位元組寫，外掛更新也不重新產生；卡組搬走或跳過才更新對象，而且先存再寫', async () => {
  const stopAtSnapshot = async () => {
    const v = vault();
    const job = saved(copied());
    v.io.store(job);
    v.box.crash = (what, path) => what === 'create' && path === SNAPSHOT;
    await assert.rejects(publish(job, v.io), Crash);
    v.box.crash = () => false;
    return v;
  };
  // 存下的全文就是要寫的：換版後序列化不同也照舊。
  {
    const { files, io, reload } = await stopAtSnapshot();
    const job = reload();
    const published = job.save!.published!;
    assert.equal(sha256Hex(published.text), published.sha256);
    assert.ok(published.text.startsWith('---\n日期: 2026-11-07\n'));
    const older = published.text.replace('接法: 複製貼上', '接法:   複製貼上');
    const stored = { ...job, save: { ...job.save!, published: { ...published, text: older, sha256: sha256Hex(older) } } };
    io.store(stored);
    assert.equal((await publish(stored, io)).kind, 'done');
    assert.equal(files.get(SNAPSHOT), older);
  }
  // 搬走：對象更新，時間沿用，寫之前先存好更新後的全文。
  {
    const { files, io, box, reload } = await stopAtSnapshot();
    const job = reload();
    const moved = 'Essence Cards/學業/國二上/英文/單字 改名.md';
    files.set(moved, files.get(WORD)!);
    files.delete(WORD);
    box.crash = (what, path) => what === 'create' && path === SNAPSHOT;
    await assert.rejects(publish(job, io), Crash);
    box.crash = () => false;
    const again = reload();
    assert.ok(again.save!.published!.text.includes('[[單字 改名]]'));
    assert.equal(again.save!.published!.time, job.save!.published!.time);
    assert.equal(sha256Hex(again.save!.published!.text), again.save!.published!.sha256);
    assert.equal((await publish(again, io)).kind, 'done');
    assert.equal(files.get(SNAPSHOT), again.save!.published!.text);
  }
  // 明確跳過：對象不列它。
  {
    const { files, io, reload } = await stopAtSnapshot();
    const skipped = skipDeck(reload(), 0).job!;
    assert.equal((await publish(skipped, io)).kind, 'done');
    assert.ok(!files.get(SNAPSHOT)!.includes('[[國二上英文 L3 單字]]'));
  }
});

void test('§5 即將建立時再核對整個 vault 的檔名（L2-9）：別的資料夾在存檔途中出現同名檔，卡組與快照都往後加（大小寫不同也算），路徑先存再寫', async () => {
  // 卡組：規畫之後，別的資料夾多了一篇同名（大小寫不同）。
  {
    const { files, io, reload } = vault();
    const job = saved(copied());
    io.store(job);
    files.set('其他資料夾/國二上英文 l3 單字.md', '別人的筆記');
    const result = await publish(job, io);
    assert.deepEqual(result, { kind: 'done', decks: [WORD.replace('.md', ' 2.md'), GRAMMAR], targets: 3 });
    assert.equal(files.get('其他資料夾/國二上英文 l3 單字.md'), '別人的筆記');
    assert.ok(files.get(SNAPSHOT)!.includes('  - "[[國二上英文 L3 單字 2]]"\n'));
    assert.throws(reload);
  }
  // 卡組：改名先存進恢復資料，建檔當掉、重開也是同一個路徑。
  {
    const { files, io, box, reload } = vault();
    const job = saved(copied());
    io.store(job);
    files.set('其他資料夾/國二上英文 L3 單字.md', '別人的筆記');
    const renamed = WORD.replace('.md', ' 2.md');
    box.crash = (what, path) => what === 'create' && path === renamed;
    await assert.rejects(publish(job, io), Crash);
    assert.equal(reload().save!.decks[0].path, renamed);
    assert.equal(reload().save!.decks[0].stage, 'started');
  }
  // 快照：準備發布之前。
  {
    const { files, io } = vault();
    const job = saved(copied());
    io.store(job);
    files.set('其他資料夾/2026-11-07 國二上英文 L3 Sports： Week 1.md', '別人的筆記');
    assert.equal((await publish(job, io)).kind, 'done');
    assert.ok(!files.has(SNAPSHOT));
    assert.ok(files.get(SNAPSHOT.replace('.md', ' 2.md'))!.startsWith('---\n日期: 2026-11-07\n'));
  }
  // 快照：準備發布之後、寫之前（快照寫不成，隔天重開，別的資料夾多了同名檔）。
  {
    const { files, io, box, reload } = vault();
    const job = saved(copied());
    io.store(job);
    box.crash = (what, path) => what === 'create' && path === SNAPSHOT;
    await assert.rejects(publish(job, io), Crash);
    box.crash = () => false;
    files.set('其他資料夾/2026-11-07 國二上英文 L3 Sports： Week 1.md', '別人的筆記');
    const again = reload();
    assert.equal((await publish(again, io)).kind, 'done');
    assert.ok(!files.has(SNAPSHOT));
    // 全文不變，只換位置。
    assert.equal(files.get(SNAPSHOT.replace('.md', ' 2.md')), again.save!.published!.text);
  }
});

void test('§5 跨午夜才補完（L2 規格核對）：檔名照開始存草稿那一天，日期與時間照準備發布那一刻', async () => {
  const { files, io } = vault();
  const job = saved(copied());
  io.store(job);
  io.now = () => ({ ms: NOW + 24 * 3_600_000, offset: 480 });
  assert.equal((await publish(job, io)).kind, 'done');
  assert.ok(files.get(SNAPSHOT)!.startsWith('---\n日期: 2026-11-08\n時間: 2026-11-08T10:23:45+08:00\n'));
});

void test('§5 第一次建檔就發現 ID 被占用（R2-2）：不把別篇當成自己搬走了，回報占用，這一篇維持沒碰過 vault', async () => {
  // 建檔時才被擋下（別的筆記剛同步進來）：階段改回來，不寫快照。
  {
    const { files, io, reload } = vault();
    const job = saved(copied());
    io.store(job);
    const other = 'Essence Cards/學業/國二上/英文/剛同步.md';
    io.createDeck = (path, text, ids) => {
      if (path !== WORD) return io.create(path, text);
      files.set(other, `- 別的目標 ^${ids[0]}\n    - 別的題目 :: 別的答案\n`);
      return Promise.resolve({ kind: 'refused', why: 'ids' });
    };
    assert.deepEqual(await publish(job, io), { kind: 'deck', index: 0, situation: 'taken', path: WORD });
    assert.ok(!files.has(SNAPSHOT));
    assert.ok(!files.has(WORD));
    // 重開也一樣：沒碰過 vault 的篇不會跟到別篇。
    const again = reload();
    assert.equal(again.save!.decks[0].stage, 'pending');
    assert.deepEqual(await publish(again, io), { kind: 'deck', index: 0, situation: 'taken', path: WORD });
    assert.deepEqual(skipDeck(again, 0).retire, []);
  }
  // 原草稿真的搬走（曾經開始建過）：照樣跟到新位置。
  {
    const { files, io, reload } = await firstWritten();
    const moved = 'Essence Cards/學業/國二上/英文/單字 改名.md';
    files.set(moved, files.get(WORD)!);
    files.delete(WORD);
    assert.equal((await publish(reload(), io)).kind, 'done');
  }
});

void test('§5 還沒建過的篇，目的地已有同 ID、內容不同的檔（R3-3）：ID 證明不了是自己寫的，回報占用；全文相同、開始建過的照舊算寫成', async () => {
  const stranger = (ids: string[]) => `---\n狀態: 啟用\n---\n\n- 別的目標 ^${ids[0]}\n    - 別的題目 :: 別的答案\n`;
  // 存恢復資料之後同步到同一個路徑：不是這次寫的，不算寫成，不發布。
  {
    const { files, io, reload } = vault();
    const job = saved(copied());
    io.store(job);
    const text = stranger(job.save!.decks[0].ids);
    // 第一篇有兩個 ID（目標與候選）：都放進去，才是「每個 ID 都在」。
    files.set(WORD, text + `\n> [!note]- 候選卡片\n> - 別的候選 ^${job.save!.decks[0].ids[1]}\n>     - 問 :: 答\n`);
    const before = files.get(WORD);
    assert.deepEqual(await publish(job, io), { kind: 'deck', index: 0, situation: 'taken', path: WORD });
    assert.equal(files.get(WORD), before);
    assert.ok(!files.has(SNAPSHOT));
    assert.equal(reload().save!.decks[0].stage, 'pending');
    assert.deepEqual(skipDeck(reload(), 0).retire, []);
  }
  // 建檔的當下才冒出來（exists）：照樣不算寫成。
  {
    const { files, io, reload } = vault();
    const job = saved(copied());
    io.store(job);
    const { ids } = job.save!.decks[0];
    io.createDeck = (path, text) => {
      if (path !== WORD) return io.create(path, text);
      files.set(WORD, stranger(ids) + `\n> [!note]- 候選卡片\n> - 別的候選 ^${ids[1]}\n>     - 問 :: 答\n`);
      return Promise.resolve({ kind: 'exists' });
    };
    assert.deepEqual(await publish(job, io), { kind: 'deck', index: 0, situation: 'taken', path: WORD });
    assert.ok(!files.has(SNAPSHOT));
    assert.equal(reload().save!.decks[0].stage, 'pending');
  }
  // 全文一字不差：就是要寫的那一份，不算別人的。
  {
    const { files, io } = vault();
    const job = saved(copied());
    io.store(job);
    files.set(WORD, job.save!.decks[0].text);
    assert.equal((await publish(job, io)).kind, 'done');
  }
  // 開始建過、之後被家長改字：照 ID 認得出來。
  {
    const { files, io, reload } = await firstWritten();
    files.set(WORD, files.get(WORD)!.replace('借入', '借進來'));
    assert.equal((await publish(reload(), io)).kind, 'done');
  }
});

void test('§5 檔名存下原始基底（R4-2、R4-4）：快照改用後綴後被擋，重開照那個位置接著做；重試與規畫時已加後綴都照原始檔名遞增', async () => {
  const SECOND = SNAPSHOT.replace('.md', ' 2.md'), THIRD = SNAPSHOT.replace('.md', ' 3.md');
  // 改用 ` 2` 之後門檻擋下：位置與全文一起留著，重開不退回別人的原名。
  {
    const { files, io, reload } = vault();
    const job = saved(copied());
    io.store(job);
    files.set(SNAPSHOT, '別人的快照');
    const create = io.createSnapshot.bind(io);
    let once = true;
    io.createSnapshot = (path, text, decks) => { if (!once) return create(path, text, decks); once = false; return Promise.resolve({ kind: 'blocked', reason: 'unread' }); };
    assert.deepEqual(await publish(job, io), { kind: 'blocked', reason: 'unread' });
    const again = reload();
    assert.equal(again.save!.snapshotPath, SECOND);
    assert.ok(again.save!.published);
    assert.equal((await publish(again, io)).kind, 'done');
    assert.ok(files.has(SECOND));
    assert.equal(files.get(SNAPSHOT), '別人的快照');
  }
  // 原名被占、` 2` 寫入的當下也被別的資料夾占走：往 ` 3`，不回到原名而卡住。
  {
    const { files, io } = vault();
    const job = saved(copied());
    io.store(job);
    files.set(SNAPSHOT, '別人的快照');
    const create = io.createSnapshot.bind(io);
    io.createSnapshot = (path, text, decks) => {
      if (path !== SECOND) return create(path, text, decks);
      files.set('其他資料夾/' + path.slice(path.lastIndexOf('/') + 1), '別人的筆記');
      return Promise.resolve({ kind: 'refused', why: 'name' });
    };
    assert.equal((await publish(job, io)).kind, 'done');
    assert.ok(files.has(THIRD));
  }
  // 規畫時卡組與快照就已經是 ` 2`：再撞名是 ` 3`，不是 ` 2 2`。
  {
    const { files, io } = vault();
    const job = saved(copied(), new Set([fileNameOf(WORD), fileNameOf(SNAPSHOT)]));
    io.store(job);
    const deck2 = WORD.replace('.md', ' 2.md');
    assert.equal(job.save!.decks[0].path, deck2);
    assert.equal(job.save!.snapshotPath, SECOND);
    files.set('其他資料夾/' + deck2.slice(deck2.lastIndexOf('/') + 1), '別人的');
    files.set('其他資料夾/' + SECOND.slice(SECOND.lastIndexOf('/') + 1), '別人的');
    files.set('其他資料夾/' + WORD.slice(WORD.lastIndexOf('/') + 1), '別人的');
    files.set('其他資料夾/' + SNAPSHOT.slice(SNAPSHOT.lastIndexOf('/') + 1), '別人的');
    assert.equal((await publish(job, io)).kind, 'done');
    assert.ok(files.has(WORD.replace('.md', ' 3.md')));
    assert.ok(files.has(THIRD));
    assert.ok(![...files.keys()].some(path => path.includes(' 2 2')));
  }
});

void test('§5 快照分得出確定沒寫與可能寫成（R5-2）：確定沒寫的候選被占用就換後綴，可能寫成的位置有異文照舊不蓋掉', async () => {
  const SECOND = SNAPSHOT.replace('.md', ' 2.md'), THIRD = SNAPSHOT.replace('.md', ' 3.md');
  const BASE = SNAPSHOT.slice(SNAPSHOT.lastIndexOf('/') + 1);
  // 改用 ` 2` 之後門檻擋下，確定沒寫；重開之前 ` 2` 被第二個工作占了：存成 ` 3`，時間與全文沿用，` 2` 不動。
  {
    const { files, io, reload } = vault();
    const job = saved(copied());
    io.store(job);
    files.set('其他資料夾/' + BASE, '別人的筆記');
    const create = io.createSnapshot.bind(io);
    let once = true;
    io.createSnapshot = (path, text, decks) => { if (!once) return create(path, text, decks); once = false; return Promise.resolve({ kind: 'blocked', reason: 'unread' }); };
    assert.deepEqual(await publish(job, io), { kind: 'blocked', reason: 'unread' });
    const held = reload();
    assert.equal(held.save!.snapshotPath, SECOND);
    files.set(SECOND, '第二個工作的快照');
    assert.equal((await publish(held, io)).kind, 'done');
    assert.equal(files.get(SECOND), '第二個工作的快照');
    assert.equal(files.get(THIRD), held.save!.published!.text);
  }
  // 第一次寫這個位置，寫入的當下才發現有檔：不是這份快照，換下一個後綴。
  {
    const { files, io } = vault();
    const job = saved(copied());
    io.store(job);
    const create = io.createSnapshot.bind(io);
    io.createSnapshot = (path, text, decks) => { if (path === SNAPSHOT) files.set(SNAPSHOT, '剛同步來的筆記'); return create(path, text, decks); };
    assert.equal((await publish(job, io)).kind, 'done');
    assert.equal(files.get(SNAPSHOT), '剛同步來的筆記');
    assert.ok(files.has(SECOND));
  }
  // 寫不進去，不知道寫了沒有：那個位置之後出現別的內容，停下、不蓋掉、不換位置。
  {
    const { files, io, reload } = vault();
    const job = saved(copied());
    io.store(job);
    const create = io.createSnapshot.bind(io);
    let once = true;
    io.createSnapshot = (path, text, decks) => { if (!once) return create(path, text, decks); once = false; return Promise.resolve({ kind: 'failed', error: Error('寫不進去') }); };
    assert.equal((await publish(job, io)).kind, 'failed');
    files.set(SNAPSHOT, '別人的快照');
    assert.deepEqual(await publish(reload(), io), { kind: 'conflict', path: SNAPSHOT, what: 'snapshot' });
    assert.equal(files.get(SNAPSHOT), '別人的快照');
    assert.ok(!files.has(SECOND));
  }
  // 記成可能寫成、存好才去寫：寫的時候當掉，重開看到的是可能寫成。
  {
    const { files, io, box, reload } = vault();
    const job = saved(copied());
    io.store(job);
    box.crash = (what, path) => what === 'create' && path === SNAPSHOT;
    await assert.rejects(publish(job, io), Crash);
    box.crash = () => false;
    files.set(SNAPSHOT, '別人的快照');
    assert.deepEqual(await publish(reload(), io), { kind: 'conflict', path: SNAPSHOT, what: 'snapshot' });
    assert.equal(files.get(SNAPSHOT), '別人的快照');
  }
});

void test('§5 快照三次都趕不上（R3-6）：卡組一直在變動回 changing，不說成讀不到；不寫快照', async () => {
  const { files, io } = vault();
  const job = saved(copied());
  io.store(job);
  io.createSnapshot = () => Promise.resolve({ kind: 'refused', why: 'decks' });
  assert.deepEqual(await publish(job, io), { kind: 'blocked', reason: 'changing' });
  assert.ok(!files.has(SNAPSHOT));
});

void test('§5 檔名清單比檔案事件慢（R2-4）：讀到目的地已有檔，就算清單還沒列也往後加', async () => {
  const { files, io } = vault();
  const job = saved(copied());
  io.store(job);
  files.set(WORD, '家長剛建的筆記');
  files.set(SNAPSHOT, '別人的筆記');
  const list = io.names.bind(io);
  io.names = () => { const names = list(); names.delete(fileNameOf(WORD)); names.delete(fileNameOf(SNAPSHOT)); return names; };
  const result = await publish(job, io);
  assert.deepEqual(result, { kind: 'done', decks: [WORD.replace('.md', ' 2.md'), GRAMMAR], targets: 3 });
  assert.equal(files.get(WORD), '家長剛建的筆記');
  assert.equal(files.get(SNAPSHOT), '別人的筆記');
  assert.ok(files.has(SNAPSHOT.replace('.md', ' 2.md')));
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
  // 重建之後又停在建檔之前（原文讀不到、寫入門檻）：曾經開始建過的事實不能消失，放棄與跳過照樣不再配出，重開也一樣（L2-4）。
  {
    const { io, box, reload } = await between(createWord, false);
    const rebuilt = rebuildDeck(reload(), 0);
    io.store(rebuilt);
    const read = io.read.bind(io);
    const error = Error('原文還在同步');
    io.read = () => Promise.reject(error);
    assert.equal((await publish(rebuilt, io)).kind, 'unreadable');
    io.read = read;
    const again = reload();
    assert.deepEqual(abandonJob(again).retire, ['aaaaa2', 'bbbbb2']);
    assert.deepEqual(skipDeck(again, 0).retire, ['aaaaa2', 'bbbbb2']);
    // 再選一次重建照樣能建：允許重建不會因為中斷而消失。
    box.crash = () => false;
    assert.equal((await publish(again, io)).kind, 'done');
  }
  // 重建寫到一半又當掉：回到開始建了，要再問一次，不會自動再建。
  {
    const { io, box, reload } = await between(createWord, false);
    const rebuilt = rebuildDeck(reload(), 0);
    io.store(rebuilt);
    box.crash = createWord;
    await assert.rejects(publish(rebuilt, io), Crash);
    box.crash = () => false;
    assert.deepEqual(await publish(reload(), io), { kind: 'deck', index: 0, situation: 'missing', path: WORD });
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
