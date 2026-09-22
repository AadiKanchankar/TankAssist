import React, { useState } from 'react';
import {
  Modal,
  View,
  Image,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Palette, Type, Space, Radius, Layout } from '../constants/colors';

export interface ViewerPhoto {
  uri: string;
  caption?: string;
}

/**
 * Full-screen photo viewer: swipe through the set, close with × or Android back.
 *
 * ponytail: no pinch-zoom. Android's ScrollView cannot zoom and
 * react-native-gesture-handler is not installed — adding it is a native module
 * and therefore a build. A full-screen `contain` view is the stated minimum;
 * pinch is the upgrade once gesture-handler lands for another reason.
 */
export default function PhotoViewer({
  photos,
  index,
  onClose,
}: {
  photos: ViewerPhoto[];
  /** Photo to open on; null = closed. */
  index: number | null;
  onClose: () => void;
}) {
  return (
    <Modal visible={index !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* Keyed so each open starts on the tapped photo with fresh state. */}
      {index !== null ? <ViewerBody key={index} photos={photos} start={index} onClose={onClose} /> : null}
    </Modal>
  );
}

function ViewerBody({ photos, start, onClose }: { photos: ViewerPhoto[]; start: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(start);
  const caption = photos[current]?.caption;

  return (
    <View style={styles.backdrop}>
      <StatusBar style="light" />
      <FlatList
        data={photos}
        horizontal
        pagingEnabled
        initialScrollIndex={start}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(p, i) => `${i}-${p.uri}`}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index: i }) => (
          <ViewerPage
            uri={item.uri}
            width={width}
            height={height}
            label={item.caption ?? `Photo ${i + 1} of ${photos.length}`}
          />
        )}
      />

      <View style={[styles.topBar, { paddingTop: insets.top + Space.sm }]}>
        <Text style={[Type.label, styles.onDark]}>
          {photos.length > 1 ? `${current + 1} of ${photos.length}` : ''}
        </Text>
        <Pressable
          onPress={onClose}
          style={styles.close}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
        >
          <Ionicons name="close" size={26} color={Colors.textOnDark} />
        </Pressable>
      </View>

      {caption ? (
        <View style={[styles.captionBar, { paddingBottom: insets.bottom + Space.lg }]}>
          <Text style={[Type.body, styles.onDark]}>{caption}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ViewerPage({ uri, width, height, label }: { uri: string; width: number; height: number; label: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={{ width, height, justifyContent: 'center' }}>
      {failed ? (
        <Text style={[Type.body, styles.onDark, styles.failed]}>
          Couldn’t load this photo. Close and reopen the report to refresh it.
        </Text>
      ) : (
        <>
          <ActivityIndicator color={Colors.textOnDark} style={StyleSheet.absoluteFill} />
          <Image
            source={{ uri }}
            style={{ width, height }}
            resizeMode="contain"
            accessibilityLabel={label}
            onError={() => setFailed(true)}
          />
        </>
      )}
    </View>
  );
}

/** Row of tappable thumbnails that open the viewer on the tapped photo. */
export function PhotoStrip({ photos, size = 96 }: { photos: ViewerPhoto[]; size?: number }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip}>
        {photos.map((p, i) => (
          <Pressable
            key={`${i}-${p.uri}`}
            onPress={() => setOpen(i)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Open photo ${i + 1} of ${photos.length}`}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Image source={{ uri: p.uri }} style={[styles.thumb, { width: size, height: size }]} />
          </Pressable>
        ))}
      </ScrollView>
      <PhotoViewer photos={photos} index={open} onClose={() => setOpen(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: Palette.ink },
  onDark: { color: Colors.textOnDark },
  failed: { textAlign: 'center', paddingHorizontal: Space.xl },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Layout.screenPad,
  },
  close: { width: Layout.tap, height: Layout.tap, alignItems: 'center', justifyContent: 'center', marginRight: -Space.sm },
  captionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Layout.screenPad,
    paddingTop: Space.md,
    backgroundColor: Colors.scrim,
  },
  strip: { marginTop: Space.sm },
  thumb: { borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt, marginRight: Space.sm },
  pressed: { opacity: 0.85 },
});
