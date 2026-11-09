import test from 'node:test';
import assert from 'node:assert/strict';
import { SEMESTERS, semesterOn } from '../src/core/settings/index.ts';

// 目前學期怎麼自動換（tasks/settings-page.md §4、§7 的表）：預期值是手算的字面值。

const cases: [string, string, string, string][] = [
  ['國二上', '2026-09-15', '2027-01-31', '國二上'],
  ['國二上', '2026-09-15', '2027-02-01', '國二下'],
  ['國二上', '2026-09-15', '2027-08-01', '國三上'],
  ['國二上', '2026-09-15', '2028-02-01', '國三下'],
  ['小六下', '2027-03-01', '2027-08-01', '國一上'],
  ['國三下', '2027-03-01', '2027-08-01', '高一上'],
  ['高三下', '2027-03-01', '2030-08-01', '高三下'],
  ['國二下', '2027-01-20', '2027-02-01', '國二下'],
  ['國二下', '2027-01-20', '2027-08-01', '國三上'],
  ['國二上', '2026-07-20', '2026-08-01', '國二上'],
  ['國二上', '2027-02-01', '2027-02-01', '國二上'],
  ['國二上', '2027-03-01', '2027-08-01', '國二上'],
  ['國二上', '2027-03-01', '2028-02-01', '國二下'],
  ['國二上', '2027-03-01', '2027-01-01', '國二上'],
];

for (const [value, setOn, today, expected] of cases) {
  void test(`${value}（${setOn} 選的）到 ${today} 是 ${expected}`, () => {
    assert.equal(semesterOn({ value, setOn }, today), expected);
  });
}

void test('學期的選項是小一上到高三下，照順序', () => {
  assert.equal(SEMESTERS.length, 24);
  assert.equal(SEMESTERS[0], '小一上');
  assert.equal(SEMESTERS[11], '小六下');
  assert.equal(SEMESTERS[12], '國一上');
  assert.equal(SEMESTERS[18], '高一上');
  assert.equal(SEMESTERS[23], '高三下');
});
