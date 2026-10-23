// 所有材料與回覆都是自行編寫；不連網、不讀私人教材或真實金鑰。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ROOT, exists } from './core.mjs';
import { buildPrompt, buildUser, snapshot, cleanCommit, runScreen } from './screen.mjs';
import { normalize, hash, readText, readJSON, category, inspect, blind, blindText, abilities, validateScore, report, metrics, newCode } from './screen-analysis.mjs';
import { ApiClient } from './api.mjs';

async function inventory(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) files.push(...(e.isDirectory() ? await inventory(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  return files;
}
async function put(file, text) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); }

const OUTPUT = `> [!note] 給家長的備註
> - 計算題建議另外練習，不做成卡片

## 分類

- 能辨認範例的方向
    - 出處：p.1｜類型：定義｜重要性：高
    - 圖中箭頭朝哪裡？ ![[前.png]] :: **上方** ![[答案.png]]
        - ![[後.png]]
        - 提示是背面補充
- 能說出範例的顏色
    - 出處：p.1｜類型：定義
    - 範例是==藍色==
- 能逐項列出範例
    - 出處：p.1｜類型：定義
    - 有哪些範例？ ::
        - 甲
        - 乙
- 能看見缺答的例子
    - 出處：p.1｜類型：定義
    - 缺答的問題？ ::

## 延伸

- 能辨認另一個例子
    - 出處：p.1｜類型：定義
    - 另一個例子是什麼？ :: 丙
    - 記憶錨點：共同補充

> [!note] 加進已有的學習目標
> - q8z3ka 能說明原有範例
>     - 出處：p.1
>     - 原有的範例？ :: 已有內容不列

> [!note]- 候選卡片
> - 能記住候選內容
>     - 理由：不一定需要
>     - 出處：p.1｜類型：定義
>     - 候選題？ :: 候選答案不列
`;
const TRANSCRIPT = 'p.1 ^p1\n\n## 分類\n\n## 延伸\n\n![[前.png]]\n![[答案.png]]\n![[後.png]]\n';
const ABILITIES = '# 能力清單\n\n## 必須涵蓋的能力\n\n| 代號 | 能力 |\n|---|---|\n| K1 | 能辨認範例 |\n';

