import {ReactNode, useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {radii, spacing} from '../theme';
import {ThemeColors, useTheme} from '../themeRuntime';

type SectionCardProps = {
  title: string;
  subtitle?: string;
  titleRight?: ReactNode;
  children: ReactNode;
};

export function SectionCard({title, subtitle, titleRight, children}: SectionCardProps) {
  const {colors, fontFamily} = useTheme();
  const styles = useMemo(() => createStyles(colors, fontFamily), [colors, fontFamily]);

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        {titleRight ? <View style={styles.titleRight}>{titleRight}</View> : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

function createStyles(colors: ThemeColors, fontFamily: string) {
  return StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderRadius: radii.lg,
      backgroundColor: colors.backgroundCard,
      padding: spacing.md,
      gap: spacing.xs,
    },
    title: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
      fontFamily,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    titleRight: {
      flexShrink: 1,
    },
    subtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      fontFamily,
    },
    content: {
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
  });
}
