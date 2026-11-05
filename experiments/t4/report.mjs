import fs from 'node:fs/promises';
import path from 'node:path';
import { exists, readJson, slug } from './core.mjs';
import { languageStats } from './language.mjs';

export { languageStats };
const count = (text, regex) => [...text.matchAll(regex)].length;
export function inspectCards(text) {
  const lines = text.split(/\r?\n/), errors = [], goals = [];
  const requiredSections = ['學習目標', '候選但未採用', '給家長的備註'];
  let section, goal, awaitingAnswer = false, questionIds = [], sections = [];
  const add = (line, message) => errors.push({ line, message });
  const close = line => {
    if (!goal) return;
    for (const field of ['類型', '重要性', '出處']) if (!goal.fields[field]) add(goal.line, `缺少${field}`);
    if (!goal.questions) add(goal.line, '沒有題目');
    if (goal.questions < 2 || goal.questions > 3) add(goal.line, '初次題目池應為 Q1 加 1～2 題進階題');
    if (questionIds.join(',') !== Array.from({ length: questionIds.length }, (_, i) => i + 1).join(',')) add(goal.line, 'Q 編號應從 1 連續遞增');
    if (awaitingAnswer) add(line, '題目缺少 A');
    goal = null; questionIds = []; awaitingAnswer = false;
  };
  lines.forEach((line, i) => {
    const n = i + 1;
    if (!line.trim()) return;
    const heading = line.match(/^## (.+)$/);
    if (heading) {
      close(n); section = heading[1]; sections.push(section);
      if (!requiredSections.includes(section)) add(n, '不允許的第二層標題');
      return;
    }
    const title = line.match(/^### LT-(\d+) (能.+)$/);
    if (title && section === '學習目標') {
      close(n); goal = { line: n, id: title[1], fields: {}, questions: 0 }; goals.push(goal);
      if (goals.some(g => g !== goal && g.id === goal.id)) add(n, 'LT 編號重複');
      return;
    }
    if (section === '學習目標' && goal) {
      const field = line.match(/^- (類型|重要性|出處)：(.+)$/);
      if (field) {
        if (goal.fields[field[1]]) add(n, `${field[1]}重複`);
        goal.fields[field[1]] = field[2].trim();
        if (field[1] === '重要性' && !['高', '中', '低'].includes(field[2])) add(n, '重要性應為高、中、低');
        if (field[1] === '類型' && !['定義', '因果', '比較', '順序', '實驗', '公式與單位', '圖表'].includes(field[2])) add(n, '類型不在自然預設清單');
        if (field[1] === '出處' && /^(無|不明|未知|未提供)$/.test(field[2])) add(n, '出處未填實際依據');
        return;
      }
      const q = line.match(/^- Q(\d+)(（進階）)?：(.+)$/);
      if (q) {
        if (awaitingAnswer) add(n, '前一題缺少 A');
        goal.questions++; questionIds.push(Number(q[1])); awaitingAnswer = true;
        if (Number(q[1]) >= 2 && !q[2]) add(n, '進階題缺少（進階）標記');
        return;
      }
      if (/^  - A：\S/.test(line)) {
        if (!awaitingAnswer) add(n, 'A 沒有對應題目');
        awaitingAnswer = false; return;
      }
      if (/^    \S/.test(line) && !awaitingAnswer) return; // 答案換行。
      if (/^\s*$/.test(line)) return; // 只有空白的行。
      if (/^\s{2,}!\[\[[^\]\n]+\]\]\s*$/.test(line) && !awaitingAnswer) return; // 答案下方直接附圖（使用者 2026-10-13）。
      add(n, '不符合學習目標、欄位、Q 或 A 格式'); return;
    }
    if (['候選但未採用', '給家長的備註'].includes(section) && /^- .+/.test(line)) return;
    add(n, '不符合輸出格式或位於不允許的段落');
  });
  close(lines.length);
  // 必要段落只有「學習目標」；「候選但未採用」「給家長的備註」可有可無，但出現時要照順序、各一次。
  if (sections[0] !== '學習目標' || new Set(sections).size !== sections.length || sections.some(x => !requiredSections.includes(x)) || sections.map(x => requiredSections.indexOf(x)).some((v, i, a) => i && v < a[i - 1])) add(1, '段落：第一段要是「學習目標」，其餘可省略，但不能重複或顛倒');
  const sourced = goals.filter(g => g.fields.出處 && !/^(無|不明|未知|未提供)$/.test(g.fields.出處)).length;
  return { goals: goals.length, questions: count(text, /^\s*-\s*Q\d+/gm), sourced, sourceRatio: goals.length ? `${(sourced / goals.length * 100).toFixed(1)}%` : '—', errors };
}
export function transcriptStats(text, actualPages) {
  const marks = [...text.matchAll(/^(?:p\.(\d+) \^p\1|PDF 第 (\d+) 頁 \^pdf\2)\s*$/gm)];
  const success = count(text, /!\[\[[^\]\n]+\.png\]\]/g), failed = count(text, /<figure\b/g);
  return { characters: [...text.replace(/\s/g, '')].length, uncertain: count(text, /\[\?\]/g), pages: marks.length,
    pagesMatch: marks.length === actualPages && new Set(marks.map(m => m[1] || m[2])).size === actualPages,
    figures: success + failed, success, failed, teachers: count(text, /\[!教師註記\]/g) };
}
export function verificationStats(text) {
  const lines = text.split(/\r?\n/).filter(line => /^\s*-\s*頁\s*\d+/.test(line));
  return { total: lines.length, high: lines.filter(l => /把握：高/.test(l)).length, low: lines.filter(l => /把握：低/.test(l)).length };
}
export async function report(config, out) {
  const logFile = path.join(out, '紀錄.json');
  const records = await exists(logFile) ? await readJson(logFile) : [];
  const manifest = await exists(path.join(out, '頁面/文字層.json')) ? await readJson(path.join(out, '頁面/文字層.json')) : { pages: [] };
  const models = [...new Map([...config.transcribe, ...config.verify, ...config.cards].map(m => [`${m.provider}/${m.model}`, m])).values()];
  const rows = [], details = [], usageRows = [];
  for (const model of models) {
    const id = slug(model.model), related = records.filter(r => r.model === model.model && r.provider === model.provider);
    const transcript = path.join(out, id, '轉錄稿.md'), verification = path.join(out, id, '檢查.md');
    let transCell = '—', verifyCell = '—';
    if (await exists(transcript)) {
      const text = await fs.readFile(transcript, 'utf8'), s = transcriptStats(text, manifest.pages.length);
      transCell = `${s.characters} 字；[?] ${s.uncertain}；頁 ${s.pages}/${manifest.pages.length}；圖 ${s.success}/${s.figures}`;
      details.push(`### ${id}／轉錄稿\n\n- 字數（含 Markdown、排除空白）：${s.characters}\n- [?]：${s.uncertain}\n- 頁碼標記：${s.pages}；實際頁數：${manifest.pages.length}；數量及唯一性${s.pagesMatch ? '相符' : '不符'}\n- 圖：${s.figures}；裁切成功：${s.success}；失敗／未解析標記：${s.failed}\n- 教師註記：${s.teachers}\n${languageLine(text)}`);
    }
    if (await exists(verification)) {
      const s = verificationStats(await fs.readFile(verification, 'utf8'));
      verifyCell = `${s.total}（高 ${s.high}／低 ${s.low}）`;
      details.push(`### ${id}／檢查\n\n- 問題數：${s.total}；把握高：${s.high}；把握低：${s.low}；未標把握：${s.total - s.high - s.low}`);
    }
    const cardCells = [];
    for (const variant of ['只用轉錄稿', '轉錄稿加原頁']) {
      const file = path.join(out, '卡片', `${id}-${variant}.md`);
      if (!(await exists(file))) { cardCells.push('—'); continue; }
      const text = await fs.readFile(file, 'utf8'), s = inspectCards(text);
      cardCells.push(`${s.goals}/${s.questions}；${s.sourceRatio}；格式 ${s.errors.length}`);
      details.push(`### ${id}／${variant}\n\n- 學習目標：${s.goals}；題目：${s.questions}\n- 有出處的目標：${s.sourced}/${s.goals}（${s.sourceRatio}；同目標題目共用出處）\n${languageLine(text)}\n- 格式問題：${s.errors.length}${s.errors.length ? '\n' + s.errors.map(e => `  - 行 ${e.line}：${e.message}`).join('\n') : ''}`);
    }
    const input = related.reduce((sum, r) => sum + (r.usage?.prompt_tokens || 0), 0);
    const output = related.reduce((sum, r) => sum + (r.usage?.completion_tokens || 0), 0);
    const seconds = related.reduce((sum, r) => sum + r.seconds, 0);
    const price = config.pricesUsdPerMillion[model.model];
    const missingUsage = related.some(r => r.status === 200 && (r.usage?.prompt_tokens === undefined || r.usage?.completion_tokens === undefined));
    const cost = price && !missingUsage ? (input * price.input + output * price.output) / 1e6 : null;
    const status = related.length ? `${related.filter(r => r.outcome === 'ok').length}/${related.length} 成功` : '尚未請求';
    rows.push(`| ${model.model} | ${status} | ${transCell} | ${verifyCell} | ${cardCells.join(' | ')} | ${input}/${output}${missingUsage ? '（部分未知）' : ''} | ${seconds.toFixed(1)} | ${cost === null ? '未知' : cost.toFixed(6)} | ${cost === null ? '未知' : (cost * 60).toFixed(4)} |`);
    for (const step of ['transcribe', 'verify', 'cards']) {
      for (const variant of step === 'cards' ? ['只用轉錄稿', '轉錄稿加原頁'] : [undefined]) {
        const group = related.filter(r => r.step === step && (step !== 'cards' || r.variant === variant));
        if (!group.length) continue;
        const ti = group.reduce((s, r) => s + (r.usage?.prompt_tokens || 0), 0), to = group.reduce((s, r) => s + (r.usage?.completion_tokens || 0), 0);
        const unknown = group.some(r => r.status === 200 && (r.usage?.prompt_tokens === undefined || r.usage?.completion_tokens === undefined));
        const fee = price && !unknown ? (ti * price.input + to * price.output) / 1e6 : null;
        usageRows.push(`| ${step}${variant ? '/' + variant : ''} | ${model.model} | ${group.length} | ${group.filter(r => r.outcome === 'ok').length} | ${[...new Set(group.map(r => r.status ?? r.outcome))].join(', ')} | ${ti}/${to}${unknown ? '（部分未知）' : ''} | ${group.reduce((s, r) => s + r.seconds, 0).toFixed(1)} | ${fee === null ? '未知' : fee.toFixed(6)} | ${fee === null ? '未知' : (fee * 60).toFixed(4)} |`);
      }
    }
  }
  const header = '| 模型 | 請求成功/嘗試 | 轉錄 | 檢查問題 | 只用稿：目標/題/出處/格式問題 | 加原頁：目標/題/出處/格式問題 | token 輸入/輸出 | 秒 | 估算 USD | 60 次 USD |\n|---|---|---|---|---|---|---|---|---|---|';
  const table = header + '\n' + rows.join('\n');
  const result = `# T4 機械統計報告\n\n${table}\n\n- PDF 頁序：${manifest.pages.map(p => p.page).join('、') || '尚未渲染'}\n- 此報告只統計，不判斷正確性、學習效果或模型優劣。簡體字採固定常見字形清單；用語採指定八詞精確比對。\n- token／秒數包括既有紀錄與重試；秒數是請求耗時，不含限速或重試等待。\n- 費用使用 models.json 標價估算；免費方案的實際收費與估算不同。缺少 usage 的成功請求不當成零費用。\n- 60 次費用是本資料夾這輪累計估算乘 60，含兩份轉錄的檢查及兩種製卡，不代表單一正式流程的費用。\n- ${config.pricesNote || ''}\n\n## 請求與用量\n\n| 步驟 | 模型 | 嘗試 | 成功 | HTTP／狀態 | token 輸入/輸出 | 秒 | USD | 60 次 USD |\n|---|---|---|---|---|---|---|---|---|\n${usageRows.join('\n')}\n\n## 逐份統計\n\n${details.join('\n\n')}\n`;
  await fs.writeFile(path.join(out, '報告.md'), result);
  console.log(table);
  return table;
}
function languageLine(text) {
  const s = languageStats(text);
  return `- 常見簡體字形：${s.simplified}\n- 指定用語：${Object.entries(s.terms).map(([t, n]) => `${t} ${n}`).join('；')}`;
}
