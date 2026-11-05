import { MarkdownView, type TFile } from 'obsidian';
import { EXAM_FOLDER, QUIZ_FOLDER, scopeDate } from '../core/catalog/index.ts';
import { createState, type State } from '../state/index.ts';
import { quizMark } from '../ui/prefs.ts';
import { inEntry, screens, sleep, text, until, type EntryDevHost } from './dev-entry.ts';
import { clearTrial, makeTrial, newTrial, noteFolder } from './dev-exam-files.ts';
import { buttonIn, enabled, inReview, typeInto } from './dev-practice.ts';
import { capturePng, keepRendering, webContents } from './dev-review.ts';
import { createObsidianFiles } from './files.ts';
import { quizLinkResolver } from './quiz-links.ts';

// 小考標記的 Windows 實機（tasks/quiz-mark.md §6）：只在電腦。在測試 vault 建 L3 兩篇，走目錄設小考、入口那一列、只練那一篇、日期過了、取消、段考同時生效、
// Obsidian 改名與搬移（自動更新開／關、接受或拒絕）、用建議清單修好。結束時只清掉有建立證據的檔，還原開關與 Obsidian 的設定。

const FOLDER = 'Essence Cards/小考測試';
const MOVED = FOLDER + '/搬走', OTHER = FOLDER + '/同名';
/** 手機寬度和開發命令 ui-phone 相同的做法。 */
const narrowStyle = '.ec-fullscreen { right: auto !important; width: 375px !important; }';

interface LinkConfig { getConfig(key: string): unknown; setConfig(key: string, value: unknown): void }

/** Obsidian 現在開著的視窗（改名時問要不要更新連結的那個）。 */
const openModal = (): HTMLElement | undefined => Array.from(document.querySelectorAll<HTMLElement>('.modal-container')).at(-1);
const modalButtons = (modal: HTMLElement | undefined): HTMLButtonElement[] => Array.from(modal?.querySelectorAll<HTMLButtonElement>('button') ?? []);
/** 卡住時看畫面上有什麼（URI 帶 do=probe）：只讀，不按。 */
export function quizProbe(): unknown {
  const modal = openModal();
  return { modal: modal ? text(modal) : null, classes: modal?.className ?? null, buttons: modalButtons(modal).map(text), clickable: Array.from(modal?.querySelectorAll('[class*="button"]') ?? []).map(each => [each.tagName, each.className, text(each)]), screens: screens().length };
}

