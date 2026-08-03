/**
 * parse-excise-permit — server-side ingestion of an uploaded excise permit.
 *
 * SECURITY POSTURE
 * - Runs entirely with the CALLER'S JWT (no service-role key anywhere): every
 *   read/write is still subject to RLS, so this function cannot do anything the
 *   signed-in management user couldn't do themselves.
 * - File type is verified by MAGIC BYTES, not filename/extension.
 * - Hard size cap enforced here as well as on the bucket.
 * - PDF text extraction uses unpdf (serverless pdf.js build) with eval/JS
 *   execution disabled — embedded PDF JavaScript is never run.
 *
 * HONEST-FAILURE POSTURE (works before facilities/product units are populated)
 * - No text layer (scan/photo)  -> permit created, needs manual entry. Never OCR-guessed.
 * - Unknown state / no parser   -> permit created with raw text, manual entry.
 * - Facility registry empty     -> movement_direction = 'unclassified'.
 * - Product units missing / PL / UNKNOWN quantity -> allocation written with
 *   computed_* = null and needs_review = true.
 * In every case the row lands as `pending_review` for a human. It never fails
 * the upload and never fabricates a value.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { extractText, getDocumentProxy } from 'npm:unpdf';
import { selectParser, type ParsedPermit } from './parsers.ts';
import {
  classifyMovement,
  type FacilityRow,
  type MovementDirection,
} from './classify.ts';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB, mirrors the bucket cap
const BUCKET = 'excise-permits';
const CONVERSION_FORMULA_VERSION = 'bl-v1';
/**
 * How far the raw bottle count may sit from a whole bottle before we suspect the
 * permit was matched to the wrong product. NOTE: this only catches sizes that
 * divide UNCLEANLY — 396 BL divides exactly by both 180ml and 330ml, so it
 * cannot tell those apart. That is why auto-allocation is limited to the
 * single-active-product case and everything else goes to a human.
 */
const CONVERSION_TOLERANCE_BOTTLES = 0.05;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

/** Magic-byte sniff. Filenames and client-supplied mime types are not trusted. */
function sniffType(bytes: Uint8Array): 'pdf' | 'jpeg' | 'png' | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
    return 'pdf'; // %PDF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  )
    return 'png';
  return null;
}

