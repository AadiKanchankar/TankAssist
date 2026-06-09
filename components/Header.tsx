import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Typography } from '../constants/colors';

interface HeaderProps {
  title: string;
  onBack?: () => void;
  rightElement?: React.ReactNode;
}

export default function Header({ title, onBack, rightElement }: HeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.leftSection}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>{title}</Text>
      </View>
      {rightElement && <View>{rightElement}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: Colors.background,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  backArrow: {
    fontSize: 24,
    color: Colors.text,
    fontWeight: '700',
  },
  title: {
    fontFamily: Typography.fontFamily,
    ...Typography.sectionTitle,
    color: Colors.text,
  },
});
