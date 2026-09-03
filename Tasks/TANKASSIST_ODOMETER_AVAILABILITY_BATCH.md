# TankAssist — make cloud odometer OCR reliably available + fix check-in scroll

**One real goal: cloud OCR must actually run when called.** The evidence says this is an
**availability** problem, not an accuracy or crop problem — a crisp green LCD ("89314 km") with a
perfect tight crop still returned "cloud read no digits" (see the live screenshot). A perfect crop
is the easiest possible OCR target, so if that failed, the Vision call itself is not landing. Fix
that. **YOLO/OpenCV is explicitly phase-2 and out of scope here** (it's a localizer, not a digit
reader — it wouldn't fix "unavailable," and the crop is already working). Plus one small unrelated
UX bug: the check-in page won't scroll.

Standing rules: verify live via MCP, `graphify query` before grep, `tsc` clean, complete files,
schema changes are STOP-POINTs, no service-role key, `ponytail:` where scope is narrowed, Impeccable
pass on UI. This is JS/server-config only (no new native module) → **OTA, not a build**, unless
something forces otherwise (say so if it does).

---

## 1. Diagnose WHY cloud OCR is unavailable (do this first — likely a fast, free finding)
Don't harden blind. Read the actual logs and find the failing link before changing code. The client
currently swallows any cloud failure into "cloud OCR unavailable (cloud read no digits)", which hides
the real cause. Check, in order of likelihood:

1. **Vision API key / billing / quota.** Inspect the Supabase Edge Function logs and the GCP side:
   is the `read-odometer` (or whatever it's named) function returning 401/403 (bad/restricted key),
   429 (quota/rate limit), or a billing-disabled error? A lapsed billing account or an over-
   restricted API key makes *every* call fail and look identical to "unavailable." **Confirm the
   Vision API key is valid, unrestricted-enough for this call, and billing is active on the project.**
2. **Edge Function errors / cold start.** Is the function erroring on the request shape, timing out,
   or slow to cold-start? A cold Supabase Edge Function can take several seconds; if the client
   timeout is short it gives up and shows "unavailable" even though the call would have succeeded.
   Check function invocation logs for actual 200s vs errors and the latency distribution.
3. **The client → function call.** Is the client actually invoking the function (auth header, URL,
   payload), or failing before it even leaves the phone? Is it sending the cropped image correctly
   (right encoding/size)? `graphify` the capture → crop → Edge Function call path.
4. **What "cloud read no digits" actually means here.** Distinguish "the function returned but Vision
   found nothing" from "the function call never succeeded." These are different bugs — the screenshot
   suggests the latter. **Surface the real error** (status code / message) in logs (and, in a dev/
   debug affordance, on screen) so this stops being a black box.

**Report the identified root cause before hardening.** If it's key/billing/quota, that's the whole
fix and the rest is belt-and-suspenders.

## 2. Harden availability so it reliably lands
Once the root cause is known, make the call robust (these apply regardless of the specific cause):

- **Warm the Edge Function on check-in.** The owner's instinct is right: fire a cheap warm-up ping
  to the OCR function when the rep taps check-in, so it's not cold by the time they finish the selfie
  and reach the odometer step. The real photo doesn't exist yet at check-in — so this is a *warm-up*
  (keep the function hot), NOT a prefetch of the result. Keep it lightweight; don't burn quota.
- **Retry with backoff.** A single transient failure (cold start, brief signal drop) must not
  dead-end to "unavailable." Retry the OCR call 2–3 times with short backoff before falling back.
  Most "retake fails again" reports are likely first-call-cold / transient — retry catches these.
- **Sensible timeout.** Long enough to survive a cold start + a real Vision round-trip, short enough
  not to hang the rep. Because §3b already made OCR non-blocking (the rep is on the correction screen
  with the crop, field fills when it returns), a slightly longer timeout costs the rep nothing — they
  can type meanwhile — so bias toward *completing* over *failing fast*.
- **Fix the confidence/error surfacing** so "unavailable" only shows when the call genuinely,
  finally failed after retries — not on a recoverable first miss.
- **Verify the key/billing fix holds** with a real end-to-end call to Vision from the deployed
  function returning digits on the clean-LCD test image.

## 3. On-device fallback — leave ML Kit as-is, do NOT build YOLO now
- Keep ML Kit purely as the **offline/last-resort** fallback for a rep with genuinely no signal
  (who will usually just type it anyway). Don't invest in it.
- **YOLO/OpenCV on-device is phase-2, parked.** Record in HANDOFF: the ~180 real rep photos in
  `E:\TANK90\Odometer-Reading` are the training/calibration set for a future on-device region
  detector — but that's a multi-day pipeline (label → train → export TFLite → validate) and is the
  *offline-quality* upgrade, not the fix for availability. On the security framing the owner raised:
  a bundled on-device model is in-process offline inference — there's no server/network surface to
  attack and no data exfiltration path, so the "local API / OWASP isolation" concern is largely moot
  for on-device inference; the real concern is model-file supply-chain, addressed when/if it's built.
  Don't over-engineer it now.

## 4. Fix the check-in page scroll (small, unrelated)
The check-in page can't scroll, so the odometer section below the fold is unreachable — a rep who
can't scroll will never fill it and may think it's broken. The screen is otherwise perfect; **just
make it scroll.** Likely a `ScrollView`/`contentContainerStyle`/`flex` issue (a fixed-height or
`flex:1` inner view eating the scroll, or content not in a scroll container). Confirm the odometer
section is reachable on a small screen. Nothing else on this page changes.

## 5. Ship
After §1–§4 tsc-clean: update `CLAUDE.md`/`HANDOFF.md` (cloud-OCR availability root cause + hardening;
scroll fix; YOLO parked with the dataset location). Commit + push. Since this is JS/config only,
**OTA** onto the current runtime (confirm the runtime matches the installed build) — no new build
unless something native crept in (flag it if so). `expo-doctor` if anything dependency-touching.
On-device test: check-in page scrolls to the odometer section → OCR is called, warms on check-in,
and on a clean LCD **returns a reading reliably** (no "unavailable") → retake succeeds on retry →
genuinely-offline still falls back gracefully.

## Order of work
1. §1 diagnose — read Edge Function + Vision/GCP logs, identify the real failure, **report before fixing**.
2. §2 harden (warm-up, retry/backoff, timeout, honest error surfacing) — targeted at the found cause.
3. §4 scroll fix (quick).
4. §5 docs → OTA (or build only if forced).

Report after the §1 diagnosis (root cause) before hardening, and before shipping.
