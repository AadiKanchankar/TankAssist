import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Colors, Typography } from '../../constants/colors';
import Button from '../../components/Button';
import Header from '../../components/Header';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';
import * as Location from 'expo-location';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { uploadSelfie } from '../../lib/storage';
import { reverseGeocode } from '../../lib/geocoding';

export default function AttendanceScreen({
  navigation,
}: {
  navigation: any;
}) {
  const { profile } = useAuthStore();
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [permission, requestPermission] = useCameraPermissions();
  const [submitting, setSubmitting] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [loadingAddress, setLoadingAddress] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required for check-in.');
        navigation.goBack();
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      setLocation(loc);
      setLoadingLocation(false);

      // Reverse geocode in parallel — non-blocking
      setLoadingAddress(true);
      const addr = await reverseGeocode(
        loc.coords.latitude,
        loc.coords.longitude
      );
      setAddress(addr);
      setLoadingAddress(false);
    })();
  }, []);

  const takeSelfie = async () => {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
    if (photo) {
      setPhotoUri(photo.uri);
    }
  };

  const handleSubmit = async () => {
    if (!location) {
      Alert.alert('Error', 'Location not available yet.');
      return;
    }
    if (!photoUri) {
      Alert.alert('Error', 'Please take a selfie first.');
      return;
    }

    setSubmitting(true);
    try {
      // Upload selfie to Supabase Storage (private bucket: visit-photos)
      const selfieUrl = await uploadSelfie(photoUri, profile!.id);

      const { error } = await supabase.from('attendance').insert({
        user_id: profile!.id,
        check_in_time: new Date().toISOString(),
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        address: address,
        selfie_url: selfieUrl,
      });

      if (error) throw error;

      Alert.alert('Success', 'You are checked in!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to check in.');
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
        <Header title="Check In" onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <Text style={styles.permText}>Camera permission is required.</Text>
          <Button title="Grant Permission" onPress={requestPermission} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title="Check In" onBack={() => navigation.goBack()} />

      <View style={styles.content}>
        {/* GPS */}
        <View style={styles.section}>
          <Text style={styles.label}>GPS COORDINATES</Text>
          {loadingLocation ? (
            <ActivityIndicator size="small" color={Colors.accent} />
          ) : (
            <>
              <Text style={styles.coords}>
                {location?.coords.latitude.toFixed(6)},{' '}
                {location?.coords.longitude.toFixed(6)}
              </Text>
              {loadingAddress ? (
                <Text style={styles.addressLoading}>Resolving address...</Text>
              ) : address ? (
                <Text style={styles.addressText}>{address}</Text>
              ) : null}
            </>
          )}
        </View>

        {/* Camera */}
        <View style={styles.section}>
          <Text style={styles.label}>SELFIE</Text>
          <Text style={styles.liveLabel}>Live photo only — gallery disabled</Text>

          {photoUri ? (
            <View style={styles.photoPreview}>
              <Text style={styles.photoTaken}>✓ Selfie captured</Text>
              <Button
                title="Retake"
                onPress={() => setPhotoUri(null)}
                variant="secondary"
              />
            </View>
          ) : (
            <View style={styles.cameraWrapper}>
              <CameraView
                ref={cameraRef}
                style={styles.camera}
                facing="front"
              />
              <Button title="Take Selfie" onPress={takeSelfie} style={styles.captureBtn} />
            </View>
          )}
        </View>

        {/* Submit */}
        <Button
          title="Confirm Check In"
          onPress={handleSubmit}
          loading={submitting}
          disabled={!location || !photoUri}
          style={styles.submitBtn}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  content: { flex: 1, padding: 24 },
  section: { marginBottom: 24 },
  label: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 8,
  },
  liveLabel: {
    fontFamily: Typography.fontFamily,
    fontSize: 12,
    color: Colors.alert,
    marginBottom: 12,
    fontWeight: '600',
  },
  coords: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.text,
    fontWeight: '600',
  },
  addressLoading: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.muted,
    marginTop: 4,
    fontStyle: 'italic',
  },
  addressText: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.text,
    marginTop: 4,
  },
  permText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.text,
    marginBottom: 16,
  },
  cameraWrapper: { borderRadius: 4, overflow: 'hidden' },
  camera: { width: '100%', height: 300 },
  captureBtn: { marginTop: 12 },
  photoPreview: { alignItems: 'center', gap: 12 },
  photoTaken: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.success,
    fontWeight: '600',
  },
  submitBtn: { marginTop: 'auto' },
});
