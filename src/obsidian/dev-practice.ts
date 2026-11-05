import { MarkdownView, type TFile } from 'obsidian';
import { EXAM_FOLDER } from '../core/catalog/index.ts';
import { capturePng, keepRendering } from './dev-review.ts';
import { inEntry, screens, sleep, text, until, type EntryDevHost } from './dev-entry.ts';
import { clearTrial, makeTrial, newTrial, scopeFiles } from './dev-exam-files.ts';

// 小考前的密集複習的 Windows 實機（tasks/quiz-practice.md §6）：只在電腦。在測試 vault 建 L3 兩篇，走目錄的單篇入口、練一輪、完成畫面、暫停與恢復、
// 開著的筆記、考試範圍/小考/ 裡壞掉的檔。結束時只清掉有建立證據的檔；這一輪的作答與 set: status 留在測試 vault 的紀錄裡，ID 每次都是新的。

const FOLDER = 'Essence Cards/練習測試';
const WORDS = `${FOLDER}/L3 單字.md`, REST = `${FOLDER}/L3 其他.md`, LONG = `${FOLDER}/L3 這一篇的名稱故意寫得非常非常非常非常非常非常非常非常長.md`;
const COUNT = 6;
const NOTICE = (): string[] => Array.from(document.querySelectorAll('.notice'), text);

