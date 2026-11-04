import { MarkdownView, type App, type TFile } from 'obsidian';
import { EXAM_FOLDER, scopeDate } from '../core/catalog/index.ts';
import { capturePng, keepRendering } from './dev-review.ts';
import { buttonOf, focusOk, inEntry, screens, sleep, text, until, type EntryDevHost } from './dev-entry.ts';
import { clearTrial, makeTrial, newTrial, noteFolder, noteScope, type Trial } from './dev-exam-files.ts';

// 考試範圍的 Windows 實機（tasks/exam-scope.md §10）：只在電腦。在測試 vault 建暫時的卡組，走完設定、倒數、目錄標籤、外部修改、§8 的點開與結束，截圖對照樣式稿，結束時只清掉有建立證據的檔（dev-exam-files.ts）。
// do=run 一次走完。獨占鎖要 PowerShell 配合，分段跑：do=prep → run=reload → do=reopen → （鎖住）do=lock-on → （放開）do=lock-off → do=clean。

const FOLDER = 'Essence Cards/考試測試';
const SUBJECT = '考試測試';
const HEAD = (term: string, subject: string, code: string, extra = ''): string => `---\n年級學期: ${term}\n科目: ${subject}\n單元: "${code}"\n${extra}---\n`;
const FILES: Record<string, string> = {
  [`${FOLDER}/甲 1-1.md`]: HEAD('高三下', SUBJECT, '1-1 測試單元') + '- 一之一 ^exaaa1\n    - 第一題 :: 一\n',
  [`${FOLDER}/甲 1-2.md`]: HEAD('高三下', SUBJECT, '1-2') + '- 一之二 ^exaaa2\n    - 第二題 :: 二\n',
  [`${FOLDER}/甲 2-1.md`]: HEAD('高三下', SUBJECT, '2-1') + '- 二之一 ^exaaa3\n    - 第三題 :: 三\n',
  [`${FOLDER}/甲 2-2.md`]: HEAD('高三下', SUBJECT, '2-2', '狀態: 草稿\n') + '- 二之二 ^exaaa4\n    - 第四題 :: 四\n',
  [`${FOLDER}/甲 2-3.md`]: HEAD('高三下', SUBJECT, '2-3') + '- 溫度影響溶解度 ^exaaa5\n    - 出處：1-3 p.20\n    - 第五題 :: 五\n',
  [`${FOLDER}/乙 L1.md`]: HEAD('高三下', '考試英文', 'L1') + '- 英文一 ^exaaa6\n    - 第六題 :: 六\n',
  [`${FOLDER}/舊.md`]: HEAD('高一上', SUBJECT, '9-1') + '- 從舊單元來的 ^exaaa7\n    - 出處：高三下 1-1 p.3\n    - 第七題 :: 七\n',
  [`${FOLDER}/存檔用.md`]: HEAD('高一上', SUBJECT, '9-2') + '- 還沒有編號\n    - 第八題 :: 八\n',
};

const isBox = (each: HTMLElement): HTMLInputElement | null => each.querySelector('input');
const boxOf = (label: string): HTMLInputElement | null => {
  const row = inEntry('.ec-sc-u').find(each => text(each.querySelector('.ec-sc-name span')) === label);
  return row ? isBox(row) : null;
};
const checkedRows = (): string[] => inEntry('.ec-sc-u').filter(each => isBox(each)?.checked).map(each => text(each.querySelector('.ec-sc-name span')));
const fieldOf = (name: '考試開始' | '考試結束'): HTMLInputElement | null => inEntry('input[type="text"]').find(each => each.getAttribute('aria-label') === name) as HTMLInputElement | undefined ?? null;
/** blur() 沒有發事件的次數：Obsidian 的視窗沒有焦點時（使用者在別的視窗），focus()、blur() 不發事件。 */
let silentBlurs = 0;
function typeInto(input: HTMLInputElement | null, value: string): void {
  if (!input) return;
  input.focus();
  Reflect.set(Object.getPrototypeOf(input) as object, 'value', value, input);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  let left = false;
  const mark = (): void => { left = true; };
  input.addEventListener('focusout', mark, { once: true });
  input.blur();
  input.removeEventListener('focusout', mark);
  if (left) return;
  // 補上離開欄位的事件（React 的 onBlur 聽 focusout），這樣結果不看使用者正在用哪個視窗。
  silentBlurs++;
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}
const notices = (): string[] => Array.from(document.querySelectorAll('.notice'), text);
const scopeRow = (): HTMLElement | undefined => inEntry('.ec-sc-row')[0];
const scopeFiles = (app: App): TFile[] => app.vault.getFiles().filter(file => file.path.startsWith(EXAM_FOLDER + '/'));


