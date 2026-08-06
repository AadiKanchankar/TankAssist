import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../constants/colors';
import Header from './Header';
import Button from './Button';
import { readOdometer } from '../lib/odometerOcr';
import { checkReading } from '../lib/odometer';

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

  const reset = () => {
    setPhotoUri(null);
    setReading('');
    setOcrMissed(false);
  };

  const shoot = async () => {
    if (!cameraRef) return;
    setBusy(true);
    try {
      const photo = await cameraRef.takePictureAsync({ quality: 0.7 });
      if (!photo?.uri) return;
      setPhotoUri(photo.uri);
      const r = await readOdometer(photo.uri);
      if (r.value != null) {
        setReading(String(r.value));
        setOcrMissed(false);
      } else {
        setReading('');
        setOcrMissed(true);
      }
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
            <CameraView ref={setCameraRef} style={{ flex: 1 }} facing="back">
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
            <Text style={styles.label}>Odometer reading</Text>
            <TextInput
              style={styles.readingInput}
              value={reading}
              onChangeText={(v) => setReading(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="e.g. 45120"
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />
            <Text style={styles.help}>
              {ocrMissed
                ? 'Couldn’t read the dial automatically — type the number from the photo.'
                : 'Read from your photo. Check it matches the dial and correct it if not.'}
            </Text>
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
