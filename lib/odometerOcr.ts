/**
 * Odometer OCR engine — deliberately behind a one-function interface.
 *
 * The capture flow, validation and anti-cheat flagging are the actual value
 * and are identical whichever engine reads the digits. Keeping the engine
 * isolated means swapping ML Kit for a TFLite/YOLO reader later touches THIS
 * FILE ONLY.
 *
 * Current engine: ML Kit Text Recognition via
 * @infinitered/react-native-mlkit-text-recognition, BUNDLED model variant —
 * on-device and offline from first launch, which matters because reps work
 * rural routes where a first-use model download would leave OCR dead.
 *
 * ponytail: this reads a guided/framed crop the rep aligns to the odometer,
 * then post-processes with extractOdometerCandidate. It does NOT locate the
 * display automatically. If real motorcycle dashboards defeat the guided crop,
 * phase 2 is a TRODO/YOLO region detector in front of the same interface.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { extractOdometerCandidate } from './odometer';
import { supabase } from './supabase';

export interface OdometerReading {
  /** Best-guess odometer value, or null when nothing plausible was found. */
  value: number | null;
  /**
   * 0..1, or NULL when the engine reports no confidence signal.
   *
   * ML Kit's text recogniser returns text + bounding boxes only — there is no
   * per-token confidence in its result shape, so this engine returns null
   * rather than a fabricated score. Kept on the interface because a phase-2
   * detector would have a real one. Never gate saving on it: the rep confirms
   * the number either way.
   */
  confidence: number | null;
  /** Raw recognised text, kept for debugging a bad read on a real dashboard. */
  rawText: string;
}

export interface OdometerEngine {
  readOdometer(imageUri: string): Promise<OdometerReading>;
}

const EMPTY: OdometerReading = { value: null, confidence: null, rawText: '' };

/**
 * ML Kit implementation.
 *
 * The module is required LAZILY and inside a try. `requireNativeModule` throws
 * at import time when the native side is absent, so a static import would take
 * the whole bundle down on any binary that predates this dependency. The app
 * version is bumped so OTA updates cannot cross that boundary, but a lazy
 * require means the worst case is "type the number yourself" rather than a
 * white screen.
 */
class MlKitEngine implements OdometerEngine {
  async readOdometer(imageUri: string): Promise<OdometerReading> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('@infinitered/react-native-mlkit-text-recognition');
      const recognize = mod?.recognizeText;
      if (typeof recognize !== 'function') return EMPTY;

      // Result shape is { text, blocks[] } — text + bounding boxes, no scores.
      const result = await recognize(imageUri);
      const rawText: string = result?.text ?? '';
      return { value: extractOdometerCandidate(rawText), confidence: null, rawText };
    } catch {
      // No native module, or the recogniser threw on a bad frame. Either way
      // the rep types the number — capture must never hard-fail.
      return EMPTY;
    }
  }
}

/** Beyond this, stop waiting and read on-device instead. */
const CLOUD_TIMEOUT_MS = 8000;

/**
 * Cloud implementation — the PRIMARY engine.
 *
 * On-device ML Kit was not accurate enough on real dashboards (the phase-2 wall
 * anticipated when this interface was built). Cloud Vision reads 7-segment and
 * LCD digits materially better, so it leads and ML Kit becomes the offline
 * fallback. This is exactly the swap `setOdometerEngine` exists for — no call
 * site changes.
 *
 * Only the CROPPED odometer region goes over the wire, which the guided capture
 * already produces: cheaper, more accurate, and no incidental photography of
 * the rep or the vehicle interior leaves the device. The credential lives in
 * the Edge Function; nothing about Google is reachable from this app.
 */
class CloudEngine implements OdometerEngine {
  constructor(private fallback: OdometerEngine) {}

  async readOdometer(imageUri: string): Promise<OdometerReading> {
    try {
      const base64 = await FileSystem.readAsStringAsync(imageUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // A rep is standing at their bike waiting for this. Rather than let a
      // slow network hold the field hostage, cap it and read on-device.
      const timeout = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), CLOUD_TIMEOUT_MS),
      );
      const call = supabase.functions.invoke('read-odometer', {
        body: { imageBase64: base64 },
      });
      const res = await Promise.race([call, timeout]);

      if (res && !(res as any).error) {
        const data = (res as any).data as OdometerReading | undefined;
        // A cloud response that read nothing is still a cloud answer — but an
        // empty one is worth a second opinion, so fall through to on-device.
        if (data && data.value != null) return data;
      }
    } catch {
      // Network down, function cold, base64 read failed — all the same to the
      // rep, and all handled the same way: read it on the phone.
    }
    // Offline fallback. `confidence: null` already signals "no score" and the
    // rep confirms every reading anyway, so a bad fallback read costs a
    // correction, never a wrong saved number.
    return this.fallback.readOdometer(imageUri);
  }
}

let engine: OdometerEngine = new CloudEngine(new MlKitEngine());

/** Swap the engine (phase-2 YOLO reader, or a fake in a test). */
export function setOdometerEngine(next: OdometerEngine) {
  engine = next;
}

export function readOdometer(imageUri: string): Promise<OdometerReading> {
  return engine.readOdometer(imageUri);
}
