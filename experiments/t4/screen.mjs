// AI 品質初篩：獨立的生成與盲評包入口。私人資料只寫入 --out。
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ROOT, REPO, exists, loadKeys, validateOut, imagePart, textPart, redact, writeJson } from './core.mjs';
import { ApiClient } from './api.mjs';
import { readText, readJSON, hash, references, inspect, mechanicalTable, blind, report } from './screen-analysis.mjs';

const HELP = `AI 品質初篩（Node 24；結果放 repo 外）
node screen.mjs run --out <資料夾> [--material <材料>=<教材路徑>]… [--run <N>]
node screen.mjs blind --out <資料夾>
node screen.mjs report --out <資料夾>
node screen.mjs selftest`;

export async function buildPrompt(root, config, material, group) {
  const files = [];
  for (const entry of config.groups[group]) {
    const file = entry === '{科目預設}' ? material['科目預設'] : entry;
    const raw = await readText(path.resolve(root, file));
    const rendered = raw.replaceAll('{{任務資料}}', material['任務資料'].join('\n')).trimEnd();
    files.push({ path: file.replaceAll('\\', '/'), sha256: hash(raw), rendered });
  }
  const system = files.map(f => f.rendered).join('\n\n');
  if (system.includes('{{') || system.includes('{科目預設}')) throw new Error('提示還有未替換的變數');
  return { system, files: files.map(({ path, sha256 }) => ({ path, sha256 })) };
}

async function materialSource(file) {
  const text = await readText(file), images = [];
  for (const name of references(text)) {
    if (!/^[^\\/:*?"<>|]+\.png$/.test(name) || name.includes('..')) throw new Error('教材圖片只接受圖資料夾內的 PNG 檔名');
    const bytes = await fs.readFile(path.join(path.dirname(file), '圖', name));
    images.push({ name, sha256: hash(bytes), bytes });
  }
  return { text, sha256: hash(text), images };
}

function sameMaterial(a, b) {
  return a.sha256 === b.sha256 && JSON.stringify(a.images.map(({ name, sha256 }) => ({ name, sha256 }))) ===
    JSON.stringify(b.images.map(({ name, sha256 }) => ({ name, sha256 })));
}

export async function snapshot(out, name, source, now = Date.now) {
  const dir = path.join(out, '材料', name), versionFile = path.join(dir, '版本.json');
  const explicit = source ? await materialSource(path.resolve(source)) : null;
  if (await exists(versionFile)) {
    const version = await readJSON(versionFile), stored = await materialSource(path.join(dir, '教材.md'));
    if (!sameMaterial(stored, version) || (explicit && !sameMaterial(explicit, version)))
      throw new Error(`${name} 教材或圖片與版本不同；請改用新的 --out`);
    return { ...stored, dir };
  }
  if (!explicit) return null;
  // 不接管不完整或不明來源的複本。
  if (await exists(dir)) throw new Error(`${name} 缺少版本紀錄；請改用新的 --out`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '教材.md'), explicit.text);
  if (explicit.images.length) await fs.mkdir(path.join(dir, '圖'));
  for (const image of explicit.images) await fs.writeFile(path.join(dir, '圖', image.name), image.bytes);
  await writeJson(versionFile, { source: path.resolve(source), sha256: explicit.sha256,
    images: explicit.images.map(({ name, sha256 }) => ({ name, sha256 })), time: new Date(now()).toISOString() });
  return { ...explicit, dir };
}

export async function buildUser(out, name, material) {
  const content = [textPart('教材全文：\n' + material.text)];
  const saved = [textPart('教材全文：\n' + material.text)];
  for (const image of material.images) {
    const label = textPart(`教材的圖：${image.name}`);
    content.push(label, await imagePart(path.join(material.dir, '圖', image.name)));
    saved.push(label, { type: 'image', file: `材料/${name}/圖/${image.name}`, sha256: image.sha256 });
  }
  return { content, saved };
}

export function cleanCommit(repo = REPO, git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true })) {
  if (git('status', '--porcelain', '--', 'experiments/t4/screen', 'docs/card-rules').trim())
    throw new Error('screen 或 card-rules 有未 commit 的修改，停止送出');
  return git('rev-parse', 'HEAD').trim();
}

