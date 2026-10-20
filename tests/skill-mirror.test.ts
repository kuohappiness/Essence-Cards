import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkMirror, COPIES, SHARED } from '../tools/check-skill-mirror.ts';

// 兩份副本都寫入同樣的檔案；個別測試再改其中一份。
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'essence-skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (copy: string, path: string, text: string) => {
    await mkdir(dirname(join(root, copy, path)), { recursive: true });
    await writeFile(join(root, copy, path), text);
  };
  for (const copy of COPIES) {
    for (const skill of SHARED) {
      await put(copy, `${skill}/SKILL.md`, `# ${skill}\n\n見 [細節](detail.md#一節)、[網站](https://example.com)、[本頁](#標題)。\n`);
      await put(copy, `${skill}/detail.md`, '細節\n');
      await put(copy, `${skill}/agents/openai.yaml`, 'interface: {}\n');
    }
  }
  return { root, put };
}

test('兩份相同時沒有問題；只差換行（CRLF／LF）也算相同', async t => {
  const { root, put } = await fixture(t);
  assert.deepEqual(checkMirror(root), []);
  await put(COPIES[1], `${SHARED[0]}/detail.md`, '細節\r\n');
  assert.deepEqual(checkMirror(root), []);
});

test('內容不同、少一個檔案、多一個檔案都報出來', async t => {
  const { root, put } = await fixture(t);
  await put(COPIES[0], `${SHARED[0]}/detail.md`, '改過的細節\n');
  await put(COPIES[1], `${SHARED[1]}/extra.md`, '只有一邊\n');
  await rm(join(root, COPIES[1], SHARED[2], 'agents/openai.yaml'));
  assert.deepEqual(checkMirror(root), [
    `內容不同：${SHARED[0]}/detail.md`,
    `只有 ${COPIES[1]} 有：${SHARED[1]}/extra.md`,
    `只有 ${COPIES[0]} 有：${SHARED[2]}/agents/openai.yaml`,
  ]);
});

test('缺少整個 skill 資料夾時報出來', async t => {
  const { root } = await fixture(t);
  await rm(join(root, COPIES[0], SHARED[1]), { recursive: true });
  assert.deepEqual(checkMirror(root), [`缺少資料夾：${COPIES[0]}/${SHARED[1]}`]);
});

test('相對連結找不到時報出來，兩份各報一次；網址與頁內錨點不檢查', async t => {
  const { root, put } = await fixture(t);
  const text = '見 [不存在](missing.md)、[上層](<../../../有 空格.md>)、[壞的上層](<../../../沒有 這個.md#節>)。\n';
  for (const copy of COPIES) await put(copy, `${SHARED[0]}/SKILL.md`, text);
  await put('', '有 空格.md', '');
  assert.deepEqual(checkMirror(root), COPIES.flatMap(copy => [
    `連結找不到：${copy}/${SHARED[0]}/SKILL.md → missing.md`,
    `連結找不到：${copy}/${SHARED[0]}/SKILL.md → ../../../沒有 這個.md#節`,
  ]));
});
