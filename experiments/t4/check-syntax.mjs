// 依 docs/syntax.md 檢查 AI 製卡交回的草稿，列出不符合的地方。規則本身在 src/core/ai/check.ts（AI 製卡的貼回檢查用同一份，tasks/ai-cards-mvp.md §4）；
// 這裡只剩命令列、樹狀輸出與自我測試。
// 用法：node check-syntax.mjs <卡片.md>… [--transcript <轉錄稿.md>] [--unit 2-2] [--subject 自然] [--tree]
//       node check-syntax.mjs --selftest
// 分三級：錯誤＝程式會跳過那個學習目標或連結壞掉（§2-10）；不符＝程式讀得懂，但違反語法或製卡規則；提醒＝啟發式，要人看。
// 只讀檔，不改任何東西。
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { check } from '../../src/core/ai/index.ts';

export { check };

function tree(result) {
  const lines = [];
  const show = (t, mark) => {
    const data = Object.entries(t.data).map(([k, v]) => k === '出處' ? v : v).join('｜');
    lines.push(`${mark} ${t.name}${data ? `　〔${data}〕` : ''}${t.reason ? `\n   理由：${t.reason}` : ''}`);
    t.questions.forEach((q, i) => {
      lines.push(`   ${i === 0 ? '基本' : '進階'}｜正面：${q.front}`, `       背面：${q.back.replace(/\n/g, ' ／ ')}`);
      for (const s of q.supplements) lines.push(`       補充：${s.text}`);
    });
    for (const s of t.shared) lines.push(`   共用補充：${s.text}`);
  };
  if (result.notes.length) lines.push('【給家長的備註】', ...result.notes.map(n => `・${n}`), '');
  let heading;
  for (const t of result.targets) { if (t.heading !== heading) { heading = t.heading; lines.push(`## ${heading ?? '（沒有小標題）'}`); } show(t, '◆'); }
  if (result.existing.length) { lines.push('', '【加進已有的學習目標】'); for (const t of result.existing) show(t, '＋'); }
  if (result.candidates.length) { lines.push('', '【候選卡片】'); for (const t of result.candidates) show(t, '◇'); }
  return lines.join('\n');
}

function format(file, result) {
  const s = result.stats, count = level => result.issues.filter(i => i.level === level).length;
  const out = [`# 語法檢查：${path.basename(file)}`, '',
    `- 學習目標 ${s.targets}（理解型 ${s.understanding}）｜題目 ${s.questions}｜附圖 ${s.images}｜候選卡片 ${s.candidates}｜給家長的備註 ${s.notes} 項｜加進已有 ${s.existing}`,
    `- 錯誤 ${count('錯誤')}｜不符 ${count('不符')}｜提醒 ${count('提醒')}`];
  for (const level of ['錯誤', '不符', '提醒']) {
    const list = result.issues.filter(i => i.level === level);
    if (list.length) out.push('', `## ${level}`, ...list.map(i => `- 第 ${i.line} 行〔${i.code}〕${i.msg}`));
  }
  return out.join('\n');
}

