import { MarkdownView, Platform } from 'obsidian';
import type { App } from 'obsidian';
import { rawPath, sha256Hex } from '../core/ai/index.ts';
import { parseDeck } from '../core/deck/index.ts';
import { aiPrefs, previewButton } from '../ui/prefs.ts';
import { screens, sleep, text, until, type EntryDevHost } from './dev-entry.ts';
import { capturePng, keepRendering } from './dev-review.ts';

// AI 製卡的 Windows 實機（tasks/ai-cards-mvp.md §8 第 1 點）：只在電腦。用自編的內容走完整流程：開視窗 → 填表 → 複製 → 關掉再「接著貼回」→ 貼回準備好的回覆
// （R3 三段、英文兩篇各一份）→ 檢查 → 存成草稿 → 預覽 → 啟用；核對卡組、快照、原文/ 與紀錄的 set: status，每一步截圖。結束時只刪這次建立的檔，紀錄的行留著。

/** 最上面那一個 AI 製卡的視窗。 */
const modal = (): HTMLElement | null => Array.from(document.querySelectorAll<HTMLElement>('.essence-cards-ai-modal')).at(-1) ?? null;
const modals = (): number => document.querySelectorAll('.essence-cards-ai-modal').length;
const inModal = <T extends HTMLElement>(selector: string): T[] => Array.from(modal()?.querySelectorAll<T>(selector) ?? []);
const button = (name: string, root: ParentNode | null = modal()): HTMLButtonElement | undefined => Array.from(root?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(each => text(each) === name);
const lastModal = (): HTMLElement | undefined => Array.from(document.querySelectorAll<HTMLElement>('.modal-container')).at(-1);
function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string, event: 'input' | 'change'): void {
  el.value = value;
  el.dispatchEvent(new Event(event, { bubbles: true }));
}
/** 系統剪貼簿（Electron 的 clipboard）：AI 讀不到使用者的剪貼簿以外的東西，只讀這次放進去的。 */
function clipboardText(): string | null {
  if (!Platform.isDesktopApp) return null;
  const load = (window as unknown as { require?: (name: string) => unknown }).require;
  const electron = load?.('electron') as { clipboard?: { readText(): string } } | undefined;
  return electron?.clipboard?.readText() ?? null;
}
const command = (app: App, id: string): boolean => (app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById(id);

/** 一科的一次：填表、複製、接著貼回、檢查、存成草稿；回傳寫成的篇與核對。 */
async function oneRun(host: EntryDevHost, capture: (name: string) => Promise<void>, subject: string, term: string, unit: string, reply: (prefix: string) => string, label: string): Promise<{ checks: Record<string, unknown>; decks: string[]; created: string[] }> {
  const { app } = host;
  const checks: Record<string, unknown> = {};
  const before = new Set(app.vault.getFiles().map(file => file.path));
  command(app, 'essence-cards:ai-cards');
  await until(() => modal() !== null);
  // 有之前沒做完的工作時先問；這次做新的一課。
  button('做新的一課')?.click();
  await until(() => inModal('select').length >= 3);
  const [subjectBox, termBox, purposeBox] = inModal<HTMLSelectElement>('select');
  setValue(subjectBox, subject, 'change');
  setValue(termBox, term, 'change');
  setValue(purposeBox, '準備段考', 'change');
  setValue(inModal<HTMLInputElement>('input[type="text"]')[0], unit, 'input');
  await sleep(200);
  checks.form = text(modal());
  await capture(`${label} 表單`);
  button('複製提示')?.click();
  await until(() => inModal('textarea').length > 0);
  const jobs = aiPrefs.jobs(app) as { id: string; parts: { text: string }[]; copiedMs: number }[] | null;
  const job = (jobs ?? []).sort((a, b) => b.copiedMs - a.copiedMs)[0];
  const copied = clipboardText();
  checks.clipboardIsPrompt = !!job && copied === job.parts.map(part => part.text).join('\n\n');
  checks.promptChars = copied?.length ?? null;
  checks.copiedText = text(modal()).slice(0, 200);
  await capture(`${label} 已複製`);
  // 按「取消」關掉再開：先問「接著貼回」。
  button('取消')?.click();
  checks.closed = await until(() => modals() === 0);
  command(app, 'essence-cards:ai-cards');
  await until(() => modal() !== null);
  checks.resumeAsked = text(modal());
  await capture(`${label} 接著貼回`);
  button('接著貼回')?.click();
  await until(() => inModal('textarea').length > 0);
  const prefix = `${term}${subject === 'english' ? '英文' : '自然'} ${unit.split(' ')[0]}`;
  setValue(inModal<HTMLTextAreaElement>('textarea')[0], reply(prefix), 'input');
  button('檢查')?.click();
  await sleep(300);
  checks.result = text(modal()).slice(0, 600);
  await capture(`${label} 檢查`);
  const save = button('存成草稿');
  checks.saveEnabled = !!save && !save.disabled;
  save?.click();
  await until(() => modal() === null, 15_000);
  await sleep(800);
  await capture(`${label} 存成草稿`);
  // 截圖不算：只算這次在 Essence Cards/ 建立的卡組、快照與原文。
  const created = app.vault.getFiles().map(file => file.path).filter(path => !before.has(path) && path.startsWith('Essence Cards/')).sort();
  const decks = created.filter(path => path.startsWith('Essence Cards/學業/'));
  checks.created = created;
  checks.decksDraft = await Promise.all(decks.map(async path => parseDeck(await app.vault.adapter.read(path)).props.status));
  const snapshot = created.find(path => path.startsWith('Essence Cards/紀錄/AI 輸出/') && !path.includes('/原文/'));
  checks.snapshotHead = snapshot ? (await app.vault.adapter.read(snapshot)).split('\n---\n')[0] : null;
  if (job) {
    const raws = await Promise.all(job.parts.map(async part => {
      const path = rawPath(sha256Hex(part.text));
      return await app.vault.adapter.exists(path) && await app.vault.adapter.read(path) === part.text;
    }));
    checks.rawPartsSame = raws.every(Boolean);
  }
  checks.jobCleared = !((aiPrefs.jobs(app) as { id: string }[] | null) ?? []).some(each => each.id === job?.id);
  checks.openedFirst = app.workspace.getActiveViewOfType(MarkdownView)?.file?.path ?? null;
  return { checks, decks, created };
}

export async function aiCardsDev(host: EntryDevHost & { device: string }, folder: string): Promise<unknown> {
  const { app } = host;
  const state = host.state;
  if (!state) return { error: 'state 還沒建好' };
  await state.ready();
  const rendering = keepRendering();
  const shots: string[] = [];
  let shot = 0;
  const capture = async (name: string): Promise<void> => {
    await sleep(300);
    if (!(await app.vault.adapter.exists(folder))) await app.vault.adapter.mkdir(folder);
    for (const notice of Array.from(document.querySelectorAll('.notice'))) if (!text(notice).startsWith('已存成草稿')) notice.remove();
    const path = await capturePng(app, `${folder}/${String(++shot).padStart(2, '0')} ${name}.png`);
    if (path) shots.push(path);
  };
  const run = Math.random().toString(36).slice(2, 6);
  const code = String(900 + Math.floor(Math.random() * 99));
  const created: string[] = [];
  const checks: Record<string, unknown> = {};
  const wasPreview = previewButton.get(app);
  try {
    // 自然（R3 三段）：一篇，候選卡片，AI 自己寫了一個 ID。
    const science = await oneRun(host, capture, 'science', '高三下', `9-${code} 試跑${run}`, () => [
      '<<<全貌>>>', '## 知識塊', '', '- 擴散：粒子不停運動', '<<<架構>>>', '## 學習目標', '', '- T01｜①｜能用粒子運動說明擴散現象',
      '<<<卡組>>>', '> [!note] 給家長的備註', '> - 例題的濃度計算建議另外練習', '', '## 1 擴散現象', '',
      '- 能用粒子運動說明擴散現象 ^aiwrote', '    - 出處：p.44｜類型：因果', '    - 黑糖放進水裡，不攪拌也會慢慢變甜，為什麼？ :: 粒子**不停運動**，從**濃度高**的地方散到**濃度低**的地方', '',
      '> [!note]- 候選卡片', '> - 能說明溫度對溶解度的影響', '>     - 理由：補充的內容，段考不一定考', '>     - 出處：p.45｜類型：因果', '>     - 水溫升高時，糖的溶解度會怎麼變？ :: 變**大**', '<<<完>>>',
    ].join('\n'), '自然');
    created.push(...science.created);
    checks.science = science.checks;
    // 預覽（D-163 第 3 點）：草稿也能看。
    previewButton.set(app, true);
    app.workspace.trigger('layout-change');
    await sleep(300);
    checks.previewCommand = command(app, 'essence-cards:preview');
    await until(() => screens().length > 0);
    await capture('自然 預覽');
    host.review?.close();
    await until(() => screens().length === 0);
    // 啟用：標題列的按鈕 → 先問 → 啟用。
    const deck = science.decks[0];
    checks.targetsBefore = state.deckTargets(deck).length;
    const activate = document.querySelector<HTMLElement>('.essence-cards-activate');
    checks.activateButton = !!activate;
    activate?.click();
    await until(() => !!button('啟用', lastModal() ?? null));
    checks.activateText = text(lastModal());
    await capture('自然 啟用的確認');
    button('啟用', lastModal() ?? null)?.click();
    await until(() => state.deckTargets(deck).length > 0);
    await sleep(500);
    await capture('自然 啟用之後');
    checks.targetsAfter = state.deckTargets(deck).length;
    checks.statusAfter = parseDeck(await app.vault.adapter.read(deck)).props.status;
    checks.activateButtonGone = !document.querySelector('.essence-cards-activate');
    await state.flush();
    const month = new Date().toISOString().slice(0, 7);
    const log = await app.vault.adapter.read(`Essence Cards/紀錄/${month} ${host.device}.jsonl`).catch(() => '');
    checks.logged = log.split('\n').filter(line => line.includes('"set":"status"') && line.includes(JSON.stringify(deck))).map(line => (JSON.parse(line) as { val: string }).val);
    // 英文（common）：一課兩篇，照篇名拆檔。
    const english = await oneRun(host, capture, 'english', '高三下', `L${code} Sports: Week ${run}`, prefix => [
      `${prefix} 單字`, '', '## 單字', '', '- borrow 英翻中', '    - borrow :: 借入', '- borrow 中翻英', '    - 借入 :: borrow', '',
      '> [!note]- 候選卡片', '> - lend 英翻中', '>     - 理由：課本只出現一次', '>     - lend :: 借出', '',
      `${prefix} 文法`, '', '## 文法', '', '- 能用 be going to 說未來的計畫', '    - 我明天要去游泳。I ＿＿ swim tomorrow. :: am going to', '<<<完>>>',
    ].join('\n'), '英文');
    created.push(...english.created);
    checks.english = english.checks;
  } finally {
    previewButton.set(app, wasPreview);
    rendering.restore();
    // 只刪這次建立的檔：關掉開著的分頁再刪。
    for (const leaf of app.workspace.getLeavesOfType('markdown')) if (leaf.view instanceof MarkdownView && created.includes(leaf.view.file?.path ?? '')) leaf.detach();
    for (const path of created) { const file = app.vault.getFileByPath(path); if (file) await app.vault.delete(file); }
  }
  return { checks, shots, deleted: created };
}