/** 複習畫面（蓋在最上面的那一層）裡的元素。 */
export const inReview = (selector: string): HTMLElement[] => {
  const top = [...screens()].reverse().find(each => !each.querySelector('.ec-entry'));
  return Array.from(top?.querySelectorAll<HTMLElement>(selector) ?? []);
};
export const enabled = (selector: string): HTMLElement | undefined => inReview(selector).find(each => !(each as HTMLButtonElement).disabled);
/** React 看得到的打字。 */
export function typeInto(input: HTMLInputElement, value: string): void {
  Reflect.set(Object.getPrototypeOf(input) as object, 'value', value, input);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
/** 這一列的按鈕；列用篇名認。 */
const rowOf = (name: string): HTMLElement | undefined => inEntry('.ec-tr-pc').find(each => text(each).startsWith(name));
export const buttonIn = (row: HTMLElement | undefined, name: string): HTMLButtonElement | undefined =>
  Array.from(row?.querySelectorAll('button') ?? []).find(each => text(each) === name || text(each).startsWith(name));

export async function practiceDev(host: EntryDevHost, folder: string): Promise<unknown> {
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
  const subject = '練習測試' + run;
  const head = `---\n${mark}\n年級學期: 高三下\n科目: ${subject}\n單元: "L3 練習"\n---\n`;
  const words = Array.from({ length: COUNT }, (_, i) => {
    const at = String(i + 1);
    return `- w${at} 中翻英 ^${prefix}z${at}\n    - 字 ${at} :: w${at}\n- w${at} 英翻中 ^${prefix}e${at}\n    - w${at} :: 字 ${at}\n`;
  }).join('');
  const rest = `- 其他一 ^${prefix}o1\n    - 第一題 :: 一\n- 其他二 ^${prefix}o2\n    - 第二題 :: 二\n`;
  const originals = { [WORDS]: head + words, [REST]: head + rest };
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
  const unitRow = (): HTMLElement | undefined => inEntry('.ec-tr-name').find(each => text(each).startsWith('L3 練習'));
  const unitButtons = (): string[] => inEntry('.ec-tr-ub .ec-u-btn').map(text);
  const changesAfter = (at: number): unknown[] => state.history().changes.filter(each => each.at >= at && each.set === 'status').map(each => JSON.stringify(each.val));
  /** 打開目錄、展開 L3。測試的學期是最新的，預設就展開。 */
  const openUnit = async (): Promise<void> => {
    host.openEntry('catalog');
    await until(() => unitRow() !== undefined);
    const row = unitRow();
    if (row && !inEntry('.ec-tr-ub').length) row.click();
    await until(() => inEntry('.ec-tr-open').length > 0);
    await sleep(100);
  };
  /** 按這個按鈕，等筆記讀回來、畫面換成 wanted。 */
  const press = async (button: HTMLElement | undefined, wanted: () => boolean): Promise<boolean> => {
    button?.click();
    return until(wanted);
  };
  try {
    await makeTrial(app, trial, FOLDER, originals, mark);
    check('卡組讀進來了', await until(() => state.catalog().terms.some(term => term.subjects.some(each => each.subject === subject))));
    await sleep(300);

    // ── §4 目錄展開後兩列全部卡 ──
    await openUnit();
    check('單元的按鈕', unitButtons());
    check('兩列全部卡', inEntry('.ec-tr-pc').map(text));
    check('數字和筆記的全部卡相同', { 單字: state.deckTargets(WORDS).length, 其他: state.deckTargets(REST).length });
    await capture('目錄 兩篇');

    // ── §2、§3 按單字篇的全部卡練一輪 ──
    const startedAt = Date.now();
    buttonIn(rowOf('L3 單字'), '全部卡')?.click();
    check('複習畫面開了', await until(() => screens().length === 2 && inReview('.ec-q').length > 0));
    check('沒有全部卡的提醒', inEntry('.ec-rem-confirm').length === 0);
    for (let step = 0; step < COUNT * 2 + 2 && !inReview('.ec-done').length; step++) {
      await until(() => inReview('.ec-q').length > 0 || inReview('.ec-done').length > 0);
      const input = inReview('input.ec-input')[0] as HTMLInputElement | undefined;
      if (input) {
        const at = /字 (\d+)/.exec(text(inReview('.ec-q')[0]))?.[1] ?? '';
        typeInto(input, 'w' + at);
        await until(() => enabled('.ec-confirm') !== undefined);
        enabled('.ec-confirm')?.click();
      } else {
        await until(() => enabled('.ec-show') !== undefined);
        enabled('.ec-show')?.click();
      }
      await until(() => enabled('.ec-rate[data-k="good"]') !== undefined);
      await sleep(350);
      // 第一張第一次答錯：完成畫面應該少一個。
      const firstCard = !state.history().reviews.some(each => each.at >= startedAt);
      enabled(`.ec-rate[data-k="${firstCard ? 'miss' : 'good'}"]`)?.click();
      await sleep(350);
    }
    check('完成畫面', await until(() => inReview('.ec-done').length > 0));
    const order = state.history().reviews.filter(each => each.at >= startedAt).map(each => each.lt.slice(3));
    check('出卡順序', order);
    check('同一個字的兩張之間隔了幾個', Object.fromEntries(Array.from({ length: COUNT }, (_, i) => {
      const at = String(i + 1), from = order.indexOf('e' + at), to = order.indexOf('z' + at);
      return ['w' + at, new Set(order.slice(from + 1, to).filter(each => each !== 'e' + at && each !== 'z' + at)).size];
    })));
    check('這輪第一次就答對', inReview('.ec-done-score').map(text));
    check('原本那一行', inReview('.ec-done-sub').map(text));
    await capture('完成畫面');
    enabled('.ec-show')?.click();
    await until(() => screens().length === 1);
    host.entry?.close();
    await until(() => screens().length === 0);

    // ── §5 暫停其他篇、恢復 ──
    const pausedAt = Date.now();
    await openUnit();
    check('暫停：單元的全部卡只剩單字篇', await press(buttonIn(rowOf('L3 其他'), '暫停'), () => unitButtons().includes(`全部卡 ${String(COUNT * 2)}`)));
    check('暫停後的按鈕', unitButtons());
    check('暫停後的列', inEntry('.ec-tr-pc').map(text));
    check('筆記只改一行', await app.vault.read(file(REST)) === originals[REST].replace('單元: "L3 練習"\n', '單元: "L3 練習"\n狀態: 暫停\n'));
    await capture('目錄 暫停其他篇');
    check('恢復：回到兩列', await press(buttonIn(rowOf('L3 其他'), '恢復'), () => inEntry('.ec-tr-pc').length === 2 && unitButtons().includes(`全部卡 ${String(COUNT * 2 + 2)}`)));
    check('恢復後的筆記', (await app.vault.read(file(REST))).includes('狀態: 啟用'));
    check('紀錄', changesAfter(pausedAt));
    host.entry?.close();
    await until(() => screens().length === 0);

    // ── §5 開著的筆記：有沒存的修改不寫；存好了走編輯器 ──
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(file(WORDS));
    const view = leaf.view instanceof MarkdownView ? leaf.view : null;
    check('筆記開著', view?.file?.path === WORDS);
    if (view) {
      await view.save();
      await sleep(300);
      const saved = view.editor.getValue();
      await openUnit();
      view.editor.replaceRange('- 還沒存的字\n', { line: view.editor.lastLine(), ch: 0 });
      buttonIn(rowOf('L3 單字'), '暫停')?.click();
      check('有沒存的修改：提示', await until(() => NOTICE().some(each => each.includes('還沒存進去'))));
      // 全螢幕蓋滿視窗：通知那一層要在它上面，只在 DOM 裡不算。通知層不接收滑鼠事件，elementFromPoint 量不到它；看得到看截圖。
      const layer = (selector: string): number => { const found = document.querySelector(selector); return found ? Number(getComputedStyle(found).zIndex) : NaN; };
      check('有沒存的修改：提示在全螢幕上面', layer('.notice-container') > layer('.ec-fullscreen'));
      check('有沒存的修改：磁碟沒動', await app.vault.read(file(WORDS)) === saved);
      check('有沒存的修改：編輯器的字還在', view.editor.getValue().includes('還沒存的字'));
      await capture('有沒存的修改');
      view.editor.setValue(saved);
      await view.save();
      await sleep(300);
      check('存好了：走編輯器', await press(buttonIn(rowOf('L3 單字'), '暫停'), () => view.editor.getValue().includes('狀態: 暫停')));
      await until(() => inEntry('.ec-tr-pc').some(each => text(each).startsWith('L3 單字') && text(each).includes('恢復')));
      check('存好了：磁碟也改了', (await app.vault.read(file(WORDS))).includes('狀態: 暫停'));
      check('存好了：其他字元不動', view.editor.getValue() === saved.replace('單元: "L3 練習"\n', '單元: "L3 練習"\n狀態: 暫停\n'));
      await press(buttonIn(rowOf('L3 單字'), '恢復'), () => view.editor.getValue().includes('狀態: 啟用'));
      await until(() => inEntry('.ec-tr-pc').length === 2 && inEntry('.ec-tr-pc').every(each => text(each).includes('全部卡')));
      check('兩列都回來', inEntry('.ec-tr-pc').map(text));
      host.entry?.close();
      await until(() => screens().length === 0);
    }
    leaf.detach();
    await sleep(1200);

    // ── §4 手機寬度：篇名太長要截斷，按鈕不換行 ──
    await makeTrial(app, trial, FOLDER, { [LONG]: head + `- 長篇名 ^${prefix}l1\n    - 第三題 :: 三\n` }, mark);
    await until(() => state.deckTargets(LONG).length === 1);
    await openUnit();
    const narrow = document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '.ec-fullscreen { right: auto !important; width: 375px !important; }' }));
    try {
      await sleep(300);
      const row = rowOf('L3 這一篇');
      const name = row?.querySelector('span');
      const buttons = Array.from(row?.querySelectorAll('.ec-u-btn') ?? []);
      const box = row?.getBoundingClientRect();
      check('手機寬度：篇名截斷', !!name && name.scrollWidth > name.clientWidth);
      check('手機寬度：按鈕都在同一列', !!box && buttons.length > 0 && buttons.every(each => { const rect = each.getBoundingClientRect(); return rect.top >= box.top && rect.bottom <= box.bottom && rect.right <= box.right + 0.5; }));
      await capture('目錄 手機寬度');
    } finally { narrow.remove(); }
    host.entry?.close();
    await until(() => screens().length === 0);

    // ── §1 考試範圍/小考/ 放一份壞掉的檔；搬出來的小考檔 ──
    const before = state.exam().path;
    // 考試範圍/ 本來沒有的話也是這次建的：清理時先刪底下的 小考/，所以記在它後面。
    const noExamFolder = !(await app.vault.adapter.exists(EXAM_FOLDER));
    await makeTrial(app, trial, EXAM_FOLDER + '/小考', { [EXAM_FOLDER + '/小考/壞掉的.md']: `---\n${mark}\n考試開始: [\n---\n` }, mark);
    if (noExamFolder) trial.folders.push(EXAM_FOLDER);
    await makeTrial(app, trial, EXAM_FOLDER, { [EXAM_FOLDER + '/搬出來的小考.md']: `---\n${mark}\n小考日期: 2026-11-30\n---\n- 高三下 ${subject} L3\n` }, mark);
    await sleep(800);
    check('段考的選定沒變', state.exam().path === before);
    host.openEntry();
    await until(() => inEntry('.ec-en-today').length === 1);
    check('入口的考試範圍那一列', inEntry('.ec-sc-row').map(text));
    await capture('入口 小考檔');
    host.entry?.close();
    await until(() => screens().length === 0);
    host.openEntry('catalog');
    await until(() => unitRow() !== undefined);
    check('目錄的考試範圍那一列', inEntry('.ec-sc-row').map(text));
    check('畫面沒有日期問題', !text(document.querySelector('.ec-entry')).includes('考試日期有問題'));
    check('開發命令認的範圍檔', (await scopeFiles(app)).map(each => each.path));
    return { checks, shots };
  } catch (error) {
    return { checks, shots, error: error instanceof Error ? error.stack : String(error) };
  } finally {
    host.review?.close();
    host.entry?.close();
    // iCloud 正在同步剛改過的檔時刪不掉（2026-11-05 遇過）：等一下再清一次。
    let left = await clearTrial(app, trial);
    if (left !== true) { await sleep(5000); left = await clearTrial(app, trial); }
    check('沒有留下暫時的檔與資料夾', left);
    rendering.restore();
  }
}