/** Litres per unit for the volume UOMs the product wizard offers. */
const LITRES_PER: Record<string, number> = { ml: 0.001, l: 1, cl: 0.01, litre: 1, liter: 1 };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization' }, 401);

  // Caller's JWT only — RLS still applies to everything below.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return json({ error: 'Not authenticated' }, 401);

  const { data: role } = await supabase.rpc('get_my_role');
  if (role !== 'management') return json({ error: 'Not permitted' }, 403);

  let storagePath: string;
  try {
    const body = await req.json();
    storagePath = String(body?.storage_path ?? '');
    if (!storagePath) throw new Error('storage_path is required');
  } catch (e) {
    return json({ error: (e as Error).message || 'Invalid body' }, 400);
  }

  // ── Download + validate ────────────────────────────────────────────────
  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(storagePath);
  if (dlErr || !blob) return json({ error: `Could not read the uploaded file: ${dlErr?.message ?? 'not found'}` }, 400);

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return json({ error: 'File exceeds the 10 MB limit' }, 400);
  const kind = sniffType(bytes);
  if (!kind) return json({ error: 'Unsupported file. Upload a PDF, JPEG or PNG.' }, 400);

  // ── Text layer ─────────────────────────────────────────────────────────
  let text = '';
  let extraction: 'text_layer' | 'no_text_layer' | 'image_no_ocr' = 'no_text_layer';

  if (kind === 'pdf') {
    try {
      const pdf = await getDocumentProxy(bytes, { isEvalSupported: false });
      const res = await extractText(pdf, { mergePages: true });
      text = (Array.isArray(res.text) ? res.text.join('\n') : res.text) ?? '';
      extraction = text.trim().length >= 40 ? 'text_layer' : 'no_text_layer';
    } catch (_e) {
      extraction = 'no_text_layer';
    }
  } else {
    // Images cannot be read without OCR, which is not available in this runtime
    // (Edge CPU/bundle limits). Route to manual entry — never guess.
    extraction = 'image_no_ocr';
  }

  // ── Parse ──────────────────────────────────────────────────────────────
  const parser = extraction === 'text_layer' ? selectParser(text) : null;
  const parsed: ParsedPermit | null = parser ? parser.parse(text) : null;
  const parserVersion = parser?.version ?? `manual-entry@1:${extraction}`;

  const needsManualEntry =
    !parsed || parsed.quantity_value === null || parsed.missing_fields.length > 0;

  // ── Duplicate guard (the "held seat") ──────────────────────────────────
  // Approved  -> final, it is already in the ledger.
  // Pending   -> a shared queue item ANY management user can review, so we send
  //              the uploader there instead of creating a second row.
  // Never runs for an unreadable upload: every one of those carries the same
  // 'UNREAD' placeholder and they are not duplicates of each other.
  const pn = parsed?.permit_number ?? null;
  if (pn && pn !== 'UNREAD') {
    const { data: rows } = await supabase
      .from('excise_permits')
      .select('id, status, uploaded_by')
      .eq('permit_number', pn)
      .in('status', ['approved', 'pending_review']);

    // Approved wins over pending — an approved copy is already in the ledger, so
    // that is the more important thing to tell the uploader. Picked explicitly
    // rather than leaning on 'approved' < 'pending_review' sorting alphabetically.
    const existing =
      rows?.find((r) => r.status === 'approved') ?? rows?.[0] ?? null;

    if (existing) {
      let uploaderName: string | null = null;
      if (existing.status === 'pending_review') {
        const { data: u } = await supabase
          .from('users').select('name').eq('id', existing.uploaded_by).maybeSingle();
        uploaderName = u?.name ?? null;
      }
      // The client uploaded before calling us, so this duplicate leaves a file in
      // the bucket with no permit row pointing at it. We deliberately LEAVE it.
      // Permit originals are audit evidence: the bucket has no DELETE policy by
      // design, and granting one so the app could tidy up a few stray bytes would
      // put a delete path on the evidence store to buy almost nothing. A human can
      // still clear orphans from the dashboard under service-role if it ever
      // matters. See HANDOFF.md "Known defects" for the full reasoning.
      return json({
        duplicate: existing.status === 'approved' ? 'approved' : 'pending',
        existing_permit_id: existing.id,
        permit_number: pn,
        uploaded_by_name: uploaderName,
      });
    }
  }

  // ── Classify (Gap 2). Empty registry -> everything is 'unclassified'. ───
  // Rules (incl. expired-vs-external) live in classify.ts and are unit-tested.
  let facilityFromId: string | null = null;
  let facilityToId: string | null = null;
  let direction: MovementDirection = 'unclassified';

  const srcNo = parsed?.license_no_source ?? null;
  const dstNo = parsed?.license_no_dest ?? null;
  if (srcNo || dstNo) {
    // Deliberately fetches expired/inactive rows too — classifyMovement needs
    // them to tell "not ours" apart from "ours but not currently valid".
    const { data: allFacs } = await supabase
      .from('company_facilities')
      .select('id, license_no, facility_type, is_active, valid_from, valid_until')
      .in('license_no', [srcNo, dstNo].filter(Boolean) as string[]);

    const c = classifyMovement(
      srcNo,
      dstNo,
      (allFacs ?? []) as FacilityRow[],
      new Date().toISOString().slice(0, 10),
    );
    facilityFromId = c.facilityFromId;
    facilityToId = c.facilityToId;
    direction = c.direction;
  }

  // ── Insert the permit (always pending_review) ──────────────────────────
  const { data: permit, error: insErr } = await supabase
    .from('excise_permits')
    .insert({
      state: parsed?.state ?? 'Unknown',
      permit_number: parsed?.permit_number ?? 'UNREAD',
      license_no_source: srcNo,
      license_no_dest: dstNo,
      licensee_name_source: parsed?.licensee_name_source ?? null,
      licensee_name_dest: parsed?.licensee_name_dest ?? null,
      liquor_class: parsed?.liquor_class ?? null,
      quantity_value: parsed?.quantity_value ?? 0,
      quantity_type: parsed?.quantity_type ?? 'UNKNOWN',
      // Every Liquor Details row. Allocation is driven by these, not the scalar.
      quantity_lines: parsed?.quantity_lines?.length
        ? parsed.quantity_lines
        : [{
            liquor_class: parsed?.liquor_class ?? null,
            quantity_value: parsed?.quantity_value ?? 0,
            quantity_type: parsed?.quantity_type ?? 'UNKNOWN',
          }],
      permit_date: parsed?.permit_date ?? null,
      permit_generated_at: parsed?.permit_generated_at ?? null,
      valid_until: parsed?.valid_until ?? null,
      original_file_path: storagePath,
      extracted_json: {
        extraction,
        parser: parserVersion,
        needs_manual_entry: needsManualEntry,
        missing_fields: parsed?.missing_fields ?? ['all'],
        parser_notes: parsed?.parser_notes ?? [],
        extras: parsed?.extras ?? {},
        parsed,
        raw_text: text.slice(0, 20000), // audit + diffing corrections
      },
      parser_version: parserVersion,
      status: 'pending_review',
      movement_direction: direction,
      facility_from_id: facilityFromId,
      facility_to_id: facilityToId,
      uploaded_by: userId,
    })
    .select()
    .single();

  if (insErr || !permit) return json({ error: insErr?.message ?? 'Could not save the permit' }, 400);

  // ── Product match (Gap 1) ──────────────────────────────────────────────
  // Auto-allocate ONLY when exactly one active product exists. The count is
  // evaluated live, so this self-corrects as the catalog grows.
  let allocation: Record<string, unknown> | null = null;
  const { data: products } = await supabase
    .from('products')
    .select('id, unit_size, unit_of_measure, qty_per_carton')
    .eq('is_active', true);

  // Only auto-allocate a SINGLE-line permit: a multi-line permit needs the
  // reviewer to decide how each line maps to a product.
  //
  // NOTE: this branch is currently DORMANT BY DESIGN — the catalog has >1 active
  // product, so `products.length === 1` is false and every permit goes to manual
  // allocation. That is correct, not broken: once several SKUs exist, a BL total
  // could genuinely map to more than one of them and only a human can say which.
  // Do not "fix" it by spreading a total across products. See HANDOFF.md.
  const singleLine = (parsed?.quantity_lines?.length ?? 0) <= 1;
  if (singleLine && products?.length === 1 && (parsed?.quantity_value ?? 0) > 0) {
    const p = products[0];
    const uom = (p.unit_of_measure ?? '').toString().trim().toLowerCase();
    const litresPerUnit = LITRES_PER[uom];
    const bottleLitres = p.unit_size != null && litresPerUnit ? Number(p.unit_size) * litresPerUnit : null;

    let computed_bottles: number | null = null;
    let computed_cases: number | null = null;
    let remainder_bottles: number | null = null;
    let needs_review = true;

    if (parsed!.quantity_type === 'BL' && bottleLitres && bottleLitres > 0) {
      const raw = parsed!.quantity_value! / bottleLitres;
      const bottles = Math.round(raw);
      const perCase = Number(p.qty_per_carton) || 0;
      computed_bottles = bottles;
      computed_cases = perCase > 0 ? Math.floor(bottles / perCase) : 0;
      remainder_bottles = perCase > 0 ? bottles - computed_cases * perCase : bottles;
      needs_review = Math.abs(raw - bottles) > CONVERSION_TOLERANCE_BOTTLES;
    }
    // PL / UNKNOWN / missing product units all fall through with computed_* null
    // and needs_review = true — resolved by a human in the review queue.

    const { data: alloc } = await supabase
      .from('permit_product_allocations')
      .insert({
        permit_id: permit.id,
        product_id: p.id,
        allocated_bl: parsed!.quantity_value,
        computed_bottles,
        computed_cases,
        remainder_bottles,
        needs_review,
        conversion_formula_version: CONVERSION_FORMULA_VERSION,
      })
      .select()
      .single();
    allocation = alloc ?? null;
  }

  return json({
    permit_id: permit.id,
    status: permit.status,
    extraction,
    parser_version: parserVersion,
    movement_direction: direction,
    needs_manual_entry: needsManualEntry,
    missing_fields: parsed?.missing_fields ?? ['all'],
    parser_notes: parsed?.parser_notes ?? [],
    auto_allocated: allocation !== null,
    active_product_count: products?.length ?? 0,
  });
});