async function selftest() {
  const transcript = 'p.44 ^p44\n\n## 2 擴散現象\n\n![[國二上自然 2-2 圖2-14.png]]\n*圖 2-14 黑糖在水中慢慢散開* ^fig2-14\n\np.45 ^p45\n\n**例題 2-3** ^ex2-3\n';
  const good = `> [!note] 給家長的備註
> - 例題 2-3 的濃度計算不適合做成卡，建議讓孩子做習作練習

## 2 擴散現象

- 能用粒子運動說明擴散現象
    - 出處：p.44、圖 2-14｜類型：因果｜重要性：高
    - 黑糖放進水裡，不攪拌也會慢慢變甜，為什麼？ :: 粒子**不停運動**，糖從**濃度高**的地方散到**濃度低**的地方
        - ![[國二上自然 2-2 圖2-14.png]]
- 能說出影響溶解快慢的因素
	- 出處：p.45｜類型：因果
	- 水溫越==高==、顆粒越==小==、有==攪拌==，糖溶解得越快

> [!note]- 候選卡片
> - 能說明溫度對溶解度的影響
>     - 理由：知識快遞的內容，段考不一定考
>     - 出處：p.45 知識快遞｜類型：因果
>     - 水溫升高時，糖在水中的溶解度會怎麼變？ :: 變**大**
`;
  const bad = `---
狀態: 草稿
---
以下是卡片：

> [!note]- 候選卡片
> - 能說明 A
>     - 出處：p.45｜類型：定義
>     - A 是什麼？ :: B
>     - 哪一杯糖較多，濃度就比較大？ :: 糖較多的那杯

## 2 擴散現象

- 能用粒子運動說明擴散現象 ^k3m9x2
    - 類型：因果｜難度：高｜重要性：中
    - 出處：第二段
    - 黑糖為什麼會散開？::粒子不停運動，從濃度高的地方散到濃度低的地方
    - 擴散是什麼？ ::
    - 這是是非題嗎？ :: 是
    - 第四題？第五題？ :: 太多
        - ![[不存在.png]]
        - *圖 2-14 黑糖在水中慢慢散開*
- 黑糖 :: 糖
- 能說出溶劑
    - 出處：圖 2-13｜類型：分類
    -  :: 水

> [!note] 給家長的備註
> - 圖 2-14 可以附上
`;
  const failures = [];
  const g = check(good, { transcript, unit: '2-2' });
  const serious = g.issues.filter(i => i.level !== '提醒');
  if (serious.length) failures.push('範例被誤判：' + serious.map(i => `${i.line} ${i.code}`).join('、'));
  if (g.stats.targets !== 2 || g.stats.questions !== 2 || g.stats.candidates !== 1 || g.stats.images !== 1) failures.push('範例的統計不對：' + JSON.stringify(g.stats));
  const b = check(bad, { transcript, unit: '2-2' }), codes = new Set(b.issues.map(i => i.code));
  const expected = ['yaml', 'para', 'candidate-position', 'candidate-reason', 'target-id', 'field-unknown', 'default-written', 'data-position', 'source-paragraph',
    'colon-space', 'no-bold', 'no-answer', 'yes-no', 'too-many-questions', 'image-missing', 'caption', 'top-question', 'type-unknown', 'no-front', 'note-position', 'note-kind', 'note-image', 'source-unresolved', 'leak-pattern', 'two-questions'];
  const missed = expected.filter(c => !codes.has(c));
  if (missed.length) failures.push('沒抓到：' + missed.join('、'));
  // 比較卡（§10）：照預設寫的稿什麼都沒有；另一份稿每一種都抓到，等級固定。
  const pickCard = (name, ...lines) => [`- ${name}`, '    - 出處：p.90', ...lines].join('\n');
  const pickAnchor = '    - 記憶錨點：下面是**木**，木頭圍成的：山寨';
  const pickGood = [
    pickCard('寨（寨、塞） 相似字', '    - 一句＿＿。 :: 寨', '    - 二句＿＿。 :: 寨', '    - 三句＿＿。 :: 寨', pickAnchor),
    pickCard('塞（寨、塞） 比較', '    - 一句＿＿。 :: 塞', '    - 二句＿＿。 :: 塞', '    - 三句＿＿。 :: 塞', pickAnchor),
  ].join('\n');
  const pickNoise = check('## 相似字\n\n' + pickGood, { subject: '國語' }).issues;
  if (pickNoise.length) failures.push('比較卡範例被誤判：' + pickNoise.map(i => `${i.line} ${i.code}`).join('、'));
  const pickBad = [
    pickCard('甲（甲、乙） 相似字', '    - 一句＿＿。 :: 乙'),
    pickCard('丙（丁、戊） 相似字', '    - 一句＿＿。 :: 丙'),
    pickCard('己（己、庚） 比較', '    - 一句＿＿。 :: 己', '    - 沒有空格 :: 己'),
    pickCard('辛（辛、壬） 字形', '    - 一句＿＿。 :: 辛', '    - 沒有空格 :: 辛'),
    '- ==癸==（癸、子） 相似字',
    pickCard('丑（丑、寅，卯 辰）', '    - 丑句＿＿。 :: 丑', '    - 記憶錨點：沒有粗體，而且冒號前面超過了十五個字：丑時'),
    pickCard('巳（巳、午、未） 比較', '    - 一句＿＿。 :: 巳'),
  ].join('\n');
  const pickLevels = { 'pick-answer-invalid': '錯誤', 'pick-not-recognized': '錯誤', 'pick-name-cloze': '錯誤', 'pick-few-sentences': '不符', 'pick-answer-in-question': '不符', 'pick-no-anchor': '不符', 'pick-anchor-no-bold': '不符', 'pick-member-no-target': '不符', 'pick-title': '提醒', 'pick-member-space': '提醒', 'pick-anchor-long': '提醒' };
  const pickFound = check(pickBad, { subject: '國語' }).issues;
  for (const [code, level] of Object.entries(pickLevels)) if (!pickFound.some(i => i.code === code && i.level === level)) failures.push(`比較卡沒抓到：${code}（${level}）`);
  if (!pickFound.some(i => i.code === 'pick-mixed' && i.level === '錯誤') || !pickFound.some(i => i.code === 'pick-mixed' && i.level === '提醒')) failures.push('比較卡沒抓到：pick-mixed 的兩種等級');
  console.log(failures.length ? 'FAIL\n' + failures.join('\n') : `selftest：範例 0 個不符；錯誤範例抓到 ${expected.length}/${expected.length} 種；比較卡 ${Object.keys(pickLevels).length + 1}/${Object.keys(pickLevels).length + 1} 種`);
  if (failures.length) process.exitCode = 1;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    transcript: { type: 'string' }, unit: { type: 'string' }, subject: { type: 'string' }, tree: { type: 'boolean' }, selftest: { type: 'boolean' }
  } });
  if (values.selftest) return selftest();
  if (!positionals.length) { console.log('用法：node check-syntax.mjs <卡片.md>… [--transcript <轉錄稿.md>] [--unit 2-2] [--subject 自然] [--tree]\n      node check-syntax.mjs --selftest'); return; }
  const transcript = values.transcript ? await fs.readFile(values.transcript, 'utf8') : null;
  let errors = 0;
  for (const file of positionals) {
    const result = check(await fs.readFile(file, 'utf8'), { transcript, unit: values.unit, subject: values.subject });
    console.log(format(file, result) + (values.tree ? '\n\n```\n' + tree(result) + '\n```' : '') + '\n');
    errors += result.issues.filter(i => i.level === '錯誤').length;
  }
  if (errors) process.exitCode = 1;
}
// 被 judge.mjs 匯入時不執行。
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
