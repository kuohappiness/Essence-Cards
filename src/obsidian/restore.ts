import { MarkdownView } from 'obsidian';
import type { App, TFile, ViewState, WorkspaceLeaf } from 'obsidian';
import { applyRestore, filesReader, hashBytes, openBackup, planRestore, PLUGIN_DATA, readCurrent, textDiff } from '../core/backup/index.ts';
import type { BackupReader, OpenedBackup, PlannedFile, RestorePlan, RestoreResult, StoredBackup } from '../core/backup/index.ts';
import type { Deck } from '../core/deck/index.ts';
import { parseData, sameSaved, savedDiff } from '../core/settings/index.ts';
import type { SettingsStore } from '../core/settings/index.ts';
import { canRead, releaseOf } from '../core/version/index.ts';
import type { Files } from '../core/files.ts';
import type { State } from '../state/index.ts';
import type { BackupWiring } from './backup.ts';

// 外掛內的還原（tasks/plugin-restore.md）：畫面要的資料與開始還原的步驟，Node 的部分經 Desktop（D-148）。

/** 讀一個檔最多等多久：iCloud 佔位檔可能一直不回來，還原的閘門不能一直關著（§3-1）。 */
const READ_WAIT = 30_000;

export interface RestoreHost {
  app: App;
  backup: BackupWiring;
  files: Files;
  state: () => State | null;
  settings: SettingsStore;
  build: string;
  device: string;
  /** 系統資料夾不在原位、也沒搬回（§2）。 */
  displaced: (path: string) => boolean;
  /** 開始時關掉開著的複習畫面與入口（§5）。 */
  leaving: () => void;
  /** 還原開始或結束：外掛更新「正在還原」的狀態。 */
  running: (on: boolean) => void;
  fail: (step: string, error: unknown, path?: string) => void;
}

/** 選單裡的一份備份。 */
export interface BackupRow { stored: StoredBackup; foreign: string | null }
interface BackupList { rows: BackupRow[]; unreadable: number }
/** 比對的結果：畫面勾選時用 plan 重算。 */
export interface Comparison {
  row: BackupRow;
  opened: OpenedBackup;
  current: ReadonlyMap<string, Uint8Array>;
  /** 照這些勾選算的計畫。 */
  plan(chosen: ReadonlySet<string>): RestorePlan;
  /** 文字差異；不是文字回 null。 */
  diff(file: PlannedFile): string[] | null;
  /** 「設定」那一列的欄位差異；不是 data.json 是 null。 */
  settings(file: PlannedFile): string[] | null;
}

export interface RestoreFlow {
  list(): Promise<BackupList>;
  compare(row: BackupRow): Promise<Comparison>;
  apply(comparison: Comparison, chosen: ReadonlySet<string>): Promise<RestoreResult>;
  active(): boolean;
}

interface Opened { leaf: WorkspaceLeaf; state: ViewState; eState: unknown }

function byTime(a: BackupRow, b: BackupRow): number {
  return a.stored.manifest.started < b.stored.manifest.started ? 1 : a.stored.manifest.started > b.stored.manifest.started ? -1 : 0;
}

/** 讀一個檔不能卡住（§3-1 第 6 點）。 */
function timedReader(reader: BackupReader): BackupReader {
  return {
    list: () => reader.list(),
    read(path) {
      let id: number | undefined;
      const late = new Promise<never>((_, reject) => { id = window.setTimeout(() => { reject(Error(`讀 ${path} 超過 30 秒沒有回來（可能還在從 iCloud 下載）`)); }, READ_WAIT); });
      return Promise.race([reader.read(path), late]).finally(() => { window.clearTimeout(id); });
    },
  };
}

/** 開著這些檔、已經載入的分頁（§3-2）。延後載入的分頁還沒讀檔，不用動；getLeavesOfType 才找得到背景分頁（§8 第 1 點實測）。 */
function openLeaves(app: App, paths: ReadonlySet<string>): WorkspaceLeaf[] {
  return app.workspace.getLeavesOfType('markdown').filter(leaf => {
    const file: TFile | null = leaf.view instanceof MarkdownView ? leaf.view.file : null;
    return file !== null && paths.has(file.path);
  });
}

