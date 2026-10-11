/**
 * On-device face blur for spot-sale photos. FAILS CLOSED.
 *
 * Spot-sale photos show members of the public buying alcohol. They have
 * consented to nothing, so an identifiable face must never leave the phone
 * (CLAUDE.md "Spot sales"; the privacy notice §4 states this as fact, so it
 * has to stay true).
 *
 * Pipeline, all local:
 *   1. Re-encode the camera file at SPOT_SALE_WIDTH. Bakes EXIF orientation
 *      into the pixels, so the detector and the redaction see the SAME pixel
 *      grid (ML Kit's fromFilePath honours EXIF; jpeg-js does not).
 *   2. ML Kit face detection (bundled model — works offline).
 *   3. Coarse mosaic over every face (lib/faceRedact.ts), re-encode.
 *   4. Detect AGAIN on the output. The file that uploads is the one that was
 *      checked — not an assumption about what redaction did. Anything still
 *      found is redacted and re-checked, up to MAX_ROUNDS.
 *
 * FAIL-CLOSED DECISION: if detection is unavailable, errors, or still finds a
 * face after MAX_ROUNDS, this THROWS FaceCheckError and the caller must not
 * save. We block rather than apply a conservative whole-frame blur, because a
 * whole-frame blur also destroys the bottle — the only thing the photo is for
 * — and a rep would just retake it. Silent raw upload is impossible: there is
 * no code path that returns an unchecked file.
 *
 * Original-file hygiene: the camera's file and every unblurred intermediate
 * are deleted here, success or failure. Nothing is written to the gallery
 * (expo-camera writes to the app cache only). The caller deletes the returned
 * blurred file after upload with discardPhoto().
 *
 * ponytail: ML Kit can miss a face (hard profile, heavy occlusion, very small
 * in frame — minFaceSize 0.05 of image width). Mitigations are the viewfinder
 * guidance ("faces aren't needed") and the rep seeing the blurred result
 * before saving, with Retake. A second detector (e.g. person segmentation)
 * would be the upgrade if misses show up in review.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { decode as b64ToBuf, encode as bufToB64 } from 'base64-arraybuffer';
import { redactJpeg, type FaceRect } from './faceRedact';
import { dHashFromJpeg, HASH_W, HASH_H } from './photoHash';

/** Width the spot-sale photo is stored at. Enough to read a label at 1-2 m. */
const SPOT_SALE_WIDTH = 1080;
const MAX_ROUNDS = 3;

/** Keeps name 'Error' so userMessage() shows our text (see ChallanLinesError). */
export class FaceCheckError extends Error {}

export interface BlurredPhoto {
  /** Local file: checked, faces mosaicked. The ONLY thing allowed to upload. */
  uri: string;
  /** Faces redacted. 0 = checked and none found (not "unchecked"). */
  faces: number;
  /** dHash of the blurred image (lib/photoHash), or null if hashing failed —
   *  that only loses the duplicate flag, so it never blocks the save. */
  hash: string | null;
}

let detector: any = null;

/**
 * Lazily required, exactly like the ML Kit text recogniser in odometerOcr:
 * requireNativeModule throws at import time on a binary without the module.
 * Here that must NOT degrade to "skip the check" — it throws FaceCheckError.
 */
async function getDetector(): Promise<any> {
  if (detector?.status === 'ready') return detector;
  let mod: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('@infinitered/react-native-mlkit-face-detection');
  } catch {
    throw new FaceCheckError('Face check isn’t available in this version of the app. Update the app to log spot sales.');
  }
  const d = new mod.RNMLKitFaceDetector(
    // 'accurate' catches more partial and angled faces than 'fast'; 0.05 of
    // the image width still catches a customer a few metres back.
    { performanceMode: 'accurate', minFaceSize: 0.05 },
    true,
  );
  await d.initialize();
  if (d.status !== 'ready') throw new FaceCheckError('The face check couldn’t start on this phone.');
  detector = d;
  return d;
}

async function detect(uri: string): Promise<FaceRect[]> {
  const d = await getDetector();
  // The wrapper swallows native errors and returns undefined — treat that,
  // and success=false, as "not checked", never as "no faces".
  const res = await d.detectFaces(uri);
  if (!res || res.success === false || !Array.isArray(res.faces)) {
    throw new FaceCheckError('Couldn’t check this photo for faces.');
  }
  return res.faces.map((f: any) => ({
    x: f.frame.origin.x,
    y: f.frame.origin.y,
    w: f.frame.size.x,
    h: f.frame.size.y,
  }));
}

/** Delete a local photo file. Never throws — cleanup must not mask a result. */
export async function discardPhoto(uri: string | null | undefined): Promise<void> {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Cache files are reclaimed by the OS eventually; nothing else to do.
  }
}

/** Hash of the file that will upload — what the server compares for reuse. */
async function hashOf(uri: string): Promise<string | null> {
  let tiny: string | null = null;
  try {
    const t = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: HASH_W, height: HASH_H } }], {
      compress: 1,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    tiny = t.uri;
    const b64 = await FileSystem.readAsStringAsync(t.uri, { encoding: FileSystem.EncodingType.Base64 });
    return dHashFromJpeg(new Uint8Array(b64ToBuf(b64)));
  } catch {
    return null;
  } finally {
    await discardPhoto(tiny);
  }
}

/**
 * Take ownership of a freshly captured camera file and return a checked,
 * face-blurred copy. The original is always deleted. Throws FaceCheckError
 * (or the underlying error) when the photo must not be saved.
 */
export async function blurFacesForUpload(cameraUri: string): Promise<BlurredPhoto> {
  const scratch: string[] = [];
  let current = '';
  try {
    const norm = await ImageManipulator.manipulateAsync(
      cameraUri,
      [{ resize: { width: SPOT_SALE_WIDTH } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
    );
    current = norm.uri;

    let total = 0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const faces = await detect(current);
      if (faces.length === 0) return { uri: current, faces: total, hash: await hashOf(current) };
      total += faces.length;

      const b64 = await FileSystem.readAsStringAsync(current, { encoding: FileSystem.EncodingType.Base64 });
      const out = redactJpeg(new Uint8Array(b64ToBuf(b64)), faces);
      const next = `${FileSystem.cacheDirectory}spot-sale-${Date.now()}-${round}.jpg`;
      await FileSystem.writeAsStringAsync(
        next,
        bufToB64(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer),
        { encoding: FileSystem.EncodingType.Base64 },
      );
      scratch.push(current); // the pre-redaction file: delete, never upload
      current = next;
    }
    throw new FaceCheckError('There are still faces in this photo after blurring. Retake it with the bottle and counter only.');
  } catch (e) {
    if (current) scratch.push(current);
    throw e;
  } finally {
    await discardPhoto(cameraUri);
    for (const s of scratch) await discardPhoto(s);
  }
}
