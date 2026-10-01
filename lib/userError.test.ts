// npx tsx lib/userError.test.ts
import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { userMessage, errorRef } from './userError';

console.warn = () => {}; // generic() logs the detail; keep the run quiet

const rls = {
  name: 'PostgrestError',
  code: '42501',
  message: 'new row violates row-level security policy for table "location_requests"',
  details: null,
  hint: null,
};
assert.equal(userMessage(rls), 'You don’t have permission to do this.');

// Unknown DB code: generic + ref, and none of the DB text.
const unk = { name: 'PostgrestError', code: '42P01', message: 'relation "public.foo" does not exist', details: '', hint: '' };
const g = userMessage(unk);
assert.match(g, /\(TA-[0-9A-F]{4}\)/);
assert.ok(!/foo|relation|public/.test(g), g);
assert.equal(errorRef(unk), errorRef({ ...unk })); // stable per failure

// Our own RAISE text passes; a leaky P0001 does not.
assert.equal(userMessage({ code: 'P0001', message: 'Product is out of stock', details: '' }), 'Product is out of stock');
assert.match(userMessage({ code: 'P0001', message: 'violates check constraint "x"', details: '' }), /TA-/);

// Our own thrown Error passes; a runtime TypeError does not.
assert.equal(userMessage(new Error('Sharing is not available on this device.')), 'Sharing is not available on this device.');
assert.match(userMessage(new TypeError("Cannot read property 'id' of undefined")), /TA-/);
// Our own subclass keeps name 'Error', so its authored message survives (ultrareview 2026-10-02).
class Ours extends Error {}
assert.equal(userMessage(new Ours('The challan photo was saved but its quantities were not.')), 'The challan photo was saved but its quantities were not.');

// Network, auth, storage, bare strings.
assert.match(userMessage(new TypeError('Network request failed')), /No connection/);
assert.match(userMessage({ code: '', message: 'AbortError: Aborted', details: '', hint: '' }), /No connection/);
assert.match(userMessage({ __isAuthError: true, code: 'otp_expired', message: 'Token has expired or is invalid' }), /expired/);
assert.match(userMessage({ __isStorageError: true, status: 403, message: 'new row violates row-level security policy' }), /permission/);
assert.match(userMessage('new row violates row-level security policy for table "x"'), /TA-/);

// Regression guard: no UI file renders a caught error's .message directly.
// Allowed: console lines, __DEV__-only lines, and VoiceInput (speech-engine text, never DB).
const ALLOW = new Set(['components/VoiceInput.tsx']);
const root = join(__dirname, '..');
const offenders: string[] = [];
const walk = (dir: string) => {
  for (const n of readdirSync(join(root, dir))) {
    const rel = `${dir}/${n}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel);
    else if (/\.tsx?$/.test(n) && !n.endsWith('.test.ts') && !ALLOW.has(rel)) {
      readFileSync(join(root, rel), 'utf8').split('\n').forEach((line, i) => {
        if (/\b(e|err|error|\w+Error|\w+Err)\??\.message\b/.test(line) && !/console\.|__DEV__/.test(line)) {
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }
  }
};
['app', 'components', 'hooks', 'store'].forEach(walk);
assert.deepEqual(offenders, [], `raw error text in UI — use userMessage():\n${offenders.join('\n')}`);

console.log('userError: ok');
