import { abandonJob, beginSave, buildPrompt, inspectReply, planDraft, publish, readJobs, rebuildDeck, reservedIds, RULE_SUBJECTS, sha256Hex, skipDeck, stamp, unitCode } from '../core/ai/index.ts';
import type { CardForm, CardJob, DeckStop, EmbeddedRules, Inspection, PublishIo, PublishResult, RuleSubject, SavedDeck } from '../core/ai/index.ts';
import { blockIds, codeKey, newId, parseDeck, termKey } from '../core/deck/index.ts';
import type { Files } from '../core/files.ts';
import type { State, WriteBlock } from '../state/index.ts';

// AI 製卡的流程（tasks/ai-cards-mvp.md §2、§3、§5）：複製提示、貼回檢查、存草稿與繼續。畫面在 ai-cards-modal.ts；這裡不碰 Obsidian，測試直接用。

/** 目錄認得的年級學期（syntax §2-1）：小一上～高三下。 */
const TERMS: readonly string[] = ['小', '國', '高'].flatMap((stage, s) => (s === 0 ? '一二三四五六' : '一二三').split('').flatMap(grade => [`${stage}${grade}上`, `${stage}${grade}下`]));
export const SERVICES = ['ChatGPT', 'Claude', 'Gemini', '其他'] as const;

export interface AiCardsDeps {
  /** 建置嵌進外掛的規則組（CARD_RULES）；表上有、這裡沒有的科目不列。 */
  rules: EmbeddedRules;
  state: () => State | null;
  files: Pick<Files, 'read'>;
  /** 整個 vault 現在的 Markdown 檔名（小寫、不含 .md）：D-081 檔名整個 vault 不重複。 */
  names: () => Set<string>;
  /** 這台電腦的存放（ui/prefs.ts 的 aiPrefs）。saveJobs 存不進去時丟錯。 */
  store: { jobs(): unknown; saveJobs(jobs: CardJob[]): void; retired(): string[]; retire(ids: readonly string[]): void; last(): { subject?: string; term?: string }; saveLast(last: { subject: string; term: string }): void };
  clipboard: (text: string) => Promise<void>;
  now: () => { ms: number; offset: number };
  random?: () => number;
  onError: (error: unknown) => void;
}

/** 存草稿或繼續之後：done 是快照寫成（製卡成功）；stop 寫原因，deck 是要家長選的那一篇。 */
export type Outcome =
  | { kind: 'done'; decks: string[]; targets: number }
  | { kind: 'stop'; message: string; deck?: DeckStop & { name: string; stage: SavedDeck['stage'] } };

const BLOCKED: Record<WriteBlock, string> = {
  phone: 'AI 製卡只在電腦上做',
  loading: '正在讀取卡組，先不存；讀完再按「繼續」',
  closed: '外掛關閉了，這次沒有存完；重開之後按「繼續」',
  backup: '備份還沒成功，先不存；到設定頁看原因，成功後再按「繼續」',
  unread: '還有卡組或紀錄沒讀到（可能還在從 iCloud 下載），先不存；等一下再按「繼續」',
};
const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');

