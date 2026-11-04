import { MarkdownView, type App, type Plugin, type TFile } from 'obsidian';
import { compareLists, type ListItem } from '../dev/compare.ts';
import type { State, StudyPick } from '../state/index.ts';
import type { ReviewHandle } from '../ui/index.ts';
import { noRemind, previewButton, previewReveal } from '../ui/prefs.ts';
import { keepRendering, capturePng } from './dev-review.ts';
import type { DevLog } from './dev-ids.ts';

// 入口與目錄的 Windows 實機（tasks/entry-and-catalog.md §12）：只在電腦。在測試 vault 建幾篇暫時的卡組，走完 §1 的返回路線、出處、預覽與存檔的提示，
// 截圖對照樣式稿，結束時只清掉這次自己建的檔，不作答（複習紀錄不變）。結果的 checks 全部是 true 才算通過；「完成」的通知不算。

const FOLDER = 'Essence Cards/入口測試';
const MATERIALS = 'Essence W6/入口測試材料';
const HEAD = (code: string, extra = ''): string => `---\n年級學期: 高一上\n科目: 入口測試\n單元: "${code}"\n${extra}---\n`;
const FILES: Record<string, string> = {
  [`${MATERIALS}/入口材料甲.md`]: '# 標題甲\n\np.20 ^p20\n\n內容\n',
  [`${MATERIALS}/入口材料乙.md`]: '# 標題乙\n\np.30 ^p30\n\n內容\n',
  [`${FOLDER}/入口測試 A.md`]: HEAD('9-1 測試單元', '材料: "[[入口材料甲]]"\n')
    + '- 分行的出處 ^etaaa1\n    - 出處：\n        - p.20\n        - 高一上 9-2 p.30\n        - [[入口材料乙|影片重點]]\n        - [[入口材料乙#標題乙]]\n        - 高一上 9-2 這一段說明文字故意寫得很長很長很長很長很長看按鈕在畫面上會不會好好換行\n    - 第一題 :: 一\n    - 第二題 :: 二\n'
    + '- 看不懂的出處 ^etaaa2\n    - 出處：p.46-44、9-2 p.30、小五上 p.30\n    - 第三題 :: 三\n',
  [`${FOLDER}/入口測試 B.md`]: HEAD('9-2', '材料: "[[入口材料乙]]"\n') + '- 別的單元 ^etbbb1\n    - 第四題 :: 四\n',
  [`${FOLDER}/入口測試 C.md`]: HEAD('9-3', '狀態: 草稿\n') + '- 草稿的目標 ^etccc1\n    - 第五題 :: 五\n',
};

export interface EntryDevHost extends Plugin {
  state: State | null;
  review: ReviewHandle | null;
  entry: { close(): void; refresh(): void } | null;
  ids: { saver: { save(view: MarkdownView): Promise<void> } } | null;
  startReview(pick: StudyPick): ReviewHandle | null;
  openEntry(screen?: 'entry' | 'catalog'): unknown;
}

export const sleep = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });
export async function until(check: () => boolean, ms = 8000): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) { if (check()) return true; await sleep(30); }
  return check();
}
export const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
export const screens = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.ec-fullscreen'));
export const inEntry = (selector: string): HTMLElement[] => Array.from(document.querySelector('.ec-entry')?.querySelectorAll<HTMLElement>(selector) ?? []);
/** 複習畫面（蓋在最上面的那一層）裡的元素。 */
const inReview = (selector: string): HTMLElement[] => {
  const top = [...screens()].reverse().find(each => !each.querySelector('.ec-entry'));
  return Array.from(top?.querySelectorAll<HTMLElement>(selector) ?? []);
};
export const buttonOf = (list: HTMLElement[], name: string): HTMLElement | undefined => list.find(each => text(each) === name || each.getAttribute('aria-label') === name);
export const focusOk = (): boolean => document.activeElement !== document.body && document.activeElement !== null;
const logs = async (app: App): Promise<string> => {
  const paths = app.vault.getFiles().filter(file => file.path.startsWith('Essence Cards/紀錄/') && file.path.endsWith('.jsonl') && !file.path.includes('/錯誤/')).map(file => file.path).sort();
  return (await Promise.all(paths.map(async path => path + '\n' + await app.vault.adapter.read(path)))).join('\n');
};

