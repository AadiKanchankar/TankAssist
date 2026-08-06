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
import { extractOdometerCandidate } from './odometer';

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

let engine: OdometerEngine = new MlKitEngine();

/** Swap the engine (phase-2 YOLO reader, or a fake in a test). */
export function setOdometerEngine(next: OdometerEngine) {
  engine = next;
}

export function readOdometer(imageUri: string): Promise<OdometerReading> {
  return engine.readOdometer(imageUri);
}
