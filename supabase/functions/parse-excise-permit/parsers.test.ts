/**
 * Calibration check for the state parsers.
 *
 * FIXTURE is the verbatim unpdf text layer of a real Haryana L-32 permit
 * (PN263160173328) — the same extraction path the Edge Function uses in
 * production, so passing here means passing on the real document.
 *
 * Run:  npx --yes tsx supabase/functions/parse-excise-permit/parsers.test.ts
 */
import assert from 'node:assert/strict';
import { selectParser, toIsoDate, toIsoTimestamp } from './parsers.ts';

const FIXTURE = `Excise & Taxation Department
Government of Haryana
Genuineness of this Permit or Pass can be checked at
https://haryanatax.gov.in/HEXWAR/permitPassView.html
FORM L-32
[Four Copies]*
Permit for the import or transport of country liquor/ foreign liquor/ rectified sprit/ denatured sprit.
This permit is valid up to 29-Jun-2026
District: Sonepat Permit Number: PN263160173328 License No.: 031L2106770
L-1 of Scotchtap Liquor licensed to sell liquor in Haryana state is hereby permitted to import/transport liquor as per details given
below from L-1AB1, M/s H S Oberoi Spirits, Khasra No-34/6/2 & 35/7/2/ & 7/1 Village Bairampur,Sector-59 Tahsil-Wazirabad
Gurugram Gurugram (East) to his premises at Osram Factory Opposite Civil Hospital Sonepat
Date and Time of Permit Generation: 23-Jun-2026 ,17.12.40.
Total Advance Amount Adjusted: 792
Liquor Details :-
Class of Liquor Category/EDP Range Quantity
Bulk Litres/Proof Litres
WINE 396 BL
Total Quantity in BL:-396
Type of Fee Details:-
Levies
Type Amount (INR)
Permit Fee 792.00
Total Amount (INR) 792
*[One Copy each for]
1.) Office Copy
2.) To be sent to Distillery/Supplier
3.) To be handed over to the Importer/Transporter/Purchaser
4.) To be sent to the Officer - In charge
Pardeep Jaglan
Assistant Excise and Taxation Officer`;

// ── date helpers ──────────────────────────────────────────────────────────
assert.equal(toIsoDate('29-Jun-2026'), '2026-06-29', 'DD-Mon-YYYY');
assert.equal(toIsoDate('24/06/2026'), '2026-06-24', 'DD/MM/YYYY');
assert.equal(toIsoDate('2026-06-29'), '2026-06-29', 'already ISO');
assert.equal(toIsoDate('not a date'), null, 'unparseable -> null');
// dot-separated 24h time, comma before it
assert.equal(toIsoTimestamp('23-Jun-2026 ,17.12.40.'), '2026-06-23T17:12:40Z', 'L-32 generation stamp');
// 12-hour clock from the acknowledgement view must convert, not be taken literally
assert.equal(toIsoTimestamp('24/06/2026 01:42:09 PM'), '2026-06-24T13:42:09Z', 'PM -> 24h');
assert.equal(toIsoTimestamp('24/06/2026 12:10:00 AM'), '2026-06-24T00:10:00Z', 'midnight AM');

// ── parser selection ──────────────────────────────────────────────────────
const parser = selectParser(FIXTURE);
assert.ok(parser, 'Haryana parser must be selected');
assert.equal(parser!.version, 'haryana-l32@3');
assert.equal(selectParser('a receipt from some other state'), null, 'unknown text -> no parser');

// ── the real document ─────────────────────────────────────────────────────
const p = parser!.parse(FIXTURE);
assert.equal(p.state, 'Haryana');
assert.equal(p.permit_number, 'PN263160173328');
assert.equal(p.license_no_dest, '031L2106770', 'receiving licensee licence');
assert.equal(p.licensee_name_dest, 'Scotchtap Liquor');
assert.equal(p.licensee_name_source, 'M/s H S Oberoi Spirits');
assert.equal(p.liquor_class, 'WINE');
assert.equal(p.quantity_value, 396);
assert.equal(p.quantity_type, 'BL', 'unit read off the document, not assumed');
assert.equal(p.valid_until, '2026-06-29');
assert.equal(p.permit_generated_at, '2026-06-23T17:12:40Z');
assert.equal(p.permit_date, '2026-06-23', 'derived from generation date');
assert.equal(p.extras.district, 'Sonepat');
assert.equal(p.extras.license_type_dest, 'L-1');
assert.equal(p.extras.license_type_source, 'L-1AB1');

