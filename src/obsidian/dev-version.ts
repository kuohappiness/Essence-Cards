import type { App } from 'obsidian';
import { LOG_FOLDER } from '../core/study/index.ts';
import type { State } from '../state/index.ts';
import { createObsidianFiles } from './files.ts';
import { capturePng, keepRendering } from './dev-review.ts';

// 更新防線第二部分的 Windows 對照（任務說明 2-1、2-2）：版本行真的寫進這台的紀錄、「版本」命令的多行通知在 Obsidian 裡
// 怎麼顯示、需要新版的卡組讀到之後的樣子。只在開發版（dev.ts 的 version 命令）。

/** 暫時放一篇需要新版的卡組：在 Essence Cards/ 裡才算卡組；做完刪掉。 */
const NEWER = 'Essence Cards/W5 範例/需要新版（暫存）.md';
const NEWER_TEXT = '---\n需要版本: 9.0.0\n---\n- 能說明暫存的目標 ^zzzzz8\n    - Q :: A\n';

interface VersionHost { app: App; device: string; manifest: { id: string } }

const sleep = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });

/** 等 state 讀到（最多 timeout 毫秒）。 */
async function until(check: () => boolean, timeout = 5000): Promise<boolean> {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(100)) if (check()) return true;
  return check();
}

/** 執行「版本」命令，等它的通知出現：回傳通知的原文、畫面上的換行（innerText）與 white-space。 */
async function runVersion(host: VersionHost): Promise<{ text: string | null; rendered: string; whiteSpace: string; height: number } | null> {
  const before = new Set(Array.from(document.querySelectorAll('.notice')));
  (host.app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById(host.manifest.id + ':version');
  let notice: HTMLElement | undefined;
  await until(() => (notice = Array.from(document.querySelectorAll<HTMLElement>('.notice')).find(el => !before.has(el))) !== undefined);
  if (!notice) return null;
  const message = notice.querySelector<HTMLElement>('.notice-message') ?? notice;
  return { text: message.textContent, rendered: message.innerText, whiteSpace: getComputedStyle(message).whiteSpace, height: Math.round(notice.getBoundingClientRect().height) };
}

/** 這台當月與上個月的紀錄檔裡的版本行。 */
async function ownAppLines(host: VersionHost): Promise<{ path: string; lines: string[] }[]> {
  const files = createObsidianFiles(host.app);
  const paths = (await files.list(LOG_FOLDER)).filter(path => path.endsWith(' ' + host.device + '.jsonl'));
  return Promise.all(paths.map(async path => ({ path, lines: ((await files.read(path)) ?? '').split('\n').filter(line => line.includes('"set":"app"')) })));
}

export async function versionCheck(host: VersionHost, state: State, shots: string): Promise<unknown> {
  const rendering = keepRendering();
  const files = createObsidianFiles(host.app);
  try {
    // 1. 版本行：寫進這台的紀錄了（版本命令會先 flush）。
    const plain = await runVersion(host);
    const plainShot = await capturePng(host.app, shots + ' 1 版本命令.png');
    const after = { version: state.version(), blocked: state.blocked(), ownApp: await ownAppLines(host) };
    document.querySelectorAll<HTMLElement>('.notice').forEach(el => { el.click(); });
    // 2. 需要新版的卡組：state 讀到之後不出題、按鈕說明需要更新、版本命令列出它。
    await files.modify(NEWER, () => NEWER_TEXT);
    const seen = await until(() => state.blocked().decks.includes(NEWER));
    await sleep(500);
    const gated = await runVersion(host);
    const gatedShot = await capturePng(host.app, shots + ' 2 需要新版的卡組.png');
    const deck = { seen, blocked: state.blocked(), deckStatus: state.deckStatus(NEWER), inToday: state.today().share.some(item => item.deck === NEWER), canAnswer: state.canAnswer('zzzzz8') };
    document.querySelectorAll<HTMLElement>('.notice').forEach(el => { el.click(); });
    return { plain, plainShot, after, gated, gatedShot, deck };
  } finally {
    rendering.restore();
    const file = host.app.vault.getAbstractFileByPath(NEWER);
    if (file) await host.app.vault.delete(file);
  }
}