export async function selftest() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'essence-screen-'));
  let checks = 0;
  const pass = () => { checks++; };
  try {
    const actual = await readJSON(path.join(ROOT, 'screen/設定.json'));
    const brief = await buildPrompt(ROOT, actual, actual.materials['自然2-2'], '精簡指令');
    const full = await buildPrompt(ROOT, actual, actual.materials['自然2-2'], '完整規則');
    assert.deepEqual(brief.files.map(f => f.path), actual.groups['精簡指令']);
    assert.deepEqual(full.files.map(f => f.path), ['screen/格式.md', '../../docs/card-rules/common.md', '../../docs/card-rules/science.md', 'screen/完整規則.md']);
    assert(!brief.system.includes('{{') && !full.system.includes('{{'));
    const ending = '請先完整讀完上面的製卡規則，輸出前照通用規則最後的自我檢查逐項確認。';
    assert.equal((await readText(path.join(ROOT, 'screen/完整規則.md'))).replace(ending, ''), await readText(path.join(ROOT, 'screen/精簡指令.md')));
    const promptRoot = path.join(temp, 'prompts');
    await put(path.join(promptRoot, 'format.md'), '\uFEFF格式\r\n');
    await put(path.join(promptRoot, 'end.md'), '\uFEFF{{任務資料}}\r\n');
    const prompt = await buildPrompt(promptRoot, { groups: { A: ['format.md', 'end.md'] } }, { 任務資料: ['任務'] }, 'A');
    assert.equal(prompt.system, '格式\n\n任務');
    assert.equal(prompt.files[0].sha256, hash('格式\n'));
    await put(path.join(promptRoot, 'end.md'), '{{忘記替換}}');
    await assert.rejects(buildPrompt(promptRoot, { groups: { A: ['format.md', 'end.md'] } }, { 任務資料: [] }, 'A'), /變數/);
    pass();

    const out = path.join(temp, '結果'), source = path.join(temp, '來源/教材.md');
    await put(source, '\uFEFF' + TRANSCRIPT.replaceAll('\n', '\r\n'));
    for (const name of ['前.png', '答案.png', '後.png']) await put(path.join(temp, '來源/圖', name), 'fake PNG');
    const config = structuredClone(actual);
    for (const m of Object.values(config.materials)) { m['教材'] = null; m.checkSyntax = { subject: '自然', unit: '測試' }; }
    const modelConfig = await readJSON(path.join(ROOT, 'models.json'));
    const secret = 'FAKE_KEY_SCREEN_948e1a';
    const requests = [], printed = [];
    const deps = { root: ROOT, config, models: modelConfig, keys: { openai: secret },
      git: (...args) => args[0] === 'status' ? '' : 'test-commit', wait: async () => {}, now: () => 2000000000000,
      print: text => printed.push(text), fetch: async (_, request) => {
        requests.push(JSON.parse(request.body));
        assert.equal(request.headers.Authorization, `Bearer ${secret}`);
        assert.deepEqual(Object.keys(JSON.parse(request.body)).sort(), ['messages', 'model']);
        return new Response(JSON.stringify({ model: 'mock-snapshot-' + secret, system_fingerprint: 'fp-' + secret,
          choices: [{ finish_reason: 'stop', message: { content: OUTPUT } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }), { status: 200 });
      } };
    const materials = Object.fromEntries(Object.keys(config.materials).map(name => [name, source]));
    assert.deepEqual(await runScreen({ out, materials }, deps), { succeeded: 4, reused: 0, failed: 0 });
    assert.equal(requests.length, 4);
    assert.equal(JSON.stringify(requests[0].messages[1]), JSON.stringify(requests[1].messages[1]));
    assert.equal(JSON.stringify(requests[2].messages[1]), JSON.stringify(requests[3].messages[1]));
    assert.equal(requests[0].messages.length, 2);
    const snap = await snapshot(out, '自然2-2', null);
    const user = await buildUser(out, '自然2-2', snap);
    assert.equal(user.content[0].text, '教材全文：\n' + TRANSCRIPT);
    assert.equal(user.content.filter(p => p.type === 'image_url').length, 3);
    const allBefore = new Map(await Promise.all((await inventory(out)).map(async file => [file, hash(await fs.readFile(file))])));
    assert.deepEqual(await runScreen({ out }, deps), { succeeded: 0, reused: 4, failed: 0 });
    assert.equal(requests.length, 4);
    for (const [file, digest] of allBefore) assert.equal(hash(await fs.readFile(file)), digest, '重跑改了既有檔案');
    await put(source, TRANSCRIPT + '變更\n');
    await assert.rejects(runScreen({ out, materials }, deps), /新的 --out/);
    assert.equal(requests.length, 4);
    await put(source, TRANSCRIPT);
    await put(path.join(temp, '來源/圖/前.png'), 'changed PNG');
    await assert.rejects(runScreen({ out, materials }, deps), /新的 --out/);
    await put(path.join(temp, '來源/圖/前.png'), 'fake PNG');
    for (const dirty of [' M experiments/t4/screen/格式.md', ' M docs/card-rules/common.md'])
      assert.throws(() => cleanCommit(undefined, (...args) => args[0] === 'status' ? dirty : 'test-commit'), /未 commit/);
    assert.equal((await readJSON(path.join(out, '生成/自然2-2/精簡指令-1.送出.json'))).commit, 'test-commit');
    const metadata = await readJSON(path.join(out, '生成/自然2-2/精簡指令-1.回覆.json'));
    assert.equal(metadata.model, 'mock-snapshot-[已隱藏]');
    assert.equal(metadata.finish_reason, 'stop');
    const failedOut = path.join(temp, '失敗');
    const one = structuredClone(config); delete one.materials['熱的傳播'];
    const failDeps = { ...deps, config: one, fetch: async () => new Response('{"error":{"message":"bad"}}', { status: 500 }) };
    assert.equal((await runScreen({ out: failedOut, materials: { '自然2-2': source } }, failDeps)).failed, 2);
    assert(!(await exists(path.join(failedOut, '生成/自然2-2/精簡指令-1.md'))));
    assert.equal((await runScreen({ out: failedOut }, { ...deps, config: one })).succeeded, 2);
    const stringClient = new ApiClient(modelConfig, { openai: secret }, path.join(temp, '舊介面'), { ...deps, fetch: deps.fetch });
    await fs.mkdir(path.join(temp, '舊介面'));
    assert.equal(typeof await stringClient.request('test', config.model, 'x', [], 'legacy'), 'string');
    pass();

    const sampleIssues = [
      { level: '錯誤', code: 'anything' }, { level: '不符', code: 'yaml' },
      { level: '不符', code: 'simplified' }, { level: '不符', code: 'mainland-term' },
      { level: '不符', code: 'too-many-targets' }, { level: '不符', code: 'new-future-code' },
      { level: '提醒', code: 'anything' }
    ];
    assert.deepEqual(sampleIssues.map(category), ['格式錯誤', '格式錯誤', '用語', '用語', '不計', '規則類', '提醒']);
    const stats = await readJSON(path.join(out, '生成/自然2-2/精簡指令-1.統計.json'));
    assert.equal(stats.targets, 5); assert.equal(stats.questions, 5); assert.equal(stats.images, 3);
    assert.equal(stats.notes, 1); assert.equal(stats.candidates, 1); assert.equal(stats.existing, 1);
    assert.equal(stats.costUsd, (100 * 2 + 50 * 12) / 1e6);
    assert(stats.categories['格式錯誤'] > 0);
    assert.equal(Object.values(stats.formatCodes).reduce((a, b) => a + b, 0), stats.categories['格式錯誤']);
    // 實際 check 輸出也涵蓋另外四類。
    const noisy = Array.from({ length: 7 }, (_, i) => `- 能測試${i}\n    - 出處：p.1\n    - 是否测試？ :: 软件\n`).join('');
    const noisyStats = await inspect(path.join(temp, 'noise'), noisy, 'p.1 ^p1\n', {}, { usage: {}, seconds: 0 });
    for (const c of ['用語', '規則類', '提醒']) assert(noisyStats.categories[c] > 0, c);
    pass();

    await assert.rejects(blind(out, config, deps.print), /先寫能力清單/);
    for (const material of Object.keys(config.materials)) await put(path.join(out, '能力清單', material + '.md'), ABILITIES);
    const abilityHashes = await Promise.all(Object.keys(config.materials).map(async name => hash(await fs.readFile(path.join(out, '能力清單', name + '.md')))));
    assert.equal(await blind(out, config, deps.print), 4);
    const mapping = await readJSON(path.join(out, '生成/組別對照.json'));
    assert.equal(new Set(mapping.map(e => e.code)).size, 4);
    const used = new Set(); for (let i = 0; i < 1000; i++) assert(/^[A-HJ-NP-Z]{3}$/.test(newCode(used)));
    const normalized = await readText(path.join(out, '盲評', mapping[0].code + '.md'));
    for (const removed of ['類型：', '重要性：', '**', '候選答案不列', '已有內容不列', '計算題建議另外練習']) assert(!normalized.includes(removed));
    assert(normalized.includes('範例是［＿］')); assert(normalized.includes('答案：藍色'));
    assert(normalized.includes('答案：甲 ／ 乙'));
    assert(normalized.includes('題目附圖：前.png'));
    assert(normalized.includes('答案附圖：答案.png'));
    assert(normalized.includes('背面附圖：後.png'));
    assert(normalized.includes('程式會跳過：no-answer'));
    assert.deepEqual([...normalized.matchAll(/### 目標 (\d+)：/g)].map(m => Number(m[1])), [1, 2, 3, 4, 5]);
    assert(blindText('ABC', '測試', '無目標', TRANSCRIPT).text.includes('程式讀不出學習目標'));
    const scoreFile = path.join(out, '盲評/評分', mapping[0].code + '.md');
    await fs.appendFile(scoreFile, '\n評分者已開始，請保留\n');
    const preserved = await fs.readFile(scoreFile);
    await blind(out, config, deps.print);
    assert.deepEqual(await fs.readFile(scoreFile), preserved);
    assert.deepEqual(await readJSON(path.join(out, '生成/組別對照.json')), mapping);
    for (const file of await inventory(path.join(out, '盲評'))) {
      const text = await readText(file);
      for (const hidden of [...Object.keys(config.groups), config.model.model, 'token', '費用']) assert(!text.includes(hidden));
    }
    const times = await Promise.all((await inventory(path.join(out, '盲評'))).map(async file => (await fs.stat(file)).mtimeMs));
    assert.equal(new Set(times).size, 1, '盲評檔的修改時間會透露寫入順序');
    assert.deepEqual(await Promise.all(Object.keys(config.materials).map(async name => hash(await fs.readFile(path.join(out, '能力清單', name + '.md'))))), abilityHashes);
    const duplicate = path.join(temp, '重複能力/能力清單/測試.md');
    await put(duplicate, ABILITIES + '| K1 | 重複 |\n');
    await assert.rejects(abilities(path.join(temp, '重複能力'), '測試'), /重複/);
    pass();

    const filled = code => `# 評分：${code}\n\n## 能力覆蓋\n\n| 能力 | 涵蓋 | 對到的目標 | 說明 |\n|---|---|---|---|\n| K1 能辨認範例 | 部分 | 1 | |\n\n## 逐個目標\n\n| 目標 | 正確 | 洩漏 | 同一能力 | 多餘或重複 | 處置 | 問題與教材依據 |\n|---|---|---|---|---|---|---|\n| 1 任意名稱 | 是 | 否 | 是 | 否 | 保留 | |\n| 2 任意名稱 | 是 | 題 1 | 是 | 否 | 小改 | p.1 題目要改 |\n| 3 任意名稱 | 否 | 否 | 否 | 否 | 大改 | 爭議：p.1 要拆開 |\n| 4 任意名稱 | 是 | 否 | 是 | 重複 1 | 刪除 | p.1 和目標 1 重複 |\n| 5 任意名稱 | 是 | 否 | 是 | 多餘 | 刪除 | p.1 不需要 |\n\n## 整體\n`;
    for (const e of mapping.slice(0, 2)) await put(path.join(out, '盲評/評分', e.code + '.md'), filled(e.code));
    await put(path.join(out, '盲評/評分', mapping[2].code + '.md'), filled(mapping[2].code).replace('| 部分 |', '| 不合規定 |'));
    const validated = validateScore(filled('ABC'), [{ id: 'K1', name: '範例' }], 5);
    assert.equal(validated.status, 'ok');
    assert.deepEqual(metrics(stats, validated).slice(2), [0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 4, 2]);
    const reported = await report(out, config, deps.print);
    assert.equal(reported.evaluated.length, 2);
    assert.equal(reported.problems.length, 2);
    assert.equal(reported.disputes.length, 3);
    const reportText = await readText(path.join(out, '初篩報告.md'));
    for (const expected of ['未評分', '第 7 行', '爭議：p.1 要拆開', '完整減精簡', '每格只有 1 次']) assert(reportText.includes(expected), expected);
    assert.equal(validateScore(filled('ABC').replace('重複 1', '重複 4'), [{ id: 'K1' }], 5).status, 'invalid');
    pass();

    for (const file of await inventory(out)) {
      const text = (await fs.readFile(file)).toString('utf8');
      assert(!text.includes(secret), '金鑰出現在結果檔');
      if (file.endsWith('.送出.json')) assert(!text.includes('base64') && !text.includes('Authorization'));
    }
    assert(!printed.join('\n').includes(secret));
    assert(!printed.join('\n').includes('候選答案不列'));
    pass();
    console.log(`screen selftest：${checks} 組通過（離線）`);
  } finally {
    // 唯一刪除的路徑是本函式 mkdtemp 剛建立的目錄。
    assert(path.dirname(temp) === path.resolve(os.tmpdir()) && path.basename(temp).startsWith('essence-screen-'));
    await fs.rm(temp, { recursive: true, force: true });
  }
}
