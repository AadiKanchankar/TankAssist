/**
 * One parser module per state. Adding a state = adding an entry to PARSERS,
 * never a redesign of the pipeline.
 *
 * Parsers are deliberately TOLERANT: a field that can't be found comes back
 * null and is recorded as such in `extracted_json`. A permit with missing
 * fields still lands as `pending_review` for manual completion — it is never
 * guessed at and never silently dropped.
 */

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
  permit_date: string | null;
  permit_generated_at: string | null;
  valid_until: string | null;
  /** Field names the parser could not locate — surfaced to the reviewer. */
  missing_fields: string[];
}

const clean = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length ? t : null;
};

/** First capture group of the first matching pattern. */
function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return clean(m[1]);
  }
  return null;
}

/** dd/mm/yyyy or dd-mm-yyyy → yyyy-mm-dd (ISO). Returns null if unparseable. */
function toIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}

/** dd/mm/yyyy hh:mm(:ss) → ISO timestamp. */
function toIsoTimestamp(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const d = toIsoDate(raw);
    return d ? `${d}T00:00:00Z` : null;
  }
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${hh.padStart(2, '0')}:${mi}:${ss ?? '00'}Z`;
}

/**
 * Haryana L-32 transport permit.
 * Detected via the state excise verification domain or an explicit header.
 */
function parseHaryana(text: string): ParsedPermit {
  const permit_number = firstMatch(text, [
    /Permit\s*(?:Number|No\.?)\s*[:\-]?\s*([A-Z0-9\/\-]+)/i,
    /L-?32\s*(?:Permit)?\s*(?:Number|No\.?)\s*[:\-]?\s*([A-Z0-9\/\-]+)/i,
  ]);

  // "Total Quantity in BL:- 396" or a "396 BL" cell — capture the unit actually printed.
  let quantity_value: number | null = null;
  let quantity_type: ParsedPermit['quantity_type'] = 'UNKNOWN';

  const labelled = text.match(
    /Total\s*Quantity\s*(?:in\s*)?(BL|PL)\s*[:\-]*\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (labelled) {
    quantity_type = labelled[1].toUpperCase() as 'BL' | 'PL';
    quantity_value = Number(labelled[2].replace(/,/g, ''));
  } else {
    const suffixed = text.match(/([\d,]+(?:\.\d+)?)\s*(BL|PL)\b/i);
    if (suffixed) {
      quantity_value = Number(suffixed[1].replace(/,/g, ''));
      quantity_type = suffixed[2].toUpperCase() as 'BL' | 'PL';
    }
  }

  const license_no_source = firstMatch(text, [
    /(?:From|Source|Consignor|Seller)[^\n]{0,40}?Licen[sc]e\s*(?:Number|No\.?)\s*[:\-]?\s*([A-Z0-9\/\-]+)/i,
    /Licen[sc]e\s*(?:Number|No\.?)\s*of\s*(?:the\s*)?(?:Consignor|Seller|Source)\s*[:\-]?\s*([A-Z0-9\/\-]+)/i,
  ]);
  const license_no_dest = firstMatch(text, [
    /(?:To|Destination|Consignee|Buyer)[^\n]{0,40}?Licen[sc]e\s*(?:Number|No\.?)\s*[:\-]?\s*([A-Z0-9\/\-]+)/i,
    /Licen[sc]e\s*(?:Number|No\.?)\s*of\s*(?:the\s*)?(?:Consignee|Buyer|Destination)\s*[:\-]?\s*([A-Z0-9\/\-]+)/i,
  ]);

  const licensee_name_source = firstMatch(text, [
    /(?:Consignor|Seller|From)\s*(?:Name)?\s*[:\-]\s*([A-Za-z0-9 .,&()\-]{3,80})/i,
  ]);
  const licensee_name_dest = firstMatch(text, [
    /(?:Consignee|Buyer|To)\s*(?:Name)?\s*[:\-]\s*([A-Za-z0-9 .,&()\-]{3,80})/i,
  ]);

  const liquor_class = firstMatch(text, [
    /(?:Liquor|Liquer)\s*(?:Class|Type|Category)\s*[:\-]?\s*([A-Za-z ]{3,40})/i,
    /\b(IMFL|COUNTRY LIQUOR|WINE|BEER|IMFS)\b/i,
  ]);

  const permit_date = toIsoDate(
    firstMatch(text, [/Permit\s*Date\s*[:\-]?\s*([\d/\-.]{8,10})/i, /Date\s*of\s*Issue\s*[:\-]?\s*([\d/\-.]{8,10})/i]),
  );
  const permit_generated_at = toIsoTimestamp(
    firstMatch(text, [/Generated\s*(?:On|At|Date)\s*[:\-]?\s*([\d/\-.]{8,10}[ ,T]+[\d:]{4,8})/i]),
  ) ?? (permit_date ? `${permit_date}T00:00:00Z` : null);
  const valid_until = toIsoDate(
    firstMatch(text, [/Valid\s*(?:Up\s*to|Until|Till)\s*[:\-]?\s*([\d/\-.]{8,10})/i]),
  );

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
    permit_date,
    permit_generated_at,
    valid_until,
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
  /** Parser identity recorded on every permit row (state + version). */
  version: string;
  /** Cheap signal test against the extracted text. */
  detect: (text: string) => boolean;
  parse: (text: string) => ParsedPermit;
}

export const PARSERS: StateParser[] = [
  {
    version: 'haryana-l32@1',
    detect: (t) => /haryanatax\.gov\.in|excisehry|govt\.?\s*of\s*haryana|haryana/i.test(t),
    parse: parseHaryana,
  },
];

export function selectParser(text: string): StateParser | null {
  return PARSERS.find((p) => p.detect(text)) ?? null;
}
