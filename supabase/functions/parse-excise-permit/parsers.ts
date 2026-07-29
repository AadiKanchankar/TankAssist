/**
 * One parser module per state. Adding a state = adding an entry to PARSERS,
 * never a redesign of the pipeline.
 *
 * Parsers are deliberately TOLERANT: a field that can't be found comes back
 * null and is recorded in `extracted_json`. A permit with missing fields still
 * lands as `pending_review` for manual completion — never guessed, never dropped.
 *
 * Calibrated against a real document (see parsers.test.ts fixture), not a spec.
 */

/** One row of the permit's Liquor Details table. */
export interface QuantityLine {
  liquor_class: string | null;
  quantity_value: number;
  quantity_type: 'BL' | 'PL' | 'UNKNOWN';
}

export interface ParsedPermit {
  state: string;
  permit_number: string | null;
  license_no_source: string | null;
  license_no_dest: string | null;
  licensee_name_source: string | null;
  licensee_name_dest: string | null;
  liquor_class: string | null;
  quantity_value: number | null;
  /** Captured from the document itself — never assumed. */
  quantity_type: 'BL' | 'PL' | 'UNKNOWN';
  /**
   * Every row of the Liquor Details table. A single-row permit yields one line;
   * the scalar quantity_value/quantity_type above remain the permit TOTAL for
   * back-compat. Product allocation is driven by this array.
   */
  quantity_lines: QuantityLine[];
  permit_date: string | null;
  permit_generated_at: string | null;
  valid_until: string | null;
  /** Extra context kept for the reviewer / audit (not columns on the table). */
  extras: Record<string, string | null>;
  /** Human-readable explanations of anything notable (e.g. a field the form omits). */
  parser_notes: string[];
  /** Field names the parser could not locate — surfaced to the reviewer. */
  missing_fields: string[];
}

const clean = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
  return t.length ? t : null;
};

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return clean(m[1]);
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Accepts the formats these permits actually use:
 *   29-Jun-2026  ·  24/06/2026  ·  2026-06-29
 */
export function toIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const named = raw.match(/(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{4})/);
  if (named) {
    const mo = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (mo) return `${named[3]}-${String(mo).padStart(2, '0')}-${named[1].padStart(2, '0')}`;
  }
  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const numeric = raw.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (numeric) {
    const [, d, mo, y] = numeric;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

/**
 * Accepts e.g. "23-Jun-2026 ,17.12.40." (dot-separated, 24h) and
 * "24/06/2026 01:42:09 PM" (colon-separated, 12h) — both appear in Haryana views.
 * The date is stripped before the time is read so a numeric date can't be
 * mistaken for a time.
 */
export function toIsoTimestamp(raw: string | null): string | null {
  if (!raw) return null;
  const date = toIsoDate(raw);
  if (!date) return null;

  const dateToken = raw.match(/\d{1,2}[-/ ][A-Za-z]{3,9}[-/ ]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}/);
  const rest = dateToken ? raw.slice(raw.indexOf(dateToken[0]) + dateToken[0].length) : raw;

  const t = rest.match(/(\d{1,2})[.:](\d{2})(?:[.:](\d{2}))?\s*(AM|PM)?/i);
  if (!t) return `${date}T00:00:00Z`;

  let hh = Number(t[1]);
  const mi = t[2];
  const ss = t[3] ?? '00';
  const ampm = t[4]?.toUpperCase();
  if (ampm === 'PM' && hh < 12) hh += 12;
  if (ampm === 'AM' && hh === 12) hh = 0;
  return `${date}T${String(hh).padStart(2, '0')}:${mi}:${ss}Z`;
}

/**
 * Haryana FORM L-32 — "Permit for the import or transport of country liquor/
 * foreign liquor/ rectified sprit/ denatured sprit."
 *
 * Real structure (prose, not a table):
 *   District: <d> Permit Number: <pn> License No.: <licensee licence>
 *   <L-type> of <licensee name> licensed to sell liquor in Haryana state is
 *     hereby permitted to import/transport liquor ... from <supplier L-type>,
 *     <supplier name>, <supplier address> to his premises at <destination>
 *   Date and Time of Permit Generation: 23-Jun-2026 ,17.12.40.
 *   Total Quantity in BL:-396
 *
 * IMPORTANT: the L-32 form prints the supplier's licence TYPE and NAME but NOT
 * their licence NUMBER — so `license_no_source` is structurally unavailable here
 * and the source facility must be confirmed by a human. Recorded in parser_notes.
 */
