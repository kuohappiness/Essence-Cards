import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeEntry, questionType } from '../src/core/study/index.ts';
import { AWAY_LIMIT, RATE_DELAY } from '../src/review/index.ts';
import { answers, CHARS, check, DECK, fill, heldLine, keysOf, ltsOnScreen, PC, PHONE, pick, printOf, QUESTION, rights, setup, skip, stage, START, tap, texts, TWO, view, WRONG } from './helpers/pick-session.ts';

// 比較卡的作答流程（tasks/question-type-seam.md §6）：createSession 接真的 createState。預期值來自 §4、§6 的表。
void test('帶 group 的卡是比較卡：題型的唯一判斷；翻面與打字的 pick 是 null', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  assert.equal(questionType(view(s).card), 'pick');
  assert.equal(view(s).card.typed, false);
  const other = await setup(t, { 'Essence Cards/自然.md': '---\n科目: 自然\n---\n- 能說明 ^a1\n    - Q :: A\n' });
  const flip = await other.open({ subject: '自然' });
  assert.equal(questionType(view(flip).card), 'flip');
  assert.equal(view(flip).pick, null);
});

void test('key：作答時填目前這格，游標跳到下一個空格，往後繞一圈；全部填了沒有游標，不填', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  assert.deepEqual([stage(s), pick(s).cursor, pick(s).filled], ['answer', 0, false]);
  assert.deepEqual(pick(s).cells.map(cell => cell.state), ['open', 'open', 'open', 'open', 'open']);
  s.act({ kind: 'row', index: 3 });
  assert.equal(pick(s).cursor, 3);
  tap(h, s, '寨');
  assert.equal(pick(s).cursor, 4);
  tap(h, s, '塞');
  assert.equal(pick(s).cursor, 0, '繞回前面的空格');
  tap(h, s, '寒');
  assert.equal(pick(s).cursor, 1);
  tap(h, s, '賽');
  assert.equal(pick(s).cursor, 2);
  tap(h, s, '塞');
  assert.equal(pick(s).cursor, null);
  assert.equal(pick(s).filled, true);
  assert.deepEqual(texts(s), ['寒', '賽', '塞', '寨', '塞']);
  tap(h, s, '寨');
  assert.deepEqual(texts(s), ['寒', '賽', '塞', '寨', '塞'], '沒有游標時不填');
});

void test('row：作答時移動游標，再點字直接換掉；填好之後點哪格都行', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  fill(h, s, () => '寨');
  s.act({ kind: 'row', index: 2 });
  assert.equal(pick(s).cursor, 2);
  tap(h, s, '塞');
  assert.deepEqual(texts(s), ['寨', '寨', '塞', '寨', '寨']);
  assert.equal(pick(s).cursor, null);
  s.act({ kind: 'row', index: 9 });
  assert.equal(pick(s).cursor, null, '超出範圍不算');
});

void test('連點：同一個字 0.3 秒內不算，連點一直延後；不同的字照算', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  s.act({ kind: 'key', key: '寨' });
  assert.equal(pick(s).cursor, 1);
  h.clock.now += 299;
  s.act({ kind: 'key', key: '寨' });
  assert.equal(pick(s).cursor, 1);
  h.clock.now += 299;
  s.act({ kind: 'key', key: '寨' });
  assert.equal(pick(s).cursor, 1, '上一次按也算，連點不會穿過去');
  h.clock.now += 300;
  s.act({ kind: 'key', key: '寨' });
  assert.equal(pick(s).cursor, 2);
  s.act({ kind: 'key', key: '塞' });
  assert.equal(pick(s).cursor, 3, '不同的字不用等');
});

