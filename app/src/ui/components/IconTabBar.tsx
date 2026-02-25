import {memo, useMemo} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';

import {radii, spacing} from '../theme';
import {ThemeColors, useTheme} from '../themeRuntime';

export type IconTabItem<T extends string> = {
  key: T;
  label: string;
  icon: string;
  accessibilityLabel: string;
};

type IconTabBarProps<T extends string> = {
  tabs: Array<IconTabItem<T>>;
  activeTab: T;
  onSelect: (tab: T) => void;
};

function IconTabBarBase<T extends string>({tabs, activeTab, onSelect}: IconTabBarProps<T>) {
  const {colors, fontFamily} = useTheme();
  const styles = useMemo(() => createStyles(colors, fontFamily), [colors, fontFamily]);

  return (
    <View style={styles.tabBar}>
      {tabs.map(tab => {
        const isActive = tab.key === activeTab;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="button"
            accessibilityLabel={tab.accessibilityLabel}
            onPress={() => onSelect(tab.key)}
            style={({pressed}) => [styles.tabButton, isActive ? styles.activeTab : styles.inactiveTab, pressed ? styles.pressed : null]}>
            {isActive ? <View style={styles.activeGlow} /> : null}
            <Text style={[styles.icon, isActive ? styles.activeText : styles.inactiveText]}>{tab.icon}</Text>
            <Text style={[styles.label, isActive ? styles.activeText : styles.inactiveText]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const IconTabBar = memo(IconTabBarBase) as typeof IconTabBarBase;

function createStyles(colors: ThemeColors, fontFamily: string) {
  return StyleSheet.create({
    tabBar: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderTopColor: colors.borderSubtle,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
      backgroundColor: colors.backgroundElevated,
    },
    tabButton: {
      flex: 1,
      borderWidth: 1,
      borderRadius: radii.md,
      minHeight: 54,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xs,
      overflow: 'hidden',
    },
    activeTab: {
      backgroundColor: colors.backgroundCard,
      borderColor: colors.accentPrimary,
    },
    inactiveTab: {
      backgroundColor: colors.backgroundCard,
      borderColor: colors.borderStrong,
    },
    pressed: {
      opacity: 0.88,
    },
    activeGlow: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: '50%',
      backgroundColor: `${colors.accentPrimary}22`,
    },
    icon: {
      fontSize: 15,
      marginBottom: 1,
      fontFamily,
    },
    label: {
      fontSize: 10,
      fontWeight: '700',
      fontFamily,
    },
    activeText: {
      color: colors.textPrimary,
    },
    inactiveText: {
      color: colors.textSecondary,
    },
  });
}
