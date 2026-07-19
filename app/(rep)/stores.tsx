import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography } from '../../constants/colors';
import Card from '../../components/Card';
import { useAuthStore } from '../../store/useAuthStore';
import { supabase } from '../../lib/supabase';

interface Store {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  contact_person: string | null;
  contact_number: string | null;
  license_number: string | null;
  owner_name: string | null;
  state: string | null;
}

interface StoreAssignment {
  id: string;
  store_id: string;
  stores: Store;
}

type ViewMode = 'assigned' | 'all';
type StoreStatus = 'visited' | 'in-progress' | 'pending';

const NO_STATE = 'No State';

/**
 * Empty query → group by state as a collapsible accordion ("No State" last;
 * collapsed sections keep their header, render no rows). Query → one flat
 * section, accordion state ignored.
 */
function buildSections(stores: Store[], query: string, expanded: Set<string>) {
  const q = query.trim().toLowerCase();
  if (q) {
    return [
      { title: '', count: 0, data: stores.filter((s) => s.name.toLowerCase().includes(q)) },
    ];
  }
  const map: Record<string, Store[]> = {};
  for (const s of stores) {
    const key = s.state || NO_STATE;
    if (!map[key]) map[key] = [];
    map[key].push(s);
  }
  return Object.keys(map)
    .sort((a, b) => {
      if (a === NO_STATE) return 1;
      if (b === NO_STATE) return -1;
      return a.localeCompare(b);
    })
    .map((k) => ({
      title: k,
      count: map[k].length,
      data: expanded.has(k) ? map[k] : [],
    }));
}

