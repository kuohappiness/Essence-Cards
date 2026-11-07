import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/core/deck/index.ts';
import { buildPrompt, existingTargets, inspectReply, normalizeReply, planDraft, readJobs, RULE_SUBJECTS, sha256Hex, studentOf, taskSection } from '../src/core/ai/index.ts';
import type { CardForm, EmbeddedRule, ExistingNow, ExistingTarget, RuleSubject } from '../src/core/ai/index.ts';

// tasks/ai-cards-mvp.md §3、§4、§5 的核心（不寫檔的部分）。只用自編的內容。

const subject = (key: string): RuleSubject => RULE_SUBJECTS.find(each => each.key === key)!;
const rule = (name: string, version: string, text: string): EmbeddedRule => ({ name, version, text, sha256: sha256Hex(text) });
const form = (over: Partial<CardForm> = {}): CardForm => ({ subject: 'science', term: '國二上', unit: '2-2 水溶液', purpose: '準備段考', supplement: true, adjust: '', material: '', ...over });
const nobody = (): ExistingNow => ({ kind: 'none' });
/** 照順序給 ID 的假配號。 */
const counter = (): (() => string) => { let n = 0; const ids = ['aaaaa2', 'bbbbb2', 'ccccc2', 'ddddd2', 'eeeee2', 'fffff2', 'ggggg2', 'hhhhh2']; return () => ids[n++]; };

void test('§3 提示：同樣的表單、規則與已有目標組出的文字一字不差、雜湊相同；部分照規則組 → 任務段', () => {
  const rules = [rule('通用', 'v0.15', '# 通用'), rule('英文', 'v0.14', '# 英文')];
  const english = subject('english');
  const existing: ExistingTarget[] = [{ id: 'k3m9qa', name: 'borrow 英翻中', source: '國二上 L1 p.12', path: 'Essence Cards/學業/國二上/英文/L1.md' }];
  const a = buildPrompt(form({ subject: 'english', unit: 'L3 Sports' }), english, rules, existing);
  const b = buildPrompt(form({ subject: 'english', unit: 'L3 Sports' }), english, rules, existing);
  assert.equal(a.text, b.text);
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.sha256, sha256Hex(a.text));
  assert.deepEqual(a.parts.map(part => `${part.name} ${part.version}`), ['通用 v0.15', '英文 v0.14', '任務段 提示 v1']);
  assert.equal(a.text, ['# 通用', '# 英文', a.parts[2].text].join('\n\n'));
  assert.equal(a.parts[2].text, [
    '## 這一次的任務',
    '',
    '- 學生：國中二年級（國二上）',
    '- 科目：英文',
    '- 單元：L3 Sports',
    '- 學習目的：準備段考',
    '- 允許 AI 補充：是',
    '- 家長調整：無',
    '- 教材：附件的課本頁面',
    '- 學生已有的學習目標：',
    '  - k3m9qa borrow 英翻中｜國二上 L1 p.12',
    '',
    '另外：',
    '',
    '- 教材在附件。附件沒有圖檔可以連，**不要寫 `![[…]]`**；要提到課本的圖，在出處寫圖號（例如 `p.42、圖 2`）。',
    '- 一課分成幾篇時，篇名照 `國二上英文 L3 <篇名>` 寫，例如 `國二上英文 L3 單字`，單獨一行、前面不加 `#`。',
    '- 不要寫學習目標 ID 與屬性區，程式會加。',
    '- 回覆的最後單獨一行寫 `<<<完>>>`。',
  ].join('\n'));
  // R3 的科目多一句三段的標記；沒有已有目標寫「無」；家長調整與教材照填。
  const science = taskSection(form({ adjust: '這次最多 8 個目標', material: '課本 p.40～51 的照片' }), subject('science'), []);
  assert.ok(science.includes('- 家長調整：這次最多 8 個目標\n- 教材：附件（課本 p.40～51 的照片）\n- 學生已有的學習目標：無\n'));
  assert.ok(science.includes('- 照規則交三段，標記照抄（`<<<全貌>>>`、`<<<架構>>>`、`<<<卡組>>>`）。'));
  assert.ok(!taskSection(form({ subject: 'general', unit: '睡眠講座' }), subject('general'), []).includes('篇名'));
});