export async function examDev(host: EntryDevHost, action: string | undefined, folder: string): Promise<unknown> {
  const { app } = host;
  const state = host.state;
  if (!state) return { error: 'state 還沒建好' };
  await state.ready();
  const rendering = keepRendering();
  const checks: Record<string, unknown> = {};
  const check = (name: string, value: unknown): void => { checks[name] = value; };
  const shots: string[] = [];
  const dark = document.body.classList.contains('theme-dark');
  let shot = 0;
  /** 淺色與深色各截一張，再換回原本的。 */
  async function capture(name: string): Promise<void> {
    await sleep(300);
    if (!(await app.vault.adapter.exists(folder))) await app.vault.adapter.mkdir(folder);
    for (const theme of dark ? ['dark', 'light'] : ['light', 'dark']) {
      document.body.classList.toggle('theme-dark', theme === 'dark');
      document.body.classList.toggle('theme-light', theme === 'light');
      await sleep(150);
      const path = await capturePng(app, `${folder}/${String(++shot).padStart(2, '0')} ${name} ${theme === 'dark' ? '深色' : '淺色'}.png`);
      if (path) shots.push(path);
    }
    document.body.classList.toggle('theme-dark', dark);
    document.body.classList.toggle('theme-light', !dark);
  }
  const phone = async <T>(work: () => Promise<T>): Promise<T> => {
    const narrow = document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '.ec-fullscreen { right: auto !important; width: 390px !important; }' }));
    try { return await work(); } finally { narrow.remove(); }
  };
  const openScope = async (): Promise<void> => {
    scopeRow()?.click();
    await until(() => text(inEntry('.ec-en-title')[0]) === '考試範圍與日期');
    await sleep(100);
  };
  const confirm = async (): Promise<void> => {
    buttonOf(inEntry('button'), '確定')?.click();
    await until(() => text(inEntry('.ec-en-title')[0]) !== '考試範圍與日期' || inEntry('.ec-sc-word.is-bad').length > 0);
    await sleep(200);
  };
  const day = state.exam().day;
  const soon = scopeDate(day + 12), later = scopeDate(day + 13);
  const shortOf = (date: string): string => { const [, month, each] = date.split('-'); return `${String(Number(month))}/${String(Number(each))}`; };
  /** 開始時已經有的範圍檔：不是這次建的，拒跑也不動它（R1）。 */
  const already = new Set(scopeFiles(app).map(file => file.path));
  const refused = { error: '測試 vault 已經有範圍檔，不動它', files: [...already] };
  const trial = newTrial();
  /** 這次建的卡組都寫上這個記號，清的時候核對（R12）；科目也是這次才有的，存下的範圍檔靠它認（R19）。 */
  const run = Math.random().toString(36).slice(2, 10);
  const mark = '試跑: ' + run, subject = SUBJECT + run;
  const marked = Object.fromEntries(Object.entries(FILES).map(([path, text]) => [path, text.replaceAll(SUBJECT, subject).replace('---\n', `---\n${mark}\n`)]));
  /** 分段跑的建立證據：`do=prep` 記下，`do=clean` 照它刪，跨過重新載入外掛。 */
  const proof = folder.slice(0, folder.lastIndexOf('/')) + '/exam 建立的檔.json';
  const adapter = app.vault.adapter;
  /** 分段跑的後面幾步：建立紀錄裡的那一份範圍檔，不是資料夾的第一份（R19）。 */
  const provenScope = async (): Promise<TFile> => {
    const saved = JSON.parse(await adapter.read(proof)) as Trial;
    const path = saved.files.find(each => each.path.startsWith(EXAM_FOLDER + '/'))?.path;
    const file = path ? app.vault.getFileByPath(path) : null;
    if (!file) throw Error('建立的紀錄裡沒有範圍檔');
    return file;
  };
  try {
    if (action === 'prep') {
      if (already.size) return refused;
      if (await adapter.exists(proof)) return { error: '上一次分段跑還沒清（do=clean）', proof };
      await noteFolder(app, trial, EXAM_FOLDER);
      await makeTrial(app, trial, FOLDER, marked, mark);
      await until(() => state.catalog().terms.some(term => term.term === '高三下'));
      host.openEntry();
      await until(() => inEntry('.ec-en-today').length === 1);
      await openScope();
      for (const label of ['1-2', '2-1', '2-3', 'L1']) boxOf(label)?.click();
      await sleep(100);
      typeInto(fieldOf('考試開始'), soon);
      await sleep(100);
      check('勾好了', checkedRows());
      check('開始日期', fieldOf('考試開始')?.value);
      await confirm();
      await noteScope(app, trial, EXAM_FOLDER, subject);
      check('存完的畫面', text(inEntry('.ec-en-title')[0]));
      check('紅字', inEntry('.ec-sc-word.is-bad').map(text));
      check('通知', notices());
      host.entry?.close();
      return { checks, scope: scopeFiles(app).map(file => file.path), day, soon, trial };
    }
    if (action === 'reopen') {
      host.openEntry();
      await until(() => inEntry('.ec-en-today').length === 1);
      check('關掉再開，範圍還在', text(inEntry('.ec-sc-per')[0]) === shortOf(soon));
      check('倒數還在', inEntry('.ec-sb-ex').map(text).includes('距離考試：12 天'));
      host.entry?.close();
      return { checks };
    }
    if (action === 'lock-on') {
      const file = await provenScope();
      app.vault.trigger('modify', file);
      check('讀不到的清單', await until(() => state.unread().includes(file.path), 5000));
      host.openEntry();
      check('提醒一區列出來', await until(() => inEntry('.ec-rem').length === 1, 2000));
      inEntry('.ec-rem-go')[0]?.click();
      await sleep(200);
      check('提醒的字', inEntry('.ec-rem').map(text));
      await capture('鎖住 入口');
      await openScope();
      boxOf('1-2')?.click();
      await sleep(100);
      buttonOf(inEntry('button'), '確定')?.click();
      await until(() => inEntry('.ec-sc-word.is-bad').length > 0, 3000);
      check('設定畫面擋住', inEntry('.ec-sc-word.is-bad').map(text));
      check('已勾的不丟', boxOf('1-2')?.checked);
      await capture('鎖住 設定');
      host.entry?.close();
      // 卡組的存檔不受影響：這一篇還沒有 ID，存了會補上。
      check('寫入沒有被範圍檔擋住', state.writeBlock());
      const deck = app.vault.getFileByPath(`${FOLDER}/存檔用.md`);
      if (!deck) throw Error('沒有存檔用的卡組');
      const leaf = app.workspace.getLeaf('tab');
      await leaf.openFile(deck);
      app.workspace.setActiveLeaf(leaf, { focus: true });
      await host.ids?.saver.save(leaf.view as MarkdownView);
      await sleep(500);
      check('卡組存檔補上了 ID', /\^[a-z0-9]{4,}/.test(await app.vault.read(deck)));
      leaf.detach();
      return { checks, shots };
    }
    if (action === 'lock-off') {
      const file = await provenScope();
      check('放開後恢復', await until(() => !state.unread().includes(file.path), 70_000));
      host.openEntry();
      await until(() => inEntry('.ec-en-today').length === 1);
      check('提醒消失', inEntry('.ec-rem').length === 0);
      await openScope();
      boxOf('1-2')?.click();
      await sleep(100);
      await confirm();
      check('存得進去', (await app.vault.read(file)).includes('1-2'));
      host.entry?.close();
      return { checks };
    }
    if (action === 'clean') {
      if (!(await adapter.exists(proof))) return { error: '沒有建立的紀錄，不刪任何檔', proof };
      check('沒有留下暫時的檔與資料夾', await clearTrial(app, JSON.parse(await adapter.read(proof)) as Trial));
      await adapter.remove(proof);
      return { checks };
    }

    // ── do=run：一次走完 ──
    if (already.size) return refused;
    await noteFolder(app, trial, EXAM_FOLDER);
    await makeTrial(app, trial, FOLDER, marked, mark);
    check('卡組讀進來了', await until(() => state.catalog().terms.some(term => term.term === '高三下')));
    await sleep(300);

    host.openEntry();
    check('入口打開了', await until(() => inEntry('.ec-en-today').length === 1));
    check('還沒設定', text(scopeRow()));
    await capture('入口 還沒設定');

    await openScope();
    check('設定畫面的焦點在畫面裡', focusOk() && !!document.activeElement?.closest('.ec-fullscreen'));
    check('最近學的先勾好', checkedRows());
    await capture('設定 預先勾好');

    // 日期：打字、日曆、紅字。
    typeInto(fieldOf('考試開始'), soon.replace(/-/g, ''));
    await sleep(100);
    check('打 YYYYMMDD 離開欄位變標準格式', fieldOf('考試開始')?.value === soon);
    check('視窗有焦點', document.hasFocus());
    check('blur 沒有發事件的次數', silentBlurs);
    const pick = inEntry('input[type="date"]')[1] as HTMLInputElement | undefined;
    if (pick) {
      Reflect.set(Object.getPrototypeOf(pick) as object, 'value', later, pick);
      pick.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(100);
    check('日曆選的日期填回文字欄', fieldOf('考試結束')?.value === later);
    typeInto(fieldOf('考試結束'), '2026-13-01');
    await sleep(100);
    check('紅字', inEntry('.ec-sc-word.is-bad').map(text));
    check('確定不能按', (buttonOf(inEntry('button'), '確定') as HTMLButtonElement | undefined)?.disabled);
    await capture('設定 紅字');
    const redColor = inEntry('.ec-sc-word.is-bad')[0] ? getComputedStyle(inEntry('.ec-sc-word.is-bad')[0]).color : null;
    check('紅字的顏色', redColor);
    typeInto(fieldOf('考試結束'), later);
    await sleep(100);
    check('改好後紅字消失', inEntry('.ec-sc-word.is-bad').length === 0);
    const field = fieldOf('考試開始');
    check('日期欄的字與底色（深淺色都截圖看）', field ? [getComputedStyle(field).color, getComputedStyle(field).backgroundColor] : null);

    // 只考第一章、英文不考。
    boxOf('2-1')?.click();
    boxOf('2-3')?.click();
    boxOf('L1')?.click();
    await sleep(100);
    boxOf('1 全部')?.click();
    await sleep(100);
    check('整章連動', checkedRows());
    await capture('設定 勾好了');
    await confirm();
    const scope = await noteScope(app, trial, EXAM_FOLDER, subject);
    check('存完回入口', inEntry('.ec-en-today').length === 1);
    check('通知', notices().filter(each => each.includes('考試範圍')));
    await capture('入口 倒數');
    check('倒數', inEntry('.ec-sb').map(row => [text(row.querySelector('.ec-en-name')), text(row.querySelector('.ec-sb-ex'))]).filter(([name]) => name === subject || name === '考試英文'));
    check('那一列', text(scopeRow()));
    const path = scope.path;
    const first = await app.vault.read(scope);
    check('檔名', path);
    check('檔案內容', first);
    check('一份範圍檔', scopeFiles(app).length === 1);

    // ── 目錄 ──
    buttonOf(inEntry('button'), '目錄')?.click();
    await until(() => inEntry('.ec-seg').length === 1);
    check('目錄也有那一列', text(scopeRow()));
    check('科目標題', inEntry('.ec-tr-sh').map(text).filter(each => each.includes(SUBJECT)));
    check('考試標籤', inEntry('.ec-tr-u').map(row => [text(row.querySelector('.ec-tr-name span')), Array.from(row.querySelectorAll('.ec-tr-tag'), text)]).filter(([, tags]) => tags.length > 0));
    await capture('目錄 考試');

    // 再改一次：從目錄進來、回目錄，檔名不變。
    await openScope();
    check('勾的是那一份', checkedRows());
    boxOf('2-1')?.click();
    await sleep(100);
    await confirm();
    check('回到目錄', inEntry('.ec-seg').length === 1);
    check('檔名不變', scopeFiles(app).map(file => file.path));
    check('改過的內容', await app.vault.read(scope));

    // ── 外部修改：入口自己更新；看不懂的行留著 ──
    buttonOf(inEntry('button'), '返回')?.click();
    await until(() => inEntry('.ec-en-today').length === 1);
    const before = await app.vault.read(scope);
    await app.vault.adapter.write(path, before.replace(soon, scopeDate(day + 5)) + '老師說第三節不考\n');
    check('外部改的日期入口自己更新', await until(() => inEntry('.ec-sb-ex').map(text).includes('距離考試：5 天'), 5000));
    check('看不懂的行數', inEntry('.ec-sc-note.is-warn').map(text));
    await capture('入口 外部修改');
    await openScope();
    check('設定畫面列出看不懂的行', inEntry('.ec-sc-raw p').map(text));
    inEntry('.ec-sc-raw')[0]?.scrollIntoView({ block: 'center' });
    await capture('設定 看不懂的行');
    boxOf('2-3')?.click();
    await sleep(100);

    // ── §8：來自別的單元、還不確定，點開、點一列 ──
    check('§8 兩行', inEntry('.ec-sc-go').map(text));
    for (const each of inEntry('.ec-sc-go')) each.click();
    await sleep(100);
    check('§8 列', inEntry('.ec-sc-item').map(text));
    inEntry('.ec-sc-check')[0]?.scrollIntoView({ block: 'center' });
    await capture('設定 還不確定');
    await phone(async () => { await capture('設定 手機寬度'); });
    await confirm();
    check('存別的不動看不懂的行', (await app.vault.read(scope)).includes('老師說第三節不考'));
    await phone(async () => { await capture('入口 手機寬度'); });

    await openScope();
    const unsure = inEntry('.ec-sc-go').find(each => text(each).includes('還不確定'));
    unsure?.click();
    await sleep(100);
    const item = inEntry('.ec-sc-item').find(each => text(each).includes('溫度影響溶解度'));
    const leavesBefore = new Set(app.workspace.getLeavesOfType('markdown'));
    item?.click();
    check('點一列：入口關掉', await until(() => screens().length === 0));
    const opened = (): MarkdownView | null => app.workspace.getActiveViewOfType(MarkdownView);
    check('點一列：打開那篇', await until(() => opened()?.file?.path === `${FOLDER}/甲 2-3.md`));
    await sleep(300);
    check('點一列：游標在那一行', opened()?.editor.getCursor().line);
    for (const leaf of app.workspace.getLeavesOfType('markdown')) if (!leavesBefore.has(leaf)) leaf.detach();

    // ── 結束這次考試 ──
    host.openEntry();
    await until(() => inEntry('.ec-en-today').length === 1);
    await openScope();
    buttonOf(inEntry('button'), '結束這次考試')?.click();
    await sleep(100);
    check('第一下不生效', !(await app.vault.read(scope)).includes('提前結束'));
    await capture('設定 結束這次考試');
    buttonOf(inEntry('button'), '再按一次結束這次考試')?.click();
    await until(() => inEntry('.ec-en-today').length === 1);
    await sleep(200);
    check('結束的通知', notices().filter(each => each.includes('考試')));
    check('結束後的那一列', text(scopeRow()));
    check('提前結束', (await app.vault.read(scope)).match(/提前結束: .*/)?.[0]);
    check('倒數消失', inEntry('.ec-sb-ex').length === 0);
    host.entry?.close();
    return { checks, shots };
  } catch (error) {
    return { checks, shots, error: error instanceof Error ? error.stack : String(error) };
  } finally {
    host.entry?.close();
    if (action === 'prep' && trial.files.length) {
      const root = proof.slice(0, proof.lastIndexOf('/'));
      if (!(await adapter.exists(root))) await adapter.mkdir(root);
      await adapter.write(proof, JSON.stringify(trial));
    }
    if ((action === undefined || action === 'run') && trial.files.length + trial.folders.length) check('沒有留下暫時的檔與資料夾', await clearTrial(app, trial));
    rendering.restore();
  }
}
