import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt, RULE_MARKER, RULE_SUBJECTS, ruleText } from '../src/core/ai/index.ts';
import { embedRules, ruleFiles } from '../tools/build.mjs';

// tasks/ai-cards-mvp.md §1：規則組嵌進外掛、記版號與雜湊。

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

void test('§1 送出範圍：只送標記以下，換行統一成 \\n、拿掉 BOM 與前後空行；R3 整份送，拿掉單獨一行的 {{任務資料}}', () => {
  const doc = '﻿# 標題\r\n\r\n> 狀態：v0.2，估 35～45 個\r\n\r\n' + RULE_MARKER + '\r\n\r\n## 規則\r\n\r\n- 一\r\n\r\n';
  assert.equal(ruleText(doc, { path: 'a.md', marker: true }), '## 規則\n\n- 一');
  assert.equal(ruleText('# 五步\n\n做法\n\n{{任務資料}}\n', { path: 'b.md', marker: false }), '# 五步\n\n做法');
  assert.throws(() => ruleText('# 沒有標記\n', { path: 'c.md', marker: true }), /c\.md 找不到標記/);
  assert.throws(() => ruleText('{{科目預設}}\n', { path: 'd.md', marker: false }), /d\.md 還有沒填的變數/);
  assert.throws(() => ruleText('# x\n' + RULE_MARKER + '\n\n', { path: 'e.md', marker: true }), /e\.md 送出的部分是空的/);
});

void test('§1 表：五科全開（§0），規則照表的順序；docs/card-rules 的每一份剛好一個標記，狀態框不送', async () => {
  assert.deepEqual(RULE_SUBJECTS.map(subject => subject.label), ['國語（國小）', '英文（國中）', '自然', '一般知識', '社會（國小）']);
  const r3 = ['格式', '短規則', '判斷邊界', '五步'];
  assert.deepEqual(Object.fromEntries(RULE_SUBJECTS.map(subject => [subject.key, subject.files.map(file => `${file.name} ${file.version}`)])), {
    chinese: [...r3.map(name => name + ' R3 第二輪'), '國小國語 v0.7'],
    english: ['通用 v0.15', '英文 v0.14'],
    science: r3.map(name => name + ' R3 第二輪'),
    general: ['通用 v0.15', '一般知識 v0.4'],
    social: [...r3.map(name => name + ' R3 第二輪'), '國小社會 v0.8'],
  });
  for (const path of ruleFiles().filter(path => path.startsWith('docs/'))) {
    const text = await readFile(join(root, path), 'utf8');
    assert.equal(text.split(RULE_MARKER).length - 1, 1, path + ' 的標記');
  }
  const rules = await embedRules(root);
  for (const subject of RULE_SUBJECTS) {
    assert.deepEqual(rules[subject.key].map(rule => rule.name), subject.files.map(file => file.name));
    for (const rule of rules[subject.key]) {
      assert.equal(rule.sha256, sha(rule.text), rule.name);
      assert.ok(!rule.text.includes('> 狀態') && !rule.text.includes('\r') && !rule.text.includes('{{'), rule.name);
    }
  }
  // 狀態框裡給 AI 的那一段搬到標記下面，字不改（§1）。
  assert.ok(rules.english[1].text.startsWith('適用於國中英文，不限版本；國小之後用同一份接上。搭配通用規則（common.md）使用；與通用規則衝突時，以本檔為準。'));
  assert.ok(rules.english[0].text.startsWith('## 你的任務'));
});

void test('§3 社會的提示：規則寫的已有目標格式和任務段實際送出的相同（L2 規格核對）', async () => {
  const social = RULE_SUBJECTS.find(subject => subject.key === 'social')!;
  const rules = (await embedRules(root)).social;
  const prompt = buildPrompt({ subject: 'social', term: '小五上', unit: '2-2 人口', purpose: '準備段考', supplement: true, adjust: '', material: '' }, social, rules, [{ id: 'k3m9qa', name: '能說出台灣東部海岸的地形', source: '小五上 2-1 p.30', path: 'a.md' }]);
  assert.ok(prompt.text.includes('收到的已有目標每項是 `ID 名稱｜出處`'));
  assert.ok(!prompt.text.includes('名稱｜ID｜出處'));
  assert.ok(prompt.parts.at(-1)!.text.includes('  - k3m9qa 能說出台灣東部海岸的地形｜小五上 2-1 p.30'));
});

void test('§1 建置：表上的檔讀不到就失敗，說出是哪一份', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'essence-rules-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(embedRules(dir), /AI 製卡的規則檔讀不到：experiments\/t4\/arch\/第二輪\/格式\.md/);
});
