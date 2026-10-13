import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { parseEnv, loadKeys, parseFigures, pixelBox, cropImage, processFigures, parsePages, validateOut, redact, readJson, writeJson, ROOT } from './core.mjs';
import { ApiClient, retryMilliseconds } from './api.mjs';
import { find, render } from './pdf.mjs';
import { inspectCards, transcriptStats, verificationStats, languageStats, report } from './report.mjs';

export async function selftest() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'essence-t4-selftest-'));
  let passed = 0;
  async function test(name, action) { await action(); passed++; console.log(`PASS ${name}`); }
  try {
    await test('金鑰假檔解析與環境變數優先', async () => {
      const file = path.join(temp, 'fake.env');
      await fs.writeFile(file, '\uFEFF# 假資料\nA=from-file\nB="hash#equals=value" # 註解\nexport C=unquoted # 註解\nD=\'spaced value\'\n');
      assert.deepEqual(parseEnv(await fs.readFile(file, 'utf8')), { A: 'from-file', B: 'hash#equals=value', C: 'unquoted', D: 'spaced value' });
      const providers = { test: { keyName: 'A' } };
      assert.equal((await loadKeys(providers, { A: 'from-env' }, file)).test, 'from-env');
      assert.equal((await loadKeys(providers, { A: '' }, file)).test, '');
      assert.equal((await loadKeys(providers, {}, path.join(temp, 'absent'))).test, '');
      assert.throws(() => parseEnv('A="incomplete'), /引號/);
    });
    await test('figure 標記與座標換算／拒絕無效範圍', async () => {
      const [figure] = parseFigures('前<figure box="100,200,600,800" page="3">圖說</figure>後');
      assert.equal(figure.page, 3); assert.equal(figure.description, '圖說');
      assert.deepEqual(pixelBox(figure.box, 200, 100), { x: 40, y: 10, width: 120, height: 50 });
      for (const box of [[0, 0, 1001, 1000], [0, 5, 10, 5], [10, 0, 0, 10], [0, 0, NaN, 100], [0, 1, 2]]) assert.throws(() => pixelBox(box, 100, 100));
      assert.throws(() => pixelBox(parseFigures('<figure page="1" box="0,,100,100">x</figure>')[0].box, 100, 100));
    });
    await test('程式產生小圖的裁切尺寸與像素', async () => {
      const canvas = createCanvas(100, 80), ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 100, 80); ctx.fillStyle = '#0000ff'; ctx.fillRect(50, 0, 50, 80);
      const input = path.join(temp, 'source.png'), output = path.join(temp, 'crop.png');
      await fs.writeFile(input, await canvas.encode('png'));
      await cropImage(input, output, [0, 500, 1000, 1000]);
      const image = await loadImage(output); assert.equal(image.width, 50); assert.equal(image.height, 80);
      const check = createCanvas(50, 80); check.getContext('2d').drawImage(image, 0, 0);
      assert.deepEqual([...check.getContext('2d').getImageData(25, 40, 1, 1).data], [0, 0, 255, 255]);
    });
    await test('自編 PDF 搜尋、文字層與 1600px 渲染', async () => {
      const stream = 'BT /F1 18 Tf 20 150 Td (T4 water) Tj ET';
      const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
      ];
      let pdf = '%PDF-1.4\n', offsets = [0];
      for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; }
      const xref = Buffer.byteLength(pdf);
      pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const file = path.join(temp, 'synthetic.pdf'), out = path.join(temp, 'pdf-output');
      await fs.writeFile(file, pdf);
      const messages = [], print = console.log;
      console.log = m => messages.push(m);
      try { await find(file, 'water'); await render(file, [1], out); await render(file, [1], out); }
      finally { console.log = print; }
      assert.ok(messages.some(m => m.includes('PDF 第 1 頁') && m.includes('water')));
      assert.ok(messages.some(m => m.includes('沿用')));
      const manifest = await readJson(path.join(out, '頁面/文字層.json'));
      assert.ok(manifest.pages[0].text.includes('T4 water')); assert.equal(manifest.pages[0].width, 1600);
      const image = await loadImage(path.join(out, '頁面/p1.png')); assert.equal(image.height, 1600);
      await assert.rejects(render(file, [2], out), /只有 1 頁/);
    });
    await test('figure 替換、模型檔名與失敗標記保留', async () => {
      await fs.mkdir(path.join(temp, '頁面')); await fs.copyFile(path.join(temp, 'source.png'), path.join(temp, '頁面/p3.png'));
      const invalid = '<figure page="99" box="0,0,500,500">錯頁</figure>';
      const warnings = [];
      const result = await processFigures('<figure page="3" box="0,0,500,500">說明</figure>\n' + invalid, 'test/model:free', [{ page: 3, image: 'p3.png' }], temp, text => warnings.push(text));
      assert.ok(result.text.includes('![[test-model-free-p3-1.png]]\n*說明* ^fig-p3-1'));
      assert.ok(result.text.includes(invalid)); assert.deepEqual(result.stats, { total: 2, success: 1, failed: 1 }); assert.equal(warnings.length, 1);
      const quoted = await processFigures('> <figure page="3" box="0,0,500,500">說明</figure>', 'quoted', [{ page: 3, image: 'p3.png' }], temp, () => {});
      assert.ok(quoted.text.includes('\n> *說明* ^fig-p3-1'));
      const labeled = await processFigures('<figure page="PDF 第 3 頁" box="0,0,500,500">說明</figure>', 'labeled', [{ page: 3, image: 'p3.png' }], temp, () => {});
      assert.equal(labeled.stats.failed, 1); assert.ok(labeled.text.includes('<figure'));
    });
    await test('頁序與 repo／worktree 輸出保護', async () => {
      assert.deepEqual(parsePages('2-4'), [2, 3, 4]);
      for (const value of ['0', '4-2', '1,2', 'NaN']) assert.throws(() => parsePages(value));
      await assert.rejects(validateOut(ROOT), /repo/);
      const commonRoot = path.dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim());
      await assert.rejects(validateOut(path.join(commonRoot, 'should-not-write')), /repo/);
      assert.equal(await validateOut(temp), await fs.realpath(temp));
    });
    await test('製卡格式行號、出處比例、轉錄與用語統計', async () => {
      const good = '## 學習目標\n\n### LT-1 能辨認溶質\n- 類型：定義\n- 重要性：高\n- 出處：p.45 第 1 段\n- Q1：什麼是溶質？\n  - A：被溶解的物質。\n- Q2（進階）：糖水中的糖是什麼？\n  - A：溶質。\n\n## 候選但未採用\n- 無\n\n## 給家長的備註\n- 無';
      const goodStats = inspectCards(good); assert.equal(goodStats.errors.length, 0); assert.equal(goodStats.goals, 1); assert.equal(goodStats.questions, 2); assert.equal(goodStats.sourceRatio, '100.0%');
      const broken = inspectCards(good.replace('- 出處：p.45 第 1 段\n', '').replace('  - A：被溶解的物質。', 'A: 不符格式'));
      assert.ok(broken.errors.some(e => e.line === 3 && e.message === '缺少出處'));
      assert.ok(broken.errors.some(e => e.line === 7)); assert.equal(broken.sourceRatio, '0.0%');
      const s = transcriptStats('p.45 ^p45\n[?]\n[!教師註記]\n![[a.png]]\n<figure>壞</figure>', 1);
      assert.equal(s.pagesMatch, true); assert.equal(s.success, 1); assert.equal(s.failed, 1); assert.equal(s.teachers, 1);
      assert.equal(transcriptStats('p.45 ^p46', 1).pagesMatch, false);
      assert.deepEqual(verificationStats('- 頁 45：錯字（把握：高）\n- 頁 46：疑點（把握：低）'), { total: 2, high: 1, low: 1 });
      assert.equal(languageStats('学国信息信息程序').simplified, 2); assert.equal(languageStats('信息信息').terms.信息, 2);
    });
    await test('模擬 API：序列限速、429 重試及秘密不外洩', async () => {
      let now = 0, calls = 0; const messages = [], waits = [], secret = 'fake-only-secret';
      const config = { providers: { fake: { baseUrl: 'https://example.invalid/v1/', minSecondsBetweenCalls: 4, keyName: 'FAKE' } } };
      const client = new ApiClient(config, { fake: secret }, temp, {
        now: () => now, wait: async ms => { waits.push(ms); now += ms; }, print: m => messages.push(m),
        fetch: async (url, options) => {
          assert.equal(url, 'https://example.invalid/v1/chat/completions'); assert.equal(options.headers.Authorization, `Bearer ${secret}`); calls++; now += 1000;
          if (calls === 1) return new Response(JSON.stringify({ error: { message: secret } }), { status: 429, headers: { 'Retry-After': '2' } });
          if (calls === 3) return new Response(JSON.stringify({ error: { message: `failure ${secret}` } }), { status: 400 });
          return new Response(JSON.stringify({ choices: [{ message: { content: '完成 ' + secret }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20, bad: secret } }), { status: 200 });
        }
      });
      const model = { provider: 'fake', model: 'fake-model' };
      assert.equal(await client.request('transcribe', model, '不記錄提示', [], undefined), '完成 [已隱藏]');
      assert.equal(await client.request('cards', model, '不記錄提示', [], '只用轉錄稿'), null);
      assert.deepEqual(waits, [2000, 2000, 4000]); assert.equal(calls, 3);
      const log = await fs.readFile(path.join(temp, '紀錄.json'), 'utf8');
      assert.ok(!log.includes(secret)); assert.ok(!log.includes('不記錄提示')); assert.ok(!messages.join().includes(secret));
      const rows = JSON.parse(log); assert.deepEqual(rows.map(r => r.status), [429, 200, 400]); assert.equal(rows[1].usage.prompt_tokens, 10);
      assert.equal(retryMilliseconds('Thu, 01 Jan 1970 00:00:08 GMT', 5000, 0), 3000);
      assert.equal(redact(secret, [secret]), '[已隱藏]');
    });
    await test('模擬 API：429 最多三次重試並繼續下一項', async () => {
      let calls = 0; const messages = [];
      const client = new ApiClient({ providers: { fake: { baseUrl: 'https://example.invalid', minSecondsBetweenCalls: 0 } } }, { fake: 'fake' }, temp,
        { wait: async () => {}, print: m => messages.push(m), fetch: async () => { calls++; return new Response('{}', { status: 429, headers: { 'Retry-After': '0' } }); } });
      assert.equal(await client.request('verify', { provider: 'fake', model: 'limited' }, '', []), null); assert.equal(calls, 4);
      assert.ok(messages.some(m => m.includes('fake 的額度暫時用完了')));
      client.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '無' } }] }), { status: 200 });
      assert.equal(await client.request('verify', { provider: 'fake', model: 'next' }, '', []), '無');
    });
    await test('模擬 API：截斷回覆及網路錯誤不當作完成', async () => {
      const client = new ApiClient({ providers: { fake: { baseUrl: 'https://example.invalid', minSecondsBetweenCalls: 0 } } }, { fake: 'fake-secret' }, temp, { print: () => {}, fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '未完成' }, finish_reason: 'length' }] }), { status: 200 }) });
      assert.equal(await client.request('transcribe', { provider: 'fake', model: 'truncated' }, '', []), null);
      client.fetch = async () => new Response('null', { status: 200 });
      assert.equal(await client.request('transcribe', { provider: 'fake', model: 'null-response' }, '', []), null);
      client.fetch = async () => { throw new Error('fake-secret'); };
      assert.equal(await client.request('transcribe', { provider: 'fake', model: 'network' }, '', []), null);
    });
    await test('離線報告費用加總及缺失資料標示', async () => {
      const reportOut = path.join(temp, 'report'); await fs.mkdir(reportOut);
      await writeJson(path.join(reportOut, '紀錄.json'), [{ model: 'model', provider: 'fake', step: 'verify', variant: 'source', status: 200, seconds: 2, outcome: 'ok', usage: { prompt_tokens: 1000, completion_tokens: 2000 } }]);
      const config = { transcribe: [{ model: 'model', provider: 'fake' }], verify: [], cards: [], pricesUsdPerMillion: { model: { input: 1, output: 2 } } };
      const table = await report(config, reportOut); assert.ok(table.includes('0.005000')); assert.ok(table.includes('0.3000'));
      const output = await fs.readFile(path.join(reportOut, '報告.md'), 'utf8'); assert.ok(output.includes('| verify | model | 1 | 1 |'));
    });
    console.log(`selftest: ${passed}/${passed} passed（離線；未讀取真實金鑰）`);
  } finally {
    const target = await fs.realpath(temp), tempRoot = await fs.realpath(os.tmpdir());
    if (path.dirname(target) !== tempRoot || !path.basename(target).startsWith('essence-t4-selftest-')) throw new Error('自測暫存資料夾範圍檢查失敗，未刪除');
    await fs.rm(target, { recursive: true, force: true });
  }
}
