import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput, SectionList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../constants/colors';
import Header from './Header';
import { INDIA_STATES, INDIA_UNION_TERRITORIES } from '../constants/indiaStates';

/**
 * Searchable state / UT picker, in the shape of a billing-address selector.
 * Renders as a field that opens a full-screen searchable list. Stores the plain
 * state name, matching what the column already holds.
 */
export default function StatePicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (state: string) => void;
  error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (list: string[]) => (q ? list.filter((s) => s.toLowerCase().includes(q)) : list);
    return [
      { title: 'States', data: match(INDIA_STATES) },
      { title: 'Union territories', data: match(INDIA_UNION_TERRITORIES) },
    ].filter((s) => s.data.length > 0);
  }, [query]);

  return (
    <>
      <Pressable
        onPress={() => {
          setQuery('');
          setOpen(true);
        }}
        style={[styles.field, error && styles.fieldError]}
        accessibilityRole="button"
        accessibilityLabel={value ? `State: ${value}. Change` : 'Select a state'}
      >
        <Text style={[Type.body, { color: value ? Colors.text : Colors.textMuted, flex: 1 }]} numberOfLines={1}>
          {value || 'Select a state'}
        </Text>
        <Ionicons name="chevron-down" size={16} color={Colors.textMuted} />
      </Pressable>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={styles.sheet}>
          <Header title="Select state" onBack={() => setOpen(false)} />
          <View style={styles.searchWrap}>
            <View style={styles.search}>
              <Ionicons name="search" size={18} color={Colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search states and UTs"
                placeholderTextColor={Colors.textMuted}
                autoCorrect={false}
                autoFocus
                accessibilityLabel="Search states"
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
                </Pressable>
              )}
            </View>
          </View>

          <SectionList
            sections={sections}
            keyExtractor={(item) => item}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionHeader}>{section.title}</Text>
            )}
            renderItem={({ item }) => {
              const selected = item === value;
              return (
                <Pressable
                  style={styles.row}
                  onPress={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[Type.body, { color: Colors.text, flex: 1 }]}>{item}</Text>
                  {selected ? <Ionicons name="checkmark" size={18} color={Colors.accent} /> : null}
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <Text style={[Type.body, { color: Colors.textMuted, padding: Layout.screenPad }]}>
                No match for “{query}”.
              </Text>
            }
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Space.lg,
    minHeight: Layout.tap,
  },
  fieldError: { borderColor: Colors.alert },
  sheet: { flex: 1, backgroundColor: Colors.background },
  searchWrap: { paddingHorizontal: Layout.screenPad, paddingBottom: Space.sm },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Space.md,
    minHeight: Layout.tap,
  },
  searchInput: { flex: 1, ...Type.body, color: Colors.text, paddingVertical: Space.sm },
  list: { paddingHorizontal: Layout.screenPad, paddingBottom: Space.xxl },
  sectionHeader: { ...Type.label, color: Colors.textMuted, marginTop: Space.lg, marginBottom: Space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: Layout.tap,
    paddingVertical: Space.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
});
