import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ActivityIndicator, Alert, Image } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../constants/colors';
import Header from './Header';
import Button from './Button';
import * as ImageManipulator from 'expo-image-manipulator';
import { readOdometer } from '../lib/odometerOcr';
import { checkReading, resolveOdometerReading } from '../lib/odometer';

/** Guide-frame height in dp — must match styles.frame.height. */
const FRAME_H = 96;
/**
 * Widest image we send to OCR. Only ever a DOWNSCALE, and high enough that the
 * digits keep their pixels; the previous unconditional 1200 shrank a
 * full-width strip by 70% and threw away exactly what OCR needed.
 */
const OCR_MAX_WIDTH = 1600;

export interface OdometerResult {
  value: number;
  photoUri: string;
}

interface Props {
  visible: boolean;
  which: 'start' | 'end';
  /** Morning reading, when capturing the end-of-day one. Enables the
   *  "odometers don't go backwards" check before anything is saved. */
  startOfDay?: number | null;
  onCancel: () => void;
  onConfirm: (r: OdometerResult) => void;
}

/**
 * Guided odometer capture: photograph the dial inside the frame, OCR pre-fills
 * the number, the REP confirms or corrects it.
 *
 * The on-screen frame is the whole trick for a first cut — a dashboard shows
 * odometer, trip meter and speed at once, and aligning the digits inside a box
 * hands the recogniser a tight crop instead of the whole cluster. OCR ASSISTS;
 * the human confirms. A failed read is not a failure state: the field is just
 * empty and typed in.
 */
