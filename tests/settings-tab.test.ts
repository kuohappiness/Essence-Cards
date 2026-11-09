import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createObsidianStub, type FakeEl, type FakeSetting, type StubOptions } from './helpers/obsidian.ts';
import { desktopOnly, embedRules } from '../tools/build.mjs';

// 設定分頁與 main 的接線（tasks/settings-page.md §5、§7 第 24～29 點）：正式建置的程式碼配 obsidian 替身，只測接線，真的畫面在 Windows 實機（§8）。

const root = fileURLToPath(new URL('../', import.meta.url));
const code = (await build({
  absWorkingDir: root, entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', plugins: [desktopOnly(root)],
  external: ['obsidian', '@codemirror/state', '@codemirror/view'], write: false, define: { 'process.env.NODE_ENV': '"production"', DEV: 'false', BUILD: '"0.0.1+test"', CARD_RULES: JSON.stringify(JSON.stringify(await embedRules(root))) },
})).outputFiles[0].text;

const deck = { 'Essence Cards/a.md': '---\n年級學期: 國二上\n科目: 自然\n單元: "1"\n---\n- 目標 ^aaaaaa\n    - Q :: A\n' };
interface StateLike { ready(): Promise<unknown>; currentSettings(): { settings: { capMinutes: number }; known: boolean }; today(): object }
interface PluginLike { onload(): void; onunload(): void; onExternalSettingsChange(): void; state: StateLike | null }
interface TabLike { containerEl: FakeEl; display(): void }

function quiet(t: TestContext): void {
  const original = console.error;
  console.error = () => {};
  t.after(() => { console.error = original; });
}
const settle = async (): Promise<void> => { for (let i = 0; i < 12; i++) await new Promise<void>(resolve => { setImmediate(resolve); }); };

async function open(t: TestContext, options: Omit<StubOptions, 'texts'> = {}) {
  quiet(t);
  const stub = createObsidianStub({ ...options, texts: deck });
  const { default: Plugin } = stub.load<{ default: new (app: unknown, manifest: unknown) => PluginLike }>(code);
  const plugin = new Plugin(stub.app, { id: 'essence-cards', version: '0.0.1' });
  t.after(() => { plugin.onunload(); });
  plugin.onload();
  const beforeReady = stub.data.loads;
  stub.layoutReady();
  await plugin.state?.ready();
  await settle();
  const tab = stub.settingTabs[0] as TabLike;
  tab.containerEl.shown = true;
  tab.display();
  await settle();
  const row = (name: string): FakeSetting => {
    const found = tab.containerEl.rows.find(item => item.name === name);
    assert.ok(found, '找不到這一列：' + name);
    return found;
  };
  return { ...stub, plugin, tab, row, beforeReady };
}
const CAP = '每日時間上限', RETENTION = '目標保持率', COUNTDOWN = '考試倒數', SEMESTER = '目前學期';

void test('選項與預設（D-104）', async t => {
  const { row } = await open(t);
  assert.deepEqual(row(CAP).dropdown?.options.map(option => option.label), ['5 分鐘', '10 分鐘', '15 分鐘', '20 分鐘', '30 分鐘', '45 分鐘', '60 分鐘', '75 分鐘', '90 分鐘']);
  assert.deepEqual(row(RETENTION).dropdown?.options.map(option => option.label), ['70%', '75%', '80%', '85%', '90%', '95%']);
  const semesters = row(SEMESTER).dropdown?.options.map(option => option.label) ?? [];
  assert.equal(semesters.length, 25);
  assert.equal(semesters[0], '未設定');
  assert.equal(semesters[1], '小一上');
  assert.equal(semesters[24], '高三下');
  assert.equal(row(CAP).dropdown?.value, '30');
  assert.equal(row(RETENTION).dropdown?.value, '0.8');
  assert.equal(row(SEMESTER).dropdown?.value, '');
  assert.equal(row(COUNTDOWN).toggle?.value, true);
});

void test('分區的順序：複習、學期、備份；文字不寫角色（D-156）', async t => {
  const { tab, row } = await open(t);
  assert.deepEqual(tab.containerEl.rows.filter(item => item.heading).map(item => item.name), ['複習', '學期', '備份']);
  const words = (el: FakeEl): string => el.text + el.children.map(words).join('');
  const all = tab.containerEl.rows.map(item => item.name + item.desc + words(item.nameEl) + words(item.descEl)).join('\n');
  assert.ok(!/給家長|學生/.test(all), all);
  assert.match(words(row(RETENTION).descEl), /預計還記得的比例/);
});

void test('改上限：存進 data.json、排程馬上照新的值；重開也是', async t => {
  const h = await open(t, { data: { foo: 1 } });
  h.row(CAP).dropdown?.choose('5');
  await settle();
  assert.deepEqual(h.data.content, { foo: 1, capMinutes: 5 });
  assert.equal(h.plugin.state?.currentSettings().settings.capMinutes, 5);
  assert.equal(h.row(CAP).dropdown?.value, '5');
});

void test('存過才有恢復預設；按了欄位不見、選單回到預設', async t => {
  const none = await open(t);
  for (const name of [CAP, RETENTION, COUNTDOWN]) assert.equal(none.row(name).extras.length, 0, name);

  const h = await open(t, { data: { capMinutes: 45, examCountdown: false } });
  assert.equal(h.row(CAP).extras.length, 1);
  assert.equal(h.row(COUNTDOWN).extras.length, 1);
  assert.equal(h.row(RETENTION).extras.length, 0);
  assert.equal(h.row(COUNTDOWN).toggle?.value, false);
  h.row(COUNTDOWN).extras[0].click();
  await settle();
  assert.deepEqual(h.data.content, { capMinutes: 45 });
  assert.equal(h.row(COUNTDOWN).toggle?.value, true);
  assert.equal(h.row(COUNTDOWN).extras.length, 0);
});