void test('§3 學生由年級學期換算；認不得的照原字', () => {
  assert.deepEqual(['國二上', '小五上', '高三下', '八上', '五年級'].map(studentOf), ['國中二年級（國二上）', '國小五年級（小五上）', '高中三年級（高三下）', '國中二年級（國二上）', '五年級']);
});

void test('§2 已有目標：同科、之前或相同的年級學期，草稿與轉錄稿不算，認不得的年級學期只算相同的；照年級學期、單元、筆記順序', () => {
  const deck = (term: string, subjectName: string, unit: string, status: string, body: string) =>
    parseDeck(`---\n年級學期: ${term}\n科目: ${subjectName}\n單元: ${unit}\n狀態: ${status}\n---\n\n${body}`);
  const decks = [
    { path: 'b.md', deck: deck('國二上', '自然', '2-1 溶液', '暫停', '- 能說出溶質 ^bbbbb2\n    - 出處：p.40\n    - 溶質是什麼？ :: 被溶解的物質\n- 能說出溶劑 ^ccccc2\n    - 溶劑是什麼？ :: 溶解別人的物質') },
    { path: 'a.md', deck: deck('國一下', '自然', '3-1 酵素', '啟用', '- 能說出酵素的作用 ^aaaaa2\n    - 酵素有什麼作用？ :: 加快反應') },
    { path: 'c.md', deck: deck('國二下', '自然', '1-1 力', '啟用', '- 能說出力 ^ddddd2\n    - 力是什麼？ :: 推或拉') },
    { path: 'd.md', deck: deck('國二上', '自然', '2-3 草稿', '草稿', '- 能說出草稿 ^eeeee2\n    - 草稿？ :: 是') },
    { path: 'e.md', deck: deck('國二上', '英文', 'L1 Hi', '啟用', '- hi 英翻中 ^fffff2\n    - hi :: 嗨') },
    { path: 'f.md', deck: deck('補習班', '自然', '1 浮力', '啟用', '- 能說出浮力 ^ggggg2\n    - 浮力？ :: 向上的力') },
    { path: 'g.md', deck: deck('國二上', '自然', '2-2 沒有 ID', '啟用', '- 能說出沒有 ID\n    - 問？ :: 答') },
  ];
  assert.deepEqual(existingTargets(decks, '自然', '國二上').map(each => `${each.id} ${each.name}｜${each.source}`), [
    'aaaaa2 能說出酵素的作用｜國一下 3-1',
    'bbbbb2 能說出溶質｜國二上 2-1 p.40',
    'ccccc2 能說出溶劑｜國二上 2-1',
  ]);
  assert.deepEqual(existingTargets(decks, '自然', '補習班').map(each => each.id), ['ggggg2']);
  assert.deepEqual(existingTargets(decks, '自然', '國二上', new Set(['bbbbb2'])).map(each => each.id), ['aaaaa2', 'ccccc2']);
});

const R3_REPLY = [
  '<<<全貌>>>',
  '## 知識塊',
  '',
  '- 擴散：粒子不停運動',
  '<<<架構>>>',
  '## 學習目標',
  '',
  '- T01｜①｜能用粒子運動說明擴散現象',
  '<<<卡組>>>',
  '> [!note] 給家長的備註',
  '> - 例題 2-3 的濃度計算建議另外練習',
  '',
  '## 2 擴散現象',
  '',
  '- 能用粒子運動說明擴散現象',
  '    - 出處：p.44｜類型：因果',
  '    - 黑糖放進水裡，不攪拌也會慢慢變甜，為什麼？ :: 粒子**不停運動**，從**濃度高**的地方散到**濃度低**的地方',
  '',
  '> [!note] 加進已有的學習目標',
  '> - q8z3ka 能用密度判斷物體的浮沉',
  '>     - 出處：p.46',
  '>     - 雞蛋在濃鹽水裡為什麼浮起來？ :: 鹽水的**密度變大**',
  '',
  '> [!note]- 候選卡片',
  '> - 能說明溫度對溶解度的影響',
  '>     - 理由：知識快遞的內容，段考不一定考',
  '>     - 出處：p.45｜類型：因果',
  '>     - 水溫升高時，糖的溶解度會怎麼變？ :: 變**大**',
  '<<<完>>>',
  '',
].join('\n');

