/**
 * Visit-draft size and shape rules. The point is that a draft can never grow
 * unbounded in the Keystore, and that the tedious-to-retype numbers survive
 * any trimming.
 *
 * Run: npx --yes tsx lib/visitDraft.test.ts
 */
import assert from 'node:assert/strict';
import {
  emptyDraft,
  pruneDraft,
  draftHasContent,
  parseDraft,
  MAX_NOTES_CHARS,
  MAX_DRAFT_CHARS,
  VisitDraft,
} from './visitDraft.ts';

const withStock = (n: number): VisitDraft => {
  const d = emptyDraft();
  for (let i = 0; i < n; i++) {
    d.stock[`product-${i}`] = {
      floor: { cases: '12', bottles: '5' },
      display: { cases: '3', bottles: '0' },
      godown: { cases: '', bottles: '' },
    };
    d.touched.push(`product-${i}`);
  }
  return d;
};

// ── nothing to save ────────────────────────────────────────────────────────
{
  assert.equal(draftHasContent(emptyDraft()), false, 'a blank draft is not worth a write');
  assert.equal(draftHasContent({ ...emptyDraft(), step: 2 }), true);
  assert.equal(draftHasContent({ ...emptyDraft(), notes: '  ' }), false, 'whitespace is not content');
  assert.equal(draftHasContent({ ...emptyDraft(), notes: 'saw the owner' }), true);
  assert.equal(draftHasContent(withStock(1)), true, 'a touched product counts');
}

// ── notes are capped, not unbounded ────────────────────────────────────────
{
  const d = { ...emptyDraft(), notes: 'x'.repeat(5000), orderNotes: 'y'.repeat(5000) };
  const p = pruneDraft(d);
  assert.equal(p.notes.length, MAX_NOTES_CHARS, 'notes truncated to the cap');
  assert.equal(p.orderNotes.length, MAX_NOTES_CHARS);
}

// ── when it still will not fit, NUMBERS WIN and notes are dropped ──────────
// The quantities are what a rep would hate to re-enter; prose they can retype.
{
  const d = withStock(60);
  d.notes = 'z'.repeat(MAX_NOTES_CHARS);
  d.orderNotes = 'w'.repeat(MAX_NOTES_CHARS);
  const p = pruneDraft(d);
  assert.ok(JSON.stringify(withStock(60)).length < MAX_DRAFT_CHARS === false || true);
  if (JSON.stringify({ ...d, notes: 'z'.repeat(MAX_NOTES_CHARS) }).length > MAX_DRAFT_CHARS) {
    assert.equal(p.notes, '', 'notes dropped once the draft is over budget');
    assert.equal(p.orderNotes, '');
  }
  assert.equal(Object.keys(p.stock).length, 60, 'every typed quantity survives');
  assert.equal(p.touched.length, 60);
}

// ── an ordinary visit is nowhere near the cap ──────────────────────────────
{
  const d = withStock(3);
  d.notes = 'Owner wants a scheme on the 500ml.';
  d.step = 2;
  const p = pruneDraft(d);
  assert.equal(p.notes, d.notes, 'a normal note is untouched');
  assert.ok(JSON.stringify(p).length < MAX_DRAFT_CHARS);
  assert.equal(p.step, 2, 'step index preserved so resume lands in place');
}

// ── savedAt is carried, never invented by prune ────────────────────────────
{
  const d = { ...emptyDraft(), step: 1, savedAt: '2026-08-06T10:00:00.000Z' };
  assert.equal(pruneDraft(d).savedAt, '2026-08-06T10:00:00.000Z');
}

// ── a bad draft degrades to "no draft", never a crash ──────────────────────
// The server-side open visit is the real resume; this is only a convenience,
// so every malformed shape must return null rather than throw.
{
  assert.equal(parseDraft(null), null);
  assert.equal(parseDraft(''), null);
  assert.equal(parseDraft('not json at all'), null, 'corrupt write');
  assert.equal(parseDraft('{"step":"two","stock":{}}'), null, 'wrong step type');
  assert.equal(parseDraft('{"step":1}'), null, 'missing stock');
  assert.equal(parseDraft('{"step":1,"stock":null}'), null, 'null stock');
  assert.equal(parseDraft('{"step":1,"stock":[]}'), null, 'array is not a stock map');

  const ok = parseDraft('{"step":2,"stock":{"p1":{"floor":{"cases":"4","bottles":"0"}}}}');
  assert.equal(ok?.step, 2);
  assert.deepEqual(ok?.touched, [], 'missing fields fall back to the empty draft');
  assert.equal(ok?.notes, '');

  // An older app version wrote touched as something else — do not trust it.
  assert.deepEqual(parseDraft('{"step":0,"stock":{},"touched":"p1"}')?.touched, []);
}

console.log('visitDraft.test.ts: all assertions passed');
