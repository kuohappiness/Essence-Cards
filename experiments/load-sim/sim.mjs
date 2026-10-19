// T8 每日時間上限模擬：一學年每天需要幾分鐘，上限 15／20／30／45 分鐘夠不夠。
// 排程用 FSRS-5 預設參數（D-062、D-078 的估算也是這一版），出卡順序照 D-071。
// 用法：node sim.mjs [--seeds 20] [--sems 2] [--only A,C] [--json]
// 這是試作場的估算，不是產品程式；所有教材數量都是假設，寫在 SCENARIOS。

const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5, FACTOR = 19 / 81;
const AGAIN = 1, GOOD = 3, EASY = 4;

const retr = (t, s) => Math.pow(1 + FACTOR * t / s, DECAY);
const ivl = (r, s) => (s / FACTOR) * (Math.pow(r, 1 / DECAY) - 1);
const clampD = (d) => Math.min(10, Math.max(1, d));
const initD = (g) => clampD(W[4] - Math.exp(W[5] * (g - 1)) + 1);
function nextD(d, g) {
  const dp = d + (-W[6] * (g - 3)) * (10 - d) / 9;
  return clampD(W[7] * initD(EASY) + (1 - W[7]) * dp);
}
function sRecall(d, s, r, g) {
  const easy = g === EASY ? W[16] : 1;
  return s * (Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * easy + 1);
}
function sForget(d, s, r) {
  return Math.min(s, W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
}
const sShort = (s, g) => s * Math.exp(W[17] * (g - 3 + W[18]));

// 可重現的亂數
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- 教材與學期（假設） ----
// 一學期 140 天（20 週），段考在第 49、98、140 天；考前 14 天設考試範圍（D-078 考前提高到 90%、D-071 範圍內優先）。
// 寒暑假一律算 28 天，照常複習、不加新卡；之後每學期同樣的進度（--sems 6 是國中三年）。
const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const NSEM = Number(opt('--sems', 2));
const SEM_DAYS = 140, BREAK = 28, EXAMS = [49, 98, 140], RANGE_LEAD = 14;
const SEM_LEN = SEM_DAYS + BREAK;
const NEXAM = NSEM * 3;
const TOTAL_DAYS = (NSEM - 1) * SEM_LEN + SEM_DAYS + 1;

// 每種卡片作答一次的秒數（看題、想、翻面、自評）；重出的卡算 0.8 倍。
// D-071 的例子「50 張約 12 分鐘」平均 14.4 秒。
const SECS = { en: 8, enType: 15, sci: 18, soc: 14 };

function semesterUnits(offset) {
  const units = [];
  // 自然：每週一節，週末製卡（第 6 天起每 7 天一節），一節約 12 個學習目標（T4 的 2-2 是 11.7，D-101）
  for (let k = 0; k < 20; k++) units.push({ sub: '自然', type: 'sci', day: offset + 6 + 7 * k, n: 12, deepen: 3 });
  // 英文：一學期 6 課、每次段考前 2 課，一課 40 個新單字（D-069 的情境）
  for (const day of [6, 20, 55, 69, 104, 118]) units.push({ sub: '英文', type: 'en', day: offset + day, n: 40, enType: true });
  return units;
}
function socialUnits(offset) {
  const units = [];
  // 歷史、地理、公民：每科一學期 6 課，平均分在三次段考前，一課約 15 個學習目標
  for (const sub of ['歷史', '地理', '公民'])
    for (const day of [10, 31, 59, 80, 108, 129]) units.push({ sub, type: 'soc', day: offset + day, n: 15 });
  return units;
}

const SCENARIOS = {
  A: { name: 'A 英文＋自然（v1 驗證，D-018），英文只有英翻中', social: false, typeShare: 0, k: 1, skip: 0 },
  B: { name: 'B 同 A，三成單字開中翻英', social: false, typeShare: 0.3, k: 1, skip: 0 },
  C: { name: 'C 同 B，加歷史、地理、公民', social: true, typeShare: 0.3, k: 1, skip: 0 },
  D: { name: 'D 同 C，學生忘得比 FSRS 預設快（實際穩定度 0.7 倍）', social: true, typeShare: 0.3, k: 0.7, skip: 0 },
  E: { name: 'E 同 C，每週有一天沒複習', social: true, typeShare: 0.3, k: 1, skip: 1 / 7 },
  F: { name: 'F 同 C，作答慢 1.5 倍（自然一張 27 秒）', social: true, typeShare: 0.3, k: 1, skip: 0, slow: 1.5 },
};

function buildCards(sc, rand) {
  const cards = [];
  const units = [];
  for (let i = 0; i < NSEM; i++) {
    units.push(...semesterUnits(i * SEM_LEN));
    if (sc.social) units.push(...socialUnits(i * SEM_LEN));
  }
  for (const u of units) {
    const exam = examOf(u.day);
    const add = (type, day, extra = {}) => {
      const c = { type, sub: u.sub, release: day, exam, state: 'new', s: 0, d: 0, last: -1, first: -1, ...extra };
      cards.push(c); return c;
    };
    for (let i = 0; i < u.n; i++) {
      const base = add(u.type, u.day);
      // 中翻英：英翻中變成「記得」以後才開始出（D-069）
      if (u.enType && rand() < sc.typeShare) add('enType', u.day, { after: base });
    }
    // 循序漸進加深（D-100）：兩週後一節多約 3 張
    if (u.deepen) for (let i = 0; i < u.deepen; i++) add(u.type, u.day + 14);
  }
  return cards;
}

// 卡片屬於哪一次段考的範圍（學期內第幾次，加上學期）
function examOf(day) {
  const sem = Math.floor(day / SEM_LEN), local = day - sem * SEM_LEN;
  const i = EXAMS.findIndex((e) => local < e);
  return sem * 3 + (i < 0 ? 2 : i);
}
const examDay = (idx) => Math.floor(idx / 3) * SEM_LEN + EXAMS[idx % 3];
function activeRange(day) {
  for (let i = 0; i < NEXAM; i++) { const e = examDay(i); if (day >= e - RANGE_LEAD && day <= e) return i; }
  return -1;
}

function simulate(sc, capMin, seed) {
  const rand = rng(seed);
  const cards = buildCards(sc, rand);
  const cap = capMin * 60;
  const days = [];
  const examStats = [];
  const roll = (p) => rand() < p;
  const sec = (c) => SECS[c.type] * (sc.slow || 1);

  // 一次作答：回傳花的秒數；答錯的照 D-062 在同一次複習裡再出（沒印象約 1 分鐘、差一點約 10 分鐘後）
  function review(c, day, target) {
    let secs = sec(c);
    let g;
    if (c.state === 'new') {
      // 第一次：在課堂學過，三成左右已經會（D-069 第一次照常出題）
      const x = rand(); g = x < 0.6 ? AGAIN : x < 0.9 ? GOOD : EASY;
      c.s = W[g - 1]; c.d = initD(g); c.state = 'review'; c.first = day;
    } else {
      const t = day - c.last;
      const rTrue = retr(t, c.s * sc.k), rSched = retr(t, c.s);
      if (roll(rTrue)) { g = roll(0.12) ? EASY : GOOD; c.s = sRecall(c.d, c.s, rSched, g); }
      else { g = AGAIN; c.s = sForget(c.d, c.s, rSched); }
      c.d = nextD(c.d, g);
    }
    // 同一天重出：每次約八成五想得起來，最多三次
    let tries = 0;
    while (g === AGAIN && tries < 3) {
      secs += sec(c) * 0.8; tries++;
      g = roll(0.85) ? GOOD : AGAIN;
      c.s = sShort(c.s, g);
    }
    c.last = day;
    return secs;
  }

  for (let day = 0; day < TOTAL_DAYS; day++) {
    const range = activeRange(day);
    const tgt = (c) => (range >= 0 && c.exam === range ? 0.9 : 0.8);
    const isDue = (c) => c.state === 'review' && day - c.last >= Math.max(1, Math.round(ivl(tgt(c), c.s)));
    const avail = (c) => c.state === 'new' && c.release <= day &&
      (!c.after || (c.after.state === 'review' && !isDue(c.after) && c.after.first < day));

    // 段考當天早上：範圍內卡片的保持率（考前抽測，D-075）
    const ei = Array.from({ length: NEXAM }, (_, i) => i).find((i) => examDay(i) === day);
    if (ei !== undefined) {
      const inRange = cards.filter((c) => c.exam === ei && c.release <= day);
      const seen = inRange.filter((c) => c.state === 'review');
      const r = seen.reduce((a, c) => a + retr(day - c.last, c.s * sc.k), 0) / Math.max(1, seen.length);
      examStats.push({ exam: ei, retention: r, coverage: seen.length / Math.max(1, inRange.length) });
    }

    const due = cards.filter(isDue);
    const fresh = cards.filter(avail);
    const needSecs = due.reduce((a, c) => a + sec(c), 0) + fresh.reduce((a, c) => a + sec(c), 0);
    if (sc.skip && roll(sc.skip)) {
      days.push({ day, used: 0, due: due.length, fresh: fresh.length, needSecs, skipped: true });
      continue;
    }
    const lowR = (c) => retr(day - c.last, c.s);
    const inR = (c) => range >= 0 && c.exam === range;
    const queue = [
      ...due.filter(inR).sort((a, b) => lowR(a) - lowR(b)),
      ...fresh.filter(inR),
      ...due.filter((c) => !inR(c)).sort((a, b) => lowR(a) - lowR(b)),
      ...fresh.filter((c) => !inR(c)).sort((a, b) => a.release - b.release),
    ];
    let used = 0, done = 0;
    for (const c of queue) {
      if (used >= cap) break;
      used += review(c, day, tgt(c)); done++;
    }
    days.push({ day, used, done, due: due.length, fresh: fresh.length, left: queue.length - done, needSecs });
  }
  const waits = cards.filter((c) => c.first >= 0).map((c) => c.first - c.release);
  const never = cards.filter((c) => c.first < 0 && c.release < TOTAL_DAYS - 7).length;
  return { days, examStats, waits, never, cards: cards.length };
}

// ---- 彙整 ----
const SEEDS = Number(opt('--seeds', 20));
const ONLY = opt('--only', '').split(',').filter(Boolean);
const CAPS = [15, 20, 30, 45, 90, Infinity];
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const out = {};
for (const [key, sc] of Object.entries(SCENARIOS)) {
  if (ONLY.length && !ONLY.includes(key)) continue;
  out[key] = { name: sc.name, caps: {} };
  for (const cap of CAPS) {
    const runs = Array.from({ length: SEEDS }, (_, i) => simulate(sc, cap, 1000 + i));
    const sems = Array.from({ length: NSEM }, (_, i) => {
      const ds = runs.flatMap((r) => r.days.filter((d) => d.day >= i * SEM_LEN && d.day < i * SEM_LEN + SEM_DAYS && !d.skipped));
      return {
        avgMin: mean(ds.map((d) => d.used / 60)),
        p90Min: pct(ds.map((d) => d.used / 60), 0.9),
        hitCap: cap === Infinity ? 0 : mean(ds.map((d) => (d.left > 0 ? 1 : 0))),
      };
    });
    const exams = Array.from({ length: NEXAM }, (_, i) => ({
      retention: mean(runs.map((r) => r.examStats[i].retention)),
      coverage: mean(runs.map((r) => r.examStats[i].coverage)),
    }));
    out[key].caps[cap] = {
      sems, exams, cards: runs[0].cards,
      waitAvg: mean(runs.flatMap((r) => r.waits)), waitP90: pct(runs.flatMap((r) => r.waits), 0.9),
    };
  }
}

if (args.includes('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
const f = (x, n = 1) => x.toFixed(n);
for (const [, s] of Object.entries(out)) {
  console.log(`
## ${s.name}（${NSEM} 學期共 ${s.caps[15].cards} 張，${SEEDS} 次平均）`);
  console.log('上限 | 每學期平均分 | 每學期 P90 分 | 時間到還有卡的天數 | 新卡等幾天 平均/P90 | 段考保持率 最低/平均 | 段考時範圍內開始過的比例（最低）');
  for (const [cap, r] of Object.entries(s.caps)) {
    const ret = r.exams.map((e) => e.retention * 100);
    console.log(`${cap === 'Infinity' ? '不限' : cap} | ${r.sems.map((x) => f(x.avgMin)).join(' ')} | ${r.sems.map((x) => f(x.p90Min)).join(' ')} | ` +
      `${r.sems.map((x) => f(x.hitCap * 100, 0) + '%').join(' ')} | ${f(r.waitAvg)}/${f(r.waitP90, 0)} | ` +
      `${f(Math.min(...ret), 0)}/${f(mean(ret), 0)} | ${f(Math.min(...r.exams.map((e) => e.coverage)) * 100, 0)}%`);
  }
}
