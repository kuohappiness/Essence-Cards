// npm run knip：knip 的解析器一次預留約 6 GB 記憶體，電腦可用的記憶體不夠時報 `RangeError: Array buffer allocation failed`
// （2026-10-27 W6 合併時遇到）。關掉 raw transfer 改走一般的傳遞方式，檢查項目不變；寫在這裡，不必每次 commit 失敗再手動加。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const knip = fileURLToPath(new URL('../node_modules/knip/bin/knip.js', import.meta.url));
const result = spawnSync(process.execPath, [knip, ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, KNIP_DISABLE_RAW_TRANSFER: '1' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