void test('選學期記下選的那一天；選未設定就刪掉', async t => {
  const h = await open(t);
  h.row(SEMESTER).dropdown?.choose('國二上');
  await settle();
  const saved = h.data.content as { semester: string; semesterSetOn: string };
  assert.equal(saved.semester, '國二上');
  assert.match(saved.semesterSetOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(h.row(SEMESTER).dropdown?.value, '國二上');
  h.row(SEMESTER).dropdown?.choose('');
  await settle();
  assert.deepEqual(h.data.content, {});
});

void test('寫不進去（saveData 吞掉錯誤）：有通知、選單回到實際的值', async t => {
  const h = await open(t, { data: { capMinutes: 45 }, failSave: true });
  const dropdown = h.row(CAP).dropdown;
  dropdown?.choose('60');
  await settle();
  assert.ok(h.notices.includes('Essence Cards：設定暫時寫不進去，這次沒有存下，請再試一次'), h.notices.join('、'));
  assert.equal(h.row(CAP).dropdown?.value, '45');
  assert.notEqual(h.row(CAP).dropdown, dropdown, '重畫過');
});

void test('寫前讀不到：不寫、有通知', async t => {
  const h = await open(t, { data: { capMinutes: 45 } });
  h.data.content = undefined;
  h.row(CAP).dropdown?.choose('60');
  await settle();
  assert.equal(h.data.saves, 0);
  assert.ok(h.notices.includes('Essence Cards：設定暫時讀不到，這次沒有存下，請再試一次'), h.notices.join('、'));
  assert.equal(h.row(CAP).dropdown?.value, '45');
});

void test('layout ready 之前沒有讀 data.json（T12）', async t => {
  const h = await open(t);
  assert.equal(h.beforeReady, 0);
  assert.ok(h.data.loads >= 1);
});

/** 只跑到 onload，還沒 layout ready。 */
function loadedOnly(t: TestContext, data: unknown) {
  quiet(t);
  const stub = createObsidianStub({ data, texts: deck });
  const { default: Plugin } = stub.load<{ default: new (app: unknown, manifest: unknown) => PluginLike }>(code);
  const plugin = new Plugin(stub.app, { id: 'essence-cards', version: '0.0.1' });
  t.after(() => { plugin.onunload(); });
  plugin.onload();
  return { ...stub, plugin, tab: stub.settingTabs[0] as TabLike };
}

void test('layout ready 之前在設定頁操作：不讀不寫，有通知（L2 F2）', async t => {
  const h = loadedOnly(t, { capMinutes: 45 });
  h.tab.containerEl.shown = true;
  h.tab.display();
  h.tab.containerEl.rows.find(item => item.name === CAP)?.dropdown?.choose('5');
  await settle();
  assert.deepEqual([h.data.loads, h.data.saves], [0, 0]);
  assert.deepEqual(h.data.content, { capMinutes: 45 });
  assert.ok(h.notices.includes('Essence Cards：設定暫時讀不到，這次沒有存下，請再試一次'), h.notices.join('、'));
});

void test('外掛停用之後：還沒開始的存檔不做，不跳通知（L2 F3）', async t => {
  const h = await open(t, { data: { capMinutes: 45 } });
  const dropdown = h.row(CAP).dropdown;
  dropdown?.choose('60');
  dropdown?.choose('75');
  h.plugin.onunload();
  const before = h.notices.length;
  await settle();
  assert.equal(h.data.saves <= 1, true, '最多是停用前已經開始的那一筆');
  assert.notEqual((h.data.content as { capMinutes: number }).capMinutes, 75);
  assert.equal(h.notices.length, before);
});

void test('手機回到前景時重讀，電腦不多讀', async t => {
  const phone = await open(t, { data: { capMinutes: 45 } });
  phone.data.content = { capMinutes: 60 };
  phone.show();
  await settle();
  assert.equal(phone.plugin.state?.currentSettings().settings.capMinutes, 60);

  const desktop = await open(t, { desktop: true });
  const loads = desktop.data.loads;
  desktop.show();
  await settle();
  assert.equal(desktop.data.loads, loads);
});

void test('外部改了 data.json：值變了才重排，內容相同不重排；打開設定頁也重讀', async t => {
  const h = await open(t, { data: { capMinutes: 45 } });
  const before = h.plugin.state?.today();
  h.plugin.onExternalSettingsChange();
  await settle();
  assert.equal(h.plugin.state?.today(), before);
  h.data.content = { capMinutes: 60 };
  h.plugin.onExternalSettingsChange();
  await settle();
  assert.equal(h.plugin.state?.currentSettings().settings.capMinutes, 60);
  assert.notEqual(h.plugin.state?.today(), before);
  assert.equal(h.row(CAP).dropdown?.value, '60', '開著的設定頁跟著變');
  h.data.content = { capMinutes: 75 };
  h.tab.display();
  await settle();
  assert.equal(h.plugin.state?.currentSettings().settings.capMinutes, 75);
  assert.equal(h.row(CAP).dropdown?.value, '75');
});
