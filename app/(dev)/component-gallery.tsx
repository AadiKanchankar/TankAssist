// Dev-only gallery to eyeball Phase A tokens + primitives. Not wired into any
// production nav tree. To view: temporarily render <ComponentGallery /> as the
// App root, or add it to a stack while developing.
import React, { useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Colors,
  Type,
  Space,
  Layout,
  Radius,
} from '../../constants/colors';
import BentoTile from '../../components/BentoTile';
import Metric from '../../components/Metric';
import Donut from '../../components/Donut';
import TrendBars from '../../components/TrendBars';
import PipelineStrip from '../../components/PipelineStrip';
import StatusPill from '../../components/StatusPill';
import SuccessOverlay from '../../components/SuccessOverlay';
import EmptyState from '../../components/EmptyState';
import Autocomplete, { AutocompleteItem } from '../../components/Autocomplete';
import Breadcrumbs from '../../components/Breadcrumbs';
import { SkelBlock } from '../../components/skeleton/Skeleton';
import { DashboardSkeleton } from '../../components/skeleton/DashboardSkeleton';

const STORES: AutocompleteItem[] = [
  { id: '1', label: 'Ganguli Wines', sublabel: 'Kolkata' },
  { id: '2', label: 'Park Street Cellars', sublabel: 'Kolkata' },
  { id: '3', label: 'Salt Lake Spirits', sublabel: 'Bidhannagar' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[Type.label, styles.sectionTitle]}>{title}</Text>
      {children}
    </View>
  );
}

export default function ComponentGallery() {
  const [results, setResults] = useState<AutocompleteItem[]>([]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[Type.title, { color: Colors.text }]}>Component gallery</Text>

        <Section title="Metrics + bento tiles">
          <View style={styles.row}>
            <BentoTile style={styles.flex}>
              <Metric label="Cases today" value={42} delta={8} deltaSuffix="%" />
            </BentoTile>
            <BentoTile style={styles.flex}>
              <Metric label="Stores visited" value={6} delta={-2} />
            </BentoTile>
          </View>
          <BentoTile variant="dark">
            <Metric label="Cases this month" value={318} spotlight onDark />
          </BentoTile>
        </Section>

        <Section title="Donut (pipeline)">
          <BentoTile style={{ alignItems: 'center' }}>
            <Donut
              centerValue={17}
              centerLabel="open"
              data={[
                { label: 'To process', value: 9, color: Colors.accent },
                { label: 'Dispatched', value: 4, color: Colors.text },
                { label: 'In transit', value: 4, color: Colors.warning },
              ]}
            />
          </BentoTile>
        </Section>

        <Section title="Trend bars (spotlight latest)">
          <BentoTile>
            <TrendBars
              data={[
                { label: 'M', value: 12 },
                { label: 'T', value: 18 },
                { label: 'W', value: 9 },
                { label: 'T', value: 22 },
                { label: 'F', value: 30 },
              ]}
            />
          </BentoTile>
        </Section>

        <Section title="Pipeline strip">
          <BentoTile>
            <PipelineStrip status="dispatched" />
          </BentoTile>
        </Section>

        <Section title="Status pills">
          <View style={styles.pills}>
            {['placed', 'in_process', 'dispatched', 'in_transit', 'delivered', 'cancelled'].map(
              (s) => (
                <StatusPill key={s} status={s} />
              )
            )}
          </View>
        </Section>

        <Section title="Breadcrumbs">
          <Breadcrumbs
            items={[
              { label: 'Stores', onPress: () => {} },
              { label: 'Ganguli Wines', onPress: () => {} },
              { label: 'Order #1204' },
            ]}
          />
        </Section>

        <Section title="Autocomplete">
          <Autocomplete
            placeholder="Search stores"
            results={results}
            onQueryChange={(q) =>
              setResults(
                q ? STORES.filter((s) => s.label.toLowerCase().includes(q.toLowerCase())) : []
              )
            }
            onSelect={() => setResults([])}
          />
        </Section>

        <Section title="Empty state">
          <EmptyState
            icon="storefront-outline"
            title="No assigned stores"
            message="Stores you're assigned to show up here. Check with your manager."
            actionLabel="Refresh"
            onAction={() => {}}
          />
        </Section>

        <Section title="Skeletons">
          <View style={styles.row}>
            <SkelBlock w="48%" h={72} r={Radius.card} />
            <SkelBlock w="48%" h={72} r={Radius.card} />
          </View>
          <View style={{ marginTop: Space.md }}>
            <DashboardSkeleton />
          </View>
        </Section>

        <Section title="Success overlay (peak-end)">
          <View style={styles.overlayBox}>
            <SuccessOverlay label="Checked out" />
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Layout.screenPad, gap: Space.xl, paddingBottom: Space.xxl },
  section: { gap: Space.sm },
  sectionTitle: { color: Colors.textMuted },
  row: { flexDirection: 'row', gap: Layout.gridGap },
  flex: { flex: 1 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  overlayBox: {
    height: 160,
    borderRadius: Radius.card,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
});
