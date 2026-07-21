import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, SectionList, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../../constants/colors';
import BentoTile from '../../components/BentoTile';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import SearchField from '../../components/SearchField';
import { ListSkeleton } from '../../components/skeleton/ListSkeleton';
import { useAuthStore } from '../../store/useAuthStore';
import { useRepStores, Store } from '../../hooks/useStores';

type ViewMode = 'assigned' | 'all';
type StoreStatus = 'visited' | 'in-progress' | 'pending';

const NO_STATE = 'No State';

// Empty query → group by state (accordion, "No State" last). Query → one flat section.
function buildSections(stores: Store[], query: string, expanded: Set<string>) {
  const q = query.trim().toLowerCase();
  if (q) {
    return [{ title: '', count: 0, data: stores.filter((s) => s.name.toLowerCase().includes(q)) }];
  }
  const map: Record<string, Store[]> = {};
  for (const s of stores) {
    const key = s.state || NO_STATE;
    if (!map[key]) map[key] = [];
    map[key].push(s);
  }
  return Object.keys(map)
    .sort((a, b) => (a === NO_STATE ? 1 : b === NO_STATE ? -1 : a.localeCompare(b)))
    .map((k) => ({ title: k, count: map[k].length, data: expanded.has(k) ? map[k] : [] }));
}

export default function RepStoresScreen({ navigation }: { navigation: any }) {
  const { profile } = useAuthStore();
  const insets = useSafeAreaInsets();
  const { data, refetch, isPending, isError } = useRepStores(profile?.id);
  const assignments = data?.assignments ?? [];
  const allStores = data?.allStores ?? [];
  const visited = data?.visited ?? new Set<string>();
  const inProgress = data?.inProgress ?? new Set<string>();

  const [viewMode, setViewMode] = useState<ViewMode>('assigned');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Debounce the in-memory filter so large lists don't re-section per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const toggleSection = (title: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  const getStatus = (storeId: string): StoreStatus =>
    visited.has(storeId) ? 'visited' : inProgress.has(storeId) ? 'in-progress' : 'pending';

  const assignedStoreIds = new Set(assignments.map((a) => a.store_id));
  const dataset: Store[] = viewMode === 'assigned' ? assignments.map((a) => a.stores) : allStores;
  const sections = useMemo(
    () => buildSections(dataset, search, expanded),
    [dataset, search, expanded]
  );

  return (
    <View style={styles.container}>
      <View style={[styles.headerPad, { paddingTop: insets.top + Space.md }]}>
        <Text style={[Type.title, { color: Colors.text }]}>Your stores</Text>
        <Text style={[Type.body, { color: Colors.textSecondary, marginTop: 2 }]}>
          {assignments.length} assigned · {visited.size} visited
        </Text>

        <View style={styles.toggleRow}>
          {(['assigned', 'all'] as ViewMode[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => setViewMode(m)}
              style={[styles.toggleBtn, viewMode === m && styles.toggleBtnActive]}
            >
              <Text style={[styles.toggleText, viewMode === m && styles.toggleTextActive]}>
                {m === 'assigned' ? 'Assigned today' : 'All stores'}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ marginTop: Space.md }}>
          <SearchField value={searchInput} onChange={setSearchInput} placeholder="Search by name" />
        </View>
      </View>

      {isPending && !data ? (
        <ListSkeleton />
      ) : isError && !data ? (
        <ErrorState onRetry={refetch} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Layout.tabBar + insets.bottom + Space.md },
          ]}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) =>
            section.title ? (
              <Pressable style={styles.sectionHeaderRow} onPress={() => toggleSection(section.title)}>
                <Text style={[Type.section, { color: Colors.text }]}>
                  {section.title} ({section.count})
                </Text>
                <Ionicons
                  name={expanded.has(section.title) ? 'chevron-down' : 'chevron-forward'}
                  size={16}
                  color={Colors.textMuted}
                />
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => {
            const status = getStatus(item.id);
            const isAssigned = assignedStoreIds.has(item.id);
            const dotColor =
              status === 'visited'
                ? Colors.success
                : status === 'in-progress'
                ? Colors.accent
                : Colors.borderStrong;
            return (
              <Pressable
                onPress={() => navigation.navigate('StoreDetail', { store: item })}
                style={styles.rowWrap}
              >
                <BentoTile>
                  <View style={styles.storeRow}>
                    <View style={[styles.dot, { backgroundColor: dotColor }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[Type.bodyMed, { color: Colors.text }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={[Type.caption, { color: Colors.textMuted }]} numberOfLines={1}>
                        {item.address || 'No address'}
                      </Text>
                    </View>
                    <View style={styles.rightCol}>
                      {viewMode === 'all' && isAssigned && (
                        <Text style={styles.assignedBadge}>Assigned</Text>
                      )}
                      <Text style={[Type.caption, { color: Colors.textMuted }]}>
                        {status === 'visited' ? 'Visited' : status === 'in-progress' ? 'In progress' : 'Pending'}
                      </Text>
                    </View>
                  </View>
                </BentoTile>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              icon="storefront-outline"
              title={
                viewMode === 'assigned'
                  ? 'No stores assigned today'
                  : search.trim()
                  ? 'No matches'
                  : 'No stores yet'
              }
              message={
                viewMode === 'assigned'
                  ? 'Stores assigned to you today show up here.'
                  : undefined
              }
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerPad: { paddingHorizontal: Layout.screenPad, paddingBottom: Space.sm },
  toggleRow: {
    flexDirection: 'row',
    marginTop: Space.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  toggleBtn: { flex: 1, paddingVertical: Space.sm, alignItems: 'center', minHeight: Layout.tap, justifyContent: 'center' },
  toggleBtnActive: { backgroundColor: Colors.accent },
  toggleText: { ...Type.label, color: Colors.textMuted },
  toggleTextActive: { color: Colors.white },
  list: { paddingHorizontal: Layout.screenPad, paddingTop: Space.sm },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Space.md,
    marginBottom: Space.sm,
    minHeight: Layout.tap,
  },
  rowWrap: { marginBottom: Space.md },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rightCol: { alignItems: 'flex-end', gap: 2 },
  assignedBadge: { ...Type.caption, fontWeight: '700', color: Colors.accent },
});