void test('§4 整理：CRLF、BOM、最外層圍欄一起出現；行號照原文', () => {
  const raw = '﻿\r\n```markdown\r\n<<<卡組>>>\r\n- 一\r\n```\r\n\r\n';
  const normalized = normalizeReply(raw);
  assert.deepEqual(normalized.lines, ['<<<卡組>>>', '- 一']);
  assert.deepEqual(normalized.raw, [3, 4]);
  // 四個反引號包著三個反引號：只拿掉外面那一對。
  const four = normalizeReply('````\n- 一\n```\n程式\n```\n````');
  assert.deepEqual(four.lines, ['- 一', '```', '程式', '```']);
  // 裡面有一樣長的圍欄：不算被一對包起來。
  assert.deepEqual(normalizeReply('```\n- 一\n```\n- 二\n```').lines.length, 5);
  assert.deepEqual(normalizeReply('~~~md\n- 一\n~~~').lines, ['- 一']);
});

void test('§4 分段：R3 三段齊全、少一段、卡組段空白、標記寫錯、開場白；<<<完>>> 在引言框或程式碼裡不算', () => {
  const science = subject('science');
  const ok = inspectReply(R3_REPLY, form(), science, [], nobody);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.ended, true);
  assert.equal(ok.pieces.length, 1);
  assert.deepEqual([ok.pieces[0].targets, ok.pieces[0].prompts, ok.pieces[0].candidates, ok.pieces[0].adds.length], [1, 1, 1, 1]);
  const messages = (reply: string, key = 'science', over: Partial<CardForm> = {}) => inspectReply(reply, form({ subject: key, ...over }), subject(key), [], nobody).errors.map(each => `${String(each.line)} ${each.message}`);
  assert.match(messages(R3_REPLY.replace('<<<架構>>>\n', ''))[0], /^0 少了 <<<架構>>> 那一段/);
  assert.match(messages('<<<全貌>>>\n<<<架構>>>\n<<<卡組>>>\n\n<<<完>>>\n')[0], /^3 <<<卡組>>> 這一段是空的/);
  assert.match(messages(R3_REPLY.replace('<<<架構>>>', '<<<架構段>>>')).join('\n'), /5 認不得的標記 <<<架構段>>>/);
  assert.match(messages('好的，以下是：\n' + R3_REPLY)[0], /^1 第一個標記前面有其他文字/);
  assert.match(messages('好的，以下是卡組：\n\n## 2\n\n- 能說出一\n    - 一？ :: 一\n<<<完>>>', 'english', { unit: 'L3' })[0], /^1 第一行「好的，以下是卡組：」不是卡組的內容/);
  assert.match(messages(R3_REPLY + '希望有幫助\n').join('\n'), /30 <<<完>>> 後面還有文字/);
  // 尾段少貼：標記與題目都合法，但沒有 <<<完>>>；引言框或程式碼裡的 <<<完>>> 不算。
  const cut = inspectReply(R3_REPLY.replace('<<<完>>>\n', ''), form(), science, [], nobody);
  assert.deepEqual([cut.errors, cut.ended], [[], false]);
  assert.ok(cut.hints.some(each => each.line === 0 && each.message.startsWith('最後一行沒有 <<<完>>>')));
  const quoted = inspectReply(R3_REPLY.replace('<<<完>>>\n', '> <<<完>>>\n'), form(), science, [], nobody);
  assert.equal(quoted.ended, false);
  const english = inspectReply('## 單字\n\n- borrow 英翻中\n    - 出處：p.40\n    - borrow :: 借入\n\n```\n<<<完>>>\n```\n', form({ subject: 'english', unit: 'L3' }), subject('english'), [], nobody);
  assert.equal(english.ended, false);
  assert.deepEqual(english.errors, []);
});

const ENGLISH = [
  '國二上英文 L3 單字',
  '',
  '## 單字',
  '',
  '- borrow 英翻中',
  '    - 出處：p.40',
  '    - borrow :: 借入',
  '',
  '國二上英文 L3 文法',
  '',
  '## 文法',
  '',
  '- 能用 be going to 說未來的計畫',
  '    - 出處：p.42',
  '    - 我明天要去游泳。I ＿＿ swim tomorrow. :: am going to',
  '<<<完>>>',
].join('\n');
const englishForm = form({ subject: 'english', unit: 'L3 Sports: Week 1', supplement: false });
const inspectEnglish = (reply: string) => inspectReply(reply, englishForm, subject('english'), [], nobody);
const errorsOf = (reply: string) => inspectEnglish(reply).errors.map(each => `${String(each.line)} ${each.message}`);

