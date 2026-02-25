import {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {radii, spacing} from '../theme';
import {ThemeColors, useTheme} from '../themeRuntime';

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

type StatusChipProps = {
  label: string;
  tone?: StatusTone;
};

export function StatusChip({label, tone = 'neutral'}: StatusChipProps) {
  const {colors, fontFamily} = useTheme();
  const styles = useMemo(() => createStyles(colors, fontFamily), [colors, fontFamily]);

  return (
    <View style={[styles.chip, tone === 'success' ? styles.success : null, tone === 'warning' ? styles.warning : null, tone === 'danger' ? styles.danger : null]}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

function createStyles(colors: ThemeColors, fontFamily: string) {
  return StyleSheet.create({
    chip: {
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.backgroundElevated,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      alignSelf: 'flex-start',
    },
    success: {
      borderColor: colors.accentSuccess,
    },
    warning: {
      borderColor: colors.accentWarning,
    },
    danger: {
      borderColor: colors.accentDanger,
    },
    label: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textPrimary,
      fontFamily,
    },
  });
}