export function createAiCards(deps: AiCardsDeps) {
  const subjects = RULE_SUBJECTS.filter(subject => deps.rules[subject.key]?.length);
  const loaded = readJobs(deps.store.jobs(), deps.now().ms);
  let jobs = loaded.jobs;
  /** 存回這台電腦：沒開始存草稿的最多 5 個、14 天（readJobs 照規則拿掉）。存不進去丟錯。 */
  function persist(next: CardJob[]): void {
    const kept = readJobs(next, deps.now().ms).jobs;
    deps.store.saveJobs(kept);
    jobs = kept;
  }
  const put = (job: CardJob): void => { persist([job, ...jobs.filter(each => each.id !== job.id)]); };
  const drop = (job: CardJob): void => { persist(jobs.filter(each => each.id !== job.id)); };
  const subjectOf = (job: CardJob): Pick<RuleSubject, 'subject' | 'r3'> => job.subject;
  const GONE: Outcome = { kind: 'stop', message: '這次製卡已經結束或放棄了；要再做一份請重新複製提示' };
  const SAVING: Outcome = { kind: 'stop', message: '這一課還在存，沒有停下來；等一下再打開「AI 製卡」看結果' };
  /** 正在存、選擇或放棄的工作（L2-1）。視窗可以關掉重開，所以記在這裡、不記在視窗：同一個工作同時只有一個操作，放棄不會和還在跑的存檔交錯。 */
  const busy = new Set<string>();
  async function exclusive<T>(id: string, work: () => Promise<T>): Promise<T | Outcome> {
    if (busy.has(id)) return SAVING;
    busy.add(id);
    try { return await work(); } finally { busy.delete(id); }
  }
  /** 這個工作現在的樣子；視窗留著的那一份可能已經完成或放棄，不拿它當數（否則存回去就復活了）。 */
  const current = (job: CardJob): CardJob | undefined => jobs.find(each => each.id === job.id);

  /** PublishResult 換成給家長看的字（§5）；寫不進去的錯誤交給錯誤紀錄。 */
  function outcome(job: CardJob, result: PublishResult): Outcome {
    switch (result.kind) {
      case 'done': return result;
      case 'blocked': return { kind: 'stop', message: BLOCKED[result.reason as WriteBlock] ?? '先不存；等一下再按「繼續」' };
      case 'failed':
        deps.onError(result.error);
        return { kind: 'stop', message: '寫不進去，這次停在一半；按「繼續」會從停下的地方接著做' };
      case 'unreadable': return { kind: 'stop', message: `讀不到 ${result.path}（可能還在從 iCloud 下載）；等一下再按「繼續」` };
      case 'conflict': return { kind: 'stop', message: result.what === 'raw' ? `原文的檔對不上：${result.path} 已經有不同的內容，沒有覆蓋` : `快照的位置已經有不同的內容：${result.path}，沒有覆蓋` };
      case 'deck': {
        const deck = job.save!.decks[result.index];
        const name = fileName(deck.path);
        const message = result.situation === 'taken' ? `「${name}」要用的學習目標 ID 已經被別的卡組或複習紀錄用了，這一篇沒有建`
          : result.situation === 'split' ? `「${name}」的學習目標現在分在好幾篇，或只剩一部分；不會自動補回`
          : deck.stage === 'written' ? `「${name}」寫成之後找不到了（可能被刪掉）；不會自動補回` : `上一次建「${name}」時中斷，現在找不到它；不會自動補回`;
        return { kind: 'stop', message, deck: { ...result, name, stage: deck.stage } };
      }
    }
  }
  /** 寫入的當下問：整個 vault 還沒有這個檔名（D-081）；只在這個路徑沒有檔時問。 */
  const nameFree = (path: string) => (): boolean => !deps.names().has(fileName(path).toLowerCase());
  /** 照恢復資料做第 3～7 步；每一步改了恢復資料都先存。 */
  async function run(job: CardJob): Promise<Outcome> {
    const state = deps.state();
    if (!state) return { kind: 'stop', message: BLOCKED.loading };
    let latest = job;
    const io: PublishIo = {
      store(next) { latest = next; put(next); },
      remove(done) { drop(done); },
      read: path => deps.files.read(path),
      create: (path, text) => state.aiCreate(path, text),
      createDeck: (path, text, ids) => state.aiCreateDeck(path, text, ids, nameFree(path)),
      where: ids => state.aiWhere(ids),
      names: deps.names,
      now: deps.now,
    };
    try {
      const result = await publish(job, io);
      // 通知寫學習目標數：寫成的篇裡的學習目標，候選卡片不算（§7）。
      if (result.kind === 'done') return { ...result, targets: latest.save!.decks.filter(deck => !deck.skipped).reduce((sum, deck) => sum + parseDeck(deck.text).targets.length, 0) };
      return outcome(latest, result);
    } catch (error) {
      deps.onError(error);
      return { kind: 'stop', message: '存到一半出了問題，這次停在一半；按「繼續」會從停下的地方接著做' };
    }
  }

  return {
    /** 讀不懂、沒辦法用的工作數（請家長重新複製一次）。 */
    broken: loaded.broken,
    subjects,
    /** 這一科用哪些規則與版號（唯讀的一行）。 */
    rulesLine: (key: string): string => (deps.rules[key] ?? []).map(rule => `${rule.name} ${rule.version}`).join('、'),
    /** 沒完成的工作：最新的在前。 */
    jobs: (): readonly CardJob[] => [...jobs].sort((a, b) => b.copiedMs - a.copiedMs),
    /** 這台電腦預留、不能配出的 ID（§5〈ID 的預留〉）：state 每次配號時問。 */
    reserved: (): string[] => [...reservedIds(jobs), ...deps.store.retired()],
    last: () => deps.store.last(),
    /** 年級學期的選項：這一科已有卡組的排前面（§2）。 */
    terms(key: string): string[] {
      const subject = subjects.find(each => each.key === key)?.subject;
      const used = new Set((deps.state()?.decks() ?? []).filter(entry => subject !== undefined && entry.deck.props.subject === subject && entry.deck.props.term !== null).map(entry => termKey(entry.deck.props.term!)));
      return [...TERMS.filter(term => used.has(term)), ...TERMS.filter(term => !used.has(term))];
    },
    /** 同一個年級學期、科目、單元編號已經有的卡組：檔名與狀態（§2，不擋）。 */
    sameUnit(form: CardForm): { name: string; status: string }[] {
      const subject = subjects.find(each => each.key === form.subject)?.subject;
      if (subject === undefined || subject === null || !form.unit.trim()) return [];
      const code = codeKey(unitCode(form.unit));
      const label = { draft: '草稿', active: '啟用', paused: '暫停' } as const;
      return (deps.state()?.decks() ?? []).filter(({ deck: { props } }) => props.subject === subject && props.term !== null && termKey(props.term) === termKey(form.term) && props.unit !== null && codeKey(props.unit.code) === code)
        .map(entry => ({ name: fileName(entry.path), status: label[entry.deck.props.status] }));
    },
    /** 會一起送出的已有學習目標；還沒讀完是 null。 */
    existing(form: CardForm): number | null {
      const state = deps.state();
      const subject = subjects.find(each => each.key === form.subject);
      if (!state || !subject || state.writeBlock() === 'loading') return null;
      return state.aiExisting(subject.subject, form.term).length;
    },
    /** 第二步：組提示、存成待貼回的工作（按下的當下就存，F1），再放進剪貼簿。 */
    async copy(form: CardForm): Promise<{ job: CardJob; chars: number } | { error: string }> {
      const state = deps.state();
      const subject = subjects.find(each => each.key === form.subject);
      if (!state || state.writeBlock() === 'loading') return { error: '正在讀取卡組，讀完才知道學生已有哪些學習目標；等一下再按' };
      if (!subject) return { error: '這一科還沒有規則' };
      const existing = state.aiExisting(subject.subject, form.term);
      const prompt = buildPrompt(form, subject, deps.rules[subject.key], existing);
      const at = deps.now();
      const job: CardJob = {
        id: newId(deps.random ?? Math.random, new Set(jobs.map(each => each.id)), { letterFirst: true }),
        copiedAt: stamp(at.ms, at.offset), copiedMs: at.ms, form, subject: { key: subject.key, label: subject.label, subject: subject.subject, r3: subject.r3 },
        parts: prompt.parts, promptSha: prompt.sha256, existing: existing.map(each => ({ ...each })), save: null,
      };
      try { put(job); } catch (error) { deps.onError(error); return { error: '存不進這台電腦，這次沒有複製；請再按一次' }; }
      deps.store.saveLast({ subject: subject.key, term: form.term });
      try { await deps.clipboard(prompt.text); } catch (error) { deps.onError(error); return { error: '放不進剪貼簿；請再按一次' }; }
      return { job, chars: prompt.text.length };
    },
    /** 再放一次剪貼簿：照存下的每一部分，不重組（§3）。 */
    async recopy(job: CardJob): Promise<boolean> {
      try { await deps.clipboard(job.parts.map(part => part.text).join('\n\n')); return true; } catch (error) { deps.onError(error); return false; }
    },
    /** 第三步：檢查（§4），不寫檔。 */
    inspect(job: CardJob, reply: string): Inspection | { error: string } {
      const state = deps.state();
      if (!state) return { error: BLOCKED.loading };
      return inspectReply(reply, job.form, subjectOf(job), job.existing, id => state.aiTarget(id));
    },
    /**
     * 存成草稿（§5 第 1、2 步之後接著做）。同一個工作已經用另一份回覆存過一部分就停下；用同一份就從停下的地方接著做。
     */
    save: (job: CardJob, reply: string, service: string | null): Promise<Outcome> => exclusive(job.id, async () => {
      const latest = current(job);
      if (!latest) return { kind: 'stop', message: '找不到這次複製的提示，可能已經結束了或放太久被清掉了；請重新複製一次' } satisfies Outcome;
      if (latest.save) return latest.save.replySha === sha256Hex(reply) ? run(latest) : { kind: 'stop', message: '這次的提示已經用另一份回覆存過一部分：要繼續上一次的，或放棄它' } satisfies Outcome;
      const state = deps.state();
      if (!state) return { kind: 'stop', message: BLOCKED.loading } satisfies Outcome;
      const inspection = inspectReply(reply, latest.form, subjectOf(latest), latest.existing, id => state.aiTarget(id));
      if (inspection.errors.length) return { kind: 'stop', message: '還有擋住的地方，先改好再存' } satisfies Outcome;
      const count = inspection.pieces.reduce((sum, piece) => sum + piece.names.length, 0);
      // 題目、答案與其他行的區塊 ID 會原樣存進卡組（§4）：配號要避開，新目標的連結才不會指到別行（L2-12）。
      const ids = state.aiIds(count, blockIds(inspection.normalized.lines.join('\n')));
      if (typeof ids === 'string') return { kind: 'stop', message: BLOCKED[ids] } satisfies Outcome;
      const at = deps.now(), started = stamp(at.ms, at.offset);
      let n = 0;
      const planned = planDraft(inspection, latest.form, subjectOf(latest), latest.existing, id => state.aiTarget(id), () => ids[n++], deps.names(), started.slice(0, 10));
      const saved = beginSave(latest, reply, service, planned, started);
      // 第 2 步：恢復資料先存進這台電腦，存不進去就不碰 vault。
      try { put(saved); } catch (error) { deps.onError(error); return { kind: 'stop', message: '存不進這台電腦，這次沒有寫任何檔；請再按一次' } satisfies Outcome; }
      return run(saved);
    }),
    /** 繼續存上一次的結果（§5〈中斷與重試〉）：不用再貼一次。 */
    resume: (job: CardJob): Promise<Outcome> => exclusive(job.id, () => {
      const latest = current(job);
      return latest ? run(latest) : Promise.resolve(GONE);
    }),
    /** 家長選了：跳過這一篇（其他篇照常發布）或重建這一篇（只在 ID 一個都找不到時）。 */
    choose: (job: CardJob, index: number, choice: 'skip' | 'rebuild'): Promise<Outcome> => exclusive(job.id, () => {
      const latest = current(job);
      if (!latest) return Promise.resolve(GONE);
      let next: CardJob;
      if (choice === 'skip') {
        const released = skipDeck(latest, index);
        deps.store.retire(released.retire);
        next = released.job!;
      } else next = rebuildDeck(latest, index);
      try { put(next); } catch (error) { deps.onError(error); return Promise.resolve({ kind: 'stop', message: '存不進這台電腦；請再按一次' }); }
      return run(next);
    }),
    /**
     * 放棄（§5）：只有還沒發布的能放棄。已寫成的卡組照樣是草稿、不刪；開始建了或寫出過的篇，ID 進不再配出的清單。回傳留下的篇。
     * 快照其實已經寫成（清理前中斷）時不放棄，照發布處理。
     */
    abandon: (job: CardJob): Promise<{ left: string[] } | Outcome> => exclusive<{ left: string[] } | Outcome>(job.id, async () => {
      const latest = current(job);
      if (!latest) return GONE;
      if (latest.save?.published) {
        try {
          const text = await deps.files.read(latest.save.snapshotPath);
          if (text !== null && sha256Hex(text) === latest.save.published.sha256) return run(latest);
        } catch (error) {
          deps.onError(error);
          return { kind: 'stop', message: `讀不到 ${latest.save.snapshotPath}，不知道是不是已經存好了；等一下再試` };
        }
      }
      const { retire, left } = abandonJob(latest);
      deps.store.retire(retire);
      drop(latest);
      return { left };
    }),
  };
}
export type AiCards = ReturnType<typeof createAiCards>;