void test('§4 拆篇：沒有篇名行是一篇（檔名照 D-081）；兩篇照篇名；篇名重複、空篇、只有候選框的一篇都擋', () => {
  const whole = inspectReply(R3_REPLY, form(), subject('science'), [], nobody);
  assert.equal(whole.pieces[0].name, '國二上自然 2-2 水溶液（卡片）');
  const two = inspectEnglish(ENGLISH);
  assert.deepEqual(two.errors, []);
  assert.deepEqual(two.pieces.map(piece => [piece.name, piece.targets]), [['國二上英文 L3 單字', 1], ['國二上英文 L3 文法', 1]]);
  assert.match(errorsOf(ENGLISH.replace('國二上英文 L3 文法', '國二上英文 L3 單字')).join('\n'), /9 篇名「國二上英文 L3 單字」出現了兩次/);
  assert.match(errorsOf('國二上英文 L3 單字\n\n國二上英文 L3 文法\n\n- 能說出一\n    - 一？ :: 一\n<<<完>>>').join('\n'), /1 「國二上英文 L3 單字」沒有任何學習目標/);
  const onlyCandidates = '國二上英文 L3 單字\n\n- borrow 英翻中\n    - borrow :: 借入\n\n國二上英文 L3 補充\n\n> [!note]- 候選卡片\n> - lend 英翻中\n>     - 理由：課本沒有\n>     - lend :: 借出\n<<<完>>>';
  assert.match(errorsOf(onlyCandidates).join('\n'), /6 「國二上英文 L3 補充」沒有任何學習目標/);
});

void test('§4 拆篇：篇名字串在答案的接續行、引言框、程式碼裡不拆；第一篇前的備註框併入、候選框擋；檔名不能用的字換成全形', () => {
  const inside = [
    '國二上英文 L3 單字', '', '- borrow 英翻中', '    - borrow :: 借入', '    國二上英文 L3 文法', '',
    '> [!note] 給家長的備註', '> 國二上英文 L3 文法', '', '```', '國二上英文 L3 文法', '```', '<<<完>>>',
  ].join('\n');
  assert.deepEqual(inspectEnglish(inside).pieces.map(piece => piece.name), ['國二上英文 L3 單字']);
  const noteFirst = inspectEnglish('> [!note] 給家長的備註\n> - 課本 p.40 可能印錯\n\n' + ENGLISH);
  assert.deepEqual(noteFirst.errors, []);
  assert.equal(noteFirst.pieces[0].lines[0], 0);
  assert.match(errorsOf('> [!note]- 候選卡片\n> - lend 英翻中\n>     - 理由：x\n>     - lend :: 借出\n\n' + ENGLISH).join('\n'), /^1 第一個篇名前面還有內容：請移到它所屬的那一篇/);
  const odd = inspectReply('國二上英文 L3 A/B: "c"?\n\n- borrow 英翻中\n    - borrow :: 借入\n<<<完>>>', form({ subject: 'english', unit: 'L3' }), subject('english'), [], nobody);
  assert.equal(odd.pieces[0].name, '國二上英文 L3 A／B： ＂c＂？');
});