void test('check：有空格時游標跳到第一個空格、不對答案；填滿後 0.35 秒內不算，到 0.35 秒算', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  s.act({ kind: 'row', index: 2 });
  tap(h, s, '寨');
  s.act({ kind: 'check' });
  assert.deepEqual([stage(s), pick(s).cursor], ['answer', 0]);
  answers(s).forEach((answer, index) => { if (index !== 2) { s.act({ kind: 'row', index }); tap(h, s, answer); } });
  s.act({ kind: 'row', index: 2 });
  tap(h, s, answers(s)[2]);
  h.clock.now += 349;
  s.act({ kind: 'check' });
  assert.equal(stage(s), 'answer', '0.34 秒');
  h.clock.now += 1;
  s.act({ kind: 'check' });
  assert.equal(stage(s), 'result', '0.35 秒');
});

void test('全對：到結果階段，能按記住了、太簡單；0.3 秒內不算；每個目標一行，第二行起 with 是第一行的 t，一行也有 pick', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  const order = ltsOnScreen(s);
  rights(h, s);
  assert.deepEqual([stage(s), view(s).revealed, view(s).allowed, pick(s).committable], ['result', true, ['good', 'easy'], false]);
  assert.deepEqual(pick(s).cells.map(cell => cell.state), ['right', 'right', 'right', 'right', 'right']);
  assert.deepEqual(pick(s).results, { 寨: 'good', 塞: 'good', 寒: 'good', 賽: 'good' });
  assert.equal(s.commit(), false, '全對沒有下一張');
  h.clock.now += RATE_DELAY - 1;
  assert.equal(s.rate('good'), false);
  h.clock.now += 1;
  assert.equal(s.rate('miss'), false, '程式判的不能改');
  assert.equal(s.rate('good'), true);
  await h.state.flush();
  const lines = h.log();
  assert.deepEqual(lines.map(line => line.lt), order);
  assert.deepEqual(lines.map(line => line.r), ['good', 'good', 'good', 'good']);
  assert.equal(lines[0].with, undefined);
  for (const line of lines.slice(1)) assert.equal(line.with, lines[0].t);
  for (const line of lines) assert.equal(typeof line.pick, 'string');
  // 多放的一句在同一行的 also：這一行有兩格。
  const doubled = lines.filter(line => line.also);
  assert.equal(doubled.length, 1);
  assert.equal((doubled[0].also as unknown[]).length, 1);
  assert.deepEqual(Object.keys(lines[1]).filter(key => key === 'retry'), []);
});

void test('全部卡的「這輪第一次就答對」（D-189）：比較卡一張寫好幾行也算得出來，一個字一個分母；回看改評分照新的那幾行', async t => {
  const h = await setup(t);
  const s = await h.open({ deck: DECK, since: h.clock.now });
  fill(h, s, (answer, index) => index === 0 ? WRONG(answer, keysOf(s)) : answer);
  check(h, s);
  tap(h, s, answers(s)[0]);
  h.clock.now += RATE_DELAY;
  assert.equal(s.commit(), true);
  // 剛才再選才對的那個字（near）這一輪再出一次，答對才算完成，第一次就答對不算它。
  while (s.view().kind === 'card') {
    rights(h, s);
    h.clock.now += RATE_DELAY;
    assert.equal(s.rate('good'), true);
  }
  const done = s.view();
  assert.equal(done.kind === 'done' ? done.done.score : null, '這輪第一次就答對 3／4');
});

void test('全對按太簡單：每一行（含 also）都是 easy', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  rights(h, s);
  h.clock.now += RATE_DELAY;
  assert.equal(s.rate('easy'), true);
  await h.state.flush();
  for (const line of h.log()) {
    assert.equal(line.r, 'easy');
    for (const cell of (line.also ?? []) as { r: string }[]) assert.equal(cell.r, 'easy');
  }
});

