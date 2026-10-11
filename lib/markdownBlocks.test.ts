/**
 * Run: npx --yes tsx lib/markdownBlocks.test.ts
 * Also parses the real policy, so a structure the renderer can't show fails here.
 */
import assert from 'node:assert/strict';
import { parseBlocks, parseSpans } from './markdownBlocks.ts';
import { POLICY_MARKDOWN } from '../constants/privacyPolicy.ts';

const b = parseBlocks(`## 1. Title

Para line one
continues here.

- bullet one
  wraps
- bullet two

| What | Why |
|---|---|
| A | B |
| C | D |`);
assert.deepEqual(b[0], { kind: 'h2', text: '1. Title' });
assert.deepEqual(b[1], { kind: 'p', text: 'Para line one continues here.' });
assert.deepEqual(b[2], { kind: 'li', text: 'bullet one wraps' });
assert.deepEqual(b[3], { kind: 'li', text: 'bullet two' });
assert.deepEqual(b[4], { kind: 'table', head: ['What', 'Why'], rows: [['A', 'B'], ['C', 'D']] });

assert.deepEqual(parseSpans('a **b** `C` d'), [
  { text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'C', placeholder: true }, { text: ' d' },
]);

// The real policy: 12 numbered sections, tables have rows, no raw markers left.
const policy = parseBlocks(POLICY_MARKDOWN);
assert.equal(policy.filter((x) => x.kind === 'h2').length, 12);
assert.ok(policy.filter((x) => x.kind === 'table').every((t) => t.kind === 'table' && t.rows.length > 0));
for (const x of policy) if (x.kind === 'p' || x.kind === 'li') assert.ok(!/^\s*[|#]/.test(x.text), x.text);

console.log('markdownBlocks: all checks passed');