void test('§4 疑似篇名（R2-5）：年級學期、科目、編號不同的純文字與 ## 都擋；相同但寫成 ## 擋；## 2 擴散現象不受影響', () => {
  const body = '\n\n- borrow 英翻中\n    - borrow :: 借入\n<<<完>>>';
  assert.deepEqual(errorsOf('國二上英文 L3 單字' + body), []);
  assert.match(errorsOf('## 國二上英文 L3 單字' + body)[0], /^1 篇名請另起一行，不加 #/);
  for (const wrong of ['國二下英文 L3 單字', '國二上自然 L3 單字', '國二上英文 L4 單字', '## 國二上英文 L4 單字', '### 國一上國語 2 課文']) {
    assert.match(errorsOf(wrong + body)[0], /^1 這一行像篇名，但和這次填的單元不同/, wrong);
  }
  assert.deepEqual(errorsOf('## 2 擴散現象' + body), []);
});

void test('§4 檢查：check-syntax 算錯誤的擋（缺答案、pick-mixed、比較卡認不出來）、行號照原文；不符的提示；AI 寫的屬性區擋', () => {
  const science = subject('science');
  // 候選框裡缺答案：擋，行號是原文的第 24 行（題目那一行）。
  const missing = inspectReply(R3_REPLY.replace('>     - 水溫升高時，糖的溶解度會怎麼變？ :: 變**大**', '>     - 水溫升高時，糖的溶解度會怎麼變？ ::'), form(), science, [], nobody);
  assert.deepEqual(missing.errors.map(each => each.line), [28]);
  // 開頭包了一層圍欄、前面有兩行空行：行號照貼上的原文。
  const fenced = inspectReply('\n\n```markdown\n' + R3_REPLY.replace('>     - 水溫升高時，糖的溶解度會怎麼變？ :: 變**大**', '>     - 水溫升高時，糖的溶解度會怎麼變？ ::') + '```\n', form(), science, [], nobody);
  assert.deepEqual(fenced.errors.map(each => each.line), [31]);
  const chinese = subject('chinese');
  const pick = '<<<全貌>>>\n無\n<<<架構>>>\n無\n<<<卡組>>>\n## 相似字\n\n- 寨（寨、塞） 相似字\n    - 出處：p.1\n    - 山＿＿。 :: 寨\n    - 寨是什麼？ :: 防守的地方\n<<<完>>>';
  const mixed = inspectReply(pick, form({ subject: 'chinese', term: '小五上', unit: 'L7 詩' }), chinese, [], nobody);
  // pick-mixed 指在不是比較句的那一題（原文第 11 行）。
  assert.deepEqual(mixed.errors.map(each => each.line), [11]);
  const yaml = inspectEnglish('---\n狀態: 啟用\n---\n## 單字\n\n- borrow 英翻中\n    - borrow :: 借入\n<<<完>>>');
  assert.match(yaml.errors.map(each => `${String(each.line)} ${each.message}`).join('\n'), /1 AI 寫了屬性區/);
  // 不符：每個字少於兩句、自然的「能……」以外的名稱照樣提示；英文的名稱不提示。
  const few = inspectReply(pick.replace('    - 寨是什麼？ :: 防守的地方\n', ''), form({ subject: 'chinese', term: '小五上', unit: 'L7 詩' }), chinese, [], nobody);
  assert.deepEqual(few.errors, []);
  assert.ok(few.hints.some(each => each.message.includes('每個字至少兩句')));
  assert.ok(!inspectEnglish(ENGLISH).hints.some(each => each.message.includes('「能……」')));
});

void test('§4 AI 自己寫的 ID：只拿掉新目標與候選名稱行行尾的（不限 6 碼）；行中、一行兩個擋；題目、答案、加進已有的不動', () => {
  const science = subject('science');
  const withIds = R3_REPLY
    .replace('- 能用粒子運動說明擴散現象\n', '- 能用粒子運動說明擴散現象 ^k3m9x2\n')
    .replace('> - 能說明溫度對溶解度的影響', '> - 能說明溫度對溶解度的影響 ^my-own-id')
    .replace('從**濃度低**的地方', '從**濃度低**的地方 ^abc234');
  const result = inspectReply(withIds, form(), science, [], nobody);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.removed.map(each => [result.normalized.raw[each.line], each.text]), [[15, '^k3m9x2'], [25, '^my-own-id']]);
  const middle = inspectReply(R3_REPLY.replace('- 能用粒子運動說明擴散現象\n', '- 能用 ^k3m9x2 粒子運動說明擴散現象\n'), form(), science, [], nobody);
  assert.match(middle.errors.map(each => `${String(each.line)} ${each.message}`).join('\n'), /15 學習目標名稱那一行中間有 ID/);
  const two = inspectReply(R3_REPLY.replace('- 能用粒子運動說明擴散現象\n', '- 能用粒子運動 ^k3m9x2 說明擴散現象 ^p7q2w8\n'), form(), science, [], nobody);
  assert.equal(two.errors.length, 1);
});

