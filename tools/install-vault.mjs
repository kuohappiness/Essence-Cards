import { main } from './install.ts';

// 擋法寫在安裝命令本身（D-149 第 4 點）：開發版只裝登錄過的測試 vault，其他 vault 只裝正式版（tools/install.ts）。
await main(process.argv.slice(2));
