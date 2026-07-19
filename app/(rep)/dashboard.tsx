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
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Typography } from '../../constants/colors';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Header from '../../components/Header';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';
import { totalRouteKm } from '../../lib/haversine';
import { directionsRouteKm } from '../../lib/directions';
import StoreLocationPicker from '../../components/StoreLocationPicker';
import type { StoreLocationValue } from '../../components/StoreLocationPicker';
import * as Location from 'expo-location';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';

interface StoreAssignment {
  id: string;
  store_id: string;
  stores: { id: string; name: string; address: string };
}

interface StoreVisit {
  store_id: string;
  check_out_time: string | null;
}

interface AttendanceRow {
  id: string;
  check_in_time: string | null;
  check_out_time: string | null;
  latitude: number | null;
  longitude: number | null;
  total_distance_km: number | null;
  total_market_time_minutes: number | null;
}

interface StoreSearchResult {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

export default function RepDashboard({
  navigation,
}: {
  navigation: any;
}) {
  const { profile } = useAuthStore();
  const [attendance, setAttendance] = useState<AttendanceRow | null>(null);
  const [assignments, setAssignments] = useState<StoreAssignment[]>([]);
  const [visits, setVisits] = useState<StoreVisit[]>([]);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [punchingOut, setPunchingOut] = useState(false);

  // Store search modal state
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [modalMode, setModalMode] = useState<'search' | 'add'>('search');
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

  const loadData = useCallback(async () => {
    if (!profile) return;

    // Fetch today's attendance
    const { data: att } = await supabase
      .from('attendance')
      .select('*')
      .eq('user_id', profile.id)
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`)
      .order('check_in_time', { ascending: false })
      .limit(1)
      .maybeSingle();
    setAttendance(att);

    // Fetch assigned stores for today
    const { data: assigns } = await supabase
      .from('store_assignments')
      .select('id, store_id, stores(id, name, address)')
      .eq('user_id', profile.id)
      .eq('assigned_date', today);
    setAssignments((assigns as any) || []);

    // Fetch today's visits
    const { data: vis } = await supabase
      .from('store_visits')
      .select('store_id, check_out_time')
      .eq('user_id', profile.id)
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`);
    setVisits(vis || []);

    // Check if daily report submitted
    const { data: report } = await supabase
      .from('daily_reports')
      .select('id')
      .eq('user_id', profile.id)
      .eq('report_date', today)
      .maybeSingle();
    setReportSubmitted(!!report);
  }, [profile, today]);

  // Refetch data every time the screen gains focus (tab switch, back nav, etc.)
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const { refreshing, onRefresh } = usePullToRefresh(loadData);

  const isCheckedIn = !!attendance?.check_in_time;
  const isPunchedOut = !!attendance?.check_out_time;

  const getStoreStatus = (storeId: string) => {
    const visit = visits.find((v) => v.store_id === storeId);
    if (!visit) return 'pending';
    return visit.check_out_time ? 'visited' : 'in-progress';
  };

  // --- Punch out ---

