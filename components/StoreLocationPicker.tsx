import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import type { Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Layout } from '../constants/colors';
import { reverseGeocodeDetailed } from '../lib/geocoding';
import { freshPosition } from '../lib/freshLocation';

export interface StoreLocationValue {
  latitude: number | null;
  longitude: number | null;
  address: string;
  /** Auto-derived Indian state (never hand-entered). Null until geocoded. */
  state: string | null;
}

interface Props {
  value: StoreLocationValue;
  onChange: (value: StoreLocationValue) => void;
}

// Fallback map region (center of India, wide zoom) when GPS is unavailable.
const DEFAULT_REGION: Region = {
  latitude: 20.5937,
  longitude: 78.9629,
  latitudeDelta: 20,
  longitudeDelta: 20,
};

/**
 * Shared "fixed center pin, map pans underneath" location picker for the
 * Add/Edit Store forms (rep + admin). A static pin sits at the visual center
 * of the map; the user pans the map underneath it, and when panning stops the
 * map's center becomes the selected coordinate. The coordinate is reverse-
 * geocoded into the editable address field.
 *
 * Controlled component: the parent owns { latitude, longitude, address } and
 * receives updates via onChange. `name` remains the only required field on the
 * parent form — the location here is always optional.
 */
export default function StoreLocationPicker({ value, onChange }: Props) {
  const [mapRegion, setMapRegion] = useState<Region | null>(null);
  const [locating, setLocating] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  // True when the phone couldn't produce a fresh fix and we fell back to an
  // older one — said out loud, because this coordinate is saved for good.
  const [staleFix, setStaleFix] = useState(false);
  const mapRef = useRef<MapView>(null);

  // Initialise the map region once when the picker mounts.
  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const init = async () => {
    // Editing an existing store that already has coordinates: center on them
    // and leave the pin placed — no GPS needed.
    if (value.latitude != null && value.longitude != null) {
      setMapRegion({
        latitude: value.latitude,
        longitude: value.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      });
      return;
    }
    // Otherwise center + place the pin on the user's current GPS — a FRESH fix.
    // This coordinate becomes the store's permanent location and feeds the
    // proximity de-dup check, so a cached fix (the last shop's, 50 m away)
    // would corrupt data long after this screen closes.
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const { loc, fresh } = await freshPosition(Location.Accuracy.High);
        setStaleFix(!fresh);
        const lat = loc.coords.latitude;
        const lng = loc.coords.longitude;
        setMapRegion({
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        });
        commit(lat, lng);
      } else {
        // Permission denied — show default region, no pin until user pans.
        setMapRegion(DEFAULT_REGION);
      }
    } catch {
      setMapRegion(DEFAULT_REGION);
    }
    setLocating(false);
  };

  // "Locate me": re-capture where the phone is now and move the pin there.
  const locateMe = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const { loc, fresh } = await freshPosition(Location.Accuracy.High);
      setStaleFix(!fresh);
      const region = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.003,
        longitudeDelta: 0.003,
      };
      // A programmatic move settles with isGesture false, which the region
      // handler ignores — so commit explicitly.
      mapRef.current?.animateToRegion(region, 300);
      commit(region.latitude, region.longitude);
    } catch {
      // Location unavailable: the pin stays where it was.
    } finally {
      setLocating(false);
    }
  };

  // Commit a coordinate: save lat/lng immediately (clearing any stale state),
  // then reverse-geocode to refresh the address AND the auto-derived state.
  // reverseGeocodeDetailed never throws (returns "lat, lng" + null state on
  // failure), so the address is always populated and stays hand-editable.
  const commit = async (lat: number, lng: number) => {
    setGeocoding(true);
    onChange({ latitude: lat, longitude: lng, address: value.address, state: null });
    try {
      const result = await reverseGeocodeDetailed(lat, lng);
      onChange({
        latitude: lat,
        longitude: lng,
        address: result.address,
        state: result.state,
      });
    } finally {
      setGeocoding(false);
    }
  };

  // Fires continuously while panning — only toggles the "Moving…" hint. Never
  // geocodes here (that would cost an API call per frame). Ignores the initial
  // programmatic settle (isGesture === false).
  const handleRegionChange = (
    _region: Region,
    details?: { isGesture?: boolean }
  ) => {
    if (!details || details.isGesture !== false) setIsMoving(true);
  };

  // Fires once when panning stops. Commit the map's center as the selected
  // point. Skip the initial/programmatic settle so we don't auto-place a pin
  // on the default region before the user has actually panned.
  const handleRegionChangeComplete = (
    region: Region,
    details?: { isGesture?: boolean }
  ) => {
    setIsMoving(false);
    if (details && details.isGesture === false) return;
    commit(region.latitude, region.longitude);
  };

  return (
    <View>
      <Text style={styles.label}>STORE LOCATION</Text>
      <Text style={styles.hint}>
        Move the map so the center pin sits on the store.
      </Text>

      {mapRegion ? (
        <View style={styles.mapWrapper}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={styles.map}
            initialRegion={mapRegion}
            showsUserLocation
            showsMyLocationButton={false}
            onRegionChange={handleRegionChange}
            onRegionChangeComplete={handleRegionChangeComplete}
          />
          {/* Static center pin — an overlay, NOT a MapView child. The map
              pans underneath; this never moves. pointerEvents none so it
              never intercepts pan gestures. */}
          <View style={styles.centerPin} pointerEvents="none">
            <View style={styles.centerPinHead}>
              <View style={styles.centerPinInner} />
            </View>
            <View style={styles.centerPinStem} />
          </View>
          <Pressable
            onPress={locateMe}
            style={styles.locateBtn}
            accessibilityRole="button"
            accessibilityLabel="Use my current location"
            hitSlop={6}
          >
            {locating ? (
              <ActivityIndicator size="small" color={Colors.accent} />
            ) : (
              <Ionicons name="locate" size={22} color={Colors.text} />
            )}
          </Pressable>
        </View>
      ) : (
        <View style={[styles.mapWrapper, styles.mapPlaceholder]}>
          <ActivityIndicator size="small" color={Colors.accent} />
          <Text style={styles.placeholderText}>
            {locating ? 'Getting your location…' : 'Loading map…'}
          </Text>
        </View>
      )}

      {staleFix && !isMoving ? (
        <Text style={[styles.coordText, { color: Colors.warning }]}>
          Couldn’t get a fresh GPS fix — this may be where you were earlier. Tap the locate button
          again, or step outside for a clearer signal.
        </Text>
      ) : null}
      {isMoving ? (
        <Text style={styles.coordText}>Moving…</Text>
      ) : value.latitude != null && value.longitude != null ? (
        <Text style={styles.coordText}>
          📍 {value.latitude.toFixed(6)}, {value.longitude.toFixed(6)}
        </Text>
      ) : (
        <Text style={styles.coordText}>
          Pan the map to set the store location (optional).
        </Text>
      )}

      <Text style={styles.label}>ADDRESS (AUTO-FILLED, EDITABLE)</Text>
      <TextInput
        style={styles.input}
        value={value.address}
        onChangeText={(text) => onChange({ ...value, address: text })}
        placeholder={geocoding ? 'Resolving address…' : 'Address'}
        placeholderTextColor={Colors.muted}
        multiline
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 8,
    marginTop: 20,
  },
  hint: {
    fontFamily: Typography.fontFamily,
    fontSize: 12,
    color: Colors.muted,
    marginBottom: 8,
    marginTop: -12,
  },
  input: {
    fontFamily: Typography.fontFamily,
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  mapWrapper: {
    height: 220,
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  map: { flex: 1 },
  // The familiar maps "locate me" control, bottom-right over the map.
  locateBtn: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: Layout.tap,
    height: Layout.tap,
    borderRadius: Layout.tap / 2,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  // Static center pin overlay (tip points at the map's center point)
  centerPin: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    alignItems: 'center',
    transform: [{ translateX: -12 }, { translateY: -34 }],
  },
  centerPinHead: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.accent,
    borderWidth: 2,
    borderColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerPinInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.white,
  },
  centerPinStem: {
    width: 2,
    height: 10,
    backgroundColor: Colors.accent,
  },
  mapPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  placeholderText: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.muted,
    marginTop: 8,
  },
  coordText: {
    fontFamily: Typography.fontFamily,
    fontSize: 12,
    color: Colors.muted,
    marginTop: 6,
  },
});
