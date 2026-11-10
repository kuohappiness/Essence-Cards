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
  /**
   * 一次讀、改、寫；不存在時以 edit('', false) 建立含上層資料夾；內容不變時不寫入。exists 是讀的那一刻檔案在不在：
   * 零位元組的檔是 edit('', true)，建新檔的一方靠它不蓋掉讀與寫之間才出現的空檔（tasks/quiz-mark.md L2 R2）。
   * edit 可能被呼叫不只一次，以最後一次為準：要先建上層資料夾時，建好之後再問一次（AI 製卡的 R3-2），所以 edit 不能有累積的副作用；丟錯就不建。
   */
  modify(path: string, edit: (text: string, exists: boolean) => string): Promise<void>;
  /** 追加 line 與換行；不存在時建立含上層資料夾。 */
  append(path: string, line: string): Promise<void>;
  /**
   * 原樣寫入位元組（還原用，tasks/plugin-restore.md §3-3）：和 modify、append 同一個同路徑的隊伍。讀現在的原始位元組交給 check（不存在是 null），
   * 不通過回 false、不寫；通過就寫入 bytes，不轉換編碼與換行，不存在時建立含上層資料夾，回 true。讀與寫之間沒有鎖（只有這兩步之間的空檔）。
   */
  replace(path: string, check: (now: Uint8Array | null) => boolean, bytes: Uint8Array): Promise<boolean>;
  /** 新增、修改、刪除、改名通知；改名通知舊新路徑；回傳取消監看的函式。 */
  watch(onChange: (path: string) => void): () => void;
}
