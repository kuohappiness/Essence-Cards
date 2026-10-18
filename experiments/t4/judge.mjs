// 用 Jev（TypeSafe AI 的判斷模型）逐題檢查 AI 製卡草稿的品質，取代一部分 Claude 逐題評分（T7）。
// Jev 只回答是／否機率與評分，不寫字；這裡把通用規則 8～10 的題目品質寫成固定的檢查題，每一題各問一次。
// 用法：node judge.mjs <卡片.md>… --out <repo外資料夾> [--purpose <學習目的>] [--grade 國二] [--lang zh|en]
//         [--model jev-latest] [--threshold 0.5] [--expect <標準答案.json>] [--subject 自然] [--dry-run]
//       node judge.mjs --selftest
// 金鑰讀 %USERPROFILE%\.essence-api-keys.env 的 TYPESAFE_API_KEY；TYPESAFE_BASE_URL 可換成其他閘道。
// --dry-run 不送出，只把請求寫進 --out，用來確認送出的內容。
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { check } from './check-syntax.mjs';
import { loadKeys, redact, writeJson, writeFileRetry } from './core.mjs';

const PRICE = 0.042 / 1e6; // 每個輸入 token 的美元標價；輸出免費（2026-09 官方標價）

// 檢查題：code 對到 check-syntax.mjs 的提醒代碼時，報告會並列兩邊的結果。
export const CHECKS = {
  zh: {
    leak: { hint: 'leak-pattern', instructions: '只看「題目」，學生不用回想所學就能推出答案嗎？', criteria: { true: '題目裡已經寫出答案、答案的關鍵字，或用比較句型暗示了答案', false: '一定要回想學過的內容才答得出來' } },
    two: { hint: 'two-questions', instructions: '這一題是不是同時要學生回答兩件以上不同的事？', criteria: { true: '要回答兩個以上獨立的問題或知識點', false: '只問一件事；「是什麼、為什麼」當成一個完整的解釋也算一件事' } },
    yesno: { hint: 'yes-no', instructions: '這一題是不是是非題，或只能在兩個選項之間猜？', criteria: { true: '回答「是／否」「對／錯」或兩者擇一就能過關，用猜的也有一半機會', false: '要說出具體的內容' } },
    options: { hint: 'which-of', instructions: '這一題是不是一定要看到選項才能作答？', criteria: { true: '例如「下列何者」，但沒有給選項', false: '不需要選項就能回答' } },
    context: { hint: 'context', instructions: '這一題單獨拿出來看，看得懂在問什麼嗎？', criteria: { true: '看不懂：依賴上文、前一題或沒有附上的圖', false: '單獨看就懂' } },
    vague: { hint: null, instructions: '學生在腦中回答後，能根據「答案」清楚判斷自己對不對嗎？', criteria: { true: '不能：答案太長、太散，或可以有很多種說法', false: '能：答案短而明確，理解題有清楚的重點' } }
  },
  en: {
    leak: { hint: 'leak-pattern', instructions: 'Looking only at the question (題目), could a student infer the answer without recalling anything they learned?', criteria: { true: 'The question already contains the answer, its key words, or hints it through a comparison phrasing', false: 'The student must recall learned content to answer' } },
    two: { hint: 'two-questions', instructions: 'Does this question ask the student to answer two or more different things?', criteria: { true: 'Two or more independent questions or facts must be answered', false: 'It asks one thing; "what and why" as one complete explanation counts as one thing' } },
    yesno: { hint: 'yes-no', instructions: 'Is this a yes/no question, or one where the student can only guess between two options?', criteria: { true: 'Answering yes/no, true/false or picking one of two passes; guessing has a 50% chance', false: 'The student must state specific content' } },
    options: { hint: 'which-of', instructions: 'Does this question require seeing answer options to be answerable?', criteria: { true: 'e.g. "which of the following" with no options given', false: 'It can be answered without options' } },
    context: { hint: 'context', instructions: 'Read on its own, is it clear what this question asks?', criteria: { true: 'Not clear: it depends on earlier text, a previous question, or a missing figure', false: 'Clear on its own' } },
    vague: { hint: null, instructions: 'After answering in their head, can the student clearly judge from the answer (答案) whether they were right?', criteria: { true: 'No: the answer is long, scattered, or can be phrased many ways', false: 'Yes: the answer is short and clear, or has clear key points' } }
  }
};
const RANK = {
  zh: { instructions: '對這個學習目的來說，這個學習目標有多值得花時間記住？', criteria: ['不需要', '可有可無', '有幫助', '重要', '核心，一定要會'] },
  en: { instructions: 'For this learning purpose, how worth remembering is this learning target?', criteria: ['Not needed', 'Optional', 'Helpful', 'Important', 'Core, must know'] }
};

