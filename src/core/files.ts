export interface Files {
  /** folder 底下所有檔案（含子資料夾），vault 相對路徑以 / 分隔並照字串排序；不存在時回傳 []。 */
  list(folder: string): Promise<string[]>;
  /** 不存在時回傳 null。 */
  read(path: string): Promise<string | null>;
  /**
   * 原始位元組（不轉換換行或編碼，備份用，syntax §8）；不存在時回傳 null。讀不到（沒有權限、iCloud 雲端佔位檔）就丟錯，
   * 原本的錯誤照樣丟出，呼叫的一方才寫得出是哪個檔、什麼原因（D-154）。
   */
  readBytes(path: string): Promise<Uint8Array | null>;
  /** 一次讀、改、寫；不存在時以 edit('') 建立含上層資料夾；內容不變時不寫入。 */
  modify(path: string, edit: (text: string) => string): Promise<void>;
  /** 追加 line 與換行；不存在時建立含上層資料夾。 */
  append(path: string, line: string): Promise<void>;
  /** 新增、修改、刪除、改名通知；改名通知舊新路徑；回傳取消監看的函式。 */
  watch(onChange: (path: string) => void): () => void;
}