void test('對答案後錯的再選：剛才選的字不能按、那一格劃掉；對的記 near、pick 是第一次選的、retry: right；有錯時只有下一張', async t => {
  const g = await setup(t);
  const c = await g.open({ subject: '國語' });
  const keys = keysOf(c);
  const wrong = WRONG(answers(c)[0], keys);
  fill(g, c, (answer, index) => index === 0 ? wrong : answer);
  check(g, c);
  assert.deepEqual([stage(c), pick(c).cursor, pick(c).spent], ['retry', 0, wrong]);
  assert.deepEqual(pick(c).cells.map(cell => cell.state), ['retry', 'right', 'right', 'right', 'right']);
  assert.equal(pick(c).cells[0].text, wrong);
  assert.deepEqual(view(c).allowed, []);
  // 再選時不能換別格（其他格都對）。
  c.act({ kind: 'row', index: 2 });
  assert.equal(pick(c).cursor, 0);
  tap(g, c, wrong);
  assert.deepEqual([stage(c), pick(c).cursor], ['retry', 0], '剛才選的字不能按');
  tap(g, c, answers(c)[0]);
  assert.equal(stage(c), 'result');
  assert.deepEqual(view(c).allowed, []);
  assert.equal(pick(c).committable, true);
  assert.equal(pick(c).cells[0].state, 'near');
  assert.equal(pick(c).cells[0].text, answers(c)[0]);
  assert.equal(pick(c).results[answers(c)[0]], 'near');
  g.clock.now += RATE_DELAY - 1;
  assert.equal(c.commit(), false, '0.3 秒內不算');
  g.clock.now += 1;
  const lt = view(c).card.blanks[0].lt;
  assert.equal(c.commit(), true);
  await g.state.flush();
  const line = g.log().find(each => each.lt === lt);
  assert.ok(line);
  assert.deepEqual([line.r, line.pick, line.retry], ['near', wrong, 'right']);
});

void test('再選也錯：miss、retry: wrong；再選時按沒印象：miss、retry: skip；第一次按沒印象：miss、pick: null、沒有 retry', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  const keys = keysOf(s);
  const first = answers(s);
  const bad = (answer: string, count: number): string => keys.filter(key => key !== answer)[count];
  fill(h, s, (answer, index) => index === 0 || index === 1 ? bad(answer, 0) : index === 2 ? null : answer);
  check(h, s);
  assert.deepEqual([stage(s), pick(s).cursor], ['retry', 0]);
  assert.equal(pick(s).cells[2].state, 'miss');
  assert.equal(pick(s).cells[2].text, '？');
  tap(h, s, bad(first[0], 1));
  assert.deepEqual([pick(s).cells[0].state, pick(s).cells[0].text, pick(s).cursor, pick(s).spent], ['miss', '？', 1, bad(first[1], 0)]);
  skip(h, s);
  assert.equal(stage(s), 'result');
  assert.deepEqual(pick(s).cells.slice(0, 3).map(cell => cell.state), ['miss', 'miss', 'miss']);
  assert.deepEqual(pick(s).cells.map(cell => cell.text), first, '結果階段每一格都是答案');
  const blanks = view(s).card.blanks;
  h.clock.now += RATE_DELAY;
  assert.equal(s.commit(), true);
  await h.state.flush();
  const of = (index: number): Record<string, unknown> | undefined => {
    const lt = blanks[index].lt, v = blanks[index].prompt.fingerprint;
    const line = h.log().find(each => each.lt === lt);
    assert.ok(line);
    return line.v === v ? line : (line.also as Record<string, unknown>[]).find(cell => cell.v === v);
  };
  assert.deepEqual([of(0)?.r, of(0)?.pick, of(0)?.retry], ['miss', bad(first[0], 0), 'wrong']);
  assert.deepEqual([of(1)?.r, of(1)?.pick, of(1)?.retry], ['miss', bad(first[1], 0), 'skip']);
  assert.deepEqual([of(2)?.r, of(2)?.pick], ['miss', null]);
  assert.equal(Object.hasOwn(of(2) ?? {}, 'retry'), false);
});

