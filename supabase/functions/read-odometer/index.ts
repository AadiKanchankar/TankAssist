/**
 * read-odometer — cloud OCR for the odometer capture.
 *
 * On-device ML Kit was not accurate enough on real dashboards, so cloud vision
 * is the PRIMARY engine and ML Kit stays as the offline fallback. Returns the
 * client's existing { value, confidence, rawText } shape, so readOdometer()'s
 * swappable interface needs no call-site changes.
 *
 * CREDENTIAL: a GCP SERVICE ACCOUNT JSON, held ONLY as a Supabase Edge Function
 * secret. Never in the app, the repo, the database, or Vault. Service account
 * rather than an API key because it is scopeable and rotatable, and Google
 * recommends it for server-to-server; the cost is the OAuth2 exchange below.
 *
 * Runs on the CALLER'S JWT like every other function here, so the
 * anon-key-only invariant holds and the private key never leaves this process.
 */

const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const KEY_CANDIDATES = [
  'vision-ocr',
  'VISION_OCR',
  'vision_ocr',
  'VISION_API_KEY',
  'GOOGLE_VISION_API_KEY',
  'GCP_VISION_API_KEY',
  'GOOGLE_SERVICE_ACCOUNT',
];

function resolveSecret(): { name: string; value: string } | null {
  for (const name of KEY_CANDIDATES) {
    const value = Deno.env.get(name);
    if (value && value.trim()) return { name, value: value.trim() };
  }
  return null;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/**
 * What KIND of credential is present — never the value.
 *
 * Storing the wrong type presents identically to "the key is bad", so naming
 * the shape turns a mystery into a one-line answer.
 */
function credentialShape(value: string): string {
  const v = value.trim();
  if (v.startsWith('{') && v.includes('private_key')) return 'service_account_json';
  if (v.endsWith('.gserviceaccount.com')) return 'service_account_email_only';
  if (/^AIza[0-9A-Za-z_-]{30,}$/.test(v)) return 'api_key';
  return 'unrecognised';
}

function parseServiceAccount(value: string): ServiceAccount | null {
  try {
    const sa = JSON.parse(value);
    if (typeof sa?.client_email === 'string' && typeof sa?.private_key === 'string') return sa;
    return null;
  } catch {
    return null;
  }
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlStr = (s: string) =>
  btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** PEM (PKCS#8) → the DER bytes WebCrypto wants. */
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Access token, cached in module scope.
 *
 * Signing an RS256 assertion and round-tripping to Google on EVERY odometer
 * read would add latency to the one interaction a rep is waiting on. Tokens
 * last an hour; this reuses one until it is nearly expired.
 */
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // 60s of slack so a token cannot expire mid-flight.
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.token;

  const header = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64urlStr(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput)),
  );
  const assertion = `${signingInput}.${b64url(sig)}`;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);

  const body = await res.json();
  if (!body?.access_token) throw new Error('Token exchange returned no access_token');
  cachedToken = { token: body.access_token, expiresAt: now + (body.expires_in ?? 3600) };
  return cachedToken.token;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const MIN_ODO_DIGITS = 4;
const MAX_ODO_DIGITS = 7;

/**
 * Pick the odometer number out of Vision's text. Mirrors
 * extractOdometerCandidate in lib/odometer.ts — this copy is the one that
 * decides for CLOUD reads; the client's copy only serves the ML Kit fallback.
 * Both are covered by lib/odometer.test.ts, so keep them in step.
 */