export default function OdometerCapture({
  visible,
  which,
  startOfDay,
  onCancel,
  onConfirm,
}: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [reading, setReading] = useState('');
  const [busy, setBusy] = useState(false);
  const [ocrMissed, setOcrMissed] = useState(false);
  /**
   * Which engine answered, in plain words.
   *
   * Shown to the rep rather than logged, because the person holding the phone
   * is the only one who can tell us what happened in the field — and a silent
   * fallback is indistinguishable from a cloud engine that was never wired up.
   */
  const [engineNote, setEngineNote] = useState<string | null>(null);
  /** Camera view size, needed to map the guide frame onto the photo. */
  const [camSize, setCamSize] = useState<{ w: number; h: number } | null>(null);
  /**
   * The exact image that went to OCR. Shown on the correction screen so the
   * rep can read the number off it — and so a bad crop is VISIBLE rather than
   * silently producing a bad reading.
   */
  const [cropUri, setCropUri] = useState<string | null>(null);
  const [cropFailed, setCropFailed] = useState(false);
  /** OCR runs after the correction screen is already up; never blocks it. */
  const [ocrBusy, setOcrBusy] = useState(false);
  /**
   * Set when the reading was corrected (tenths wheel dropped) or looks
   * implausible. Shown prominently — a silently adjusted number is worse than
   * a wrong one, because nobody checks it.
   */
  const [readingNote, setReadingNote] = useState<string | null>(null);

  const reset = () => {
    setPhotoUri(null);
    setCropUri(null);
    setCropFailed(false);
    setReading('');
    setOcrMissed(false);
    setOcrBusy(false);
    setEngineNote(null);
    setReadingNote(null);
  };

  /**
   * Crop the captured photo down to the guide frame, then shrink it.
   *
   * The frame WAS purely decorative — the full dashboard photo went to OCR,
   * which is why readings were poor: the digits were a small fraction of a
   * wide frame full of competing dial numbers. Measured on tightly-framed
   * images, cloud OCR reads well; on a whole dashboard it has to find the
   * odometer first.
   *
   * ponytail: this maps the frame by PROPORTION, not by true preview geometry.
   * CameraView may letterbox the sensor image, so the crop can be a few
   * percent off — harmless, because the box is drawn generously and the rep
   * confirms the number. Upgrade path is the frame's real preview rect.
   *
   * Falls back to the uncropped photo on any failure: a bad crop must never
   * cost the rep their capture.
   */
  const cropToFrame = async (
    uri: string,
    w: number,
    h: number,
  ): Promise<{ uri: string; cropped: boolean }> => {
    try {
      if (!camSize || !w || !h) return { uri, cropped: false };

      // Pad the MARGIN around the guide, never multiply the frame itself.
      // The previous version did `0.78 * 1.8`, which overflowed past 1.0 and
      // clamped — leaving ZERO horizontal crop, so the whole dashboard
      // (speedo dials, brand text) reached Vision. Expanding into the leftover
      // space instead means padding can never erase the crop.
      const baseW = 0.78; // matches styles.frame width
      const baseH = Math.min(1, FRAME_H / camSize.h);
      const fw = Math.min(0.94, baseW + (1 - baseW) * 0.45);
      // The frame is a thin band, so it is the one most at risk of clipping a
      // digit — pad it harder than the width, but keep it a real crop.
      const fh = Math.min(0.55, baseH * 2.6);

      const cropW = Math.round(fw * w);
      const actions: ImageManipulator.Action[] = [
        {
          crop: {
            originX: Math.round(((1 - fw) / 2) * w),
            originY: Math.round(((1 - fh) / 2) * h),
            width: cropW,
            height: Math.round(fh * h),
          },
        },
      ];
      // Only ever DOWNSCALE, and not below a width that keeps the digits
      // legible. Unconditionally resizing to 1200 previously shrank a
      // full-width strip by 70%, throwing away the very pixels OCR needs.
      if (cropW > OCR_MAX_WIDTH) actions.push({ resize: { width: OCR_MAX_WIDTH } });

      const result = await ImageManipulator.manipulateAsync(uri, actions, {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      return result?.uri ? { uri: result.uri, cropped: true } : { uri, cropped: false };
    } catch {
      // Falling back to the full photo is survivable, but the rep MUST be able
      // to see it happened — the correction screen shows whatever went to OCR.
      return { uri, cropped: false };
    }
  };

  /**
   * OCR, run AFTER the correction screen is already showing.
   *
   * The rep must never wait on a network round-trip: they land on the
   * correction screen instantly with the crop in front of them, and the field
   * fills itself when the read returns (usually 1-2s). If it never returns,
   * they simply type the number they can already see.
   */
  const runOcr = async (uri: string) => {
    setOcrBusy(true);
    try {
      const r = await readOdometer(uri);
      setEngineNote(
        r.source === 'cloud'
          ? `Read by cloud OCR${r.confidence != null ? ` (${Math.round(r.confidence * 100)}% confident)` : ''}.`
          : `Read on this phone — cloud OCR unavailable (${r.cloudError ?? 'reason unknown'}).`,
      );
      // Guard the tenths wheel BEFORE the number reaches the field: a reading
      // 10x too big would wreck travel allowance, and the rep is unlikely to
      // spot a plausible-looking extra digit.
      const resolved = resolveOdometerReading(r.value, startOfDay ?? null);
      if (resolved.reason) setReadingNote(resolved.reason);
      if (resolved.value != null) {
        // Never clobber a number the rep has already typed while waiting.
        setReading((prev) => (prev ? prev : String(resolved.value)));
        setOcrMissed(false);
      } else {
        setOcrMissed(true);
      }
    } catch {
      setOcrMissed(true);
    } finally {
      setOcrBusy(false);
    }
  };

  const shoot = async () => {
    if (!cameraRef) return;
    setBusy(true);
    try {
      const photo = await cameraRef.takePictureAsync({ quality: 0.7 });
      if (!photo?.uri) {
        setBusy(false);
        return;
      }
      const crop = await cropToFrame(photo.uri, photo.width, photo.height);
      setPhotoUri(photo.uri);
      setCropUri(crop.uri);
      setCropFailed(!crop.cropped);
      // Correction screen NOW. OCR is deliberately not awaited.
      setBusy(false);
      void runOcr(crop.uri);
      return;
    } catch {
      Alert.alert('Camera', 'Could not take the photo. Try again.');
    }
    setBusy(false);
  };

  const confirm = () => {
    const value = Number(reading.replace(/[^0-9]/g, ''));
    const check = checkReading(Number.isFinite(value) ? value : null, startOfDay ?? null);
    if (!check.ok) {
      Alert.alert('Check the reading', check.message ?? 'That reading does not look right.');
      return;
    }
    if (!photoUri) {
      Alert.alert('Photo needed', 'Take a photo of the odometer before saving.');
      return;
    }
    onConfirm({ value, photoUri });
    reset();
  };

  const title = which === 'start' ? 'Odometer — start of day' : 'Odometer — end of day';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.screen}>
        <Header
          title={title}
          onBack={() => {
            reset();
            onCancel();
          }}
        />

        {!permission?.granted ? (
          <View style={styles.center}>
            <Text style={styles.help}>Camera access is needed to photograph the odometer.</Text>
            <Button title="Allow camera" onPress={requestPermission} style={{ marginTop: Space.md }} />
          </View>
        ) : !photoUri ? (
          <View style={{ flex: 1 }}>
            <CameraView
              ref={setCameraRef}
              style={{ flex: 1 }}
              facing="back"
              onLayout={(e) =>
                setCamSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
              }
            >
              {/* Alignment frame — line the digits up inside it. */}
              <View style={styles.frameWrap} pointerEvents="none">
                <View style={styles.frame} />
                <Text style={styles.frameHint}>
                  Line up only the odometer digits inside the box{'\n'}
                  (not the trip meter)
                </Text>
              </View>
            </CameraView>
            <View style={styles.shootBar}>
              <Button title={busy ? 'Reading…' : 'Capture'} onPress={shoot} loading={busy} />
            </View>
          </View>
        ) : (
          <View style={styles.reviewWrap}>
            {/* The exact image OCR was given. Doubles as a crop check: if the
                box missed the odometer the rep sees it here and retakes,
                instead of the bad crop silently becoming a bad reading. */}
            {cropUri ? (
              <Image source={{ uri: cropUri }} style={styles.cropPreview} resizeMode="contain" />
            ) : null}
            {cropFailed ? (
              <Text style={styles.cropWarn}>
                Couldn’t crop to the box — this is the whole photo, so the reading may be less
                accurate. Retake if the digits are small.
              </Text>
            ) : null}

            <Text style={styles.label}>Odometer reading</Text>
            <TextInput
              style={styles.readingInput}
              value={reading}
              onChangeText={(v) => setReading(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder={ocrBusy ? 'Reading…' : 'Type the number above'}
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />
            <Text style={styles.help}>
              {ocrBusy
                ? 'Reading the photo… you can type it yourself without waiting.'
                : ocrMissed
                ? 'Couldn’t read it automatically — type the number from the image above.'
                : 'Check it matches the image above and correct it if not.'}
            </Text>
            {readingNote ? <Text style={styles.cropWarn}>{readingNote}</Text> : null}
            {engineNote ? <Text style={styles.help}>{engineNote}</Text> : null}
            {startOfDay != null ? (
              <Text style={styles.help}>This morning’s reading was {startOfDay}.</Text>
            ) : null}

            <View style={styles.reviewActions}>
              <Button title="Save reading" onPress={confirm} />
              <Button
                title="Retake photo"
                variant="secondary"
                onPress={reset}
                style={{ marginTop: Space.sm }}
              />
            </View>
          </View>
        )}

        {busy && !photoUri ? (
          <View style={styles.busyOverlay}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Space.lg },
  frameWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: '78%',
    height: 96,
    borderWidth: 3,
    borderColor: Colors.accent,
    borderRadius: Radius.md,
    backgroundColor: 'transparent',
  },
  frameHint: {
    ...Type.caption,
    color: Colors.white,
    textAlign: 'center',
    marginTop: Space.md,
    paddingHorizontal: Space.lg,
    lineHeight: 18,
  },
  shootBar: { padding: Space.md, backgroundColor: Colors.background },
  cropPreview: {
    width: '100%',
    height: 130,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    marginBottom: Space.md,
  },
  cropWarn: { ...Type.caption, color: Colors.warning, marginBottom: Space.sm, lineHeight: 17 },
  reviewWrap: { padding: Space.lg },
  label: { ...Type.label, color: Colors.textMuted, marginBottom: Space.sm },
  readingInput: {
    ...Type.display,
    color: Colors.text,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    letterSpacing: 2,
  },
  help: { ...Type.caption, color: Colors.textMuted, marginTop: Space.sm, lineHeight: 18 },
  reviewActions: { marginTop: Space.xl },
  busyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0004',
  },
});