const plain = s => s.replace(/!\[\[[^\]]*\]\]/g, '［圖］').replace(/\*\*/g, '').trim();

export function buildRequests(cards, { lang = 'zh', grade = '', purpose = '', model = 'jev-latest' } = {}) {
  const checks = CHECKS[lang], requests = [];
  for (const card of cards) {
    for (const target of card.targets) {
      target.questions.forEach((q, index) => requests.push({
        kind: 'question', file: card.file, line: q.line, target: target.name, index, front: q.front, hints: card.hints.get(q.line) ?? [],
        body: {
          model,
          state: { 學生: grade || '未指定', 學習目標: target.name, 類型: target.data['類型'] ?? '', 題目: plain(q.front), 答案: plain(q.back) },
          questions: Object.fromEntries(Object.entries(checks).map(([code, c]) => [code, { type: 'noul', instructions: c.instructions, criteria: c.criteria }]))
        }
      }));
      if (purpose) requests.push({
        kind: 'rank', file: card.file, line: target.line, target: target.name,
        body: {
          model,
          state: { 學生: grade || '未指定', 學習目的: purpose, 學習目標: target.name, 題目: target.questions.map(q => plain(q.front)) },
          questions: { worth: { type: 'score', instructions: RANK[lang].instructions, criteria: RANK[lang].criteria } }
        }
      });
    }
  }
  return requests;
}

export async function send(request, { key, base, fetchImpl = fetch, wait = sleep, tries = 4 }) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(`${base}/systemone`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(request.body)
    });
    if (response.ok) return response.json();
    const text = await response.text();
    if (attempt + 1 >= tries || !(response.status === 429 || response.status >= 500)) throw new Error(`Jev ${response.status}：${redact(text, [key]).slice(0, 300)}`);
    await wait(2000 * 2 ** attempt);
  }
}

// 標準答案：[{ "題目": "…", "標記": ["leak", "two"] }]，題目寫正面的開頭幾個字也可以。標記空陣列代表這題沒問題。
export function agreement(results, expect, threshold) {
  const rows = [], codes = Object.keys(CHECKS.zh);
  const matched = expect.map(e => ({ e, r: results.find(r => r.kind === 'question' && r.answers && r.front.includes(e['題目'])) })).filter(x => x.r);
  for (const code of codes) {
    let tp = 0, fp = 0, fn = 0, tn = 0, htp = 0, hfp = 0, hfn = 0;
    const hint = CHECKS.zh[code].hint;
    for (const { e, r } of matched) {
      const truth = e['標記'].includes(code), jev = r.answers[code] >= threshold, regex = hint ? r.hints.includes(hint) : null;
      if (jev && truth) tp++; else if (jev) fp++; else if (truth) fn++; else tn++;
      if (regex !== null) { if (regex && truth) htp++; else if (regex) hfp++; else if (truth) hfn++; }
    }
    rows.push({ code, n: matched.length, tp, fp, fn, tn, hint: hint ? { tp: htp, fp: hfp, fn: hfn } : null });
  }
  return { matched: matched.length, missing: expect.length - matched.length, rows };
}