export async function entryCheck(host: EntryDevHost, folder: string, devLog: DevLog): Promise<unknown> {
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
  const prefs = { noRemind: noRemind.get(app), button: previewButton.get(app), reveal: previewReveal.get(app) };
  const leavesBefore = new Set(app.workspace.getLeavesOfType('markdown'));
  const created: TFile[] = [];
  const logBefore = await logs(app);
  await app.vault.adapter.mkdir(folder).catch(() => { /* 已經有了。 */ });
  try {
    for (const name of [FOLDER, MATERIALS]) if (!app.vault.getAbstractFileByPath(name)) await app.vault.createFolder(name);
    for (const [path, content] of Object.entries(FILES)) {
      if (app.vault.getAbstractFileByPath(path)) throw Error('已經有這個檔，不覆寫：' + path);
      created.push(await app.vault.create(path, content));
    }
    const unitOf = (code: string): string => JSON.stringify(['高一上', '入口測試', code]);
    check('卡組讀進來了', await until(() => state.catalog().terms.some(term => term.subjects.some(subject => subject.subject === '入口測試'))));
    await until(() => !!app.metadataCache.getFileCache(created[1])?.blocks?.p30);

    // ── 入口 ──
    host.openEntry();
    check('入口打開了', await until(() => inEntry('.ec-en-today').length === 1));
    check('入口的焦點在畫面裡', focusOk() && !!document.activeElement?.closest('.ec-fullscreen'));
    check('字標用了內建字型', document.fonts.check('italic 500 15px "Essence Cards Mark"'));
    await capture('入口');
    const rowsBefore = inEntry('.ec-sb').map(text);
    const subject = inEntry('.ec-sb-btn:not(:disabled)')[0] as HTMLElement | undefined;
    if (subject) {
      subject.click();
      check('入口按科目：複習蓋在入口上面', await until(() => screens().length === 2));
      await sleep(200);
      buttonOf(inReview('button'), '結束複習')?.click();
      check('✕ 回入口', await until(() => screens().length === 1 && inEntry('.ec-en-today').length === 1));
      await sleep(100);
      check('回入口的焦點在畫面裡', !!document.activeElement?.closest('.ec-fullscreen'));
      check('回入口的數字還在', inEntry('.ec-sb').map(text).length === rowsBefore.length);
    }

    // ── 目錄 ──
    buttonOf(inEntry('button'), '目錄')?.click();
    check('目錄打開了', await until(() => inEntry('.ec-en-title').length === 1));
    check('目錄的焦點沒有掉到 body', focusOk());
    await capture('目錄');
    const row = (code: string): HTMLElement | undefined => inEntry('.ec-tr-name').find(each => text(each).startsWith(code));
    // 測試的學期可能不是最新的：收著就打開。
    if (!row('9-1')) inEntry('.ec-tr-sem').find(each => text(each) === '高一上')?.click();
    check('目錄有測試單元', await until(() => !!row('9-1')));
    row('9-1')?.click();
    check('單元展開', await until(() => inEntry('.ec-u-btn').length >= 2));
    check('展開的按鈕', inEntry('.ec-u-btn').map(text));
    await capture('目錄展開');
    buttonOf(inEntry('.ec-u-btn'), `全部卡 ${String(state.scope({ unit: unitOf('9-1'), since: Date.now() })?.total ?? 0)}`)?.click();
    check('目錄按全部卡：複習蓋在上面', await until(() => screens().length === 2 && inReview('.ec-q').length > 0));
    check('全部卡的總數', text(inReview('.ec-count')[0]));
    buttonOf(inReview('button'), '結束複習')?.click();
    check('✕ 回目錄', await until(() => screens().length === 1 && inEntry('.ec-en-title').length === 1));
    check('回目錄時單元還是展開', inEntry('.ec-u-btn').length >= 2);
    row('9-2')?.click();
    await until(() => inEntry('.ec-tr-from').length > 0);
    check('跨單元的小字', inEntry('.ec-tr-from').map(text));
    const names = inEntry('.ec-tr-name')[0];
    check('單元名稱靠左', names ? getComputedStyle(names).justifyContent : null);
    buttonOf(inEntry('button'), '返回')?.click();
    check('目錄返回回入口', await until(() => inEntry('.ec-en-today').length === 1));

    // ── 草稿的單元：入口關掉，打開那篇筆記 ──
    buttonOf(inEntry('button'), '目錄')?.click();
    await until(() => inEntry('.ec-en-title').length === 1);
    if (!row('9-3')) inEntry('.ec-tr-sem').find(each => text(each) === '高一上')?.click();
    await until(() => !!row('9-3'));
    check('草稿標出來', text(row('9-3')));
    row('9-3')?.click();
    check('點草稿：入口關掉', await until(() => screens().length === 0));
    check('點草稿：打開那篇筆記', await until(() => app.workspace.getActiveViewOfType(MarkdownView)?.file?.path === `${FOLDER}/入口測試 C.md`));

    // ── 設定圖示：入口關掉，設定視窗不被蓋住 ──
    host.openEntry();
    await until(() => inEntry('.ec-en-today').length === 1);
    buttonOf(inEntry('button'), '設定')?.click();
    check('設定圖示：入口關掉', await until(() => screens().length === 0));
    const setting = (app as unknown as { setting?: { activeTab?: { id?: string }; close(): void } }).setting;
    check('設定圖示：開到 Essence Cards 的分頁', await until(() => setting?.activeTab?.id === host.manifest.id));
    await sleep(200);
    setting?.close();

    // ── 卡組筆記的全部卡、預覽 ──
    const file = created[2];
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(file);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view as MarkdownView;
    const action = (cls: string): HTMLElement | null => view.containerEl.querySelector<HTMLElement>('.' + cls);
    noRemind.set(app, false);
    await until(() => !!action('essence-cards-full'));
    check('全部卡的按鈕', !!action('essence-cards-full'));
    check('預覽的按鈕一開始照開關', !!action('essence-cards-preview') === prefs.button);
    action('essence-cards-full')?.click();
    const modal = (): HTMLElement | null => document.querySelector<HTMLElement>('.modal');
    check('按全部卡先出提醒', await until(() => !!modal()));
    check('提醒的文字', Array.from(modal()?.querySelectorAll('p') ?? [], text));
    await capture('全部卡的提醒');
    buttonOf(Array.from(modal()?.querySelectorAll<HTMLElement>('button') ?? []), '取消')?.click();
    check('取消不開複習', await until(() => !modal()) && screens().length === 0);
    action('essence-cards-full')?.click();
    await until(() => !!modal());
    buttonOf(Array.from(modal()?.querySelectorAll<HTMLElement>('button') ?? []), '開始練習')?.click();
    check('開始練習：開複習', await until(() => screens().length === 1 && inReview('.ec-q').length > 0));
    await capture('全部卡的複習');
    buttonOf(inReview('button'), '結束複習')?.click();
    check('✕ 回那篇筆記', await until(() => screens().length === 0));
    check('焦點還原', focusOk());

    previewButton.set(app, true);
    previewReveal.set(app, false);
    app.workspace.trigger('layout-change');
    check('打開開關：按鈕立刻出現', await until(() => !!action('essence-cards-preview')));
    action('essence-cards-preview')?.click();
    check('預覽打開了', await until(() => inReview('.ec-q').length > 0));
    check('預覽的標示', text(inReview('.ec-count')[0]));
    check('預覽沒有旗子', inReview('.ec-flag').length === 0);
    await capture('預覽');
    for (let i = 0; i < 20 && inReview('.ec-next').length; i++) {
      inReview('.ec-next')[0].click();
      await sleep(350);
    }
    check('預覽走到底', inReview('.ec-done').length === 1);
    check('預覽到底的文字', text(inReview('.ec-done')[0]));
    check('到底也標著', text(inReview('.ec-count')[0]));
    await capture('預覽完了');
    buttonOf(inReview('button'), '結束預覽')?.click();
    check('預覽結束回筆記', await until(() => screens().length === 0));
    previewReveal.set(app, true);
    action('essence-cards-preview')?.click();
    await until(() => inReview('.ec-q').length > 0);
    check('自動展開：一進卡片就是背面', inReview('.ec-rates').length === 1);
    buttonOf(inReview('button'), '結束複習')?.click();
    await until(() => screens().length === 0);
    previewButton.set(app, false);
    app.workspace.trigger('layout-change');
    check('關掉開關：按鈕不見', await until(() => !action('essence-cards-preview')));

    // ── 分行的出處、Obsidian 的清單和解析一致 ──
    await until(() => !!app.metadataCache.getFileCache(file)?.listItems?.length);
    const items: ListItem[] = (app.metadataCache.getFileCache(file)?.listItems ?? []).map(item => ({ line: item.position.start.line, end: item.position.end.line, parent: item.parent, ...(item.id ? { id: item.id } : {}) }));
    check('清單和解析不一致的地方', compareLists(FILES[file.path], items));

    // ── 看不懂的出處：存檔按鈕與通知 ──
    const save = (): HTMLElement | null => view.containerEl.querySelector<HTMLElement>('.essence-cards-save');
    check('存檔按鈕的樣子', save()?.classList.contains('is-sources'));
    check('存檔按鈕的說明', save()?.getAttribute('aria-label'));
    const notices = devLog.notices.length;
    await host.ids?.saver.save(view);
    check('存檔的通知', devLog.notices.slice(notices));
    await capture('存檔的通知');
    check('存檔沒有改到內容', await app.vault.read(file) === FILES[file.path]);

    // ── 出處：實際點一次（按鈕文字、長文字換行、最上層是筆記）──
    host.openEntry();
    await until(() => inEntry('.ec-en-today').length === 1);
    host.startReview({ deck: file.path, since: Date.now() });
    await until(() => screens().length === 2 && inReview('.ec-q').length > 0);
    await sleep(200);
    inReview('.ec-show')[0]?.click();
    await until(() => inReview('.ec-srcw button').length > 0);
    await sleep(400);
    inReview('.ec-srcw button')[0]?.click();
    await until(() => inReview('.ec-tip').length > 0);
    check('出處按鈕的文字', inReview('.ec-tip').map(text));
    const tips = inReview('.ec-tip');
    // 手機寬度下量：寬視窗放得下一行。
    const thin = document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '.ec-fullscreen { right: auto !important; width: 390px !important; }' }));
    await sleep(100);
    check('長文字換行', (tips.at(-1)?.getBoundingClientRect().height ?? 0) > 40);
    await capture('出處 手機寬度');
    thin.remove();
    check('沒有露出括號', !tips.some(each => /\[\[|\]\]/.test(text(each))));
    await capture('出處');
    const before = new Set(app.workspace.getLeavesOfType('markdown'));
    buttonOf(tips, '高一上 9-2 p.30 ↗')?.click();
    check('點出處：複習和入口都關掉', await until(() => screens().length === 0));
    const opened = (): string | undefined => app.workspace.getActiveViewOfType(MarkdownView)?.file?.path;
    check('點出處：跳到那個單元的材料', await until(() => opened() === `${MATERIALS}/入口材料乙.md`));
    check('點出處：開在新分頁', app.workspace.getLeavesOfType('markdown').some(each => !before.has(each)));
    await capture('出處打開的筆記');

    // ── 手機寬度的截圖 ──
    const narrow = document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '.ec-fullscreen { right: auto !important; width: 390px !important; }' }));
    try {
      host.openEntry();
      await until(() => inEntry('.ec-en-today').length === 1);
      await capture('入口 手機寬度');
      host.openEntry('catalog');
      await until(() => inEntry('.ec-en-title').length === 1);
      if (!row('9-1')) inEntry('.ec-tr-sem').find(each => text(each) === '高一上')?.click();
      await until(() => !!row('9-1'));
      row('9-1')?.click();
      await capture('目錄 手機寬度');
      host.entry?.close();
    } finally { narrow.remove(); }

    check('沒有留下全螢幕', screens().length === 0);
    check('複習紀錄沒有變', await logs(app) === logBefore);
    return { checks, shots };
  } catch (error) {
    return { checks, shots, error: error instanceof Error ? error.stack : String(error) };
  } finally {
    host.review?.close();
    host.entry?.close();
    noRemind.set(app, prefs.noRemind);
    previewButton.set(app, prefs.button);
    previewReveal.set(app, prefs.reveal);
    for (const leaf of app.workspace.getLeavesOfType('markdown')) if (!leavesBefore.has(leaf)) leaf.detach();
    await sleep(1500);
    for (const file of created) await app.vault.delete(file).catch(() => { /* 開發命令：沒刪到的看結果檔的 left。 */ });
    await sleep(500);
    for (const name of [FOLDER, MATERIALS]) {
      const entry = app.vault.getFolderByPath(name);
      if (entry && !entry.children.length) await app.vault.delete(entry, true).catch(() => { /* 同上。 */ });
    }
    check('沒有留下暫時的檔與資料夾', [FOLDER, MATERIALS].every(name => !app.vault.getAbstractFileByPath(name)));
    rendering.restore();
  }
}

