import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, SectionList, Pressable, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Layout } from '../../constants/colors';
import Button from '../../components/Button';
import BentoTile from '../../components/BentoTile';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import SearchField from '../../components/SearchField';
import { ListSkeleton } from '../../components/skeleton/ListSkeleton';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { useAdminStores, Store } from '../../hooks/useStores';

const NO_STATE = 'No State';

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

export default function AdminStoresScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();
  const { data, refetch, isPending, isError } = useAdminStores();
  const stores = data ?? [];

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );
  const { refreshing, onRefresh } = usePullToRefresh(refetch);

  const toggleSection = (title: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  const sections = useMemo(
    () => buildSections(stores, search, expanded),
    [stores, search, expanded]
  );

  return (
    <View style={styles.container}>
      <View style={[styles.headerPad, { paddingTop: insets.top + Space.md }]}>
        <Text style={[Type.title, { color: Colors.text, marginBottom: Space.md }]}>Stores</Text>
        {/* Calm list (no Von Restorff): Add store stays olive, not lime. */}
        <Button
          title="Add store"
          onPress={() => navigation.navigate('StoreForm')}
          style={{ marginBottom: Space.md }}
        />
        <SearchField value={searchInput} onChange={setSearchInput} placeholder="Search stores by name" />
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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
          renderItem={({ item }) => (
            <Pressable
              onPress={() => navigation.navigate('StoreDetail', { store: item })}
              style={styles.rowWrap}
            >
              <BentoTile>
                <Text style={[Type.bodyMed, { color: Colors.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[Type.caption, { color: Colors.textMuted, marginTop: 2 }]} numberOfLines={1}>
                  {item.address || 'No address'}
                </Text>
              </BentoTile>
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="storefront-outline"
              title={search.trim() ? 'No matches' : 'No stores yet'}
              message={search.trim() ? undefined : 'Add your first store to get started.'}
              actionLabel={search.trim() ? undefined : 'Add store'}
              onAction={search.trim() ? undefined : () => navigation.navigate('StoreForm')}
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
});
