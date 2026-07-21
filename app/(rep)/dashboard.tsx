import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import {
  Colors,
  Typography,
  Type,
  Space,
  Radius,
  Layout,
  Glass,
  tabularNums,
} from '../../constants/colors';
import { entrance } from '../../constants/motion';
import Button from '../../components/Button';
import Header from '../../components/Header';
import BentoTile from '../../components/BentoTile';
import Metric from '../../components/Metric';
import Autocomplete, { AutocompleteItem } from '../../components/Autocomplete';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import { RepDashboardSkeleton } from '../../components/skeleton/RepDashboardSkeleton';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';
import { totalRouteKm } from '../../lib/haversine';
import { directionsRouteKm } from '../../lib/directions';
import StoreLocationPicker from '../../components/StoreLocationPicker';
import type { StoreLocationValue } from '../../components/StoreLocationPicker';
import * as Location from 'expo-location';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { useRepDashboard } from '../../hooks/useRepDashboard';

interface StoreSearchResult {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

const fmtHM = (min: number) => `${Math.floor(min / 60)}h ${min % 60}m`;

export default function RepDashboard({ navigation }: { navigation: any }) {
  const reduce = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const { data, refetch, isPending, isError } = useRepDashboard(profile?.id);
  const attendance = data?.attendance ?? null;
  const assignments = data?.assignments ?? [];
  const visits = data?.visits ?? [];
  const reportSubmitted = data?.reportSubmitted ?? false;
  const casesToday = data?.casesToday ?? 0;
  const [punchingOut, setPunchingOut] = useState(false);

  // Store search + add-store modal state
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [storeSearch, setStoreSearch] = useState('');
  const [storeResults, setStoreResults] = useState<StoreSearchResult[]>([]);
  const [searchingStores, setSearchingStores] = useState(false);

  // Add store form state
  const [newStoreName, setNewStoreName] = useState('');
  const [storeLocation, setStoreLocation] = useState<StoreLocationValue>({
    latitude: null,
    longitude: null,
    address: '',
    state: null,
  });
  const [newStoreLicense, setNewStoreLicense] = useState('');
  const [creatingStore, setCreatingStore] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  // Cache-backed focus refresh (Phase B): paint from cache, refetch in background.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const isCheckedIn = !!attendance?.check_in_time;
  const isPunchedOut = !!attendance?.check_out_time;

  const getStoreStatus = (storeId: string) => {
    const visit = visits.find((v) => v.store_id === storeId);
    if (!visit) return 'pending';
    return visit.check_out_time ? 'visited' : 'in-progress';
  };

  // --- Punch out (unchanged logic) ---

  const handlePunchOut = async () => {
    Alert.alert(
      'End day',
      'Are you sure you want to punch out? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Punch out',
          style: 'destructive',
          onPress: async () => {
            setPunchingOut(true);
            try {
              const { status } = await Location.requestForegroundPermissionsAsync();
              if (status !== 'granted') {
                Alert.alert('Location needed', 'Location permission is required to punch out.');
                setPunchingOut(false);
                return;
              }
              const loc = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.BestForNavigation,
              });
              const checkOutTime = new Date().toISOString();

              const checkInTime = new Date(attendance!.check_in_time!);
              const totalMinutes = Math.round(
                (new Date(checkOutTime).getTime() - checkInTime.getTime()) / 60000
              );

              const waypoints: Array<{ latitude: number; longitude: number }> = [];
              if (attendance!.latitude && attendance!.longitude) {
                waypoints.push({
                  latitude: attendance!.latitude,
                  longitude: attendance!.longitude,
                });
              }

              const { data: visitCoords } = await supabase
                .from('store_visits')
                .select('latitude, longitude, check_in_time')
                .eq('user_id', profile!.id)
                .gte('check_in_time', `${today}T00:00:00`)
                .lt('check_in_time', `${today}T23:59:59`)
                .order('check_in_time', { ascending: true });

              if (visitCoords) {
                for (const vc of visitCoords) {
                  if (vc.latitude != null && vc.longitude != null) {
                    waypoints.push({ latitude: vc.latitude, longitude: vc.longitude });
                  }
                }
              }

              waypoints.push({
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
              });

              // Real road-network route via Google Directions; straight-line
              // Haversine fallback — never block punch-out on this call.
              let distance = await directionsRouteKm(waypoints);
              if (distance == null) {
                distance = totalRouteKm(waypoints);
              }

              await supabase
                .from('attendance')
                .update({
                  check_out_time: checkOutTime,
                  total_market_time_minutes: totalMinutes,
                  total_distance_km: distance,
                })
                .eq('id', attendance!.id);

              await refetch();
            } catch (err: any) {
              Alert.alert('Couldn’t punch out', err.message || 'Try again.');
            }
            setPunchingOut(false);
          },
        },
      ]
    );
  };

  // --- Store search + creation (unchanged logic) ---

  const resetStoreModal = () => {
    setStoreSearch('');
    setStoreResults([]);
    setNewStoreName('');
    setStoreLocation({ latitude: null, longitude: null, address: '', state: null });
    setNewStoreLicense('');
  };

  // Debounced store search
  useEffect(() => {
    if (!storeSearch.trim() || storeSearch.length < 2) {
      setStoreResults([]);
      setSearchingStores(false);
      return;
    }
    setSearchingStores(true);
    const timeout = setTimeout(async () => {
      const { data } = await supabase
        .from('stores')
        .select('id, name, address, latitude, longitude')
        .ilike('name', `%${storeSearch}%`)
        .order('name')
        .limit(20);
      setStoreResults(data || []);
      setSearchingStores(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [storeSearch]);

  const handleSelectStore = (store: StoreSearchResult) => {
    setShowStoreModal(false);
    navigation.navigate('StoreVisit', { store });
  };

  const openAddStore = () => {
    setNewStoreName(storeSearch);
    setShowStoreModal(true);
  };

  const handleCreateStore = async () => {
    if (!newStoreName.trim()) {
      Alert.alert('Name required', 'Enter a store name to continue.');
      return;
    }
    setCreatingStore(true);
    try {
      const { data, error } = await supabase
        .from('stores')
        .insert({
          name: newStoreName.trim(),
          address: storeLocation.address.trim() || null,
          latitude: storeLocation.latitude,
          longitude: storeLocation.longitude,
          license_number: newStoreLicense.trim() || null,
          state: storeLocation.state,
          created_by_user_id: profile!.id,
        })
        .select()
        .single();

      if (error) throw error;

      setShowStoreModal(false);
      resetStoreModal();
      navigation.navigate('StoreVisit', {
        store: {
          id: data.id,
          name: data.name,
          address: data.address,
          latitude: data.latitude,
          longitude: data.longitude,
        },
      });
    } catch (err: any) {
      Alert.alert('Couldn’t add the store', err.message || 'Try again.');
    }
    setCreatingStore(false);
  };

  // --- Render ---

  const formattedDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const completedVisits = visits.filter((v) => v.check_out_time).length;
  // ponytail: market time so far = now − check-in, computed at render (updates on
  // focus/refresh). A live ticking timer needs a setInterval — YAGNI on a dashboard.
  const activeMinutes = attendance?.check_in_time
    ? Math.max(0, Math.round((Date.now() - new Date(attendance.check_in_time).getTime()) / 60000))
    : 0;

  const searchItems: AutocompleteItem[] = storeResults.map((s) => ({
    id: s.id,
    label: s.name,
    sublabel: s.address || 'No address',
  }));

  if (isPending && !data) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <RepDashboardSkeleton />
      </View>
    );
  }
  if (isError && !data) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <ErrorState onRetry={refetch} />
      </View>
    );
  }

  let section = 0;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Space.md,
            // Clear the bottom tab bar (getTabScreenOptions height = 60 + inset)
            // so the last card is never obscured, incl. the home-indicator area.
            paddingBottom: Layout.tabBar + insets.bottom + Space.md,
          },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Greeting + brand mark */}
        <View style={styles.greetRow}>
          <View style={{ flex: 1 }}>
            <Text style={[Type.title, { color: Colors.text }]}>
              {getGreeting()}, {profile?.name || 'Rep'}
            </Text>
            <Text style={[Type.body, { color: Colors.textSecondary, marginTop: 2 }]}>
              {formattedDate}
            </Text>
          </View>
          <Text style={styles.brandMark}>Tank No. 90</Text>
        </View>

        {/* Hero — check-in state */}
        <MotiView {...entrance(section++, reduce)}>
          <BentoTile variant="dark" style={{ marginTop: Space.md }}>
            {!isCheckedIn ? (
              <>
                <Text style={[Type.label, styles.onDarkMuted]}>Today</Text>
                <Text style={[Type.section, { color: Colors.textOnDark, marginTop: 2 }]}>
                  You’re not checked in yet
                </Text>
                <Text style={[Type.body, styles.onDarkMuted, { marginTop: Space.xs }]}>
                  Start your day to record attendance and visit stores.
                </Text>
                <Button
                  title="Start check-in"
                  spotlight
                  onPress={() => navigation.navigate('Attendance')}
                  style={{ marginTop: Space.lg }}
                />
              </>
            ) : isPunchedOut ? (
              <>
                <View style={styles.statusRow}>
                  <View style={[styles.dot, { backgroundColor: Colors.textOnDark }]} />
                  <Text style={[Type.label, { color: Colors.textOnDark }]}>Day ended</Text>
                </View>
                <View style={styles.heroStats}>
                  <View style={{ flex: 1 }}>
                    <Text style={[Type.label, styles.onDarkMuted]}>Market time</Text>
                    <Text style={[Type.display, styles.onDarkValue]}>
                      {fmtHM(attendance?.total_market_time_minutes || 0)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[Type.label, styles.onDarkMuted]}>Distance</Text>
                    <Text style={[Type.display, styles.onDarkValue]}>
                      {(attendance?.total_distance_km ?? 0).toFixed(1)} km
                    </Text>
                  </View>
                </View>
              </>
            ) : (
              <>
                <View style={styles.statusRow}>
                  <View style={[styles.dot, { backgroundColor: Colors.spotlight }]} />
                  <Text style={[Type.label, { color: Colors.textOnDark }]}>Checked in</Text>
                </View>
                <View style={styles.heroStats}>
                  <View style={{ flex: 1 }}>
                    <Text style={[Type.label, styles.onDarkMuted]}>Market time</Text>
                    <Text style={[Type.display, styles.onDarkValue]}>{fmtHM(activeMinutes)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[Type.label, styles.onDarkMuted]}>Stores visited</Text>
                    <Text style={[Type.display, styles.onDarkValue]}>{completedVisits}</Text>
                  </View>
                </View>
                <Pressable
                  onPress={handlePunchOut}
                  disabled={punchingOut}
                  accessibilityRole="button"
                  accessibilityLabel="Punch out and end day"
                  style={styles.heroSecondary}
                >
                  {punchingOut ? (
                    <ActivityIndicator color={Colors.textOnDark} />
                  ) : (
                    <Text style={[Type.label, { color: Colors.textOnDark }]}>
                      Punch out · end day
                    </Text>
                  )}
                </Pressable>
              </>
            )}
          </BentoTile>
        </MotiView>

        {/* Bento row: cases today · stores visited */}
        <MotiView {...entrance(section++, reduce)} style={styles.bentoRow}>
          <BentoTile style={styles.flex}>
            <Metric label="Cases today" value={casesToday} />
          </BentoTile>
          <BentoTile style={styles.flex}>
            <Metric label="Stores visited" value={completedVisits} />
          </BentoTile>
        </MotiView>

        {/* Start a store visit — only while checked in and not punched out */}
        {isCheckedIn && !isPunchedOut && (
          <MotiView {...entrance(section++, reduce)} style={{ marginTop: Space.md }}>
            <Text style={[Type.section, styles.sectionTitle]}>Start a store visit</Text>
            <Autocomplete
              placeholder="Search a store to check in"
              results={searchItems}
              loading={searchingStores}
              debounceMs={0}
              onQueryChange={setStoreSearch}
              onSelect={(item) => {
                const full = storeResults.find((s) => s.id === item.id);
                if (full) handleSelectStore(full);
              }}
            />
            {storeSearch.trim().length >= 2 && (
              <Pressable onPress={openAddStore} style={styles.addStoreLink} hitSlop={6}>
                <Ionicons name="add-circle-outline" size={16} color={Colors.accent} />
                <Text style={[Type.label, { color: Colors.accent }]}>
                  Can’t find it? Add a store
                </Text>
              </Pressable>
            )}
          </MotiView>
        )}

        {/* Your stores preview */}
        <MotiView {...entrance(section++, reduce)} style={{ marginTop: Space.md }}>
          <View style={styles.sectionHeader}>
            <Text style={[Type.section, { color: Colors.text }]}>Your stores</Text>
            {assignments.length > 0 && (
              <Pressable
                onPress={() => navigation.navigate('MyStores')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="See all your stores"
                style={styles.seeAll}
              >
                <Text style={[Type.label, { color: Colors.accent }]}>See all</Text>
                <Ionicons name="chevron-forward" size={14} color={Colors.accent} />
              </Pressable>
            )}
          </View>

          {assignments.length === 0 ? (
            <BentoTile>
              <EmptyState
                icon="storefront-outline"
                title="No assigned stores"
                message="Stores you’re assigned to show up here. Check with your manager."
              />
            </BentoTile>
          ) : (
            <BentoTile>
              {assignments.slice(0, 4).map((a, i) => {
                const status = getStoreStatus(a.store_id);
                const dotColor =
                  status === 'visited'
                    ? Colors.success
                    : status === 'in-progress'
                    ? Colors.accent
                    : Colors.borderStrong;
                const statusLabel =
                  status === 'visited' ? 'Visited' : status === 'in-progress' ? 'In progress' : 'Pending';
                return (
                  <View
                    key={a.id}
                    style={[styles.storeRow, i > 0 && styles.storeRowDivider]}
                  >
                    <View style={[styles.dot, { backgroundColor: dotColor }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[Type.bodyMed, { color: Colors.text }]} numberOfLines={1}>
                        {(a as any).stores?.name || 'Store'}
                      </Text>
                      {(a as any).stores?.address ? (
                        <Text style={[Type.caption, { color: Colors.textMuted }]} numberOfLines={1}>
                          {(a as any).stores.address}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[Type.caption, { color: Colors.textMuted }]}>{statusLabel}</Text>
                  </View>
                );
              })}
            </BentoTile>
          )}
        </MotiView>

        {/* Daily report status */}
        <MotiView {...entrance(section++, reduce)}>
          <BentoTile>
            <Text style={[Type.label, { color: Colors.textMuted }]}>Daily report</Text>
            <View style={[styles.statusRow, { marginTop: Space.sm }]}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: reportSubmitted ? Colors.success : Colors.borderStrong },
                ]}
              />
              <Text style={[Type.bodyMed, { color: Colors.text }]}>
                {reportSubmitted ? 'Submitted' : 'Pending'}
              </Text>
            </View>
          </BentoTile>
        </MotiView>
      </ScrollView>

      {/* Add-store modal */}
      <Modal
        visible={showStoreModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setShowStoreModal(false);
          resetStoreModal();
        }}
      >
        <View style={styles.modalContainer}>
          <Header
            title="Add a store"
            onBack={() => {
              setShowStoreModal(false);
              resetStoreModal();
            }}
          />
          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Store name</Text>
            <TextInput
              style={styles.input}
              value={newStoreName}
              onChangeText={setNewStoreName}
              placeholder="Store name"
              placeholderTextColor={Colors.textMuted}
            />

            <StoreLocationPicker value={storeLocation} onChange={setStoreLocation} />

            <Text style={styles.fieldLabel}>License number (optional)</Text>
            <TextInput
              style={styles.input}
              value={newStoreLicense}
              onChangeText={setNewStoreLicense}
              placeholder="Store license number"
              placeholderTextColor={Colors.textMuted}
            />

            <Button
              title="Add & check in"
              onPress={handleCreateStore}
              loading={creatingStore}
              disabled={!newStoreName.trim()}
              style={{ marginTop: Space.xl, marginBottom: 48 }}
            />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Layout.screenPad },
  greetRow: { flexDirection: 'row', alignItems: 'flex-start' },
  brandMark: { ...Type.label, color: Colors.accent },
  // Hero (dark surface)
  onDarkMuted: { color: Colors.textOnDark, opacity: 0.7 },
  onDarkValue: { color: Colors.textOnDark, ...tabularNums, marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  heroStats: { flexDirection: 'row', gap: Space.lg, marginTop: Space.md },
  heroSecondary: {
    marginTop: Space.lg,
    minHeight: Layout.tap,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Glass.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  // Bento
  bentoRow: { flexDirection: 'row', gap: Layout.gridGap, marginTop: Space.md },
  flex: { flex: 1 },
  sectionTitle: { color: Colors.text, marginBottom: Space.sm },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Space.sm,
  },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: Layout.tap, paddingLeft: Space.sm },
  addStoreLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    marginTop: Space.sm,
    minHeight: Layout.tap,
  },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.sm },
  storeRowDivider: { borderTopWidth: 1, borderTopColor: Colors.border },
  // Modal
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalBody: { flex: 1, padding: Layout.screenPad },
  fieldLabel: {
    ...Type.label,
    color: Colors.textMuted,
    marginBottom: Space.sm,
    marginTop: Space.lg,
  },
  input: {
    fontFamily: Typography.fontFamily,
    ...Type.body,
    color: Colors.text,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
});