export async function quizDev(host: EntryDevHost, folder: string, device: string): Promise<unknown> {
  const { app } = host;
  const state = host.state;
  if (!state) return { error: 'state 還沒建好' };
  await state.ready();
  const rendering = keepRendering();
  const checks: Record<string, unknown> = {};
  const check = (name: string, value: unknown): void => { checks[name] = value; };
  const shots: string[] = [];
  let shot = 0;
  const trial = newTrial();
  const run = Math.random().toString(36).slice(2, 10);
  const mark = '試跑: ' + run, prefix = run.slice(0, 3);
  const subject = '小考測試' + run;
  const WORDS = `${FOLDER}/L3 單字 ${run}.md`, GRAMMAR = `${FOLDER}/L3 文法 ${run}.md`, GONE = `${FOLDER}/L3 刪掉 ${run}.md`;
  const head = `---\n${mark}\n年級學期: 高三下\n科目: ${subject}\n單元: "L3 小考"\n---\n`;
  const items = (id: string, count: number): string => Array.from({ length: count }, (_, i) => `- ${id}${String(i + 1)} 的目標 ^${prefix}${id}${String(i + 1)}\n    - ${id}${String(i + 1)} 的題目 :: 答\n`).join('');
  const originals = { [WORDS]: head + items('w', 3), [GRAMMAR]: head + items('g', 2) };
  const links = app.vault as unknown as LinkConfig;
  const wasMark = quizMark.get(app);
  const wasLinks = links.getConfig('alwaysUpdateLinks');

  const capture = async (name: string): Promise<void> => {
    await sleep(300);
    if (!(await app.vault.adapter.exists(folder))) await app.vault.adapter.mkdir(folder);
    const path = await capturePng(app, `${folder}/${String(++shot).padStart(2, '0')} ${name}.png`);
    if (path) shots.push(path);
  };
  const file = (path: string): TFile => {
    const found = app.vault.getFileByPath(path);
    if (!found) throw Error('找不到 ' + path);
    return found;
  };
  const closeAll = async (): Promise<void> => {
    host.review?.close();
    host.entry?.close();
    await until(() => screens().length === 0);
  };
  const mine = (from: State = state) => from.quizzes().filter(row => row.subject === subject || row.name.includes(run));
  /** 入口的這幾列（這次試跑的）。 */
  const entryRows = (): HTMLElement[] => inEntry('.ec-qz').filter(each => text(each).includes(subject) || text(each).includes(run));
  const unitRow = (): HTMLElement | undefined => inEntry('.ec-tr-name').find(each => text(each).startsWith('L3 小考'));
  const pieceRow = (name: string): HTMLElement | undefined => inEntry('.ec-tr-pc').find(each => text(each).startsWith(name));
  const openUnit = async (): Promise<void> => {
    await closeAll();
    host.openEntry('catalog');
    await until(() => unitRow() !== undefined);
    const row = unitRow();
    if (row && !inEntry('.ec-tr-ub').length) row.click();
    await until(() => inEntry('.ec-tr-open').length > 0);
    await sleep(100);
  };
  const openHome = async (): Promise<void> => {
    await closeAll();
    host.openEntry();
    await until(() => inEntry('.ec-en-today').length === 1);
    await sleep(100);
  };
  /** 寫著 needle 的小考檔；這次外掛建的記進清理清單。 */
  const noteQuiz = async (needle: string): Promise<TFile | null> => {
    for (let round = 0; round < 25; round++) {
      for (const each of app.vault.getFiles()) {
        if (!each.path.startsWith(QUIZ_FOLDER + '/') || trial.files.some(known => known.path === each.path)) continue;
        const body = await app.vault.read(each);
        const id = /^識別碼: (\S+)/m.exec(body)?.[1];
        if (body.includes(needle) && id) { trial.files.push({ path: each.path, mark: '識別碼: ' + id }); return each; }
      }
      await sleep(200);
    }
    return null;
  };
  const answerAll = async (): Promise<boolean> => {
    for (let step = 0; step < 30 && !inReview('.ec-done').length; step++) {
      await until(() => inReview('.ec-q').length > 0 || inReview('.ec-done').length > 0);
      if (inReview('.ec-done').length) break;
      await until(() => enabled('.ec-show') !== undefined);
      enabled('.ec-show')?.click();
      await until(() => enabled('.ec-rate[data-k="good"]') !== undefined);
      await sleep(350);
      enabled('.ec-rate[data-k="good"]')?.click();
      await sleep(350);
    }
    return until(() => inReview('.ec-done').length > 0);
  };
  const renamed = (from: string, to: string): void => {
    const known = trial.files.find(each => each.path === from);
    if (known) known.path = to;
  };
  /** Obsidian 問要不要更新連結的那個視窗：回報字，照 wanted 按；改名先結束、一直沒有視窗回報 null。按鈕認不出來時關掉視窗，不讓命令卡住。 */
  const answerModal = async (wanted: 'accept' | 'reject', finished: () => boolean): Promise<{ text: string; buttons: string[]; pressed: string | null } | null> => {
    await until(() => finished() || openModal() !== undefined, 20000);
    const modal = openModal();
    if (!modal) return null;
    const buttons = modalButtons(modal);
    // 三個按鈕：總是更新、僅此一次、不更新（Obsidian 1.15.0 中文介面實機讀到）。「總是」會改掉 alwaysUpdateLinks，不按。
    const pick = buttons.find(each => (wanted === 'reject' ? /不更新|don.?t|do not/i : /僅此一次|once/i).test(text(each)));
    const seen = { text: text(modal), buttons: buttons.map(text), pressed: pick ? text(pick) : null };
    if (pick) pick.click();
    else modal.querySelector<HTMLElement>('.modal-close-button')?.click();
    await until(() => openModal() === undefined, 3000);
    return seen;
  };

  try {
    quizMark.set(app, true);
    // 這次才建的資料夾：清理照順序刪，子資料夾要排在前面。
    await makeTrial(app, trial, FOLDER, originals, mark);
    await noteFolder(app, trial, QUIZ_FOLDER);
    await noteFolder(app, trial, EXAM_FOLDER);
    trial.folders.unshift(MOVED, OTHER);
    check('卡組讀進來了', await until(() => state.deckTargets(WORDS).length === 3 && state.deckTargets(GRAMMAR).length === 2));
    await sleep(300);
    const { day } = state.exam();
    const tomorrow = scopeDate(day + 1), yesterday = scopeDate(day - 1), today = scopeDate(day);
    const later = scopeDate(day + 9);
    const shortDate = (date: string): string => { const [, month, at] = date.split('-'); return `${String(Number(month))}/${String(Number(at))}`; };

    // ── §3 目錄：替單字篇設明天小考 ──
    await openUnit();
    check('單元的按鈕', inEntry('.ec-tr-ub .ec-u-btn').map(text));
    check('每一篇的列', inEntry('.ec-tr-pc').map(text));
    buttonIn(pieceRow('L3 單字'), '小考')?.click();
    await until(() => inEntry('.ec-qz-menu').length === 1);
    check('選單', inEntry('.ec-qz-menu button').map(text));
    await capture('目錄 選日期');
    const narrowMenu = document.head.appendChild(Object.assign(document.createElement('style'), { textContent: narrowStyle }));
    await capture('目錄 選日期 手機寬度');
    narrowMenu.remove();
    buttonIn(inEntry('.ec-qz-menu')[0], '明天')?.click();
    const wordsFile = await noteQuiz(WORDS.replace(/\.md$/, ''));
    check('建了一份小考檔', wordsFile?.path);
    if (!wordsFile) throw Error('沒有建小考檔');
    const wordsText = await app.vault.read(wordsFile);
    check('檔案內容', wordsText);
    check('檔名是建立時的日期加小考', wordsFile.name.startsWith(tomorrow + ' 小考'));
    await until(() => buttonIn(pieceRow('L3 單字'), '小考 ' + shortDate(tomorrow)) !== undefined);
    check('按鈕寫日期', pieceRow('L3 單字') ? text(pieceRow('L3 單字')) : null);
    await capture('目錄 設好了');

    // ── §4 入口最上面那一列；只練那一篇 ──
    await openHome();
    const homeList = inEntry('.ec-sb');
    check('入口最上面', homeList[0] ? text(homeList[0]) : null);
    check('最上面是小考那一列', homeList[0]?.classList.contains('ec-qz'));
    check('明天考', entryRows().map(text));
    await capture('入口 明天考');
    const narrowHome = document.head.appendChild(Object.assign(document.createElement('style'), { textContent: narrowStyle }));
    await sleep(200);
    check('手機寬度：沒有超出', entryRows().every(row => { const box = row.getBoundingClientRect(); return Array.from(row.querySelectorAll('button')).every(each => each.getBoundingClientRect().right <= box.right + 0.5); }));
    await capture('入口 明天考 手機寬度');
    narrowHome.remove();
    const startedAt = Date.now();
    const go = buttonIn(entryRows()[0], '全部卡');
    check('全部卡的數字', go ? text(go) : null);
    go?.click();
    check('複習畫面開了', await until(() => screens().length === 2 && inReview('.ec-q').length > 0));
    check('練完了', await answerAll());
    const practiced = state.history().reviews.filter(each => each.at >= startedAt).map(each => each.lt);
    check('只出單字那一篇', practiced);
    check('只有單字的目標', practiced.length === 3 && practiced.every(each => each.startsWith(prefix + 'w')));
    await capture('完成畫面');
    enabled('.ec-show')?.click();
    await until(() => screens().length === 1);

    // ── §1 日期過了：假的時鐘看 4 點的邊界，真的畫面看那一列消失、檔案還在 ──
    const [year, month, date] = tomorrow.split('-').map(Number);
    const boundary = new Date(year, month - 1, date + 1, 4, 0, 0, 0).getTime();
    let clock = boundary - 1;
    const later4am = createState({ files: createObsidianFiles(app), device, fillIds: false, now: () => clock, resolveLink: quizLinkResolver(app) });
    try {
      await later4am.ready();
      check('隔天 03:59:59.999 還在', mine(later4am).map(row => row.date));
      clock = boundary;
      check('隔天 04:00 消失', mine(later4am).map(row => row.date));
    } finally { await later4am.close(); }
    check('沒有因此改檔', await app.vault.read(wordsFile) === wordsText);
    await app.vault.process(wordsFile, body => body.replace('小考日期: ' + tomorrow, '小考日期: ' + yesterday));
    await until(() => mine().length === 0);
    await openHome();
    check('日期過了：那一列消失', entryRows().length === 0);
    check('日期過了：檔案還在', app.vault.getFileByPath(wordsFile.path) !== null);
    await app.vault.process(wordsFile, body => body.replace('小考日期: ' + yesterday, '小考日期: ' + tomorrow));
    await until(() => mine().length === 1);

    // ── §3 再按一次改日期 ──
    await openUnit();
    buttonIn(pieceRow('L3 單字'), '小考 ' + shortDate(tomorrow))?.click();
    await until(() => inEntry('.ec-qz-menu').length === 1);
    check('已設的選單', inEntry('.ec-qz-menu button').map(text));
    buttonIn(inEntry('.ec-qz-menu')[0], '其他日期')?.click();
    await until(() => inEntry('.ec-qz-other').length === 1);
    typeInto(inEntry('.ec-qz-other input[type="text"]')[0] as HTMLInputElement, yesterday);
    await sleep(100);
    check('已經過的日期：紅字', inEntry('.ec-qz-other .ec-sc-word').map(text));
    await capture('目錄 其他日期 過了');
    typeInto(inEntry('.ec-qz-other input[type="text"]')[0] as HTMLInputElement, later.replaceAll('-', '/'));
    await sleep(100);
    buttonIn(inEntry('.ec-qz-other')[0], '確定')?.click();
    await until(() => buttonIn(pieceRow('L3 單字'), '小考 ' + shortDate(later)) !== undefined);
    check('改日期：只改那一行', await app.vault.read(wordsFile) === wordsText.replace('小考日期: ' + tomorrow, '小考日期: ' + later));
    check('改日期：檔名不變', app.vault.getFileByPath(wordsFile.path) !== null && mine()[0]?.paths[0] === wordsFile.path);

    // ── §3 取消 ──
    buttonIn(pieceRow('L3 單字'), '小考 ' + shortDate(later))?.click();
    await until(() => inEntry('.ec-qz-menu').length === 1);
    buttonIn(inEntry('.ec-qz-menu')[0], '取消小考')?.click();
    await until(() => mine().length === 0);
    const cancelled = await app.vault.read(wordsFile);
    check('取消：多一行取消', cancelled === wordsText.replace('小考日期: ' + tomorrow, `小考日期: ${later}\n取消: ${today}`));
    check('取消：檔案還在', app.vault.getFileByPath(wordsFile.path) !== null);
    await until(() => buttonIn(pieceRow('L3 單字'), '小考') !== undefined);
    check('取消：按鈕變回小考', pieceRow('L3 單字') ? text(pieceRow('L3 單字')) : null);
    await openHome();
    check('取消：入口那一列消失', entryRows().length === 0);

    // ── §5 段考的考試範圍同時生效：兩邊都對；今天的份不變 ──
    if (state.exam().path === null) {
      await makeTrial(app, trial, EXAM_FOLDER, { [`${EXAM_FOLDER}/小考測試 ${run}.md`]: `---\n${mark}\n識別碼: ${prefix}ex1\n考試開始: ${later}\n考試結束: ${later}\n---\n- 高三下 ${subject} L3\n` }, mark);
      await until(() => state.exam().path !== null);
      await sleep(300);
    } else check('段考範圍已經有別的（這個科目不在裡面）', state.exam().path);
    const share = (): string => JSON.stringify(state.today().share.map(item => [item.lt, item.lane]));
    const shareBefore = share();
    await openUnit();
    buttonIn(inEntry('.ec-tr-ub')[0], '小考')?.click();
    await until(() => inEntry('.ec-qz-menu').length === 1);
    buttonIn(inEntry('.ec-qz-menu')[0], '後天')?.click();
    const unitFile = await noteQuiz(`- 高三下 ${subject} L3`);
    check('單元的小考檔', unitFile ? await app.vault.read(unitFile) : null);
    await until(() => mine().length === 1);
    check('今天的份不變', share() === shareBefore);
    check('單元的標籤', unitRow() ? text(unitRow()) : null);
    await capture('目錄 段考與小考');
    await openHome();
    check('段考與小考：那一列', entryRows().map(text));
    check('段考與小考：科目列', inEntry('.ec-sb').filter(each => !each.classList.contains('ec-qz') && text(each).includes(subject)).map(text));
    await capture('入口 段考與小考');
    const unitPractice = buttonIn(entryRows()[0], '全部卡');
    check('單元的全部卡是兩篇加起來', unitPractice ? text(unitPractice) : null);
    if (unitFile) await state.cancelQuiz(mine()[0]);
    await closeAll();

    // ── §1 §5 連結 ──
    const grammarLink = (path: string): string => `- [[${path.replace(/\.md$/, '')}]]`;
    let grammar = GRAMMAR;
    await state.setQuiz({ deck: grammar }, tomorrow, null);
    const linkFile = await noteQuiz(grammarLink(grammar));
    if (!linkFile) throw Error('沒有建單篇的小考檔');
    const linkLine = async (): Promise<string> => (await app.vault.read(linkFile)).split(/\r?\n/).at(-2) ?? '';
    const move = async (to: string, wanted?: 'accept' | 'reject'): Promise<unknown> => {
      let finished = false;
      const moved = app.fileManager.renameFile(file(grammar), to).finally(() => { finished = true; });
      const modal = wanted ? await answerModal(wanted, () => finished) : null;
      // 不用無限等：視窗沒答到時這個 promise 不會結束，下面的清理還是要跑。
      const ended = await Promise.race([moved.then(() => true), sleep(15000).then(() => false)]);
      if (!ended) throw Error('改名等了 15 秒沒有結束：' + JSON.stringify(modal));
      renamed(grammar, to);
      grammar = to;
      await sleep(1000);
      return { 連結: await linkLine(), 問題: mine().map(row => row.problem), 數字: mine().map(row => row.count), 視窗: modal };
    };
    await app.vault.createFolder(MOVED);
    links.setConfig('alwaysUpdateLinks', true);
    check('自動更新開：改名', await move(`${FOLDER}/L3 文法改名 ${run}.md`));
    check('自動更新開：只搬資料夾', await move(`${MOVED}/L3 文法改名 ${run}.md`));
    check('自動更新開：只搬資料夾後入口', (await openHome(), entryRows().map(text)));
    await closeAll();
    links.setConfig('alwaysUpdateLinks', false);
    check('自動更新關：接受', await move(`${FOLDER}/L3 文法再改名 ${run}.md`, 'accept'));
    check('自動更新關：拒絕', await move(`${FOLDER}/L3 文法第三次 ${run}.md`, 'reject'));
    check('自動更新關：拒絕後入口', (await openHome(), entryRows().map(text)));
    await capture('入口 找不到這一篇');
    const narrowRow = document.head.appendChild(Object.assign(document.createElement('style'), { textContent: narrowStyle }));
    await capture('入口 找不到這一篇 手機寬度');
    narrowRow.remove();
    entryRows()[0]?.querySelector<HTMLElement>('.ec-qz-fix')?.click();
    await sleep(600);
    check('點了打開小考檔', app.workspace.getActiveFile()?.path === linkFile.path);
    links.setConfig('alwaysUpdateLinks', wasLinks);

    // ── §1 用建議清單修好：編輯模式刪掉舊連結、輸入 [[、選那一篇 ──
    await closeAll();
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(linkFile, { state: { mode: 'source', source: true } });
    const view = leaf.view instanceof MarkdownView ? leaf.view : null;
    if (view) {
      const { editor } = view;
      const line = editor.lineCount() - 2;
      editor.setSelection({ line, ch: 2 }, { line, ch: editor.getLine(line).length });
      editor.replaceSelection('');
      const keys = webContents();
      keys?.focus?.();
      editor.focus();
      editor.setCursor({ line, ch: 2 });
      // 真的按鍵：程式插字（execCommand、replaceRange）不算使用者輸入，不會叫出建議清單（2026-11-06 實機：字只進了畫面，沒有進檔案）。
      for (const each of '[[L3 文法第三次') {
        keys?.sendInputEvent?.({ type: 'char', keyCode: each });
        await sleep(40);
      }
      const suggested = await until(() => document.querySelector('.suggestion-container .suggestion-item') !== null, 5000);
      check('建議清單出現了', suggested);
      check('建議清單', Array.from(document.querySelectorAll('.suggestion-container .suggestion-item')).slice(0, 4).map(text));
      check('打字後的那一行', editor.getLine(line));
      await capture('建議清單');
      if (suggested) {
        keys?.sendInputEvent?.({ type: 'keyDown', keyCode: 'Return' });
        keys?.sendInputEvent?.({ type: 'keyUp', keyCode: 'Return' });
        await sleep(500);
      } else editor.setLine(line, grammarLink(grammar));
      check('選了之後的那一行', editor.getLine(line));
      await view.save();
      await sleep(800);
      check('修好之後的連結', await linkLine());
      check('修好之後的列', mine().map(row => [row.problem, row.count]));
    }
    leaf.detach();
    await openHome();
    const fixedAt = Date.now();
    const fixed = buttonIn(entryRows()[0], '全部卡');
    check('修好之後：全部卡', fixed ? text(fixed) : null);
    fixed?.click();
    if (await until(() => screens().length === 2 && inReview('.ec-q').length > 0)) {
      check('修好之後：練完了', await answerAll());
      const reviews = state.history().reviews.filter(each => each.at >= fixedAt).map(each => each.lt);
      check('修好之後：只練選中的那一篇', reviews);
    }
    await closeAll();
    await state.cancelQuiz(mine()[0]);
    await until(() => mine().length === 0);

    // ── §1 重名：手寫短連結，兩篇同名 ──
    const baseName = grammar.split('/').at(-1) ?? '';
    await makeTrial(app, trial, OTHER, { [`${OTHER}/${baseName}`]: `---\n${mark}\n---\n只是同名\n` }, mark);
    const SHORT = `${QUIZ_FOLDER}/手寫短連結 ${run}.md`;
    await makeTrial(app, trial, QUIZ_FOLDER, { [SHORT]: `---\n${mark}\n識別碼: ${prefix}sh1\n小考日期: ${tomorrow}\n---\n- [[${baseName.replace(/\.md$/, '')}]]\n` }, mark);
    check('重名：認不出是哪一篇', await until(() => mine().some(row => row.problem === 'several')));
    await state.cancelQuiz(mine()[0]);
    await until(() => mine().length === 0);

    // ── §1 那一篇刪掉了：目錄沒有按鈕，入口可以取消 ──
    await makeTrial(app, trial, FOLDER, { [GONE]: head + items('x', 1) }, mark);
    await until(() => state.deckTargets(GONE).length === 1);
    await state.setQuiz({ deck: GONE }, tomorrow, null);
    const goneFile = await noteQuiz(GONE.replace(/\.md$/, ''));
    await app.vault.delete(file(GONE));
    check('刪掉：找不到這一篇', await until(() => mine().some(row => row.problem === 'missing')));
    await openHome();
    const row = entryRows().find(each => text(each).includes('找不到這一篇'));
    buttonIn(row, '取消')?.click();
    check('刪掉：入口取消', await until(() => mine().length === 0));
    check('刪掉：小考檔多一行取消', goneFile ? (await app.vault.read(goneFile)).includes('取消: ' + today) : null);

    // ── §1 待修正的列一起看 ──
    const bad = `${mark}\n識別碼: ${prefix}bad\n小考日期: 下週五\n`;
    await makeTrial(app, trial, QUIZ_FOLDER, {
      [`${QUIZ_FOLDER}/壞日期 ${run}.md`]: `---\n${bad}---\n- 高三下 ${subject} L3\n`,
      [`${QUIZ_FOLDER}/對不到 ${run}.md`]: `---\n${mark}\n識別碼: ${prefix}unm\n小考日期: ${tomorrow}\n---\n- 高三下 ${subject} L9\n`,
      [`${QUIZ_FOLDER}/寫法 ${run}.md`]: `---\n${mark}\n識別碼: ${prefix}bdy\n小考日期: ${tomorrow}\n---\n- 高三下 ${subject} L3\n- 高三下 ${subject} L4\n`,
      [`${QUIZ_FOLDER}/副本一 ${run}.md`]: `---\n${mark}\n識別碼: ${prefix}cp1\n小考日期: ${tomorrow}\n---\n- 高三下 ${subject} L3\n`,
      [`${QUIZ_FOLDER}/副本二 ${run}.md`]: `---\n${mark}\n識別碼: ${prefix}cp1\n小考日期: ${later}\n---\n- 高三下 ${subject} L3\n`,
    }, mark);
    await until(() => mine().length >= 4);
    await sleep(300);
    await openHome();
    check('待修正的列', entryRows().map(text));
    await capture('入口 待修正');
    const copiesRow = entryRows().find(each => text(each).includes('兩份不一樣'));
    copiesRow?.querySelector<HTMLElement>('.ec-qz-fix')?.click();
    await until(() => inEntry('.ec-qz-copies').length === 1);
    check('兩份不一樣：列出兩份', inEntry('.ec-qz-copies button').map(text).filter(each => each.includes(run)).length === 2);
    await capture('入口 兩份不一樣');
    const narrowBad = document.head.appendChild(Object.assign(document.createElement('style'), { textContent: narrowStyle }));
    await capture('入口 待修正 手機寬度');
    narrowBad.remove();
    await openUnit();
    check('目錄的待修正', inEntry('.ec-tr-ub .ec-u-btn').map(text));
    await capture('目錄 待修正');
    return { checks, shots };
  } catch (error) {
    return { checks, shots, error: error instanceof Error ? error.stack : String(error) };
  } finally {
    host.review?.close();
    host.entry?.close();
    // 小考標記關回預設，不還原成跑之前的值：上一次試跑中斷時，「跑之前」可能是它自己留下的開著。
    quizMark.set(app, false);
    links.setConfig('alwaysUpdateLinks', wasLinks);
    check('設定還原', { 小考標記: quizMark.get(app) === false, 跑之前的小考標記: wasMark, 自動更新連結: links.getConfig('alwaysUpdateLinks') === wasLinks, 跑之前的自動更新連結: wasLinks });
    // iCloud 正在同步剛改過的檔時刪不掉（2026-11-05 遇過）：等一下再清一次。
    let left = await clearTrial(app, trial);
    if (left !== true) { await sleep(5000); left = await clearTrial(app, trial); }
    check('沒有留下暫時的檔與資料夾', left);
    rendering.restore();
  }
}
