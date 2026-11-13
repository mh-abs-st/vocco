import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuard } from '../src/guard.js';

test('reports are limited per address and per user, and a refused one counts nowhere', () => {
  const g = createGuard({ reportsPerHourPerIp: 2 });
  assert.equal(g.allowReport('1.1.1.1', 'user:u1'), true);
  assert.equal(g.allowReport('2.2.2.2', 'user:u1'), true);
  assert.equal(g.allowReport('3.3.3.3', 'user:u1'), false); // the user is at 2
  assert.equal(g.allowReport('3.3.3.3'), true); // 3.3.3.3 wasn't counted by the refused one
  assert.equal(g.allowReport('3.3.3.3'), true);
  assert.equal(g.allowReport('3.3.3.3'), false);
});
