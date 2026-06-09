import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { Colors, Typography } from '../constants/colors';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export default function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  textStyle,
}: ButtonProps) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[
        styles.base,
        isPrimary && styles.primary,
        variant === 'secondary' && styles.secondary,
        isDanger && styles.danger,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={isPrimary || isDanger ? Colors.white : Colors.accent}
        />
      ) : (
        <Text
          style={[
            styles.text,
            isPrimary && styles.primaryText,
            variant === 'secondary' && styles.secondaryText,
            isDanger && styles.dangerText,
            textStyle,
          ]}
        >
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primary: {
    backgroundColor: Colors.accent,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.accent,
  },
  danger: {
    backgroundColor: Colors.alert,
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    fontFamily: Typography.fontFamily,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  primaryText: {
    color: Colors.white,
  },
  secondaryText: {
    color: Colors.accent,
  },
  dangerText: {
    color: Colors.white,
  },
});
