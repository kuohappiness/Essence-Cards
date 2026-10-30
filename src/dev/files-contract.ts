import type { Files } from '../core/files.ts';

/**
 * Files 的契約檢查（W5 說明 §2 的 C1～C14；C15 是外掛架構檢查環節 1 的 T3；C16 是 tasks/error-log.md §4）。Node 的測試與 Obsidian 的開發命令跑同一份；
 * 改名與刪除不在 Files 介面裡，由兩邊各自提供（Node 用 node:fs，Obsidian 用 vault.rename、vault.delete）。
 */
export interface ContractOps {
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}
/** notice：等通知最多多久；quiet：確認「沒有通知」要等多久（毫秒）。 */
export interface ContractWait { notice: number; quiet: number }
export interface ContractResult { code: string; ok: boolean; detail?: string }

interface Context { files: Files; ops: ContractOps; dir: string; wait: ContractWait }
interface ContractCase { code: string; title: string; run(context: Context): Promise<void> }

class Failure extends Error {}
function expect(ok: boolean, detail: string): void { if (!ok) throw new Failure(detail); }
const show = (value: unknown): string => JSON.stringify(value);
function same(actual: unknown, expected: unknown, what: string): void {
  expect(show(actual) === show(expected), `${what}：預期 ${show(expected)}，實際 ${show(actual)}`);
}
const sleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

/** 監看期間收到的路徑；until 等到每個路徑都收到，逾時就失敗。 */
function record(files: Files, wait: ContractWait) {
  const events: string[] = [];
  const stop = files.watch(path => { events.push(path); });
  return {
    events, stop,
    async until(paths: string[], step: string): Promise<void> {
      const deadline = Date.now() + wait.notice;
      while (!paths.every(path => events.includes(path))) {
        expect(Date.now() < deadline, `${step}：${wait.notice} ms 內沒收到 ${show(paths.filter(path => !events.includes(path)))}，收到 ${show(events)}`);
        await sleep(10);
      }
    },
  };
}

async function rejects(action: () => Promise<unknown>, what: string): Promise<void> {
  let failed = false;
  try { await action(); } catch { failed = true; }
  expect(failed, what + ' 沒有丟出錯誤');
}