export default function RepStoresScreen({
  navigation,
}: {
  navigation: any;
}) {
  const { profile } = useAuthStore();
  const [viewMode, setViewMode] = useState<ViewMode>('assigned');
  const [assignments, setAssignments] = useState<StoreAssignment[]>([]);
  const [allStores, setAllStores] = useState<Store[]>([]);
  const [visitedStoreIds, setVisitedStoreIds] = useState<Set<string>>(new Set());
  const [inProgressStoreIds, setInProgressStoreIds] = useState<Set<string>>(
    new Set()
  );
  const [searchQuery, setSearchQuery] = useState('');
  // Accordion: all states start collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleSection = (title: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  const today = new Date().toISOString().split('T')[0];

  const loadData = useCallback(async () => {
    if (!profile) return;

    const { data: assigns } = await supabase
      .from('store_assignments')
      .select('id, store_id, stores(*)')
      .eq('user_id', profile.id)
      .eq('assigned_date', today);
    setAssignments((assigns as any) || []);

    const { data: storesData } = await supabase
      .from('stores')
      .select('*')
      .order('name');
    setAllStores(storesData || []);

    const { data: visits } = await supabase
      .from('store_visits')
      .select('store_id, check_out_time')
      .eq('user_id', profile.id)
      .gte('check_in_time', `${today}T00:00:00`)
      .lt('check_in_time', `${today}T23:59:59`);

    const visited = new Set<string>();
    const inProgress = new Set<string>();
    (visits || []).forEach((v) => {
      if (v.check_out_time) {
        visited.add(v.store_id);
      } else {
        inProgress.add(v.store_id);
      }
    });
    setVisitedStoreIds(visited);
    setInProgressStoreIds(inProgress);
  }, [profile, today]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const getStatus = (storeId: string): StoreStatus => {
    if (visitedStoreIds.has(storeId)) return 'visited';
    if (inProgressStoreIds.has(storeId)) return 'in-progress';
    return 'pending';
  };

  const assignedStoreIds = new Set(assignments.map((a) => a.store_id));

  // Dataset for the current mode, then grouped/filtered into sections.
  const dataset: Store[] =
    viewMode === 'assigned' ? assignments.map((a) => a.stores) : allStores;
  const sections = useMemo(
    () => buildSections(dataset, searchQuery, expanded),
    [dataset, searchQuery, expanded]
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerPad}>
        <Text style={styles.title}>My Stores</Text>
        <Text style={styles.subtitle}>
          {assignments.length} assigned • {visitedStoreIds.size} visited
        </Text>

        {/* Toggle: Assigned / All Stores */}
        <View style={styles.toggleRow}>
          <TouchableOpacity
            onPress={() => setViewMode('assigned')}
            style={[
              styles.toggleBtn,
              viewMode === 'assigned' && styles.toggleBtnActive,
            ]}
          >
            <Text
              style={[
                styles.toggleText,
                viewMode === 'assigned' && styles.toggleTextActive,
              ]}
            >
              Assigned Today
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setViewMode('all')}
            style={[
              styles.toggleBtn,
              viewMode === 'all' && styles.toggleBtnActive,
            ]}
          >
            <Text
              style={[
                styles.toggleText,
                viewMode === 'all' && styles.toggleTextActive,
              ]}
            >
              All Stores
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by name..."
          placeholderTextColor={Colors.muted}
        />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <TouchableOpacity
              style={styles.sectionHeaderRow}
              onPress={() => toggleSection(section.title)}
            >
              <Text style={styles.sectionHeader}>
                {section.title} ({section.count})
              </Text>
              <Ionicons
                name={
                  expanded.has(section.title)
                    ? 'chevron-down'
                    : 'chevron-forward'
                }
                size={16}
                color={Colors.muted}
              />
            </TouchableOpacity>
          ) : null
        }
        renderItem={({ item }) => {
          const status = getStatus(item.id);
          const isAssigned = assignedStoreIds.has(item.id);
          return (
            <TouchableOpacity
              onPress={() =>
                navigation.navigate('StoreDetail', { store: item })
              }
            >
              <Card>
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
                    <Text style={styles.storeName}>{item.name}</Text>
                    <Text style={styles.storeAddress}>
                      {item.address || 'No address'}
                    </Text>
                    <Text style={styles.tapHint}>Tap to know more Details →</Text>
                  </View>
                  <View style={styles.rightCol}>
                    {viewMode === 'all' && isAssigned && (
                      <Text style={styles.assignedBadge}>ASSIGNED</Text>
                    )}
                    <Text style={styles.statusLabel}>
                      {status === 'visited'
                        ? 'VISITED'
                        : status === 'in-progress'
                        ? 'IN PROGRESS'
                        : 'PENDING'}
                    </Text>
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <Card>
            <Text style={styles.emptyText}>
              {viewMode === 'assigned'
                ? 'No stores assigned for today.'
                : searchQuery.trim()
                ? 'No stores match your search.'
                : 'No stores found.'}
            </Text>
          </Card>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerPad: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 8 },
  title: {
    fontFamily: Typography.fontFamily,
    ...Typography.pageTitle,
    color: Colors.text,
  },
  subtitle: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
    marginTop: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    marginTop: 16,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: Colors.accent },
  toggleText: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
  },
  toggleTextActive: { color: Colors.white },
  searchInput: {
    fontFamily: Typography.fontFamily,
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 12,
  },
  list: { paddingHorizontal: 24, paddingBottom: 24 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
    paddingVertical: 4,
  },
  sectionHeader: {
    fontFamily: Typography.fontFamily,
    ...Typography.accordionHeader,
    color: Colors.text,
  },
  storeRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  storeInfo: { flex: 1 },
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
  tapHint: {
    fontFamily: Typography.fontFamily,
    fontSize: 12,
    color: Colors.accent,
    marginTop: 8,
  },
  rightCol: { alignItems: 'flex-end', marginLeft: 8 },
  assignedBadge: {
    fontFamily: Typography.fontFamily,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: Colors.accent,
    marginBottom: 2,
  },
  statusLabel: {
    fontFamily: Typography.fontFamily,
    ...Typography.label,
    color: Colors.muted,
  },
  emptyText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
  },
});