// The L-32 form genuinely omits the supplier licence number: it must come back
// null, be listed as missing, and be explained — never invented.
assert.equal(p.license_no_source, null, 'supplier licence number is not on the form');
assert.ok(p.missing_fields.includes('license_no_source'));
assert.ok(p.parser_notes.some((n) => /supplier/i.test(n)), 'omission is explained to the reviewer');
assert.deepEqual(
  p.missing_fields.filter((f) => f !== 'license_no_source'),
  [],
  'every other required field parsed cleanly',
);

// ── quantity lines: the real permit is single-row ──────────────────────────
assert.equal(p.quantity_lines.length, 1, 'real L-32 sample has exactly one Liquor Details row');
assert.deepEqual(p.quantity_lines[0], {
  liquor_class: 'WINE',
  quantity_value: 396,
  quantity_type: 'BL',
});
// the scalar total still matches the single line
assert.equal(p.quantity_value, p.quantity_lines[0].quantity_value);

// ── multi-row: same scan, no format change needed ──────────────────────────
// Synthetic ONLY — no real multi-row permit has been seen yet, so this proves
// the parser handles extra table rows, not that a real document looks like this.
{
  const multi = FIXTURE.replace(
    'WINE 396 BL',
    'WINE 396 BL\nBEER 200 BL\nIMFL 50.5 PL',
  );
  const mp = selectParser(multi)!.parse(multi);
  assert.equal(mp.quantity_lines.length, 3, 'three table rows -> three lines');
  assert.deepEqual(mp.quantity_lines.map((l) => l.liquor_class), ['WINE', 'BEER', 'IMFL']);
  assert.deepEqual(mp.quantity_lines.map((l) => l.quantity_value), [396, 200, 50.5]);
  assert.deepEqual(mp.quantity_lines.map((l) => l.quantity_type), ['BL', 'BL', 'PL']);
  assert.equal(mp.liquor_class, null, 'multi-row: no single scalar class — row 1 must not stand in for the permit');
}

// ── bottle math on the real numbers (mirrors index.ts) ─────────────────────
// 396 BL / 0.18 L per 180ml bottle = 2200 bottles -> 91 cases + 16 remainder
const bottleLitres = 180 * 0.001;
const raw = p.quantity_value! / bottleLitres;
const bottles = Math.round(raw);
assert.equal(bottles, 2200);
assert.equal(Math.floor(bottles / 24), 91);
assert.equal(bottles - 91 * 24, 16);
assert.ok(Math.abs(raw - bottles) <= 0.05, 'clean division -> not flagged as a bad product match');

// A non-dividing bottle size trips the tolerance: 396 BL / 700ml = 565.71...
const badRaw = p.quantity_value! / (700 * 0.001);
assert.ok(Math.abs(badRaw - Math.round(badRaw)) > 0.05, 'non-integral bottle count is flagged');

// KNOWN LIMITATION, asserted so it stays visible rather than being assumed away:
// the tolerance only detects mismatches that divide UNCLEANLY. 396 BL divides
// exactly by both 180ml (2200 bottles) and 330ml (1200 bottles), so it cannot
// tell those two products apart. This is why auto-allocation is restricted to
// the single-active-product case and every other case goes to a human.
const alsoClean = p.quantity_value! / (330 * 0.001);
assert.equal(alsoClean, 1200);
assert.ok(
  Math.abs(alsoClean - Math.round(alsoClean)) <= 0.05,
  'documents that a clean-dividing wrong size is NOT caught by tolerance alone',
);

console.log('parsers.test.ts: all assertions passed');