void test('§4 加進已有的學習目標：ID 不在送出的清單裡、找不到、重複或需要新版、不在同一篇都只提示，照原文留著', () => {
  const sent: ExistingTarget[] = [{ id: 'q8z3ka', name: '能用密度判斷物體的浮沉', source: '國二上 2-1 p.46', path: 'Essence Cards/學業/國二上/自然/2-1.md' }];
  const science = subject('science');
  const hints = (now: (id: string) => ExistingNow, list = sent) => inspectReply(R3_REPLY, form(), science, list, now).hints.filter(each => each.line === 20).map(each => each.message);
  assert.deepEqual(hints(() => ({ kind: 'one', path: sent[0].path, name: '能用密度判斷浮沉' })), []);
  assert.match(hints(nobody, [])[0], /不在這次送出的已有學習目標裡/);
  assert.match(hints(nobody)[0], /找不到學習目標/);
  assert.match(hints(() => ({ kind: 'unusable' }))[0], /重複或需要新版/);
  assert.match(hints(() => ({ kind: 'one', path: 'Essence Cards/別篇.md', name: 'x' }))[0], /已經不在送出時的那一篇/);
});

void test('§5 存草稿的全文：屬性用 YAML 序列化（L3 Sports: Week 1 讀回來仍是草稿）、新目標與候選配 ID、快照本文同一組 ID、加進已有的轉成連結', () => {
  const sent: ExistingTarget[] = [{ id: 'q8z3ka', name: '能用密度判斷物體的浮沉', source: '國二上 2-1 p.46', path: 'Essence Cards/學業/國二上/自然/國二上自然 2-1 密度（卡片）.md' }];
  const now = (): ExistingNow => ({ kind: 'one', path: sent[0].path, name: '能用密度判斷浮沉' });
  const withId = R3_REPLY.replace('- 能用粒子運動說明擴散現象\n', '- 能用粒子運動說明擴散現象 ^k3m9x2\n');
  const inspection = inspectReply(withId, form({ unit: '2-2 水溶液: 濃度' }), subject('science'), sent, now);
  const plan = planDraft(inspection, form({ unit: '2-2 水溶液: 濃度' }), subject('science'), sent, now, counter(), new Set(), '2026-11-07');
  assert.equal(plan.decks.length, 1);
  const [deck] = plan.decks;
  assert.equal(deck.path, 'Essence Cards/學業/國二上/自然/國二上自然 2-2 水溶液： 濃度（卡片）.md');
  assert.ok(deck.text.startsWith('---\n年級學期: 國二上\n科目: 自然\n單元: "2-2 水溶液: 濃度"\n狀態: 草稿\n---\n\n> [!note] 給家長的備註\n'));
  const parsed = parseDeck(deck.text);
  assert.equal(parsed.props.status, 'draft');
  assert.deepEqual(parsed.props.unit, { code: '2-2', name: '水溶液: 濃度' });
  assert.deepEqual(deck.ids, ['aaaaa2', 'bbbbb2']);
  assert.ok(deck.text.includes('\n- 能用粒子運動說明擴散現象 ^aaaaa2\n'));
  assert.ok(deck.text.includes('\n> - 能說明溫度對溶解度的影響 ^bbbbb2\n'));
  assert.ok(deck.text.includes('\n> - [[國二上自然 2-1 密度（卡片）#^q8z3ka|能用密度判斷浮沉]]\n'));
  assert.ok(!deck.text.includes('<<<'));
  assert.equal(deck.sha256, sha256Hex(deck.text));
  // 快照本文：三段與 <<<完>>> 照原文，名稱行多了同一組 ID、少了 AI 的 ID；加進已有的照原文。
  assert.ok(plan.snapshotBody.startsWith('<<<全貌>>>\n'));
  assert.ok(plan.snapshotBody.includes('\n- 能用粒子運動說明擴散現象 ^aaaaa2\n') && plan.snapshotBody.includes('\n> - 能說明溫度對溶解度的影響 ^bbbbb2\n'));
  assert.ok(plan.snapshotBody.includes('\n> - q8z3ka 能用密度判斷物體的浮沉\n') && plan.snapshotBody.endsWith('<<<完>>>\n'));
  assert.deepEqual(plan.edits, ['第 15 行 拿掉 ^k3m9x2']);
  assert.equal(plan.snapshotPath, 'Essence Cards/紀錄/AI 輸出/2026-11-07 國二上自然 2-2 水溶液： 濃度.md');
});

