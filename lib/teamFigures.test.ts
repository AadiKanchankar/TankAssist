/**
 * Team totals include the manager; the manager's share is always split out.
 * Run: npx --yes tsx lib/teamFigures.test.ts
 */
import assert from 'node:assert/strict';
import { teamFigure, teamDistinct, fromByActor, managerShareNote } from './teamFigures.ts';

const ME = 'sm';
const visits = [
  { user: 'r1', store: 'a', cases: 5 },
  { user: 'r1', store: 'a', cases: 2 }, // repeat visit: counts as a visit, not a store
  { user: 'r2', store: 'b', cases: 0 },
  { user: ME, store: 'b', cases: 3 }, // manager visits a store a rep also visited
  { user: ME, store: 'c', cases: 4 },
];
const mine = (v: { user: string }) => v.user === ME;

// Totals INCLUDE the manager, and the share is a subset of the total.
const cases = teamFigure(visits, (v) => v.cases, mine);
assert.deepEqual(cases, { total: 14, managerOwn: 7 });

const n = teamFigure(visits, () => 1, mine);
assert.deepEqual(n, { total: 5, managerOwn: 2 }, 'total visits counts repeats');

// Distinct stores are NOT additive: b is one store, and also one of "yours".
const stores = teamDistinct(visits, (v) => v.store, mine);
assert.deepEqual(stores, { total: 3, managerOwn: 2 });
assert.ok(stores.managerOwn <= stores.total);
assert.equal(teamDistinct([{ store: null }], (v) => v.store, () => true).total, 0, 'unknown store is not a store');

// Stamped actor roles → management's view.
assert.deepEqual(fromByActor({ rep: 40, sales_manager: 6 }), { total: 46, managerOwn: 6 });
assert.deepEqual(fromByActor({ rep: 9 }), { total: 9, managerOwn: 0 });

// The split is always said out loud, even when it is zero.
assert.equal(managerShareNote({ total: 9, managerOwn: 0 }, 'self'), 'incl. 0 by you');
assert.equal(managerShareNote({ total: 5, managerOwn: 1 }, 'management', true), 'incl. 1 sales manager');
assert.equal(managerShareNote({ total: 5, managerOwn: 2 }, 'management', true), 'incl. 2 sales managers');
assert.equal(managerShareNote({ total: 46, managerOwn: 6 }, 'management'), 'incl. 6 by sales managers');

console.log('teamFigures.test.ts: all assertions passed');
