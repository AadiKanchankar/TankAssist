import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type, Space, Radius, Layout } from '../constants/colors';

export interface AutocompleteItem {
  id: string;
  label: string;
  sublabel?: string;
}

interface AutocompleteProps {
  placeholder?: string;
  /** debounced — fires after the user stops typing */
  onQueryChange: (query: string) => void;
  results: AutocompleteItem[];
  onSelect: (item: AutocompleteItem) => void;
  loading?: boolean;
  debounceMs?: number;
  autoFocus?: boolean;
}

/** Debounced search field + result list (Hick's/Jakob's — familiar pattern). */
export default function Autocomplete({
  placeholder = 'Search',
  onQueryChange,
  results,
  onSelect,
  loading = false,
  debounceMs = 250,
  autoFocus = false,
}: AutocompleteProps) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (v: string) => {
      setText(v);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => onQueryChange(v.trim()), debounceMs);
    },
    [onQueryChange, debounceMs]
  );

  const clear = () => {
    setText('');
    if (timer.current) clearTimeout(timer.current);
    onQueryChange('');
  };

  const showList = focused && text.trim().length > 0;

  return (
    <View>
      <View style={styles.field}>
        <Ionicons name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={handleChange}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus={autoFocus}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={placeholder}
        />
        {loading ? (
          <ActivityIndicator size="small" color={Colors.accent} />
        ) : text.length > 0 ? (
          <Pressable onPress={clear} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {showList && (
        <View style={styles.list}>
          {results.length === 0 && !loading ? (
            <Text style={[Type.body, styles.noResults]}>No matches</Text>
          ) : (
            results.map((item) => (
              <Pressable
                key={item.id}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => {
                  onSelect(item);
                  setText(item.label);
                  setFocused(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={item.label}
              >
                <Text style={[Type.bodyMed, { color: Colors.text }]} numberOfLines={1}>
                  {item.label}
                </Text>
                {item.sublabel ? (
                  <Text style={[Type.caption, { color: Colors.textMuted }]} numberOfLines={1}>
                    {item.sublabel}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </View>
      )}
    </View>
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
    paddingHorizontal: Space.md,
    minHeight: Layout.tap,
  },
  input: { flex: 1, ...Type.body, color: Colors.text, paddingVertical: Space.sm },
  list: {
    marginTop: Space.xs,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  row: { paddingHorizontal: Space.md, paddingVertical: Space.sm, minHeight: Layout.tap, justifyContent: 'center' },
  rowPressed: { backgroundColor: Colors.surfaceAlt },
  noResults: { color: Colors.textMuted, padding: Space.md },
});
