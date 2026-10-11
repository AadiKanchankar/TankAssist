import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PanResponder, StyleProp, ViewStyle, LayoutChangeEvent } from 'react-native';
import { CameraView, CameraType } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Colors, Palette, Type, Space, Radius, Layout, tabularNums } from '../constants/colors';

/**
 * The ONE camera every capture surface uses: selfie, odometer, shop/stock/
 * delivered photos, challan, product image and spot sales. Digital zoom via
 * expo-camera's `zoom` prop — pinch, or tap 1x / 2x / 5x.
 *
 * expo-camera's `zoom` is a 0..1 fraction of the DEVICE's max zoom ratio
 * (Android: ratio = max(1, zoom × maxZoomRatio)), and the max isn't exposed to
 * JS. So a factor is mapped through ASSUMED_MAX_ZOOM.
 *
 * ponytail: on a phone whose max is not 8x the labels are approximate ("2x" on
 * a 10x-max phone is 2.5x). The factor recorded per photo is this NOMINAL one —
 * good enough to tell "across the shop" from "at the shelf". Upgrade path:
 * patch expo-camera to report maxZoomRatio and divide by the real value.
 *
 * Zoom crops at the sensor (CameraX crop region), so the captured photo has
 * the same field of view as the preview — overlay guides (the odometer frame)
 * keep mapping by proportion at any zoom.
 */
const ASSUMED_MAX_ZOOM = 8;
const STEPS = [1, 2, 5] as const;

export interface ZoomPhoto {
  uri: string;
  width: number;
  height: number;
  /** Nominal zoom factor the photo was taken at (1 = no zoom). */
  zoom: number;
}

export interface ZoomCameraHandle {
  takePictureAsync(opts?: { quality?: number }): Promise<ZoomPhoto | undefined>;
}

interface Props {
  facing?: CameraType;
  style?: StyleProp<ViewStyle>;
  onLayout?: (e: LayoutChangeEvent) => void;
  /** Overlay drawn over the preview (guides, hints). */
  children?: React.ReactNode;
}

/** 1x is always exactly 0 (true 1x on any phone); above it, factor / max. */
const toZoomProp = (f: number) => (f <= 1.01 ? 0 : Math.min(1, f / ASSUMED_MAX_ZOOM));
const clamp = (f: number) => Math.min(ASSUMED_MAX_ZOOM, Math.max(1, f));
const dist = (t: readonly { pageX: number; pageY: number }[]) =>
  Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);

const ZoomCamera = forwardRef<ZoomCameraHandle, Props>(function ZoomCamera(
  { facing = 'back', style, onLayout, children },
  ref,
) {
  const cam = useRef<CameraView>(null);
  const [factor, setFactor] = useState(1);
  const factorRef = useRef(1);
  factorRef.current = factor;
  const pinch = useRef<{ d: number; f: number } | null>(null);

  useImperativeHandle(ref, () => ({
    async takePictureAsync(opts) {
      const p = await cam.current?.takePictureAsync({ quality: opts?.quality ?? 0.7 });
      if (!p?.uri) return undefined;
      return { uri: p.uri, width: p.width, height: p.height, zoom: Math.round(factorRef.current * 10) / 10 };
    },
  }));

  // Two-finger only, so single taps still reach buttons in the overlay.
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
      onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
      onPanResponderGrant: (e) => {
        const t = e.nativeEvent.touches;
        if (t.length === 2) pinch.current = { d: dist(t), f: factorRef.current };
      },
      onPanResponderMove: (e) => {
        const t = e.nativeEvent.touches;
        if (t.length !== 2) return;
        if (!pinch.current) {
          pinch.current = { d: dist(t), f: factorRef.current };
          return;
        }
        if (pinch.current.d > 0) setFactor(clamp(pinch.current.f * (dist(t) / pinch.current.d)));
      },
      // Once pinching, keep the gesture: a parent ScrollView (the selfie card)
      // would otherwise take it over mid-pinch.
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: () => { pinch.current = null; },
      onPanResponderTerminate: () => { pinch.current = null; },
    }),
  ).current;

  const pick = (f: number) => {
    Haptics.selectionAsync().catch(() => {});
    setFactor(f);
  };
  // The step a free pinch is nearest to, for highlighting.
  const nearest = STEPS.reduce((a, b) => (Math.abs(b - factor) < Math.abs(a - factor) ? b : a));

  return (
    <View style={[styles.wrap, style]} onLayout={onLayout} {...responder.panHandlers}>
      <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} zoom={toZoomProp(factor)} />
      {children ? <View style={StyleSheet.absoluteFill} pointerEvents="box-none">{children}</View> : null}
      <View style={styles.bar} pointerEvents="box-none">
        <View style={styles.pills}>
          {STEPS.map((s) => {
            const on = nearest === s;
            return (
              <Pressable
                key={s}
                onPress={() => pick(s)}
                style={styles.hit}
                accessibilityRole="button"
                accessibilityLabel={`Zoom ${s} times`}
                accessibilityState={{ selected: on }}
              >
                <View style={[styles.pill, on && styles.pillOn]}>
                  <Text style={[styles.pillText, tabularNums, on && styles.pillTextOn]}>
                    {on && Math.abs(factor - s) > 0.05 ? factor.toFixed(1) : s}x
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
});

export default ZoomCamera;

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: Palette.ink },
  bar: { position: 'absolute', left: 0, right: 0, bottom: Space.sm, alignItems: 'center' },
  pills: { flexDirection: 'row', backgroundColor: Colors.scrim, borderRadius: Radius.pill, paddingHorizontal: Space.xs },
  hit: { minWidth: Layout.tap, height: Layout.tap, alignItems: 'center', justifyContent: 'center' },
  pill: { minWidth: 36, height: 30, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space.xs },
  pillOn: { backgroundColor: Colors.white },
  pillText: { ...Type.label, color: Colors.white },
  pillTextOn: { color: Colors.text },
});