export async function runScreen({ out, materials = {}, run = 1 }, dependencies = {}) {
  const root = dependencies.root ?? ROOT;
  const config = dependencies.config ?? await readJSON(path.join(root, 'screen/設定.json'));
  const models = dependencies.models ?? await readJSON(path.join(root, 'models.json'));
  const print = dependencies.print ?? console.log, now = dependencies.now ?? Date.now;
  if (!Number.isSafeInteger(run) || run < 1) throw new Error('--run 必須是正整數');
  for (const name of [...Object.keys(config.materials), ...Object.keys(config.groups)])
    if (!name || /[\\/:*?"<>|]/.test(name) || name.includes('..')) throw new Error('設定的材料或組別名稱無效');
  for (const name of Object.keys(materials)) if (!(name in config.materials)) throw new Error('未知材料名稱');
  const provider = models.providers[config.model.provider];
  if (!provider || new URL(provider.baseUrl).protocol !== 'https:') throw new Error('模型供應商設定無效');
  const keys = dependencies.keys ?? await loadKeys(models.providers);
  const client = new ApiClient(models, keys, out, { ...dependencies,
    // API 錯誤可能帶回教材片段；畫面只留狀態、檔名與數量。
    print: message => {
      if (message.startsWith('screen/')) return;
      const status = message.match(/^HTTP (\d+)/)?.[1];
      print(status ? `API HTTP ${status}` : 'API 請求未完成（詳見紀錄.json）');
    } });
  cleanCommit(dependencies.repo, dependencies.git);
  await fs.mkdir(out, { recursive: true });
  // 所有材料及提示先檢查完，輸入有問題時不先付一部分的費用。
  const jobs = [];
  for (const [name, setting] of Object.entries(config.materials)) {
    const hasCopy = await exists(path.join(out, '材料', name, '版本.json'));
    const source = materials[name] ?? (!hasCopy && setting['教材'] ? path.resolve(root, setting['教材']) : null);
    const material = await snapshot(out, name, source, now);
    if (!material) { print(`${name}：缺少 --material，跳過`); continue; }
    const user = await buildUser(out, name, material);
    for (const group of Object.keys(config.groups)) {
      const prompt = await buildPrompt(root, config, setting, group);
      jobs.push({ name, setting, group, material, user, prompt });
    }
  }
  let succeeded = 0, reused = 0, failed = 0;
  for (const job of jobs) {
    const { name, setting, group, material, user, prompt } = job;
    const dir = path.join(out, '生成', name), stem = path.join(dir, `${group}-${run}`);
    const fingerprint = hash(JSON.stringify({ model: config.model, url: provider.baseUrl, system: prompt.system, user: user.saved }));
    if (await exists(stem + '.md')) {
      const sent = await readJSON(stem + '.送出.json');
      if (sent.fingerprint !== fingerprint) throw new Error(`${name}/${group}-${run} 輸入／提示不同；請改用新的 --out`);
      print(`沿用 ${name}/${group}-${run}.md`); reused++;
      // 可補回上次中斷時還來不及寫的機械檢查。
      if (!(await exists(stem + '.統計.json')) || !(await exists(stem + '.檢查.md')))
        await inspect(stem, await readText(stem + '.md'), material.text, setting.checkSyntax, await readJSON(stem + '.回覆.json'), models.pricesUsdPerMillion[config.model.model]);
      continue;
    }
    for (const suffix of ['.送出.json', '.回覆.json', '.檢查.md', '.統計.json'])
      if (await exists(stem + suffix)) throw new Error(`${name}/${group}-${run} 留有未完成檔案，停止以保留紀錄`);
    const commit = cleanCommit(dependencies.repo, dependencies.git);
    print(`生成 ${name}/${group}-${run}.md`);
    const time = new Date(now()).toISOString();
    const reply = await client.request('screen', config.model, prompt.system, user.content, `${name}/${group}-${run}`, { metadata: true });
    if (reply === null) { failed++; continue; }
    const { text, ...metadata } = reply;
    await fs.mkdir(dir, { recursive: true });
    await writeJson(stem + '.送出.json', { time, material: name, group, run, commit, fingerprint,
      model: { provider: config.model.provider, model: config.model.model, url: provider.baseUrl.replace(/\/+$/, '') + '/chat/completions', parameters: {} },
      files: prompt.files, system: prompt.system, user: user.saved });
    await writeJson(stem + '.回覆.json', metadata);
    await fs.writeFile(stem + '.md', text, { flag: 'wx' });
    await inspect(stem, text, material.text, setting.checkSyntax, metadata, models.pricesUsdPerMillion[config.model.model]);
    succeeded++;
    print(`已保存 ${name}/${group}-${run}.md`);
  }
  await mechanicalTable(out, config);
  print(`生成完成：新增 ${succeeded}，沿用 ${reused}，失敗 ${failed}`);
  return { succeeded, reused, failed };
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    out: { type: 'string' }, material: { type: 'string', multiple: true }, run: { type: 'string' }, help: { type: 'boolean' }
  } });
  if (values.help || !positionals.length) { console.log(HELP); return; }
  const [command] = positionals;
  if (positionals.length !== 1 || !['run', 'blind', 'report', 'selftest'].includes(command)) throw new Error(HELP);
  if (command === 'selftest') { await (await import('./screen-selftest.mjs')).selftest(); return; }
  const out = await validateOut(values.out);
  const config = await readJSON(path.join(ROOT, 'screen/設定.json'));
  if (command === 'blind') return blind(out, config);
  if (command === 'report') return report(out, config);
  const materials = {};
  for (const value of values.material ?? []) {
    const at = value.indexOf('=');
    if (at < 1 || !value.slice(at + 1) || Object.hasOwn(materials, value.slice(0, at))) throw new Error('--material 要寫成 材料=路徑，材料不能重複');
    materials[value.slice(0, at)] = value.slice(at + 1);
  }
  const keys = await loadKeys((await readJSON(path.join(ROOT, 'models.json'))).providers);
  try { if ((await runScreen({ out, materials, run: Number(values.run ?? 1) }, { keys })).failed) process.exitCode = 2; }
  catch (error) { error.message = redact(error.message, Object.values(keys)); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => {
    // JSON／檔案系統例外可能含私人文字，僅顯示自訂的操作提示。
    console.error(error instanceof SyntaxError || error.code ? '未完成：請檢查檔案格式、版本紀錄與寫入權限。' : error.message);
    process.exitCode = 1;
  });
