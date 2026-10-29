import { formatTime } from '../study/index.ts';

// 和 state/device.ts 的 isDeviceCode 相同的裝置碼（tests/backup-core.test.ts 檢查兩邊一致）。
const DEVICE = '(?:iPhone|iPad|Android|Windows|Mac|Linux|Device)-[0-9a-f]{4}';
const RESTORE_SUFFIX = new RegExp(' 還原 \\d{4}-\\d{2}-\\d{2}(?:-[1-9]\\d*)? ' + DEVICE + '$');
/** 建置版本 BUILD 的寫法（tools/build.mjs）：manifest 的版本，在 git 裡建置時加 `+commit`，有未提交的修改再加 `.dirty`。 */
const BUILD_PATTERN = /^\d+\.\d+\.\d+(?:\+[0-9a-f]{4,40}(?:\.dirty)?)?$/;

/**
 * 從 main.js 讀建置版本與是不是開發版。tools/build.mjs 在第一行寫 `/*! Essence Cards build=… dev=… *\/`；
 * 在那之前的建置沒有這一行，從「版本」命令的文字找 BUILD，dev 是 null（不知道）。都找不到時 build 是 null。
 */
export function readBuild(mainJs: string): { build: string | null; dev: boolean | null } {
  const banner = /^\/\*! Essence Cards build=(\S+) dev=(true|false) \*\//.exec(mainJs);
  if (banner && BUILD_PATTERN.test(banner[1])) return { build: banner[1], dev: banner[2] === 'true' };
  const notice = /"Essence Cards(?:\\uFF1A|：)(\d+\.\d+\.\d+(?:\+[0-9a-f]{4,40}(?:\.dirty)?)?)"/.exec(mainJs);
  return { build: notice ? notice[1] : null, dev: null };
}

/**
 * 備份檔名（syntax §8）：`Essence Cards 備份 <日期> <時分秒> <BUILD> <隨機 4 碼>.zip`。時間是開始備份的當地時間；
 * BUILD 讀不出來寫「未知」。random 是 4 個 0-9a-f。
 */
export function backupName(started: number, offset: number, build: string | null, random: string): string {
  const time = formatTime(started, offset);
  const known = build !== null && BUILD_PATTERN.test(build) ? build : '未知';
  return `Essence Cards 備份 ${time.slice(0, 10)} ${time.slice(11, 19).replaceAll(':', '')} ${known} ${random}.zip`;
}

/**
 * 紀錄檔（`紀錄/` 直接底下的 .jsonl）的來源：去掉 .jsonl；還原檔只去掉最後完整的「 還原 <日期> <裝置碼>」，
 * 衝突副本的 ` 2` 這類尾巴留著（syntax §5-3）。
 */
export function logSource(name: string): string {
  const stem = name.endsWith('.jsonl') ? name.slice(0, -'.jsonl'.length) : name;
  return stem.replace(RESTORE_SUFFIX, '');
}

/**
 * 還原檔名（syntax §5-3）：`<來源> 還原 <日期> <裝置碼>.jsonl`；同一天、同一個來源、同一台已經有了（taken，
 * 照目的地的檔名規則比）就在日期後面加 -2、-3…，不覆寫。
 */
export function restoreLogName(source: string, date: string, device: string, taken: (name: string) => boolean): string {
  for (let n = 1; ; n++) {
    const name = `${source} 還原 ${date}${n === 1 ? '' : '-' + n} ${device}.jsonl`;
    if (!taken(name)) return name;
  }
}