void test('§5 有比較卡的篇寫需要版本；一般知識只寫狀態；檔名撞名往後加（同資料夾、別的資料夾、大小寫不同、 2 已經有人用）', () => {
  const pick = '<<<全貌>>>\n無\n<<<架構>>>\n無\n<<<卡組>>>\n## 相似字\n\n- 寨（寨、塞） 相似字\n    - 出處：p.1\n    - 山＿＿。 :: 寨\n    - 木＿＿。 :: 寨\n    - 記憶錨點：下面是**木**\n- 塞（寨、塞） 相似字\n    - 出處：p.1\n    - ＿＿車。 :: 塞\n    - ＿＿住。 :: 塞\n    - 記憶錨點：下面是**土**\n<<<完>>>';
  const chineseForm = form({ subject: 'chinese', term: '小五上', unit: 'L7 詩兩首' });
  const inspected = inspectReply(pick, chineseForm, subject('chinese'), [], nobody);
  assert.deepEqual(inspected.errors, []);
  const taken = new Set(['小五上國語 l7 詩兩首（卡片）', '小五上國語 l7 詩兩首（卡片） 2']);
  const plan = planDraft(inspected, chineseForm, subject('chinese'), [], nobody, counter(), taken, '2026-11-07');
  assert.equal(plan.decks[0].path, 'Essence Cards/學業/小五上/國語/小五上國語 L7 詩兩首（卡片） 3.md');
  assert.match(plan.decks[0].text, /^---\n年級學期: 小五上\n科目: 國語\n單元: L7 詩兩首\n狀態: 草稿\n需要版本: 0\.4\.0\n---\n/);
  assert.equal(parseDeck(plan.decks[0].text).props.need, '0.4.0');
  const general = inspectReply('## 睡眠\n\n- 能說出睡眠的階段\n    - 出處：[[睡眠講座]]\n    - 睡眠分哪幾個階段？ :: 淺睡、深睡、快速動眼\n<<<完>>>', form({ subject: 'general', unit: '睡眠講座' }), subject('general'), [], nobody);
  const generalPlan = planDraft(general, form({ subject: 'general', unit: '睡眠講座' }), subject('general'), [], nobody, counter(), new Set(), '2026-11-07');
  assert.equal(generalPlan.decks[0].path, 'Essence Cards/睡眠講座（卡片）.md');
  assert.ok(generalPlan.decks[0].text.startsWith('---\n狀態: 草稿\n---\n\n## 睡眠\n'));
  assert.equal(generalPlan.snapshotPath, 'Essence Cards/紀錄/AI 輸出/2026-11-07 睡眠講座.md');
  // 同一次的兩篇不互撞；配號照篇的順序。
  const two = planDraft(inspectEnglish(ENGLISH), englishForm, subject('english'), [], nobody, counter(), new Set(['國二上英文 l3 單字']), '2026-11-07');
  assert.deepEqual(two.decks.map(deck => [deck.path.split('/').pop(), deck.ids]), [['國二上英文 L3 單字 2.md', ['aaaaa2']], ['國二上英文 L3 文法.md', ['bbbbb2']]]);
  assert.ok(two.decks[0].text.startsWith('---\n年級學期: 國二上\n科目: 英文\n單元: "L3 Sports: Week 1"\n狀態: 草稿\n---\n\n## 單字\n'));
});

void test('§3 待貼回的工作：最多 5 個、14 天；過期的只丟還沒開始存草稿的；缺欄位的不能用', () => {
  const day = 86_400_000;
  const job = (id: string, ms: number, saved = false) => ({
    id, copiedAt: 'x', copiedMs: ms, form: form(), subject: { key: 'science', label: '自然', subject: '自然', r3: true },
    parts: [{ name: '任務段', version: '提示 v1', text: 't', sha256: sha256Hex('t') }], promptSha: 'p', existing: [],
    save: saved ? { reply: 'r', replySha: 's', service: null, startedAt: 'x', decks: [], snapshotPath: 'p', snapshotBody: 'b', edits: [], published: null } : null,
  });
  const now = 100 * day;
  const read = readJobs([job('a', now - 15 * day), job('b', now - 15 * day, true), ...['c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => job(id, now - i * day)), { id: 'broken' }], now);
  assert.deepEqual(read.jobs.map(each => each.id), ['b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual([read.broken, read.expired], [1, 2]);
  assert.deepEqual(readJobs('not a list', now), { jobs: [], broken: 0, expired: 0 });
});