function extractOdometer(raw: string): number | null {
  if (!raw) return null;
  const candidates: string[] = [];

  for (const line of raw.split(/[\r\n]+/)) {
    // A thousands separator is not a decimal point.
    const cleaned = line.replace(/(\d)[,](\d{3})(?!\d)/g, '$1$2');
    const tokens = cleaned.split(/[^0-9.,]+/).filter(Boolean);
    const singles: string[] = [];

    for (const rawTok of tokens) {
      const t = rawTok.replace(/[.,]+$/, '');
      // ANY separator still between digits is either the trip meter (67.8) or
      // two dial markings Vision merged ("200.120"). The merged case is the
      // dangerous one: it is the right LENGTH to look like an odometer and can
      // outrank the real reading.
      if (/\d[.,]\d/.test(t)) { singles.length = 0; continue; }
      const digits = t.replace(/\D/g, '');
      if (!digits) continue;

      if (digits.length >= MIN_ODO_DIGITS && digits.length <= MAX_ODO_DIGITS) {
        candidates.push(digits); singles.length = 0; continue;
      }
      // Rebuild a run of SINGLE digits only — looser merging would turn the
      // dial markings "80 100" into a plausible-looking 80100.
      if (digits.length === 1) {
        singles.push(digits);
        if (singles.length >= MIN_ODO_DIGITS && singles.length <= MAX_ODO_DIGITS) {
          candidates.push(singles.join(''));
        }
      } else {
        singles.length = 0;
      }
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.length - a.length || Number(b) - Number(a));
  const n = Number(candidates[0]);
  return Number.isFinite(n) ? n : null;
}


Deno.serve(async (req) => {
  const secret = resolveSecret();
  const shape = secret ? credentialShape(secret.value) : null;
  const sa = secret && shape === 'service_account_json' ? parseServiceAccount(secret.value) : null;

  // Health probe: what is present, under which name, of what shape, and can it
  // actually mint a token. Never the value.
  if (req.method === 'GET') {
    let tokenOk: boolean | null = null;
    let tokenError: string | null = null;
    if (sa) {
      try {
        await getAccessToken(sa);
        tokenOk = true;
      } catch (e) {
        tokenOk = false;
        tokenError = String(e);
      }
    }
    return json({
      ok: true,
      configured: !!secret,
      keyName: secret?.name ?? null,
      shape,
      serviceAccount: sa?.client_email ?? null,
      projectId: sa?.project_id ?? null,
      tokenOk,
      tokenError,
      usable: tokenOk === true,
    });
  }

  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  if (!secret) {
    return json(
      { error: 'Cloud OCR is not configured', detail: `Set one of: ${KEY_CANDIDATES.join(', ')}` },
      503,
    );
  }
  if (!sa) {
    // Fail loudly and specifically rather than letting Google return an opaque
    // 403 that reads like "OCR is inaccurate".
    return json(
      {
        error: 'Wrong credential type',
        detail: `Secret "${secret.name}" looks like ${shape}. This function needs the full service-account JSON.`,
        fallback: true,
      },
      503,
    );
  }

  let imageBase64: string | undefined;
  try {
    imageBase64 = (await req.json())?.imageBase64;
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return json({ error: 'imageBase64 is required' }, 400);
  }
  if (imageBase64.length > 10_000_000) {
    return json({ error: 'Image too large — send the cropped odometer only' }, 413);
  }

  let token: string;
  try {
    token = await getAccessToken(sa);
  } catch (e) {
    return json({ error: 'Auth failed', fallback: true, detail: String(e) }, 502);
  }

  let visionRes: Response;
  try {
    visionRes = await fetch(VISION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        requests: [
          {
            image: { content: imageBase64 },
            // DOCUMENT_TEXT_DETECTION reads 7-segment and LCD digit shapes
            // considerably better than plain TEXT_DETECTION.
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            imageContext: { languageHints: ['en'] },
          },
        ],
      }),
    });
  } catch (e) {
    // Network failure: the CLIENT falls back to on-device ML Kit. Flagged so
    // the caller can tell "cloud unreachable" from "cloud read nothing".
    return json({ error: 'Vision unreachable', fallback: true, detail: String(e) }, 502);
  }

  if (!visionRes.ok) {
    const detail = await visionRes.text();
    // 401/403 = bad scope or the Vision API not enabled; 429 = quota. Pass the
    // status through so a misconfiguration never looks like poor accuracy.
    return json(
      { error: 'Vision rejected the request', status: visionRes.status, fallback: true, detail },
      502,
    );
  }

  const payload = await visionRes.json();
  const first = payload?.responses?.[0];
  if (first?.error) {
    return json({ error: 'Vision error', fallback: true, detail: first.error.message }, 502);
  }

  const rawText: string = first?.fullTextAnnotation?.text ?? '';
  // Vision reports a real per-page confidence, so this field finally carries a
  // genuine signal instead of the null ML Kit was forced to return.
  const confidence: number | null =
    typeof first?.fullTextAnnotation?.pages?.[0]?.confidence === 'number'
      ? first.fullTextAnnotation.pages[0].confidence
      : null;

  const value = extractOdometer(rawText);
  // Logged so a future "no digits" is diagnosable from the server rather than
  // being a black box. Only the OCR text of a cropped odometer — no image, no
  // identifiers.
  if (value === null) {
    console.warn('[read-odometer] no digits extracted from: ' + JSON.stringify(rawText.slice(0, 200)));
  }

  return json({ value, confidence, rawText });
});
