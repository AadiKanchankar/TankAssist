import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Type, Space, Layout } from '../../constants/colors';
import Header from '../../components/Header';
import { useAuthStore } from '../../store/useAuthStore';
import RepReportSection from '../(admin)/rep-report-detail';

/**
 * A sales manager's OWN field report — the same Daily/Weekly/Monthly section,
 * drill-downs and CSV/PDF a manager opens for a rep, pointed at themselves.
 *
 * The title and the line under it are the point: an SM now has two reports
 * (their day, their team's), and the costly mistake is reading one as the other.
 */
export default function MyReportScreen({ navigation }: { navigation: any }) {
  const profile = useAuthStore((s) => s.profile);
  if (!profile) return null;
  return (
    <View style={styles.container}>
      <Header title="My field report" onBack={() => navigation.goBack()} />
      <Text style={styles.scope}>
        Only your own visits, orders and travel. Your team’s figures are under Team.
      </Text>
      <RepReportSection rep={{ id: profile.id, name: profile.name }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scope: {
    ...Type.caption,
    color: Colors.textSecondary,
    paddingHorizontal: Layout.screenPad,
    paddingBottom: Space.sm,
  },
});