/**
 * 讀不到的提示（§12、D-154）：PowerShell 用獨占鎖擋住 file 這一篇之後跑 do=on，放開之後跑 do=off。狀態列與提醒一區都看得到才算；這一篇不改內容，只送 modify 讓 state 去讀。
 */
export async function entryUnread(host: EntryDevHost, file: string | undefined, action: string | undefined, folder: string): Promise<unknown> {
  const { app } = host;
  const state = host.state;
  if (!state || !file) return { error: '要帶 file 參數' };
  const rendering = keepRendering();
  try {
    const bar = (): string => text(document.querySelector('.essence-cards-reminders'));
    if (action === 'on') {
      const target = app.vault.getFileByPath(file);
      if (!target) return { error: '沒有這個檔：' + file };
      app.vault.trigger('modify', target);
      const reached = await until(() => state.unread().includes(file), 5000);
      await sleep(200);
      host.openEntry();
      await until(() => inEntry('.ec-rem').length === 1, 2000);
      inEntry('.ec-rem-go')[0]?.click();
      await sleep(300);
      const shot = await capturePng(app, `${folder}/讀不到 提醒.png`);
      return { unread: state.unread(), reached, bar: bar(), rem: inEntry('.ec-rem').map(text), shot };
    }
    const cleared = await until(() => !state.unread().length, 70_000);
    await sleep(300);
    const after = { unread: state.unread(), cleared, bar: bar(), rem: inEntry('.ec-rem').map(text), barShown: document.querySelector<HTMLElement>('.essence-cards-reminders')?.style.display !== 'none' };
    host.entry?.close();
    return after;
  } finally { rendering.restore(); }
}