export function createRestore(host: RestoreHost): RestoreFlow {
  const { app, backup, files } = host;
  const { desktop } = backup;
  const config = app.vault.configDir;
  const dataTarget = config + '/' + PLUGIN_DATA;
  const version = releaseOf(host.build);
  const needsUpdate = (deck: Deck): boolean => deck.props.need !== null && !canRead(deck.props.need, version);
  const readData = async (): Promise<Uint8Array | null> => await app.vault.adapter.exists(dataTarget) ? new Uint8Array(await app.vault.adapter.readBinary(dataTarget)) : null;
  const reader = timedReader(filesReader(files, config, readData));
  const folder = (): string => backup.custom() ?? desktop.defaultFolder;
  const dataOf = (bytes: Uint8Array | undefined): Record<string, unknown> | null => bytes === undefined ? null : parseData(bytes);
  let running = false;

  /** 計畫要的規則（§2）：links 是事先查好的路徑上的連結。 */
  function planOptions(links: ReadonlyMap<string, string>) {
    return {
      config,
      sameFile: desktop.host.key,
      needsUpdate,
      sameData(a: Uint8Array, b: Uint8Array): boolean {
        const x = dataOf(a), y = dataOf(b);
        return x !== null && y !== null && sameSaved(x, y);
      },
      refuse({ target, backup: bytes }: { target: string; backup: Uint8Array }): string | null {
        if (target === dataTarget) return parseData(bytes) === null ? '備份裡的設定讀不懂' : links.get(target) ?? null;
        if (target.split('/').some(part => part.startsWith('.'))) return '檔名以點開頭，外掛讀不到現在的內容';
        if (links.has(target)) return links.get(target)!;
        return host.displaced(target) ? '這個位置的系統資料夾不在原位；照提醒放回去再還原' : null;
      },
    };
  }

  return {
    active: () => running,
    async list() {
      const { backups, skipped } = await desktop.listing(folder());
      const { key, vault } = desktop.host;
      const rows = backups.map(stored => {
        const from = stored.manifest.vault;
        return { stored, foreign: key(from.name) === key(vault.name) && key(from.path) === key(vault.path) ? null : from.name };
      });
      return { rows: rows.sort(byTime), unreadable: skipped.length };
    },
    async compare(row) {
      const bytes = await desktop.host.read(folder(), row.stored.name);
      if (!bytes) throw Error('讀不到備份：' + row.stored.name);
      const opened = openBackup(bytes);
      if (!opened.ok) throw Error('這份備份不能用：' + opened.error);
      const current = await readCurrent(reader, dataTarget);
      const links = new Map<string, string>();
      const source = opened.value.manifest.vault.config + '/' + PLUGIN_DATA;
      for (const path of opened.value.files.keys()) {
        const target = path === source ? dataTarget : path;
        try { await desktop.noLinks(target); } catch (error) { links.set(target, error instanceof Error ? error.message : String(error)); }
      }
      const options = planOptions(links);
      return {
        row, opened: opened.value, current,
        plan: chosen => planRestore({ manifest: opened.value.manifest, backup: opened.value.files, current, ...options, selection: chosen }),
        diff(file) {
          if (!file.current) return null;
          return textDiff(current.get(file.current.path)!, opened.value.files.get(file.path)!);
        },
        settings(file) {
          if (file.target !== dataTarget) return null;
          const after = dataOf(opened.value.files.get(file.path));
          return after === null ? [] : savedDiff(file.current ? dataOf(current.get(file.current.path)) : null, after);
        },
      };
    },
    async apply(comparison, chosen) {
      const state = host.state();
      if (!state) throw Error('還沒讀完，等一下再還原');
      if (running) throw Error('已經在還原');
      const { opened, current: screenNow, row } = comparison;
      running = true;
      host.running(true);
      try {
        host.leaving();
        return await state.restore(async writer => {
          const screenPlan = comparison.plan(chosen);
          const screen = new Map(screenPlan.files.filter(file => chosen.has(file.path)).map(file => [file.path, file.current?.sha256 ?? null] as const));
          const targets = new Set(screenPlan.files.filter(file => chosen.has(file.path) || file.action === 'restore').map(file => file.current?.path ?? file.target ?? ''));
          const swapped: Opened[] = [];
          const empty: RestoreResult = { backup: null, files: [], logs: [], stopped: null, written: [] };
          try {
            // 開著的那幾篇先存檔、換成空白分頁（§3-2）：存不進去就什麼都不寫。
            for (const leaf of openLeaves(app, targets)) {
              const view = leaf.view as MarkdownView;
              const eState: unknown = view.getEphemeralState();
              const viewState = leaf.getViewState();
              try { await view.save(); } catch (error) {
                host.fail('存檔', error, view.file?.path);
                return { ...empty, stopped: { step: '存檔 ' + (view.file?.path ?? ''), message: error instanceof Error ? error.message : String(error) } };
              }
              await leaf.setViewState({ type: 'empty' });
              swapped.push({ leaf, state: viewState, eState });
            }
            const links = new Map<string, string>();
            for (const file of screenPlan.files) {
              if (file.target === null) continue;
              try { await desktop.noLinks(file.target); } catch (error) { links.set(file.target, error instanceof Error ? error.message : String(error)); }
            }
            const result = await applyRestore({
              opened, chosen, screen,
              plan: planOptions(links),
              before: () => backup.runner.beforeRestore([row.stored.name], reader),
              current: () => readCurrent(reader, dataTarget),
              files,
              deck: (path, write) => writer.deck(path, write),
              noLinks: path => desktop.noLinks(path),
              settings(bytes, expected) {
                const fields = parseData(bytes);
                if (fields === null) return Promise.resolve('failed');
                const unchanged = async (): Promise<boolean> => {
                  const now = await readData();
                  return (now === null ? null : hashBytes(now)) === expected;
                };
                const was = screenPlan.files.find(file => file.target === dataTarget)?.current?.path;
                return host.settings.restore(fields, unchanged, was === undefined || parseData(screenNow.get(was)!) === null);
              },
              device: host.device,
              now: Date.now,
              offset: ms => -new Date(ms).getTimezoneOffset(),
              closed: () => writer.closed(),
              fail: host.fail,
            });
            await writer.reread(result.written);
            return result;
          } finally {
            for (const { leaf, state: viewState, eState } of swapped) {
              try {
                await leaf.setViewState(viewState);
                leaf.setEphemeralState(eState);
              } catch (error) { host.fail('開回分頁', error); }
            }
          }
        });
      } finally {
        running = false;
        host.running(false);
      }
    },
  };
}
