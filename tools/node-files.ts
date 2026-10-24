import { watch as watchFs, mkdirSync, readdirSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Files } from '../src/core/files.ts';

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

export function createNodeFiles(root: string): Files {
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
            for (const entry of readdirSync(path, { withFileTypes: true })) {
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
      const watcher = watchFs(base, { recursive: true }, (event, filename) => {
        // 重新列出 rename 前後的檔案，也能通知資料夾改名內的舊、新路徑。
        if (event === 'rename' || filename === null) {
          // Windows 列刪除中的資料夾會回 EPERM；回呼裡丟錯會變成未攔截的例外。
          // 保留上一次的清單，下一次通知再比對，期間的變動不會漏掉。
          let now: Set<string>;
          try { now = snapshot(); } catch { return; }
          const changed = new Set([...known].filter(path => !now.has(path)));
          for (const path of now) if (!known.has(path)) changed.add(path);
          const named = filename?.toString().split(sep).join('/');
          if (named && (known.has(named) || now.has(named))) changed.add(named);
          known = now;
          for (const path of changed) onChange(path);
        } else {
          const path = filename.toString().split(sep).join('/');
          if (known.has(path)) onChange(path);
        }
      });
      return () => watcher.close();
    },
  };
}
