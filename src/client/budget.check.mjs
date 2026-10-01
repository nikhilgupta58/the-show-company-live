// node src/client/budget.check.mjs  — fails loudly if the Indian grouping ever breaks.
import assert from 'node:assert/strict';
import { formatBudget } from './budget.js';

const cases = [
  ['', ''],
  ['abc', ''],
  ['500', '500'],
  ['1500', '1,500'],
  ['150000', '1,50,000'],
  ['1,50,0000', '15,00,000'],
  ['12345678', '1,23,45,678'],
];
for (const [input, want] of cases) assert.equal(formatBudget(input), want, `formatBudget(${JSON.stringify(input)})`);
assert.equal(formatBudget('1,50', '1,500'), '150', 'deleting back to three digits drops the comma');
console.log('budget: ok');
