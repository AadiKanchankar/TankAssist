import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout, tabularNums } from '../../constants/colors';
import Button from '../../components/Button';
import Header from '../../components/Header';
import BentoTile from '../../components/BentoTile';
import SuccessOverlay from '../../components/SuccessOverlay';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';
import * as Location from 'expo-location';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { uploadSelfie, uploadOdometerPhoto } from '../../lib/storage';
import OdometerCapture, { OdometerResult } from '../../components/OdometerCapture';
import { reverseGeocode } from '../../lib/geocoding';

export default function AttendanceScreen({ navigation }: { navigation: any }) {
  const { profile } = useAuthStore();
  const insets = useSafeAreaInsets();
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [permission, requestPermission] = useCameraPermissions();
  const [submitting, setSubmitting] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location needed', 'Location permission is required for check-in.');
        navigation.goBack();
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
      setLocation(loc);
      setLoadingLocation(false);

      setLoadingAddress(true);
      const addr = await reverseGeocode(loc.coords.latitude, loc.coords.longitude);
      setAddress(addr);
      setLoadingAddress(false);
    })();
  }, []);

  // Odometer at punch-in. Optional by design — see handleSubmit.
  const [odo, setOdo] = useState<OdometerResult | null>(null);
  const [showOdo, setShowOdo] = useState(false);

  const takeSelfie = async () => {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
    if (photo) setPhotoUri(photo.uri);
  };

  const handleSubmit = async () => {
    if (!location) {
      Alert.alert('Location not ready', 'Wait for your location to resolve.');
      return;
    }
    if (!photoUri) {
      Alert.alert('Selfie needed', 'Take a selfie first.');
      return;
    }
    setSubmitting(true);
    try {
      const selfieUrl = await uploadSelfie(photoUri, profile!.id);
      // Odometer is optional at punch-in: a rep without their bike, or one on
      // a build that predates the feature, must never be blocked from starting
      // the day. Attendance is the record of record for pay.
      let odoPath: string | null = null;
      if (odo) {
        try {
          odoPath = await uploadOdometerPhoto(odo.photoUri, profile!.id, 'start');
        } catch {
          // Evidence upload failed — keep the rep-attested number, which is
          // still better than losing both, and let them re-shoot later.
        }
      }
      const { error } = await supabase.from('attendance').insert({
        user_id: profile!.id,
        check_in_time: new Date().toISOString(),
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        address: address,
        selfie_url: selfieUrl,
        odo_start: odo?.value ?? null,
        odo_start_photo_path: odoPath,
        odo_start_at: odo ? new Date().toISOString() : null,
        odo_start_lat: odo ? location.coords.latitude : null,
        odo_start_lng: odo ? location.coords.longitude : null,
      });
      if (error) throw error;
      // Peak-end: success overlay + haptic, then return.
      setSubmitting(false);
      setShowSuccess(true);
      setTimeout(() => navigation.goBack(), 1400);
      return;
    } catch (err: any) {
      Alert.alert('Couldn’t check in', err.message || 'Try again.');
    }
    setSubmitting(false);
  };

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Header title="Check in" onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <Text style={[Type.body, { color: Colors.text, marginBottom: Space.lg, textAlign: 'center' }]}>
            Camera permission is required to check in.
          </Text>
          <Button title="Grant permission" onPress={requestPermission} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title="Check in" onBack={() => navigation.goBack()} />

      <View style={[styles.content, { paddingBottom: Layout.tabBar + insets.bottom + Space.md }]}>
        {/* GPS */}
        <BentoTile>
          <Text style={styles.label}>Your location</Text>
          {loadingLocation ? (
            <ActivityIndicator size="small" color={Colors.accent} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
          ) : (
            <>
              <Text style={[Type.bodyMed, tabularNums, { color: Colors.text }]}>
                {location?.coords.latitude.toFixed(6)}, {location?.coords.longitude.toFixed(6)}
              </Text>
              {loadingAddress ? (
                <Text style={[Type.caption, { color: Colors.textMuted, fontStyle: 'italic', marginTop: 4 }]}>
                  Resolving address…
                </Text>
              ) : address ? (
                <Text style={[Type.caption, { color: Colors.textSecondary, marginTop: 4 }]}>{address}</Text>
              ) : null}
            </>
          )}
        </BentoTile>

        {/* Selfie */}
        <BentoTile style={{ marginTop: Space.md }}>
          <Text style={styles.label}>Selfie</Text>
          <Text style={[Type.caption, { color: Colors.alert, marginBottom: Space.md }]}>
            Live photo only — gallery disabled
          </Text>

          {photoUri ? (
            <View style={styles.captured}>
              <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
              <Text style={[Type.bodyMed, { color: Colors.success }]}>Selfie captured</Text>
              <Button title="Retake" onPress={() => setPhotoUri(null)} variant="secondary" style={{ marginTop: Space.sm, alignSelf: 'stretch' }} />
            </View>
          ) : (
            <View>
              <View style={styles.cameraWrapper}>
                <CameraView ref={cameraRef} style={styles.camera} facing="front" />
              </View>
              <Button title="Take selfie" onPress={takeSelfie} variant="secondary" style={{ marginTop: Space.md }} />
            </View>
          )}
        </BentoTile>

        {/* Odometer — optional. Never gates check-in: a rep on foot today, or
            on a build without the camera module, still has to be able to
            start their day. */}
        <BentoTile style={{ marginTop: Space.md }}>
          <Text style={styles.label}>Odometer (for travel allowance)</Text>
          {odo ? (
            <>
              <Text style={styles.odoValue}>{odo.value}</Text>
              <Button
                title="Retake reading"
                variant="secondary"
                onPress={() => setShowOdo(true)}
                style={{ marginTop: Space.sm }}
              />
            </>
          ) : (
            <>
              <Text style={styles.odoHint}>
                Photograph your odometer so your travel allowance is calculated from the real
                distance. You can skip it and check in without one.
              </Text>
              <Button
                title="Capture odometer"
                variant="secondary"
                onPress={() => setShowOdo(true)}
                style={{ marginTop: Space.sm }}
              />
            </>
          )}
        </BentoTile>

        <Button
          title="Confirm check-in"
          spotlight
          onPress={handleSubmit}
          loading={submitting}
          disabled={!location || !photoUri}
          style={styles.submitBtn}
        />
      </View>

      <OdometerCapture
        visible={showOdo}
        which="start"
        onCancel={() => setShowOdo(false)}
        onConfirm={(r) => {
          setOdo(r);
          setShowOdo(false);
        }}
      />

      {showSuccess && <SuccessOverlay label="Checked in" />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Layout.screenPad },
  content: { flex: 1, padding: Layout.screenPad },
  label: { ...Type.label, color: Colors.textMuted, marginBottom: Space.sm },
  cameraWrapper: { borderRadius: Radius.md, overflow: 'hidden', backgroundColor: Colors.surfaceAlt },
  camera: { width: '100%', height: 300 },
  captured: { alignItems: 'center', gap: Space.sm },
  submitBtn: { marginTop: 'auto' },
  odoValue: { ...Type.display, color: Colors.text, letterSpacing: 2 },
  odoHint: { ...Type.caption, color: Colors.textMuted, lineHeight: 18 },
});
