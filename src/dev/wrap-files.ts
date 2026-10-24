import type { Files } from '../core/files.ts';

/** 計算每個 Files 方法被呼叫的次數；T12 用它確認 onLayoutReady 之前沒有碰檔案（W5 說明 §4-1）。 */
export function countFiles(files: Files): { files: Files; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    files: {
      list: folder => { calls++; return files.list(folder); },
      read: path => { calls++; return files.read(path); },
      modify: (path, edit) => { calls++; return files.modify(path, edit); },
      append: (path, line) => { calls++; return files.append(path, line); },
      watch: onChange => { calls++; return files.watch(onChange); },
    },
  };
}

/**
 * 只看得到 root 資料夾的 Files：裡面的 `root/Essence Cards/…` 在這裡就是 `Essence Cards/…`。
 * 開發命令 open 用它對 `Essence W5/量測/` 建一個 state，不碰真的 `Essence Cards/`。
 */
export function scopedFiles(files: Files, root: string): Files {
  const prefix = root.replace(/\/$/, '') + '/';
  const inner = (path: string): string => prefix + path;
  return {
    list: async folder => (await files.list(folder === '' ? prefix.slice(0, -1) : inner(folder))).map(path => path.slice(prefix.length)),
    read: path => files.read(inner(path)),
    modify: (path, edit) => files.modify(inner(path), edit),
    append: (path, line) => files.append(inner(path), line),
    watch: onChange => files.watch(path => { if (path.startsWith(prefix)) onChange(path.slice(prefix.length)); }),
  };
}