export function format(results, { threshold, purpose, expectResult }) {
  const questions = results.filter(r => r.kind === 'question'), ranks = results.filter(r => r.kind === 'rank');
  const failed = results.filter(r => r.error), tokens = results.reduce((s, r) => s + (r.usage?.input_tokens ?? 0), 0);
  const out = ['# Jev 逐題檢查', '', `- 題目 ${questions.length}｜失敗 ${failed.length}｜門檻 ${threshold}｜輸入 ${tokens} token，約 ${(tokens * PRICE).toFixed(5)} 美元`, ''];
  for (const code of Object.keys(CHECKS.zh)) {
    const hint = CHECKS.zh[code].hint;
    const flagged = questions.filter(r => r.answers?.[code] >= threshold);
    out.push(`## ${code}：${CHECKS.zh[code].instructions}`, '', `Jev 標出 ${flagged.length} 題${hint ? `；check-syntax 的「${hint}」提醒 ${questions.filter(r => r.hints.includes(hint)).length} 題` : ''}`, '');
    for (const r of flagged.sort((a, b) => b.answers[code] - a.answers[code])) out.push(`- ${r.answers[code].toFixed(2)}｜${path.basename(r.file)}:${r.line}｜${r.front}${hint && r.hints.includes(hint) ? '（程式也提醒）' : ''}`);
    if (hint) for (const r of questions.filter(r => r.hints.includes(hint) && !(r.answers?.[code] >= threshold))) out.push(`- 只有程式提醒（Jev ${r.answers?.[code]?.toFixed(2) ?? '失敗'}）｜${path.basename(r.file)}:${r.line}｜${r.front}`);
    out.push('');
  }
  if (purpose) {
    out.push(`## 學習目標排序（學習目的：${purpose}）`, '', '分數 0～4，越高越值得記；外掛照這個順序截斷，超過上限的移到候選卡片。', '');
    for (const r of [...ranks].sort((a, b) => (b.answers?.worth?.score ?? -1) - (a.answers?.worth?.score ?? -1))) out.push(`- ${r.answers ? `${r.answers.worth.score.toFixed(2)}（把握 ${r.answers.worth.confidence.toFixed(2)}）` : '失敗'}｜${r.target}`);
    out.push('');
  }
  if (expectResult) {
    out.push('## 和標準答案比較', '', `對到 ${expectResult.matched} 題，找不到 ${expectResult.missing} 題。精確率＝標出的有幾成真的有問題；召回率＝有問題的抓到幾成。`, '',
      '| 檢查 | Jev 精確率 | Jev 召回率 | 程式精確率 | 程式召回率 |', '|---|---|---|---|---|');
    const pct = (a, b) => b ? `${Math.round(a / b * 100)}%（${a}/${b}）` : '—';
    for (const r of expectResult.rows) out.push(`| ${r.code} | ${pct(r.tp, r.tp + r.fp)} | ${pct(r.tp, r.tp + r.fn)} | ${r.hint ? pct(r.hint.tp, r.hint.tp + r.hint.fp) : '—'} | ${r.hint ? pct(r.hint.tp, r.hint.tp + r.hint.fn) : '—'} |`);
    out.push('');
  }
  if (failed.length) out.push('## 失敗', '', ...failed.map(r => `- ${path.basename(r.file)}:${r.line}｜${r.error}`), '');
  return out.join('\n');
}

export async function run(files, options, deps = {}) {
  const cards = [];
  for (const file of files) {
    const result = check(await fs.readFile(file, 'utf8'), { subject: options.subject });
    const hints = new Map();
    for (const i of result.issues) hints.set(i.line, [...(hints.get(i.line) ?? []), i.code]);
    cards.push({ file, targets: result.targets, hints });
  }
  const requests = buildRequests(cards, options);
  await fs.mkdir(options.out, { recursive: true });
  if (options.dryRun) { await writeJson(path.join(options.out, 'Jev 請求.json'), requests.map(r => r.body)); return { requests, results: [] }; }
  const key = deps.key ?? (await loadKeys({ typesafe: { keyName: 'TYPESAFE_API_KEY' } })).typesafe;
  if (!key) throw new Error('找不到 TYPESAFE_API_KEY：請放進 %USERPROFILE%\\.essence-api-keys.env');
  const base = (process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai/v1').replace(/\/$/, '');
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < requests.length) {
      const request = requests[next++], { body, ...meta } = request;
      try {
        const response = await send(request, { key, base, fetchImpl: deps.fetch, wait: deps.wait });
        const answers = request.kind === 'question'
          ? Object.fromEntries(Object.entries(response.answers).map(([code, a]) => [code, a.noul]))
          : response.answers;
        results.push({ ...meta, model: response.model, answers, usage: response.usage });
      } catch (error) { results.push({ ...meta, error: error.message }); }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker)); // 官方上限每分鐘 1,200 次，4 條同時送就夠
  results.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const expectResult = options.expect ? agreement(results, JSON.parse(await fs.readFile(options.expect, 'utf8')), options.threshold) : null;
  await writeJson(path.join(options.out, 'Jev 結果.json'), results);
  await writeFileRetry(path.join(options.out, 'Jev 報告.md'), format(results, { ...options, expectResult }));
  return { requests, results, expectResult };
}