function parseHaryana(text: string): ParsedPermit {
  const permit_number = firstMatch(text, [
    /Permit\s*Number\s*:?\s*([A-Z0-9\-/]+)/i,
    /Permit\s*No\.?\s*:?\s*([A-Z0-9\-/]+)/i,
  ]);

  // Receiving licensee (the permit holder): "License No.: 031L2106770"
  const license_no_dest = firstMatch(text, [
    /Licen[sc]e\s*No\.?\s*:\s*([A-Z0-9\-/]+)/i,
    /(?:Consignee|Buyer|Destination)[^\n]{0,40}?Licen[sc]e\s*No\.?\s*:?\s*([A-Z0-9\-/]+)/i,
  ]);

  // "L-1 of Scotchtap Liquor licensed to sell liquor in Haryana state"
  const destParty = text.match(/\b(L-[A-Z0-9]+)\s+of\s+([\s\S]{2,80}?)\s+licensed\s+to\s+sell/i);
  const licensee_name_dest = destParty ? clean(destParty[2]) : null;
  const license_type_dest = destParty ? clean(destParty[1]) : null;

  // "from L-1AB1, M/s H S Oberoi Spirits, Khasra No-..."
  const srcParty = text.match(/\bfrom\s+(L-[A-Z0-9]+)\s*,\s*([^,\n]{2,80})\s*,/i);
  const license_type_source = srcParty ? clean(srcParty[1]) : null;
  const licensee_name_source = srcParty ? clean(srcParty[2]) : null;

  // Only present on some Haryana views (e.g. the acknowledgement page), never on L-32.
  const license_no_source = firstMatch(text, [
    /Supplier\s*Licen[sc]e\s*No\.?\s*:?\s*([A-Z0-9\-/]+)/i,
  ]);

  // Quantity — capture the unit actually printed, never defaulted.
  let quantity_value: number | null = null;
  let quantity_type: ParsedPermit['quantity_type'] = 'UNKNOWN';
  const labelled = text.match(/Total\s*Quantity\s*(?:in\s*)?(BL|PL)\s*[:\-]*\s*([\d,]+(?:\.\d+)?)/i);
  if (labelled) {
    quantity_type = labelled[1].toUpperCase() as 'BL' | 'PL';
    quantity_value = Number(labelled[2].replace(/,/g, ''));
  } else {
    const suffixed = text.match(/\b([\d,]+(?:\.\d+)?)\s*(BL|PL)\b/i);
    if (suffixed) {
      quantity_value = Number(suffixed[1].replace(/,/g, ''));
      quantity_type = suffixed[2].toUpperCase() as 'BL' | 'PL';
    }
  }

  // Liquor class must come from the DATA ROW ("WINE 396 BL"), not from a bare
  // keyword scan: the L-32 preamble ("...import or transport of country liquor/
  // foreign liquor/ rectified sprit...") would otherwise win and mislabel every
  // permit as COUNTRY LIQUOR. Caught by parsers.test.ts against the real doc.
  const CLASSES = 'COUNTRY LIQUOR|IMFL|IMFS|WINE|BEER|RUM|WHISKY|VODKA|GIN';
  // Anything after the "Liquor Details" heading, so the preamble is out of scope.
  const detailsIdx = text.search(/Liquor\s*Details/i);
  const detailsSection = detailsIdx >= 0 ? text.slice(detailsIdx) : text;

  // Every row of the Liquor Details table: "<CLASS> <qty> <BL|PL>". A one-row
  // permit yields one line; the same scan handles a multi-row permit unchanged.
  const quantity_lines: QuantityLine[] = [];
  const rowRe = new RegExp(`\\b(${CLASSES})\\s+([\\d,]+(?:\\.\\d+)?)\\s*(BL|PL)\\b`, 'gi');
  for (const m of detailsSection.matchAll(rowRe)) {
    quantity_lines.push({
      liquor_class: clean(m[1]),
      quantity_value: Number(m[2].replace(/,/g, '')),
      quantity_type: m[3].toUpperCase() as 'BL' | 'PL',
    });
  }

  // The scalar class only means something when the permit has ONE row. With
  // several rows no single class describes the permit, so it stays null rather
  // than letting row 1 masquerade as the whole document — the lines carry it.
  const liquor_class =
    quantity_lines.length === 1
      ? quantity_lines[0].liquor_class
      : quantity_lines.length > 1
      ? null
      : firstMatch(detailsSection, [
          new RegExp(`\\b(${CLASSES})\\b`, 'i'),
          /(?:Class\s*of\s*Liquor|Liquor\s*(?:Class|Type))\s*[:\-]\s*([A-Za-z ]{3,40})/i,
        ]);

  const valid_until = toIsoDate(
    firstMatch(text, [/valid\s*up\s*to\s*:?\s*([0-9]{1,2}[-/ ][A-Za-z0-9]{2,9}[-/ ][0-9]{4})/i]),
  );
  const generationRaw = firstMatch(text, [
    /Date\s*and\s*Time\s*of\s*Permit\s*Generation\s*:?\s*([^\n]{6,60})/i,
    /Generated\s*(?:On|At)\s*:?\s*([^\n]{6,60})/i,
  ]);
  const permit_generated_at = toIsoTimestamp(generationRaw);
  // L-32 carries no separate "permit date" — the generation date is that date.
  const permit_date =
    toIsoDate(firstMatch(text, [/Permit\s*Date\s*:?\s*([0-9]{1,2}[-/ ][A-Za-z0-9]{2,9}[-/ ][0-9]{4})/i])) ??
    (permit_generated_at ? permit_generated_at.slice(0, 10) : null);

  const district = firstMatch(text, [/District\s*:?\s*([A-Za-z ]{3,40}?)\s+Permit/i]);

  const parser_notes: string[] = [];
  if (!license_no_source) {
    parser_notes.push(
      'Form L-32 does not print the supplier’s licence number — only their licence type and name. Confirm the source facility manually.',
    );
  }

  const parsed: ParsedPermit = {
    state: 'Haryana',
    permit_number,
    license_no_source,
    license_no_dest,
    licensee_name_source,
    licensee_name_dest,
    liquor_class,
    quantity_value,
    quantity_type,
    // Fall back to a single synthetic line when the table couldn't be read but a
    // total was — allocation still has exactly one line to attach to.
    quantity_lines:
      quantity_lines.length > 0
        ? quantity_lines
        : quantity_value != null
        ? [{ liquor_class, quantity_value, quantity_type }]
        : [],
    permit_date,
    permit_generated_at,
    valid_until,
    extras: {
      district,
      license_type_source,
      license_type_dest,
      form: 'L-32',
    },
    parser_notes,
    missing_fields: [],
  };

  parsed.missing_fields = (
    [
      ['permit_number', permit_number],
      ['license_no_source', license_no_source],
      ['license_no_dest', license_no_dest],
      ['quantity_value', quantity_value],
      ['permit_date', permit_date],
    ] as [string, unknown][]
  )
    .filter(([, v]) => v === null || v === undefined)
    .map(([k]) => k);

  return parsed;
}

export interface StateParser {
  version: string;
  detect: (text: string) => boolean;
  parse: (text: string) => ParsedPermit;
}

export const PARSERS: StateParser[] = [
  {
    // @3 adds per-row quantity_lines and stops reporting a scalar liquor_class
    // for a multi-row permit. Bumped so already-stored @2 rows stay meaningful.
    version: 'haryana-l32@3',
    detect: (t) =>
      /haryanatax\.gov\.in|FORM\s*L-32|govt\.?\s*of\s*haryana|government\s*of\s*haryana/i.test(t),
    parse: parseHaryana,
  },
];

export function selectParser(text: string): StateParser | null {
  return PARSERS.find((p) => p.detect(text)) ?? null;
}
