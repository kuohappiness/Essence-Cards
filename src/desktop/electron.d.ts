// Obsidian 電腦版在 renderer 提供的 Electron（D-148）：只宣告外掛用到的部分。
declare module 'electron' {
  export const shell: {
    /** 用系統的檔案總管打開；成功回傳空字串，失敗回傳原因。 */
    openPath(path: string): Promise<string>;
  };
  /** @electron/remote；Obsidian 電腦版有，叫不到時是 undefined。 */
  export const remote: {
    dialog: {
      showOpenDialog(options: { title?: string; defaultPath?: string; properties: string[] }): Promise<{ canceled: boolean; filePaths: string[] }>;
    };
  } | undefined;
}