void test('作答中按沒印象又改：畫面是 ？，點那一句再點字就換掉，紀錄是點的字', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  skip(h, s);
  assert.deepEqual([pick(s).cells[0].state, pick(s).cells[0].text, pick(s).cursor], ['skipped', '？', 1]);
  s.act({ kind: 'row', index: 0 });
  tap(h, s, answers(s)[0]);
  assert.deepEqual([pick(s).cells[0].state, pick(s).cells[0].text], ['filled', answers(s)[0]]);
  s.act({ kind: 'row', index: 1 });
  fill(h, s, (answer, index) => index === 0 ? null : answer);
  assert.equal(pick(s).cells[0].state, 'filled', '沒有游標時沒印象不動填好的格');
});

void test('點了 ？ 組員：照一般字鍵判定，pick 是字串，和沒印象分得開', async t => {
  const h = await setup(t, { [DECK]: QUESTION });
  const s = await h.open({ subject: '國語' });
  fill(h, s, answer => answer);
  check(h, s);
  assert.equal(stage(s), 'result');
  assert.ok(pick(s).cells.every(cell => cell.state === 'right'));
  h.clock.now += RATE_DELAY;
  s.rate('good');
  await h.state.flush();
  assert.ok(h.log().some(line => line.pick === '？'));
});

const twoGood = (lt: string, print: string): string => encodeEntry('2026-10-01T19:00:00.000+08:00', { lt, r: 'good', v: print, pick: 'x' });
void test('兩個選項同一個字兩格一對一錯：一行、記錯的那格在最上層，對的在 also；再選只剩一個字一定 near', async t => {
  const h = await setup(t, { [DECK]: TWO, [PHONE]: `${twoGood('borrow', 'seed0000')}\n` });
  const s = await h.open({ targets: ['borrow'] });
  assert.equal(view(s).card.blanks.length, 2);
  fill(h, s, (answer, index) => index === 1 ? 'lend' : answer);
  check(h, s);
  assert.deepEqual([stage(s), pick(s).spent], ['retry', 'lend']);
  tap(h, s, 'lend');
  assert.equal(stage(s), 'retry', '剛才選的字不能按');
  const [first, second] = printOf(s, 'borrow');
  tap(h, s, 'borrow');
  assert.equal(stage(s), 'result');
  h.clock.now += RATE_DELAY;
  assert.equal(s.commit(), true);
  await h.state.flush();
  const lines = h.log();
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].lt, lines[0].r, lines[0].v, lines[0].pick, lines[0].retry], ['borrow', 'near', second, 'lend', 'right']);
  assert.deepEqual(lines[0].also, [{ v: first, r: 'good', pick: 'borrow' }]);
  assert.equal(lines[0].with, undefined, '一行的卡沒有 with');
});

void test('兩個選項：再選時按沒印象是 miss；一樣差取畫面上前面那一格', async t => {
  const h = await setup(t, { [DECK]: TWO, [PHONE]: `${twoGood('borrow', 'seed0000')}\n` });
  const s = await h.open({ targets: ['borrow'] });
  const [first, second] = printOf(s, 'borrow');
  fill(h, s, () => 'lend');
  check(h, s);
  skip(h, s);
  skip(h, s);
  assert.equal(stage(s), 'result');
  h.clock.now += RATE_DELAY;
  s.commit();
  await h.state.flush();
  const [line] = h.log();
  assert.deepEqual([line.r, line.v, line.pick, line.retry], ['miss', first, 'lend', 'skip']);
  assert.deepEqual(line.also, [{ v: second, r: 'miss', pick: 'lend', retry: 'skip' }]);
});

void test('切走超過 60 秒從頭開始、不寫紀錄，結果階段還沒按的也是；不到 60 秒不動', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  const shape = answers(s);
  tap(h, s, '寨');
  s.pause();
  h.clock.now += AWAY_LIMIT;
  assert.equal(s.resume(), false);
  assert.deepEqual(texts(s)[0], '寨');
  s.pause();
  h.clock.now += AWAY_LIMIT + 1;
  assert.equal(s.resume(), true);
  assert.deepEqual([stage(s), texts(s).every(text => text === ''), view(s).shown, answers(s)], ['answer', true, 1, shape]);
  rights(h, s);
  assert.equal(stage(s), 'result');
  s.pause();
  h.clock.now += AWAY_LIMIT + 1;
  assert.equal(s.resume(), true);
  assert.equal(stage(s), 'answer');
  await h.state.flush();
  assert.deepEqual(h.log(), []);
});