async function selftest() {
  const dir = await fs.mkdtemp(path.join((await import('node:os')).tmpdir(), 'judge-'));
  const card = `## 2 溶液
- 能說出溶質與溶劑
    - 出處：p.43｜類型：定義
    - 糖水裡的糖是什麼？ :: 溶質
    - 糖水裡的糖是溶質還是溶劑？ :: 溶質
- 能說明溫度對溶解度的影響
    - 出處：p.45｜類型：因果
    - 為什麼熱水比冷水能溶解更多糖？ :: **溫度越高**，多數固體的**溶解度越大**
`;
  await fs.writeFile(path.join(dir, '卡片.md'), card);
  const expect = [{ 題目: '糖水裡的糖是什麼', 標記: [] }, { 題目: '糖水裡的糖是溶質還是', 標記: ['yesno'] }, { 題目: '為什麼熱水', 標記: [] }];
  await fs.writeFile(path.join(dir, '標準答案.json'), JSON.stringify(expect));
  const sent = [];
  const fake = async (url, init) => {
    const body = JSON.parse(init.body); sent.push({ url, body, auth: init.headers.authorization });
    if (sent.length === 1) return { ok: false, status: 503, text: async () => 'busy' };
    const twoChoice = String(body.state.題目 ?? '').includes('還是');
    const answers = Object.fromEntries(Object.entries(body.questions).map(([code, q]) => [code, q.type === 'noul'
      ? { type: 'noul', noul: code === 'yesno' && twoChoice ? 0.9 : 0.1 }
      : { type: 'score', score: body.state.學習目標.includes('溫度') ? 3.6 : 2.1, confidence: 0.8 }]));
    return { ok: true, json: async () => ({ model: 'jev-1.13.0', answers, usage: { input_tokens: 300, output_tokens: 0 } }) };
  };
  const options = { out: dir, purpose: '段考自然', grade: '國二', lang: 'zh', model: 'jev-latest', threshold: 0.5, expect: path.join(dir, '標準答案.json') };
  const { requests, results, expectResult } = await run([path.join(dir, '卡片.md')], options, { key: 'sk-test', fetch: fake, wait: async () => {} });
  const failures = [];
  if (requests.length !== 5) failures.push(`請求數 ${requests.length}，應為 5（3 題＋2 個排序）`);
  const q = sent.find(s => s.body.questions.leak)?.body;
  if (!q || q.questions.leak.type !== 'noul' || !q.questions.leak.criteria.true || q.model !== 'jev-latest') failures.push('檢查題的格式不對');
  if (!sent.every(s => s.url === 'https://api.typesafe.ai/v1/systemone' && s.auth === 'Bearer sk-test')) failures.push('網址或金鑰標頭不對');
  if (results.some(r => r.error)) failures.push('503 後沒有重試成功：' + results.filter(r => r.error).map(r => r.error).join('；'));
  const yesno = expectResult?.rows.find(r => r.code === 'yesno');
  if (!yesno || yesno.tp !== 1 || yesno.fp !== 0 || expectResult.matched !== 3) failures.push('和標準答案的比較不對：' + JSON.stringify(yesno));
  const report = await fs.readFile(path.join(dir, 'Jev 報告.md'), 'utf8');
  if (!/3\.60.*溫度/.test(report.split('學習目標排序')[1]?.split('\n').find(l => l.startsWith('- ')) ?? '')) failures.push('排序沒有把分數高的排第一');
  if (report.includes('sk-test')) failures.push('報告裡出現金鑰');
  await run([path.join(dir, '卡片.md')], { ...options, dryRun: true, out: path.join(dir, 'dry') });
  if (JSON.parse(await fs.readFile(path.join(dir, 'dry', 'Jev 請求.json'), 'utf8')).length !== 5) failures.push('--dry-run 沒寫出 5 個請求');
  await fs.rm(dir, { recursive: true, force: true });
  console.log(failures.length ? 'FAIL\n' + failures.join('\n') : 'selftest：請求格式、重試、排序、標準答案比較、--dry-run 都正常');
  if (failures.length) process.exitCode = 1;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    out: { type: 'string' }, purpose: { type: 'string' }, grade: { type: 'string' }, lang: { type: 'string', default: 'zh' },
    model: { type: 'string', default: 'jev-latest' }, threshold: { type: 'string', default: '0.5' }, expect: { type: 'string' },
    subject: { type: 'string' }, 'dry-run': { type: 'boolean' }, selftest: { type: 'boolean' }
  } });
  if (values.selftest) return selftest();
  if (!positionals.length || !values.out || !CHECKS[values.lang]) {
    console.log('用法：node judge.mjs <卡片.md>… --out <repo外資料夾> [--purpose <學習目的>] [--grade 國二] [--lang zh|en] [--model jev-latest] [--threshold 0.5] [--expect <標準答案.json>] [--dry-run]\n      node judge.mjs --selftest');
    return;
  }
  const { results } = await run(positionals, { ...values, threshold: Number(values.threshold), dryRun: values['dry-run'] });
  if (values['dry-run']) console.log(`已寫出請求：${path.join(values.out, 'Jev 請求.json')}`);
  else console.log(`完成 ${results.length} 個請求，報告：${path.join(values.out, 'Jev 報告.md')}`);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
