/**
 * 開發命令刪掉測試建的資料夾時用的接點（Codex L2 再審的 S1）：Obsidian 的快取裡有沒有、磁碟上有沒有、刪掉一個路徑、等一段時間。
 * remove 的 cached 是 true 時經 Obsidian 刪（vault.delete），false 時直接刪磁碟（快取還沒發現 iCloud 放回來的檔）。
 */
export interface CleanupIo {
  cached(path: string): boolean;
  exists(path: string): Promise<boolean>;
  remove(path: string, cached: boolean): Promise<void>;
  wait(ms: number): Promise<void>;
}

/**
 * 刪掉 paths，回傳最後還在的路徑。iCloud 偶爾會把剛刪的檔放回來（2026-10-27 的 T3、10-28 的 a3check 各一次），
 * 留下來就會變成 iPhone 上的卡組，所以：快取或磁碟任一邊還有就算還在；刪完等 settle 毫秒再看，最多 rounds 輪。
 * 只代表這段觀察時間裡的狀態，不保證之後不會再被同步回來。一開始就兩邊都沒有時不等。
 */
export async function removePaths(io: CleanupIo, paths: readonly string[], { rounds = 3, settle = 3000 } = {}): Promise<string[]> {
  const left = async (): Promise<string[]> => {
    const found = await Promise.all(paths.map(async path => io.cached(path) || await io.exists(path)));
    return paths.filter((_, i) => found[i]);
  };
  for (let round = 0; round < rounds; round++) {
    const now = await left();
    if (!now.length) return [];
    for (const path of now) await io.remove(path, io.cached(path));
    await io.wait(settle);
  }
  return left();
}