void test('第一行被拒：下一行就是第一行、沒有 with，後面帶它的 t；中間一行被拒時也對；全部被拒換下一張不進回看', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  const order = ltsOnScreen(s);
  rights(h, s);
  h.write(PHONE, heldLine(order[0]) + '\n' + heldLine(order[2]) + '\n');
  await h.settle();
  h.clock.now += RATE_DELAY;
  assert.equal(s.rate('good'), true);
  await h.state.flush();
  const lines = h.log();
  assert.deepEqual(lines.map(line => line.lt), [order[1], order[3]]);
  assert.equal(lines[0].with, undefined);
  assert.equal(lines[1].with, lines[0].t);
  assert.equal(s.history().length, 1);

  const all = await setup(t);
  const c = await all.open({ subject: '國語' });
  rights(all, c);
  all.write(PHONE, ['zhai00', 'sai000', 'han000', 'yyy000'].map(heldLine).join('\n') + '\n');
  await all.settle();
  all.clock.now += RATE_DELAY;
  assert.equal(c.rate('good'), true);
  await all.state.flush();
  assert.deepEqual(all.log(), []);
  assert.equal(c.history().length, 0);
});

void test('紀錄從檔案讀回來結果相同：下一張換句子（also 算出過）', async t => {
  const h = await setup(t, { [DECK]: TWO, [PHONE]: `${twoGood('borrow', 'seed0000')}\n` });
  const s = await h.open({ targets: ['borrow'] });
  const shown = printOf(s, 'borrow');
  fill(h, s, answer => answer);
  check(h, s);
  h.clock.now += RATE_DELAY;
  s.rate('good');
  await h.state.flush();
  assert.deepEqual(h.log().map(line => line.r), ['good']);
  const again = await setup(t, { [DECK]: TWO, [PHONE]: h.texts.get(PC) ?? '' });
  again.clock.now = START + 90 * 86_400_000;
  const reopened = await again.open({ targets: ['borrow'] });
  const next = printOf(reopened, 'borrow');
  assert.equal(next.filter(print => !shown.includes(print)).length, 1, '三句裡沒出過的那一句先出');
});

void test('allowed 與評分：作答、再選、有錯的結果都是空的，rate 不算；下一張只在有錯的結果算數（§6）', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  const tryAll = (): [boolean, boolean, boolean] => {
    h.clock.now += RATE_DELAY;
    return [s.rate('good'), s.rate('easy'), s.commit()];
  };
  assert.deepEqual([stage(s), view(s).allowed], ['answer', []]);
  assert.deepEqual(tryAll(), [false, false, false], '作答中');
  fill(h, s, (answer, index) => index === 0 ? WRONG(answer, keysOf(s)) : answer);
  check(h, s);
  assert.deepEqual([stage(s), view(s).allowed], ['retry', []]);
  assert.deepEqual(tryAll(), [false, false, false], '再選中');
  tap(h, s, answers(s)[0]);
  assert.deepEqual([stage(s), view(s).allowed], ['result', []]);
  h.clock.now += RATE_DELAY;
  assert.deepEqual([s.rate('good'), s.rate('easy')], [false, false], '有錯的結果不能評分');
  assert.equal(s.commit(), true, '有錯的結果按下一張');
});

void test('單元的範圍也併成一張：{unit} 和今天的份一樣 5 格 4 個字鍵（§11）', async t => {
  const h = await setup(t, { [DECK]: CHARS.replace('科目: 國語', '年級學期: 國二上\n科目: 國語\n單元: "2-1"') });
  const s = await h.open({ unit: '["國二上","國語","2-1"]' });
  assert.equal(view(s).card.blanks.length, 5);
  assert.deepEqual([...keysOf(s)].sort(), ['塞', '寒', '寨', '賽']);
});
