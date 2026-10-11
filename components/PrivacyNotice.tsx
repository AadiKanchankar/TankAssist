import React, { useMemo } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Type, Space, Radius, Layout } from '../constants/colors';
import Header from './Header';
import {
  POLICY_MARKDOWN,
  POLICY_VERSION,
  POLICY_EFFECTIVE_DATE,
  POLICY_IS_DRAFT,
} from '../constants/privacyPolicy';
import { parseBlocks, parseSpans } from '../lib/markdownBlocks';

/**
 * The Privacy & Data notice, rendered from constants/privacyPolicy.ts — the one
 * place the text lives. Opened from Profile (every role) and from the login
 * screen, before any permission is asked.
 */
export default function PrivacyNotice({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const blocks = useMemo(() => parseBlocks(POLICY_MARKDOWN), []);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.screen}>
        <Header title="Privacy & Data" onBack={onClose} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xxl }]}>
          <Text style={[Type.label, { color: Colors.accent }]}>TankAssist · employee privacy notice</Text>
          <Text style={styles.meta}>
            Version {POLICY_VERSION} · Effective {POLICY_EFFECTIVE_DATE ?? 'date not yet set'}
          </Text>
          {POLICY_IS_DRAFT ? (
            <View style={styles.draft}>
              <Text style={[Type.label, { color: Colors.warning }]}>Draft — pending review</Text>
              <Text style={[Type.caption, { color: Colors.textSecondary, marginTop: 2 }]}>
                Highlighted items are still being finalised by the company.
              </Text>
            </View>
          ) : null}
          {blocks.map((b, i) => {
            if (b.kind === 'h1' || b.kind === 'h2') {
              return <Text key={i} style={styles.h2} accessibilityRole="header">{b.text}</Text>;
            }
            if (b.kind === 'p') return <Inline key={i} text={b.text} style={styles.p} />;
            if (b.kind === 'li') {
              return (
                <View key={i} style={styles.li}>
                  <Text style={styles.bullet}>•</Text>
                  <Inline text={b.text} style={[styles.p, { flex: 1, marginBottom: 0 }]} />
                </View>
              );
            }
            // Tables become stacked label/value cards: two columns of prose
            // don't fit a phone, and a reader scans them as pairs anyway.
            return (
              <View key={i} style={styles.table}>
                {b.rows.map((r, j) => (
                  <View key={j} style={[styles.row, j > 0 && styles.rowRule]}>
                    <Inline text={r[0] ?? ''} style={styles.rowKey} />
                    <Inline text={r.slice(1).join(' · ')} style={styles.rowVal} />
                  </View>
                ))}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Inline({ text, style }: { text: string; style: any }) {
  return (
    <Text style={style}>
      {parseSpans(text).map((s, i) => (
        <Text key={i} style={s.bold ? styles.bold : s.placeholder ? styles.placeholder : undefined}>
          {s.text}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Layout.screenPad, maxWidth: 680, width: '100%', alignSelf: 'center' },
  meta: { ...Type.caption, color: Colors.textMuted, marginTop: 2 },
  draft: {
    marginTop: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgWarning,
  },
  h2: { ...Type.section, color: Colors.text, marginTop: Space.xl, marginBottom: Space.sm },
  p: { ...Type.body, color: Colors.text, marginBottom: Space.md },
  li: { flexDirection: 'row', gap: Space.sm, marginBottom: Space.sm, paddingLeft: Space.xs },
  bullet: { ...Type.body, color: Colors.accent },
  bold: { fontWeight: '700' },
  placeholder: { backgroundColor: Colors.bgWarning, color: Colors.text },
  table: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Space.md,
  },
  row: { padding: Space.md },
  rowRule: { borderTopWidth: 1, borderTopColor: Colors.border },
  rowKey: { ...Type.bodyMed, color: Colors.text },
  rowVal: { ...Type.body, color: Colors.textSecondary, marginTop: 2 },
});
