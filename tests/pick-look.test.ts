import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeEntry } from '../src/core/study/index.ts';
import { RATE_DELAY } from '../src/review/index.ts';
import type { Session } from '../src/review/index.ts';
import { check, CHARS, DECK, fill, heldLine, keysOf, ltsOnScreen, PHONE, pick, rights, setup, skip, stage, tap, texts, view, WRONG } from './helpers/pick-session.ts';
import type { Harness } from './helpers/pick-session.ts';

// 比較卡的回看與改評分（tasks/question-type-seam.md §8）。
/** 全對按記住了、回看那一張。 */
async function allRightThenBack(h: Harness, s: Session): Promise<void> {
  rights(h, s);
  h.clock.now += RATE_DELAY;
  assert.equal(s.rate('good'), true);
  await h.state.flush();
  s.back();
}

void test('回看：一張卡一筆，結果階段的畫面；全對的能在記住了、太簡單之間改；有錯的不能改', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  await allRightThenBack(h, s);
  assert.deepEqual([stage(s), view(s).viewing, view(s).pressed, view(s).allowed], ['result', { index: 0, total: 1 }, 'good', ['good', 'easy']]);
  assert.equal(s.history().length, 1);

  const g = await setup(t);
  const c = await g.open({ subject: '國語' });
  const keys = keysOf(c);
  fill(g, c, (answer, index) => index === 0 ? WRONG(answer, keys) : answer);
  check(g, c);
  skip(g, c);
  g.clock.now += RATE_DELAY;
  c.commit();
  await g.state.flush();
  const before = g.log().length;
  c.back();
  assert.deepEqual([view(c).pressed, view(c).allowed, stage(c)], [null, [], 'result']);
  assert.equal(pick(c).results[view(c).card.blanks[0].answer ?? ''], 'miss');
  assert.equal(c.rate('good'), false);
  c.act({ kind: 'key', key: keys[0] });
  await g.state.flush();
  assert.equal(g.log().length, before, '回看時動作不算、也不寫');
});

void test('全對改太簡單：N 行 undo 加 N 行新的，新的 with 是新的第一行，also 跟著重寫；取消和重寫之間沒有通知', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  await allRightThenBack(h, s);
  const old = h.log();
  let notified = 0;
  const off = s.subscribe(() => { notified++; });
  h.clock.now += 1000;
  assert.equal(s.rate('easy'), true);
  off();
  assert.equal(notified, 1);
  await h.state.flush();
  const lines = h.log().slice(old.length);
  assert.deepEqual(lines.slice(0, 4).map(line => line.undo), old.map(line => line.t));
  const fresh = lines.slice(4);
  assert.deepEqual(fresh.map(line => [line.lt, line.v, line.pick, line.r]), old.map(line => [line.lt, line.v, line.pick, 'easy']));
  assert.equal(fresh[0].with, undefined);
  for (const line of fresh.slice(1)) assert.equal(line.with, fresh[0].t);
  const oldAlso = old.find(line => line.also)?.also as { v: string; pick: string }[];
  const newAlso = fresh.find(line => line.also)?.also as { v: string; r: string; pick: string }[];
  assert.deepEqual(newAlso, oldAlso.map(cell => ({ v: cell.v, r: 'easy', pick: cell.pick })));
  assert.equal(view(s).pressed, 'easy');
  assert.equal(s.rate('easy'), false, '和現在一樣不算');
  // 再改回來：這次取消的是新的那幾行。
  h.clock.now += 1000;
  assert.equal(s.rate('good'), true);
  await h.state.flush();
  assert.deepEqual(h.log().slice(old.length + 8, old.length + 12).map(line => line.undo), fresh.map(line => line.t));
});

void test('其中一個目標被停掉：不能改，一行都不寫', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  await allRightThenBack(h, s);
  const before = h.log();
  h.write(PHONE, heldLine('sai000') + '\n');
  await h.settle();
  assert.deepEqual(view(s).allowed, []);
  assert.equal(s.rate('easy'), false);
  await h.state.flush();
  assert.deepEqual(h.log(), before);
});

void test('第二個取消會被拒：別台裝置同一刻答了被停的目標，一行都不寫', async t => {
  const other = '---\n科目: 自然\n---\n- 能說明 ^other0\n    - Q :: A\n';
  const h = await setup(t, { [DECK]: CHARS, 'Essence Cards/自然.md': other });
  const s = await h.open({ subject: '國語' });
  await allRightThenBack(h, s);
  const before = h.log();
  h.write(PHONE, encodeEntry(before[1].t as string, { lt: 'other0', r: 'good', v: '12345678' }) + '\n' + JSON.stringify({ t: '2026-10-24T18:00:00.000+08:00', need: '9.0.0', lt: 'other0' }) + '\n');
  await h.settle();
  assert.equal(h.state.canAnswer('other0'), false);
  assert.ok(view(s).card.blanks.every(blank => h.state.canAnswer(blank.lt)));
  assert.equal(s.rate('easy'), false);
  await h.state.flush();
  assert.deepEqual(h.log(), before);
  assert.deepEqual(h.state.history().cancelled, []);
});

void test('當時沒寫進去的目標不補：只取消、重寫寫進去的那幾行', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  const order = ltsOnScreen(s);
  rights(h, s);
  h.write(PHONE, heldLine(order[1]) + '\n');
  await h.settle();
  h.clock.now += RATE_DELAY;
  assert.equal(s.rate('good'), true);
  await h.state.flush();
  const old = h.log();
  assert.deepEqual(old.map(line => line.lt), [order[0], order[2], order[3]]);
  h.write(PHONE, '');
  await h.settle();
  s.back();
  assert.equal(s.rate('easy'), true);
  await h.state.flush();
  const fresh = h.log().slice(old.length + 3);
  assert.deepEqual(fresh.map(line => line.lt), [order[0], order[2], order[3]]);
});

void test('ID 變成重複：目前這張丟掉重新取卡、什麼都不寫；回看裡牽涉衝突的卡不能改', async t => {
  const h = await setup(t);
  const s = await h.open({ subject: '國語' });
  await allRightThenBack(h, s);
  const before = h.log();
  const copy = 'Essence Cards/國語/複本.md';
  h.write(copy, '---\n科目: 國語\n---\n- 塞的複本 ^sai000\n    - Q :: A\n');
  await h.settle();
  assert.deepEqual(view(s).allowed, []);
  assert.equal(s.rate('easy'), false);
  await h.state.flush();
  assert.deepEqual(h.log(), before);

  const g = await setup(t);
  const c = await g.open({ subject: '國語' });
  tap(g, c, '寨');
  g.write(copy, '---\n科目: 國語\n---\n- 塞的複本 ^sai000\n    - Q :: A\n');
  await g.settle();
  assert.ok(view(c).card.blanks.every(blank => blank.lt !== 'sai000'));
  assert.ok(texts(c).every(text => text === ''));
  await g.state.flush();
  assert.deepEqual(g.log(), []);
});
