import { readFile } from 'node:fs/promises';
import { SourceMap, type SourceMapPayload } from 'node:module';
import { join } from 'node:path';
import { hashBytes } from '../src/core/backup/index.ts';
import { localFolder } from './install.ts';

/**
 * 錯誤紀錄的程式位置對回原始碼（D-155 第 5 點、tasks/error-log.md §6）：`npm run locate -- <版號> <行:欄>…`。
 * 先確認那一版保存的 main.js 與 main.js.map 的雜湊都和 release.json 相同，再用 Node 內建的 SourceMap 查；對不上就停。
 * 位置寫 stack 裡的 `行:欄`（1 起算，例如 `plugin:essence-cards:1:20345` 的 `1:20345`），也可以貼整個 frame；
 * SourceMap.findEntry 是 0 起算，這裡各減 1。
 * Obsidian 載入外掛時沒有多出行或欄的偏移（Windows 版 Obsidian 1.14.5，2026-10-30 開發命令 error-probe：六個位置都對回拋錯的
 * 那一行，欄指在 `Error(`；tasks/error-log.md〈結果〉）。iPhone 的 stack 格式待下一次實機測試確認。
 */

/** Obsidian 的 stack 和 main.js 的行、欄差多少：實測是 0。之後哪個平台不是 0，改這裡並寫明出處。 */
const OFFSET = { line: 0, column: 0 };

export interface Located {
  /** 輸入的那一個位置。 */
  position: string;
  /** 原始檔（相對 repo）、行與欄（1 起算）。 */
  source: string;
  line: number;
  column: number;
  /** 那個位置的識別字（對照表有記才有）。 */
  name?: string;
  /** 原始檔的那一行。 */
  text: string;
}

interface Release { version: string; build: string; sha256: Record<string, string> }

export async function locate(version: string, positions: readonly string[], local = localFolder()): Promise<Located[]> {
  const folder = join(local, 'releases', version);
  let release: Release;
  try { release = JSON.parse(await readFile(join(folder, 'release.json'), 'utf8')) as Release; } catch { throw Error(`沒有 ${version} 的正式產物（${folder}）`); }
  // 正式版不會是 .dirty；記錄著 .dirty 的就不是正式安裝存的，原始碼不在任何 commit 裡（D-155 第 5 點）。
  if (release.build.endsWith('.dirty')) throw Error(`${version} 的建置是 .dirty，不能定位`);
  if (!release.sha256['main.js.map']) throw Error(`${version} 沒有保存對照表（D-155 之前裝的版本）`);
  for (const name of ['main.js', 'main.js.map']) {
    const bytes = await readFile(join(folder, name)).catch(() => { throw Error(`${folder} 沒有 ${name}`); });
    if (hashBytes(new Uint8Array(bytes)) !== release.sha256[name]) throw Error(`${folder} 的 ${name} 和 release.json 記的雜湊不同，不能定位`);
  }
  const payload = JSON.parse(await readFile(join(folder, 'main.js.map'), 'utf8')) as SourceMapPayload & { sourcesContent?: (string | null)[] };
  const map = new SourceMap(payload);
  // 產物裡每一行的長度：超出範圍的位置 findEntry 會沿用前一個對應，看起來像對到了（Codex L2 的 R4）。
  // 行尾的換行字元不算進行長，CRLF 的產物和 LF 的邊界一樣（再審的 F4）。
  const code = (await readFile(join(folder, 'main.js'), 'utf8')).split(/\r?\n/);
  return positions.map(position => {
    const match = /(\d+):(\d+)\)?\s*$/.exec(position);
    const line = match ? Number(match[1]) : 0, column = match ? Number(match[2]) : 0;
    if (line < 1 || column < 1) throw Error(`位置要寫 stack 裡的「行:欄」（1 起算）：${position}`);
    const length = code[line - 1 - OFFSET.line]?.length;
    if (length === undefined || column - OFFSET.column > length) throw Error(`${position} 超出 main.js 的範圍（${String(code.length)} 行${length === undefined ? '' : `，第 ${String(line)} 行 ${String(length)} 個字`}），對不上`);
    const entry = map.findEntry(line - 1 - OFFSET.line, column - 1 - OFFSET.column);
    if (!('originalSource' in entry)) throw Error(`${position} 在對照表裡找不到對應的原始碼`);
    const index = payload.sources.findIndex(source => source === entry.originalSource || entry.originalSource.endsWith('/' + source));
    const text = (index >= 0 ? payload.sourcesContent?.[index] ?? '' : '').split(/\r?\n/)[entry.originalLine] ?? '';
    // Node 的 findEntry 有回 name，@types/node 的 SourceMapping 沒寫。
    const name = (entry as { name?: unknown }).name;
    return {
      position, source: index >= 0 ? payload.sources[index] : entry.originalSource, line: entry.originalLine + 1, column: entry.originalColumn + 1,
      ...typeof name === 'string' && name ? { name } : {}, text: text.trim(),
    };
  });
}

if (import.meta.main) {
  const [version, ...positions] = process.argv.slice(2);
  if (!version || !positions.length) {
    console.error('用法：npm run locate -- <版號> <行:欄> [<行:欄>…]（錯誤紀錄的 stack，例如 1:20345）');
    process.exitCode = 1;
  } else {
    try {
      for (const found of await locate(version, positions)) {
        console.log(`${found.position} → ${found.source}:${String(found.line)}:${String(found.column)}${found.name ? '（' + found.name + '）' : ''}\n    ${found.text}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
