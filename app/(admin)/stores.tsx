import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TextInput,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography } from '../../constants/colors';
import Card from '../../components/Card';
import Button from '../../components/Button';
import { supabase } from '../../lib/supabase';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';

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

const NO_STATE = 'No State';

/**
 * Build the SectionList data: with an empty query, group stores by state
 * (state name as a tappable accordion header, "No State" last; collapsed
 * sections keep their header but render no rows). With a query, one flat
 * section (no header) filtered across every state — accordion state ignored.
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

export default function AdminStoresScreen({
  navigation,
}: {
  navigation: any;
}) {
  const [stores, setStores] = useState<Store[]>([]);
  const [search, setSearch] = useState('');
  // Accordion: all states start collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleSection = (title: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  const loadStores = useCallback(async () => {
    const { data } = await supabase
      .from('stores')
      .select('*')
      .order('name');
    setStores(data || []);
  }, []);

  // Refetch on focus so edits/deletes/adds from pushed screens show up.
  useFocusEffect(
    useCallback(() => {
      loadStores();
    }, [loadStores])
  );

  const { refreshing, onRefresh } = usePullToRefresh(loadStores);

  const sections = useMemo(
    () => buildSections(stores, search, expanded),
    [stores, search, expanded]
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerPad}>
        <Text style={styles.title}>Manage Stores</Text>
        <Button
          title="+ Add Store"
          onPress={() => navigation.navigate('StoreForm')}
          style={styles.addBtn}
        />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search stores by name..."
          placeholderTextColor={Colors.muted}
        />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
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
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate('StoreDetail', { store: item })}
          >
            <Card>
              <Text style={styles.storeName}>{item.name}</Text>
              <Text style={styles.storeAddress}>
                {item.address || 'No address'}
              </Text>
              <Text style={styles.tapHint}>Tap to know more Details →</Text>
            </Card>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Card>
            <Text style={styles.emptyText}>
              {search.trim() ? 'No stores match your search.' : 'No stores yet.'}
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
    marginBottom: 12,
  },
  addBtn: { marginBottom: 12 },
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
  emptyText: {
    fontFamily: Typography.fontFamily,
    ...Typography.body,
    color: Colors.muted,
  },
});
