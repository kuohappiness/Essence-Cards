import type { App } from 'obsidian';
import { capturePng, keepRendering } from './dev-review.ts';
import type { SettingsStore } from '../core/settings/index.ts';
import type { State } from '../state/index.ts';
import type { Params } from './dev-cloud.ts';
import { RestoreModal } from './restore-modal.ts';
import type { RestoreFlow } from './restore.ts';

// 外掛內還原的 Windows 實機（tasks/plugin-restore.md §8），只在開發版。走真的視窗：開、選一份、勾、按還原，每一步截圖。
// URI 參數：do=status（列備份）、do=cap（value=每日時間上限）、do=check（target=資料夾：state 看到的那幾篇與作答）、do=run；run 的 pick=第幾份（0 是最新）、use=檔名（優先於 pick）、
// tick=要勾的列（文字含這段，用 | 分開；all 按全選）、apply=1 才按還原。URI 參數不能叫 name、path。

export interface RestoreDevHost { app: App; restoreFlow: RestoreFlow | null; state: State | null; store: SettingsStore }

const sleep = (ms: number) => new Promise<void>(resolve => { window.setTimeout(resolve, ms); });
const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function until(condition: () => boolean, what: string, limit = 60_000): Promise<void> {
  for (let waited = 0; !condition(); waited += 50) {
    if (waited > limit) throw Error('等太久：' + what);
    await sleep(50);
  }
}

export async function restoreDev(host: RestoreDevHost, params: Params, folder: string): Promise<unknown> {
  const { app, restoreFlow: flow } = host;
  if (!flow) throw Error('還原還沒載入（不是電腦版，或載入失敗）');
  if ((params.do ?? 'status') === 'status') {
    const list = await flow.list();
    return { unreadable: list.unreadable, rows: list.rows.map(row => ({ name: row.stored.name, by: row.stored.manifest.by, started: row.stored.manifest.started, foreign: row.foreign })) };
  }
  if (params.do === 'cap') return { saved: await host.store.change({ key: 'capMinutes', value: Number(params.value) }), now: host.store.value().settings.capMinutes };
  if (params.do === 'check') {
    if (!host.state) throw Error('state 還沒建立');
    await host.state.ready();
    const prefix = (params.target ?? '') + '/';
    const decks = host.state.decks().filter(entry => entry.path.startsWith(prefix)).map(entry => ({ path: entry.path, targets: host.state?.deckTargets(entry.path), issues: host.state?.deckStatus(entry.path).issues }));
    const ids = new Set(decks.flatMap(deck => deck.targets ?? []));
    return { decks, reviews: host.state.history().reviews.filter(entry => ids.has(entry.lt)), conflicts: host.state.conflicts(), block: host.state.writeBlock(), cap: host.store.value().settings.capMinutes };
  }
  if (params.do !== 'run') throw Error('不認得的 do：' + params.do);
  await app.vault.adapter.mkdir(folder);
  const list = await flow.list();
  const index = params.use ? list.rows.findIndex(row => row.stored.name === params.use) : Number(params.pick ?? '0');
  if (index < 0 || index >= list.rows.length) throw Error('沒有這一份備份');
  const rendering = keepRendering();
  const modal = new RestoreModal(app, flow);
  const steps: Record<string, unknown> = {};
  const body = (): HTMLElement => modal.contentEl;
  const shot = async (name: string): Promise<void> => {
    await sleep(300);
    steps[name] = { shot: await capturePng(app, `${folder}/${name}.png`), text: text(body()) };
  };
  try {
    modal.open();
    await until(() => body().querySelector('.essence-cards-restore-row') !== null, '備份清單');
    await shot('1 選備份');
    body().querySelectorAll<HTMLElement>('.essence-cards-restore-row')[index].click();
    await until(() => body().querySelector('.essence-cards-restore-footer') !== null, '比對');
    await shot('2 差異');
    if (params.tick === 'all') Array.from(body().querySelectorAll<HTMLButtonElement>('.essence-cards-restore-tools button')).find(button => button.textContent === '全選')?.click();
    else for (const part of (params.tick ?? '').split('|').filter(Boolean)) {
      const row = Array.from(body().querySelectorAll('.essence-cards-restore-item')).find(item => text(item).includes(part));
      if (!row) throw Error('沒有這一列：' + part);
      row.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    }
    await shot('3 勾選之後');
    if (params.apply === '1') {
      const start = body().querySelector<HTMLButtonElement>('.mod-cta');
      if (!start || start.disabled) throw Error('還原的按鈕不能按：' + text(start));
      start.click();
      await until(() => Array.from(body().querySelectorAll('button')).some(button => button.textContent === '重新比對'), '結果', 120_000);
      await shot('4 結果');
      Array.from(body().querySelectorAll('button')).find(button => button.textContent === '重新比對')!.click();
      await until(() => body().querySelector('.essence-cards-restore-footer .mod-cta') !== null, '重新比對');
      await shot('5 重新比對');
    }
    return steps;
  } finally {
    modal.close();
    rendering.restore();
  }
}