export const contractCases: readonly ContractCase[] = [
  {
    code: 'C1', title: 'list 遞迴、只列檔案、照字串排序、不含前綴相同的資料夾',
    async run({ files, dir }) {
      for (const path of ['a/x.md', 'a/c/d.jsonl', 'a/b.md', 'ab/z.md']) await files.modify(`${dir}/${path}`, () => 'x');
      same(await files.list(`${dir}/a`), [`${dir}/a/b.md`, `${dir}/a/c/d.jsonl`, `${dir}/a/x.md`], 'list');
    },
  },
  {
    code: 'C2', title: 'list 不存在的資料夾回傳 []',
    async run({ files, dir }) { same(await files.list(`${dir}/沒有`), [], 'list'); },
  },
  {
    code: 'C3', title: 'read 不存在的檔回傳 null',
    async run({ files, dir }) { same(await files.read(`${dir}/沒有.md`), null, 'read'); },
  },
  {
    code: 'C4', title: 'read 原樣讀回中文、表情符號、\\r\\n 與沒有檔尾換行',
    async run({ files, dir }) {
      const text = '中文😀\r\n第二行';
      await files.modify(`${dir}/c4.md`, () => text);
      same(await files.read(`${dir}/c4.md`), text, 'read');
    },
  },
  {
    code: 'C5', title: 'modify 不存在的檔：建立上層資料夾，edit 收到空字串',
    async run({ files, dir }) {
      const got: string[] = [];
      await files.modify(`${dir}/n/m/新.md`, text => { got.push(text); return 'x'; });
      same(got, [''], 'edit 收到');
      same(await files.read(`${dir}/n/m/新.md`), 'x', 'read');
    },
  },
  {
    code: 'C6', title: 'modify 的 edit 回傳原文時不寫入',
    async run({ files, dir, wait }) {
      const path = `${dir}/same.md`;
      await files.modify(path, () => 'same');
      const watch = record(files, wait);
      try {
        await files.modify(path, text => text);
        await sleep(wait.quiet);
        expect(!watch.events.includes(path), `內容沒變卻收到修改通知：${show(watch.events)}`);
        // 確認監看本身有效，上面的「沒有通知」才算數。
        await files.modify(path, text => text + '!');
        await watch.until([path], '內容變了');
      } finally { watch.stop(); }
      same(await files.read(path), 'same!', 'read');
    },
  },
  {
    code: 'C7', title: '同一個檔同時兩次 modify，兩次的修改都在',
    async run({ files, dir }) {
      const path = `${dir}/c7.md`;
      await files.modify(path, () => 'base');
      await Promise.all([files.modify(path, text => text + 'a'), files.modify(path, text => text + 'b')]);
      same(await files.read(path), 'baseab', 'read');
    },
  },
  {
    code: 'C8', title: 'edit 丟出錯誤：modify reject、檔案不變，下一次照常',
    async run({ files, dir }) {
      const path = `${dir}/c8.md`;
      await files.modify(path, () => 'before');
      await rejects(() => files.modify(path, () => { throw Error('停止'); }), 'edit 丟錯時 modify');
      same(await files.read(path), 'before', '丟錯之後');
      await files.modify(path, text => text + ' after');
      same(await files.read(path), 'before after', '下一次 modify');
    },
  },
  {
    code: 'C9', title: 'append 不存在的檔：建立上層資料夾，加上換行',
    async run({ files, dir }) {
      await files.append(`${dir}/p/q.jsonl`, 'l1');
      same(await files.read(`${dir}/p/q.jsonl`), 'l1\n', 'read');
    },
  },
  {
    code: 'C10', title: 'append 不替原檔補換行',
    async run({ files, dir }) {
      const path = `${dir}/c10.jsonl`;
      await files.modify(path, () => 'abc');
      await files.append(path, 'l2');
      same(await files.read(path), 'abcl2\n', 'read');
    },
  },
  {
    code: 'C11', title: '不存在的檔同時 append 10 次，10 行照呼叫順序',
    async run({ files, dir }) {
      const path = `${dir}/c11.jsonl`;
      const lines = Array.from({ length: 10 }, (_, i) => 'line' + String(i));
      await Promise.all(lines.map(line => files.append(path, line)));
      same(await files.read(path), lines.map(line => line + '\n').join(''), 'read');
    },
  },
  {
    code: 'C12', title: 'watch 依序通知新增、修改、刪除，改名的舊新路徑，資料夾改名裡的每個檔',
    async run({ files, ops, dir, wait }) {
      await files.modify(`${dir}/f/1.md`, () => '1');
      const watch = record(files, wait);
      try {
        const step = async (name: string, action: () => Promise<void>, paths: string[]) => {
          watch.events.length = 0;
          await action();
          await watch.until(paths, name);
        };
        await step('新增', () => files.modify(`${dir}/a.md`, () => 'new'), [`${dir}/a.md`]);
        await step('修改', () => files.append(`${dir}/a.md`, 'more'), [`${dir}/a.md`]);
        await step('改名', () => ops.rename(`${dir}/a.md`, `${dir}/b.md`), [`${dir}/a.md`, `${dir}/b.md`]);
        await step('刪除', () => ops.remove(`${dir}/b.md`), [`${dir}/b.md`]);
        await step('資料夾改名', () => ops.rename(`${dir}/f`, `${dir}/g`), [`${dir}/f/1.md`, `${dir}/g/1.md`]);
        expect(watch.events.every(path => path.startsWith(dir + '/') && !path.includes('\\')), `通知的路徑不是 vault 相對的 / 路徑：${show(watch.events)}`);
      } finally { watch.stop(); }
      same(await files.read(`${dir}/g/1.md`), '1', '資料夾改名後 read');
    },
  },
  {
    code: 'C13', title: '取消監看之後沒有通知',
    async run({ files, dir, wait }) {
      const path = `${dir}/c13.md`;
      const watch = record(files, wait);
      await files.modify(path, () => 'on');
      await watch.until([path], '取消前');
      watch.stop();
      watch.events.length = 0;
      await files.modify(path, () => 'off');
      await files.append(path, 'more');
      await sleep(wait.quiet);
      same(watch.events, [], '取消後收到');
    },
  },
  {
    code: 'C14', title: '路徑是 ../x 或絕對路徑時丟出錯誤，不碰 vault 以外',
    async run({ files, dir }) {
      // 第二個從 dir 往上多退一層，剛好越過 vault 的根。
      const escape = `${dir}/${'../'.repeat(dir.split('/').length + 1)}x`;
      for (const path of ['../x', escape, '/x']) {
        await rejects(() => files.read(path), `read(${show(path)})`);
        await rejects(() => files.list(path), `list(${show(path)})`);
        await rejects(() => files.modify(path, () => 'x'), `modify(${show(path)})`);
        await rejects(() => files.append(path, 'x'), `append(${show(path)})`);
      }
    },
  },
  {
    // 外掛架構檢查環節 1 的 T3：Obsidian 刪資料夾時子檔各收不收得到通知，只在實機知道；只要求最後每個檔都通知過，不管次數。
    code: 'C15', title: '刪掉整個資料夾，裡面每個檔（含子資料夾）都收到通知，read 回 null',
    async run({ files, ops, dir, wait }) {
      const paths = [`${dir}/f/1.md`, `${dir}/f/sub/2.md`];
      for (const path of paths) await files.modify(path, () => 'x');
      const watch = record(files, wait);
      try {
        await ops.remove(`${dir}/f`);
        await watch.until(paths, '刪除資料夾');
      } finally { watch.stop(); }
      for (const path of paths) same(await files.read(path), null, `刪除資料夾後 read(${path})`);
    },
  },
  {
    // tasks/error-log.md §4：錯誤紀錄與複習紀錄同時第一次寫，會一起建 `紀錄/`（Codex 用替身重現，D-155 第 4 點）。
    code: 'C16', title: '不存在的資料夾裡同時 append 兩個不同的檔，兩個都成功、各一行',
    async run({ files, dir }) {
      const paths = [`${dir}/new/a.jsonl`, `${dir}/new/b.jsonl`];
      const results = await Promise.allSettled(paths.map(path => files.append(path, 'line')));
      same(results.map(result => result.status === 'rejected' ? String(result.reason) : result.status), ['fulfilled', 'fulfilled'], 'append');
      for (const path of paths) same(await files.read(path), 'line\n', `read(${path})`);
    },
  },
];

/** 跑一個例子；每個例子用 dir 底下自己代號的資料夾，彼此不共用檔案。 */
export async function runContractCase(item: ContractCase, files: Files, ops: ContractOps, dir: string, wait: ContractWait): Promise<ContractResult> {
  try {
    await item.run({ files, ops, dir: `${dir}/${item.code}`, wait });
    return { code: item.code, ok: true };
  } catch (error) {
    const detail = error instanceof Failure ? error.message : error instanceof Error ? error.stack ?? error.message : String(error);
    return { code: item.code, ok: false, detail };
  }
}

/** 依序跑 C1～C16；dir 要是空的（或不存在）。 */
export async function runFilesContract(files: Files, ops: ContractOps, dir: string, wait: ContractWait): Promise<ContractResult[]> {
  const results: ContractResult[] = [];
  for (const item of contractCases) results.push(await runContractCase(item, files, ops, dir, wait));
  return results;
}
