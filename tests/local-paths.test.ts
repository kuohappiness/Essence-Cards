import test from 'node:test';
import assert from 'node:assert/strict';
import { findLocalPaths, genericRules, localRules } from '../tools/check-local-paths.ts';

// 第二次里程碑檢查 R5：repo 公開，本機的帳號名、iCloud 路徑、vault 名稱不能進 repo。
// 會被擋的例子用拼接寫，這個檔本身才不會被同一條檢查擋下；名字都是自編的。
const bs = '\\';
const win = (...parts: string[]) => parts.join(bs);

void test('R5 通用規則：Windows、Git Bash、macOS、Linux 的使用者資料夾與 iCloud 雲碟的完整路徑都擋', () => {
  const rules = genericRules();
  for (const text of [
    'C:' + bs + win('Users', 'alice', 'AppData', 'x.txt'),
    'c:/' + 'Users/alice/x',
    'C:' + bs + bs + 'Users' + bs + bs + 'alice' + bs + bs + 'x', // JSON 裡的雙反斜線
    '`/c/' + 'Users/alice/AppData`',
    'node /' + 'home/alice/x.mjs',
    '(/' + 'Users/alice/Library)',
    '/mnt/c/' + 'Users/alice/x',
    'D:' + bs + win('雲端', 'iCloud' + 'Drive', 'v'),
    'E:/' + 'Sync/iCloud ' + 'Drive/v',
  ]) assert.equal(findLocalPaths(text, rules).length, 1, text);
});

void test('R5 通用規則不誤擋：佔位字、環境變數、範例名、CI 的 runner、網址與相對路徑', () => {
  const rules = genericRules();
  for (const text of [
    String.raw`C:\Users\<帳號>\AppData\Local\Temp`,
    String.raw`C:\Users\someone\AppData\Local\Packages`,
    String.raw`C:\Users\%USERNAME%\x`,
    String.raw`C:\Users\$env:USERNAME\x`,
    String.raw`C:\Users\Public\Desktop`,
    String.raw`%USERPROFILE%\iCloudDrive\Essence 防呆測試`,
    String.raw`<iCloud 根目錄>\iCloud~md~obsidian`,
    String.raw`iCloudDrive\Essence 防呆測試`,
    '/home/runner/work/x',
    '/home/someone/.local/share',
    'https://example.com/home/alice/page',
    'https://example.com/Users/alice',
    'src/Users/alice.ts',
    '~/Library/Mobile Documents/iCloud~md~obsidian',
  ]) assert.deepEqual(findLocalPaths(text, rules), [], text);
});

void test('R5 回報行與欄，不印出找到的值', () => {
  const found = findLocalPaths('第一行\n路徑在 /' + 'home/alice/x\n', genericRules());
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
  assert.equal(found[0].column, 5);
  assert.doesNotMatch(found[0].why, /alice/);
});

void test('R5 本機規則：家目錄、帳號名、Obsidian 登錄的 vault 路徑與名稱都擋，測試 vault 的名稱不擋', () => {
  const home = win('X:', 'Profiles', 'zed');
  const root = win('Q:', '雲', 'Sync');
  const rules = localRules({
    home,
    user: 'zed',
    vaults: [win(root, 'Ivy Notes'), win(root, 'Box Test'), '/srv/notes/Plain'],
    testVaults: [win(root, 'Box Test')],
  });
  for (const text of [
    home + bs + 'x',
    home.replaceAll(bs, '/') + '/x',
    win(root, 'Ivy Notes', 'a.md'),
    win(root, 'Ivy Notes').replaceAll(bs, bs + bs),
    '正式 vault 是 ivy notes。',
    '/srv/notes/Plain/a.md',
    '寫進 /' + 'opt/zed/cache',
  ]) assert.ok(findLocalPaths(text, rules).length > 0, text);
  for (const text of [
    '測試 vault 是 Box Test。',
    'Ivy Notesbook', // 只擋完整的名字
    'zedonk',
    'Plain text', // 名字是一個單字時太容易撞到一般文字，只擋完整路徑
    root, // vault 的上層不擋（可能是一般的開發資料夾）；iCloud 雲碟由通用規則擋
  ])assert.deepEqual(findLocalPaths(text, rules), [], text);
});

void test('R5 本機規則：拿不到的資訊就略過；CI 的 runner 這類範例名不當帳號擋', () => {
  assert.deepEqual(localRules({ home: '', user: '', vaults: [], testVaults: [] }), []);
  assert.deepEqual(localRules({ home: '/home/runner', user: 'runner', vaults: [], testVaults: [] }), []);
});
