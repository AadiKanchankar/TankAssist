import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Colors, Type, Space, Radius } from '../constants/colors';
import Button from './Button';
import { errorRef } from '../lib/userError';

interface Props {
  children: React.ReactNode;
  /** Where this boundary sits, so a report says which screen died. */
  label?: string;
  onReset?: () => void;
}

interface State {
  error: Error | null;
  info: string;
}

/**
 * Catches render/lifecycle errors so a thrown exception shows a recoverable
 * screen instead of killing the app.
 *
 * Why this exists: an OTA shipped a crash that could not be root-caused after
 * the fact, because a React render error in a release build unmounts the whole
 * tree with nothing left on screen and nothing written down. A boundary turns
 * that into a readable message the rep can copy and send — the next crash is
 * diagnosable in one message instead of a guessing round-trip.
 *
 * NOT a substitute for fixing the underlying bug. It is the net, not the fix.
 * Note it also cannot catch errors thrown outside React's render cycle
 * (event handlers, async callbacks, native crashes) — those still surface as
 * unhandled rejections or a native abort.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Kept in state rather than only logged: a release build has no console
    // the rep can reach, so the stack has to be on screen to be useful.
    this.setState({ info: info?.componentStack?.slice(0, 2000) ?? '' });
    // Still log it, for anyone attached to Metro or logcat.
    console.error(`[ErrorBoundary ${errorRef(error)}]`, this.props.label ?? '', error, info?.componentStack);
  }

  reset = () => {
    this.setState({ error: null, info: '' });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Something broke on this screen</Text>
          <Text style={styles.body}>
            Your work is not lost — anything already saved is on the server. Go back and try again.
            If it keeps happening, long-press the reference below to copy it and send it to the
            office.
          </Text>

          <Button title="Try again" onPress={this.reset} style={{ marginTop: Space.lg }} />

          {/* The error's own text can carry DB detail (lib/userError), so a
              release build shows only the reference + where it happened; the
              full error is in logcat under the same ref. Dev builds keep it. */}
          <View style={styles.detail}>
            <Text style={styles.detailText} selectable>
              {errorRef(error)}
              {this.props.label ? ` · ${this.props.label}` : ''}
              {__DEV__ ? `\n${error.name}: ${error.message}\n\n${error.stack?.slice(0, 1200) ?? ''}` : ''}
              {this.state.info ? `\n${this.state.info.slice(0, 600)}` : ''}
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Space.lg, paddingTop: Space.xl * 2 },
  title: { ...Type.title, color: Colors.text },
  body: { ...Type.body, color: Colors.textSecondary, marginTop: Space.sm, lineHeight: 22 },
  detail: {
    marginTop: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
  },
  detailText: { ...Type.caption, color: Colors.textMuted, fontFamily: 'monospace' },
});
