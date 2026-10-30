import { watch as watchFs, mkdirSync, readdirSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Files } from '../src/core/files.ts';

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

/**
 * seams 只給測試換掉監看用的列資料夾與 fs.watch。不要改全域的 node:fs：Linux 上 Node 自己的遞迴監看也呼叫
 * fs.readdirSync，換掉它會打到 Node 內部（2026-10 CI 連續失敗三天，第一個里程碑回顧的 R1）。
 */
export function createNodeFiles(root: string, seams: { readdirSync?: typeof readdirSync; watch?: typeof watchFs } = {}): Files {
  const { readdirSync: listSync = readdirSync, watch: watchTree = watchFs } = seams;
  const base = resolve(root);
  const pending = new Map<string, Promise<void>>();
  function location(path: string): string {
    const absolute = resolve(base, path);
    const rel = relative(base, absolute);
    if (isAbsolute(path) || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
      throw Error('檔案路徑必須位於 vault 內');
    }
    return absolute;
  }
  const portable = (path: string): string => relative(base, path).split(sep).join('/');
  async function read(path: string): Promise<string | null> {
    try { return await readFile(path, 'utf8'); }
    catch (error) { if (missing(error)) return null; throw error; }
  }
  // 同一個實作中的 modify / append 共用佇列，避免相互蓋掉尚未寫完的內容。
  function serial(path: string, action: () => Promise<void>): Promise<void> {
    // 只正規化排隊的身分，實際開檔路徑不動；不同檔案頂多多排隊。
    const key = path.normalize('NFC').toLowerCase();
    const next = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
    pending.set(key, next);
    void next.finally(() => { if (pending.get(key) === next) pending.delete(key); }).catch(() => {});
    return next;
  }
  return {
    async list(folder) {
      const found: string[] = [];
      async function visit(path: string): Promise<void> {
        let entries;
        try { entries = await readdir(path, { withFileTypes: true }); }
        catch (error) { if (missing(error)) return; throw error; }
        for (const entry of entries) {
          const child = resolve(path, entry.name);
          if (entry.isDirectory()) await visit(child);
          else if (entry.isFile()) found.push(portable(child));
        }
      }
      await visit(location(folder));
      return found.sort();
    },
    read(path) { return read(location(path)); },
    async readBytes(path) {
      try { return new Uint8Array(await readFile(location(path))); }
      catch (error) { if (missing(error)) return null; throw error; }
    },
    modify(path, edit) {
      const file = location(path);
      return serial(file, async () => {
        const old = await read(file);
        const next = edit(old ?? '');
        if (old === next) return;
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, next, 'utf8');
      });
    },
    append(path, line) {
      const file = location(path);
      return serial(file, async () => {
        await mkdir(dirname(file), { recursive: true });
        await appendFile(file, line + '\n', 'utf8');
      });
    },
    watch(onChange) {
      mkdirSync(base, { recursive: true });
      function snapshot(): Set<string> {
        const files = new Set<string>();
        function visit(path: string): void {
          try {
            for (const entry of listSync(path, { withFileTypes: true })) {
              const child = resolve(path, entry.name);
              if (entry.isDirectory()) visit(child);
              else if (entry.isFile()) files.add(portable(child));
            }
          } catch (error) { if (!missing(error)) throw error; }
        }
        visit(base);
        return files;
      }
      let known = snapshot();
      // 列資料夾暫時失敗後的重新比對（Codex 審查 W5 的 F4）：不能只等下一次通知，那可能永遠不來。
      let retry: ReturnType<typeof setTimeout> | null = null;
      let wait = 50;
      const named = new Set<string>();
      // 收到沒有檔名的事件：不知道哪一篇的內容改了，下一次比對成功時已知的檔全部通知重讀（T2）。
      let everything = false;
      /** 和上一次的清單比對，通知不同的路徑；暫時列不到時保留舊清單與要重讀的路徑，稍後自己再比一次。 */
      function rescan(): void {
        let now: Set<string>;
        try { now = snapshot(); } catch (error) {
          // Windows 列刪除中的資料夾會回 EPERM；回呼裡丟錯會變成未攔截的例外。其他錯誤照舊丟出。
          if (!['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          if (retry === null) retry = setTimeout(() => { retry = null; rescan(); }, wait);
          wait = Math.min(1000, wait * 2);
          return;
        }
        wait = 50;
        const changed = new Set([...known].filter(path => !now.has(path)));
        for (const path of now) if (!known.has(path)) changed.add(path);
        for (const path of named) if (known.has(path) || now.has(path)) changed.add(path);
        if (everything) for (const path of now) changed.add(path);
        named.clear();
        everything = false;
        known = now;
        for (const path of changed) onChange(path);
      }
      const watcher = watchTree(base, { recursive: true }, (event, filename) => {
        // 重新列出 rename 前後的檔案，也能通知資料夾改名內的舊、新路徑。
        if (event === 'rename' || filename === null) {
          if (filename) named.add(filename.toString().split(sep).join('/'));
          else everything = true;
          rescan();
        } else {
          const path = filename.toString().split(sep).join('/');
          if (known.has(path)) onChange(path);
        }
      });
      return () => {
        if (retry !== null) clearTimeout(retry);
        retry = null;
        watcher.close();
      };
    },
  };
}