  const handlePunchOut = async () => {
    Alert.alert(
      'End Day',
      'Are you sure you want to punch out? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Punch Out',
          style: 'destructive',
          onPress: async () => {
            setPunchingOut(true);
            try {
              // Get current location
              const { status } = await Location.requestForegroundPermissionsAsync();
              if (status !== 'granted') {
                Alert.alert('Error', 'Location permission is required.');
                setPunchingOut(false);
                return;
              }
              const loc = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.BestForNavigation,
              });
              const checkOutTime = new Date().toISOString();

              // Calculate total market time
              const checkInTime = new Date(attendance!.check_in_time!);
              const totalMinutes = Math.round(
                (new Date(checkOutTime).getTime() - checkInTime.getTime()) / 60000
              );

              // Build waypoints: punch-in → store visits (sorted by time) → punch-out
              const waypoints: Array<{ latitude: number; longitude: number }> = [];

              // Punch-in coordinates
              if (attendance!.latitude && attendance!.longitude) {
                waypoints.push({
                  latitude: attendance!.latitude,
                  longitude: attendance!.longitude,
                });
              }

              // Store visit check-in coordinates, sorted by time
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
                    waypoints.push({
                      latitude: vc.latitude,
                      longitude: vc.longitude,
                    });
                  }
                }
              }

              // Punch-out coordinates
              waypoints.push({
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
              });

              // Total daily distance for TA: use the real road-network
              // route via Google Directions (rep's actual visited order,
              // optimize:false). Fall back to straight-line Haversine if
              // the API fails or there aren't enough points — never block
              // punch-out on this call.
              let distance = await directionsRouteKm(waypoints);
              if (distance == null) {
                distance = totalRouteKm(waypoints);
              }

              // Update attendance row
              await supabase
                .from('attendance')
                .update({
                  check_out_time: checkOutTime,
                  total_market_time_minutes: totalMinutes,
                  total_distance_km: distance,
                })
                .eq('id', attendance!.id);

              await loadData();
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to punch out.');
            }
            setPunchingOut(false);
          },
        },
      ]
    );
  };

  // --- Store search + creation ---

  const resetStoreModal = () => {
    setModalMode('search');
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
    resetStoreModal();
    navigation.navigate('StoreVisit', { store });
  };

  const handleCreateStore = async () => {
    if (!newStoreName.trim()) {
      Alert.alert('Error', 'Store name is required.');
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
      Alert.alert('Error', err.message || 'Failed to create store.');
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

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Greeting */}
        <Text style={styles.greeting}>
          {getGreeting()}, {profile?.name || 'Rep'}
        </Text>
        <Text style={styles.date}>{formattedDate}</Text>

        {/* Day Ended Banner */}
        {isPunchedOut && (
          <Card style={styles.endedBanner}>
            <Text style={styles.endedText}>Day ended. See you tomorrow.</Text>
          </Card>
        )}

        {/* Attendance Card */}
        <Card>
          <Text style={styles.cardLabel}>ATTENDANCE</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isCheckedIn ? Colors.success : Colors.alert },
              ]}
            />
            <Text style={styles.statusText}>
              {isCheckedIn ? 'Checked In' : 'Not Checked In'}
            </Text>
          </View>

          {!isCheckedIn && (
            <Button
              title="Check In"
              onPress={() => navigation.navigate('Attendance')}
              style={styles.actionBtn}
            />
          )}

          {isCheckedIn && !isPunchedOut && (
            <Button
              title="Punch Out / End Day"
              onPress={handlePunchOut}
              variant="danger"
              loading={punchingOut}
              style={styles.actionBtn}
            />
          )}

          {isPunchedOut && attendance && (
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>
                  {Math.floor((attendance.total_market_time_minutes || 0) / 60)}h{' '}
                  {(attendance.total_market_time_minutes || 0) % 60}m
                </Text>
                <Text style={styles.statLabel}>MARKET TIME</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>
                  {attendance.total_distance_km?.toFixed(1) || '0.0'} km
                </Text>
                <Text style={styles.statLabel}>DISTANCE</Text>
              </View>
            </View>
          )}
        </Card>

        {/* Punch In Store — only visible when checked in and day not ended */}
        {isCheckedIn && !isPunchedOut && (
          <Card>
            <Text style={styles.cardLabel}>STORE VISITS</Text>
            <Text style={styles.visitsSummary}>
              {completedVisits} completed today
            </Text>
            <Button
              title="Punch In Store"
              onPress={() => setShowStoreModal(true)}
              style={styles.actionBtn}
            />
          </Card>
        )}

        {/* Today's Assigned Stores */}
        {assignments.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Assigned Stores</Text>
            {assignments.map((a) => {
              const status = getStoreStatus(a.store_id);
              return (
                <Card key={a.id}>
                  <View style={styles.storeRow}>
                    <View
                      style={[
                        styles.statusDot,
                        {
                          backgroundColor:
                            status === 'visited'
                              ? Colors.success
                              : status === 'in-progress'
                              ? Colors.accent
                              : Colors.muted,
                        },
                      ]}
                    />
                    <View style={styles.storeInfo}>
                      <Text style={styles.storeName}>
                        {(a as any).stores?.name || 'Store'}
                      </Text>
                      <Text style={styles.storeAddress}>
                        {(a as any).stores?.address || ''}
                      </Text>
                    </View>
                    <Text style={styles.storeStatus}>
                      {status === 'visited'
                        ? '✓'
                        : status === 'in-progress'
                        ? '...'
                        : '—'}
                    </Text>
                  </View>
                </Card>
              );
            })}
          </>
        )}

        {/* Daily Report Status */}
        <Card>
          <Text style={styles.cardLabel}>DAILY REPORT</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: reportSubmitted
                    ? Colors.success
                    : Colors.muted,
                },
              ]}
            />
            <Text style={styles.statusText}>
              {reportSubmitted ? 'Submitted' : 'Pending'}
            </Text>
          </View>
        </Card>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Punch In Store Modal */}
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
            title={modalMode === 'search' ? 'Punch In Store' : 'Add New Store'}
            onBack={() => {
              if (modalMode === 'add') {
                setModalMode('search');
              } else {
                setShowStoreModal(false);
                resetStoreModal();
              }
            }}
          />

          {modalMode === 'search' ? (
            <View style={styles.modalBody}>
              <TextInput
                style={styles.searchInput}
                value={storeSearch}
                onChangeText={setStoreSearch}
                placeholder="Search store name..."
                placeholderTextColor={Colors.muted}
                autoFocus
              />

              {searchingStores && (
                <ActivityIndicator
                  size="small"
                  color={Colors.accent}
                  style={{ marginTop: 16 }}
                />
              )}

              <FlatList
                data={storeResults}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                style={styles.resultsList}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => handleSelectStore(item)}
                    style={styles.resultRow}
                  >
                    <Text style={styles.resultName}>{item.name}</Text>
                    <Text style={styles.resultAddress}>
                      {item.address || 'No address'}
                    </Text>
                  </TouchableOpacity>
                )}
                ListFooterComponent={
                  storeSearch.length >= 2 ? (
                    <TouchableOpacity
                      onPress={() => {
                        setNewStoreName(storeSearch);
                        setModalMode('add');
                      }}
                      style={styles.addStoreRow}
                    >
                      <Text style={styles.addStoreText}>
                        Can't find your store? Add it →
                      </Text>
                    </TouchableOpacity>
                  ) : null
                }
                ListEmptyComponent={
                  storeSearch.length >= 2 && !searchingStores ? (
                    <Text style={styles.noResultsText}>No stores found</Text>
                  ) : null
                }
              />
            </View>
          ) : (
            <ScrollView
              style={styles.modalBody}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.fieldLabel}>STORE NAME *</Text>
              <TextInput
                style={styles.searchInput}
                value={newStoreName}
                onChangeText={setNewStoreName}
                placeholder="Store name"
                placeholderTextColor={Colors.muted}
              />

              <StoreLocationPicker
                value={storeLocation}
                onChange={setStoreLocation}
              />

              <Text style={styles.fieldLabel}>LICENSE NUMBER (OPTIONAL)</Text>
              <TextInput
                style={styles.searchInput}
                value={newStoreLicense}
                onChangeText={setNewStoreLicense}
                placeholder="Store license number"
                placeholderTextColor={Colors.muted}
              />

              <Button
                title="Create & Check In"
                onPress={handleCreateStore}
                loading={creatingStore}
                disabled={!newStoreName.trim()}
                style={styles.createStoreBtn}
              />
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 24, paddingTop: 60 },
  greeting: {
    fontFamily: Typography.fontFamily,
    ...Typography.pageTitle,
    color: Colors.text,
  },
  date: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
    marginTop: 4,
    marginBottom: 32,
  },
  endedBanner: {
    backgroundColor: Colors.text,
    borderColor: Colors.text,
  },
  endedText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.white,
    textAlign: 'center',
    fontWeight: '600',
  },
  cardLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  statusText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.text,
    fontWeight: '600',
  },
  actionBtn: { marginTop: 16 },
  statsRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 24,
  },
  stat: {},
  statValue: {
    fontFamily: Typography.fontFamily,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },
  statLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginTop: 2,
  },
  visitsSummary: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.text,
    fontWeight: '600',
  },
  sectionTitle: {
    fontFamily: Typography.fontFamily,
    ...Typography.sectionTitle,
    color: Colors.text,
    marginTop: 8,
    marginBottom: 16,
  },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  storeInfo: { flex: 1, marginLeft: 12 },
  storeName: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
  },
  storeAddress: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.muted,
    marginTop: 2,
  },
  storeStatus: {
    fontFamily: Typography.fontFamily,
    fontSize: 20,
    color: Colors.muted,
    marginLeft: 8,
  },
  // Modal
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalBody: { flex: 1, padding: 24 },
  searchInput: {
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
  resultsList: { marginTop: 8 },
  resultRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  resultName: {
    fontFamily: Typography.fontFamily,
    ...Typography.cardTitle,
    color: Colors.text,
  },
  resultAddress: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.muted,
    marginTop: 2,
  },
  noResultsText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 24,
  },
  addStoreRow: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  addStoreText: {
    fontFamily: Typography.fontFamily,
    fontSize: 16,
    color: Colors.accent,
    fontWeight: '600',
  },
  // Add store form
  fieldLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
    marginBottom: 8,
    marginTop: 20,
  },
  predictionsContainer: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    marginTop: 4,
  },
  predictionRow: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  predictionText: {
    fontFamily: Typography.fontFamily,
    fontSize: 14,
    color: Colors.text,
  },
  selectedAddressText: {
    fontFamily: Typography.fontFamily,
    fontSize: 13,
    color: Colors.success,
    fontWeight: '600',
    marginTop: 8,
  },
  createStoreBtn: { marginTop: 32, marginBottom: 48 },
});
